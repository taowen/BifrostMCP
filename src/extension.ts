import * as vscode from 'vscode';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { 
    CallToolRequestSchema, 
    ListResourcesRequestSchema, 
    ListResourceTemplatesRequestSchema, 
    ListToolsRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';
import type { Server as HttpServer } from 'http';
import { Request, Response } from 'express';
import { mcpTools } from './tools';
import { createDebugPanel } from './debugPanel';
import { mcpServer, httpServer, setMcpServer, setHttpServer } from './globals';
import { runTool } from './toolRunner';
import { findBifrostConfig, BifrostConfig, getProjectBasePath } from './config';
import { smartSearch } from './search';

export async function activate(context: vscode.ExtensionContext) {
    let currentConfig: BifrostConfig | null = null;

    // Handle workspace folder changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await restartServerWithConfig();
        })
    );

    // Initial server start with config
    await restartServerWithConfig();

    // Register debug panel command
    context.subscriptions.push(
        vscode.commands.registerCommand('bifrost-mcp.openDebugPanel', () => {
            createDebugPanel(context);
        })
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('bifrost-mcp.startServer', async () => {
            try {
                if (httpServer) {
                    vscode.window.showInformationMessage(`MCP server is already running for project ${currentConfig?.projectName || 'unknown'}`);
                    return;
                }
                await restartServerWithConfig();
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to start MCP server: ${errorMsg}`);
            }
        }),
        vscode.commands.registerCommand('bifrost-mcp.stopServer', async () => {
            if (!httpServer && !mcpServer) {
                vscode.window.showInformationMessage('No MCP server is currently running');
                return;
            }
            
            if (mcpServer) {
                mcpServer.close();
                setMcpServer(undefined);
            }
            
            if (httpServer) {
                httpServer.close();
                setHttpServer(undefined);
            }
            
            vscode.window.showInformationMessage('MCP server stopped');
        }),
        vscode.commands.registerCommand('bifrost-mcp.smartSearch', async () => {
            try {
                // 获取用户输入
                const prompt = await vscode.window.showInputBox({
                    placeHolder: '请输入您想要搜索或了解的内容...',
                    prompt: '智能搜索 - 支持代码理解、修改建议等',
                    ignoreFocusOut: true
                });
                
                if (!prompt) {
                    return; // 用户取消了输入
                }
                
                // 显示进度指示器
                const result = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: '正在进行智能搜索...',
                    cancellable: false
                }, async (progress) => {
                    progress.report({ increment: 0, message: '分析意图中...' });
                    const searchResult = await smartSearch(prompt);
                    progress.report({ increment: 100, message: '搜索完成!' });
                    return searchResult;
                });
                
                // 在新的编辑器中显示结果
                const doc = await vscode.workspace.openTextDocument({
                    content: result,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc);
                
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`智能搜索失败: ${errorMsg}`);
                console.error('Smart search error:', error);
            }
        })
    );

    async function restartServerWithConfig() {
        // Stop existing server if running
        if (mcpServer) {
            mcpServer.close();
            setMcpServer(undefined);
        }
        if (httpServer) {
            httpServer.close();
            setHttpServer(undefined);
        }

        // Get workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            console.log('No workspace folder found');
            return;
        }

        // Find config in current workspace - will return DEFAULT_CONFIG if none found
        const config = await findBifrostConfig(workspaceFolders[0]);
        currentConfig = config!; // We know this is never null since findBifrostConfig always returns DEFAULT_CONFIG
        await startMcpServer(config!);
    }

    async function startMcpServer(config: BifrostConfig): Promise<{ mcpServer: Server, httpServer: HttpServer, port: number }> {
        // Create an MCP Server with project-specific info
        setMcpServer(new Server(
            {
                name: config.projectName,
                version: "0.1.0",
                description: config.description
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                }
            }
        ));

        // Add tools handlers
        mcpServer!.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: mcpTools
        }));

        mcpServer!.setRequestHandler(ListResourcesRequestSchema, async () => ({
            resources: []
        }));

        mcpServer!.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
            templates: []
        }));

        // Add call tool handler
        mcpServer!.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                const { name, arguments: args } = request.params;
                let result: any;
                
                // Verify file exists for commands that require it
                if (args && typeof args === 'object' && 'textDocument' in args && 
                    args.textDocument && typeof args.textDocument === 'object' && 
                    'uri' in args.textDocument && typeof args.textDocument.uri === 'string') {
                    const uri = vscode.Uri.parse(args.textDocument.uri);
                    try {
                        await vscode.workspace.fs.stat(uri);
                    } catch (error) {
                        return {
                            content: [{ 
                                type: "text", 
                                text: `Error: File not found - ${uri.fsPath}` 
                            }],
                            isError: true
                        };
                    }
                }
                
                result = await runTool(name, args);

                return { content: [{ type: "text", text: JSON.stringify(result) }] };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: "text", text: `Error: ${errorMessage}` }],
                    isError: true,
                };
            }
        });

        // Set up Express app
        const app = express();
        app.use(cors());
        app.use(express.json());

        // Track active transports by session ID
        const transports: { [sessionId: string]: SSEServerTransport } = {};

        const basePath = getProjectBasePath(config);

        // Create project-specific SSE endpoint
        app.get(`${basePath}/sse`, async (req: Request, res: Response) => {
            console.log(`New SSE connection attempt for project ${config.projectName}`);
            
            req.socket.setTimeout(0);
            req.socket.setNoDelay(true);
            req.socket.setKeepAlive(true);
            
            try {
                // Create transport with project-specific message endpoint path
                const transport = new SSEServerTransport(`${basePath}/message`, res);
                const sessionId = transport.sessionId;
                transports[sessionId] = transport;

                const keepAliveInterval = setInterval(() => {
                    if (res.writable) {
                        res.write(': keepalive\n\n');
                    }
                }, 30000);

                if (mcpServer) {
                    await mcpServer.connect(transport);
                    console.log(`Server connected to SSE transport with session ID: ${sessionId} for project ${config.projectName}`);
                    
                    req.on('close', () => {
                        console.log(`SSE connection closed for session ${sessionId}`);
                        clearInterval(keepAliveInterval);
                        delete transports[sessionId];
                        transport.close().catch(err => {
                            console.error('Error closing transport:', err);
                        });
                    });
                } else {
                    console.error('MCP Server not initialized');
                    res.status(500).end();
                    return;
                }
            } catch (error) {
                console.error('Error in SSE connection:', error);
                res.status(500).end();
            }
        });
        
        // Create project-specific message endpoint
        app.post(`${basePath}/message`, async (req: Request, res: Response) => {
            const sessionId = req.query.sessionId as string;
            console.log(`Received message for session ${sessionId} in project ${config.projectName}:`, req.body?.method);
            
            const transport = transports[sessionId];
            if (!transport) {
                console.error(`No transport found for session ${sessionId}`);
                res.status(400).json({
                    jsonrpc: "2.0",
                    id: req.body?.id,
                    error: {
                        code: -32000,
                        message: "No active session found"
                    }
                });
                return;
            }
            
            try {
                await transport.handlePostMessage(req, res, req.body);
                console.log('Message handled successfully');
            } catch (error) {
                console.error('Error handling message:', error);
                res.status(500).json({
                    jsonrpc: "2.0",
                    id: req.body?.id,
                    error: {
                        code: -32000,
                        message: String(error)
                    }
                });
            }
        });
        
        // Add project-specific health check endpoint
        app.get(`${basePath}/health`, (req: Request, res: Response) => {
            res.status(200).json({ 
                status: 'ok',
                project: config.projectName,
                description: config.description
            });
        });

        try {
            const serv = app.listen(config.port);
            setHttpServer(serv);
            vscode.window.showInformationMessage(`MCP server listening on http://localhost:${config.port}${basePath}`);
            console.log(`MCP Server for project ${config.projectName} listening on http://localhost:${config.port}${basePath}`);
            return {
                mcpServer: mcpServer!,
                httpServer: httpServer!,
                port: config.port
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start server on configured port ${config.port}${basePath}. Please check if the port is available or configure a different port in bifrost.config.json. Error: ${errorMsg}`);
            throw new Error(`Failed to start server on configured port ${config.port}. Please check if the port is available or configure a different port in bifrost.config.json. Error: ${errorMsg}`);
        }
    }
}

export function deactivate() {
    if (mcpServer) {
        mcpServer.close();
    }
    if (httpServer) {
        httpServer.close();
    }
}