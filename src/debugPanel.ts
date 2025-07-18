import * as vscode from 'vscode';
import { webviewHtml } from './webview';
import { mcpServer } from './globals';
import { runTool } from './toolRunner';
let debugPanel: vscode.WebviewPanel | undefined;
export function createDebugPanel(context: vscode.ExtensionContext) {
    if (debugPanel) {
        debugPanel.reveal();
        return;
    }

    debugPanel = vscode.window.createWebviewPanel(
        'mcpDebug',
        'MCP Debug Panel',
        vscode.ViewColumn.Two,
        {
            enableScripts: true
        }
    );

    // Get workspace files for autocomplete
    async function getWorkspaceFiles(): Promise<string[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const files: string[] = [];
        for (const folder of workspaceFolders) {
            const pattern = new vscode.RelativePattern(folder, '**/*');
            const uris = await vscode.workspace.findFiles(pattern);
            files.push(...uris.map(uri => uri.toString()));
        }
        return files;
    }

    // Send initial file list and set up file watcher
    getWorkspaceFiles().then(files => {
        debugPanel?.webview.postMessage({ type: 'files', files });
    });

    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    fileWatcher.onDidCreate(() => {
        getWorkspaceFiles().then(files => {
            debugPanel?.webview.postMessage({ type: 'files', files });
        });
    });
    fileWatcher.onDidDelete(() => {
        getWorkspaceFiles().then(files => {
            debugPanel?.webview.postMessage({ type: 'files', files });
        });
    });

    debugPanel.onDidDispose(() => {
        fileWatcher.dispose();
        debugPanel = undefined;
    });
    debugPanel.webview.html = webviewHtml;

    // Handle messages from the webview
    debugPanel.webview.onDidReceiveMessage(async message => {
        if (message.command === 'getCurrentFile') {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const uri = editor.document.uri;
                debugPanel?.webview.postMessage({
                    type: 'currentFile',
                    tool: message.tool,
                    uri: uri.toString()
                });
            } else {
                debugPanel?.webview.postMessage({
                    type: 'currentFile',
                    tool: message.tool,
                    error: 'No active editor found'
                });
                vscode.window.showInformationMessage('Please open a file in the editor to use this feature');
            }
        } else if (message.command === 'execute' && mcpServer) {
            try {
                // Create a request handler function that matches our server's handlers
                const handleRequest = async (request: { params: { name: string; arguments: any } }) => {
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

                        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        return {
                            content: [{ type: "text", text: `Error: ${errorMessage}` }],
                            isError: true,
                        };
                    }
                };

                const result = await handleRequest({
                    params: {
                        name: message.tool,
                        arguments: message.params
                    }
                });

                debugPanel?.webview.postMessage({
                    type: 'result',
                    tool: message.tool,
                    result: result
                });
            } catch (error) {
                debugPanel?.webview.postMessage({
                    type: 'result',
                    tool: message.tool,
                    result: { error: String(error) }
                });
            }
        }
    });
}
