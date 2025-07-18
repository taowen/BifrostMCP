import * as vscode from 'vscode';
import { useCopilotChat } from './copilotChat';

/**
 * 调试日志管理器
 */
class DebugLogger {
    private static outputChannel: vscode.OutputChannel | null = null;
    
    static init() {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('Smart Search Debug');
        }
    }
    
    static log(message: string, data?: any) {
        this.init();
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage, data || '');
        this.outputChannel?.appendLine(logMessage);
        if (data) {
            this.outputChannel?.appendLine(JSON.stringify(data, null, 2));
        }
    }
    
    static logGPTCall(prompt: string, response: string) {
        this.init();
        this.outputChannel?.appendLine('=== GPT 调用 ===');
        this.outputChannel?.appendLine('Prompt:');
        this.outputChannel?.appendLine(prompt);
        this.outputChannel?.appendLine('\nResponse:');
        this.outputChannel?.appendLine(response);
        this.outputChannel?.appendLine('================');
    }
    
    static show() {
        this.init();
        this.outputChannel?.show(true);
    }
}

/**
 * 实体类型枚举
 */
enum EntityType {
    FUNCTION = 'function',
    CLASS = 'class',
    VARIABLE = 'variable',
    FILE = 'file',
    MODULE = 'module',
    INTERFACE = 'interface',
    TYPE = 'type',
    NAMESPACE = 'namespace',
    CONCEPT = 'concept'
}

/**
 * 提取的实体信息
 */
interface ExtractedEntity {
    name: string;
    type: EntityType;
    confidence: number;
}

/**
 * 搜索结果项
 */
interface SearchResultItem {
    uri: vscode.Uri;
    content: string;
    symbolInfo?: vscode.SymbolInformation;
    relevanceScore: number;
    description: string;
}

/**
 * 意图分析结果
 */
interface IntentAnalysis {
    intent: 'find_entry' | 'find_structure' | 'find_entity' | 'understand_flow' | 'find_usage' | 'debug_issue' | 'other';
    entities: ExtractedEntity[];
    searchStrategy: ('workspace_symbols' | 'text_search' | 'file_structure' | 'config_files' | 'documentation')[];
    keyTerms: string[];
}

/**
 * 智能搜索主函数
 * @param prompt 用户输入的提示语
 * @returns 整理后的上下文信息
 */
export async function smartSearch(prompt: string): Promise<string> {
    try {
        DebugLogger.log('Starting smart search for prompt:', prompt);
        DebugLogger.show(); // 立即显示调试面板
        
        // 检查工作区
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return '❌ 没有打开的工作区文件夹。请先打开一个包含代码的文件夹。';
        }
        
        // 第一步：分析意图并提取实体
        DebugLogger.log('Step 1: Analyzing intent and extracting entities');
        const intentAnalysis = await analyzeIntentAndExtractEntities(prompt);
        DebugLogger.log('Intent analysis result:', intentAnalysis);
        
        if (intentAnalysis.intent === 'other' && intentAnalysis.entities.length === 0 && intentAnalysis.keyTerms.length === 0) {
            DebugLogger.log('No actionable information found, using direct chat response');
            return await directChatResponse(prompt);
        }
        
        // 第二步：根据搜索策略执行多维度搜索
        DebugLogger.log('Step 2: Executing multi-dimensional search');
        let searchResults: SearchResultItem[] = [];
        
        for (const strategy of intentAnalysis.searchStrategy) {
            DebugLogger.log(`Executing search strategy: ${strategy}`);
            const strategyResults = await executeSearchStrategy(strategy, intentAnalysis);
            DebugLogger.log(`Found ${strategyResults.length} results for strategy: ${strategy}`);
            searchResults.push(...strategyResults);
        }
        
        // 第三步：根据实体进行精准搜索
        if (intentAnalysis.entities.length > 0) {
            DebugLogger.log('Step 3: Searching for specific entities');
            for (const entity of intentAnalysis.entities) {
                if (entity.type !== 'concept') { // 跳过概念性实体
                    DebugLogger.log(`Searching for entity: ${entity.name} (${entity.type})`);
                    const entityResults = await searchForEntity(entity);
                    DebugLogger.log(`Found ${entityResults.length} results for entity ${entity.name}`);
                    searchResults.push(...entityResults);
                }
            }
        }
        
        // 第四步：相关性打分和排序
        DebugLogger.log('Step 4: Scoring relevance');
        const scoredResults = await scoreRelevance(prompt, searchResults);
        DebugLogger.log(`Scored ${scoredResults.length} results`);
        
        // 第五步：整合上下文信息
        DebugLogger.log('Step 5: Integrating final context');
        const finalContext = await integrateFinalContext(prompt, scoredResults, intentAnalysis);
        
        DebugLogger.log('Smart search completed successfully');
        
        return finalContext;
        
    } catch (error) {
        DebugLogger.log('Smart search error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : 'No stack trace available';
        DebugLogger.log('Error stack:', errorStack);
        return `搜索过程中出现错误: ${errorMessage}\n\n详细错误信息请查看 "Smart Search Debug" 输出面板`;
    }
}

/**
 * 分析用户意图并提取关键实体
 */
async function analyzeIntentAndExtractEntities(prompt: string): Promise<IntentAnalysis> {
    const analysisPrompt = `
你是一个代码搜索专家。分析用户的查询意图，提取关键信息，并制定搜索策略。

用户查询: "${prompt}"

请分析用户想要了解什么，并以JSON格式返回：

1. intent: 用户的主要意图
   - "find_entry" - 查找项目入口点、启动方式
   - "find_structure" - 了解项目结构、架构
   - "find_entity" - 查找特定的函数、类、变量等
   - "understand_flow" - 理解执行流程、调用关系
   - "find_usage" - 查找某个实体的使用方式
   - "debug_issue" - 调试问题、查找错误原因
   - "other" - 其他

2. entities: 从查询中提取的关键实体，每个包含:
   - name: 实体名称（如果是概念性的如"入口点"，使用相关关键词）
   - type: "function" | "class" | "variable" | "file" | "module" | "interface" | "type" | "concept"
   - confidence: 置信度(0-1)

3. searchStrategy: 推荐的搜索策略数组，按优先级排序:
   - "workspace_symbols" - 使用工作区符号搜索
   - "text_search" - 文本内容搜索
   - "file_structure" - 文件结构分析
   - "config_files" - 配置文件分析
   - "documentation" - 文档和注释搜索

4. keyTerms: 提取的关键搜索词数组，用于文本搜索

示例:
{
  "intent": "find_entry",
  "entities": [
    {"name": "入口点", "type": "concept", "confidence": 0.9},
    {"name": "main", "type": "function", "confidence": 0.7}
  ],
  "searchStrategy": ["config_files", "file_structure", "workspace_symbols", "text_search"],
  "keyTerms": ["main", "index", "entry", "activate", "启动", "入口"]
}

只返回JSON，不要其他解释：
`;

    DebugLogger.logGPTCall(analysisPrompt, '');
    const response = await useCopilotChat(analysisPrompt);
    DebugLogger.logGPTCall(analysisPrompt, response);
    
    const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanResponse);
}



/**
 * 根据实体搜索相关信息
 */
async function searchForEntity(entity: ExtractedEntity): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    switch (entity.type) {
        case EntityType.FUNCTION:
        case EntityType.CLASS:
        case EntityType.INTERFACE:
        case EntityType.TYPE:
            // 使用 workspace symbols 搜索
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider', 
                entity.name
            );
            
            if (symbols) {
                for (const symbol of symbols) {
                    if (symbol.name.toLowerCase().includes(entity.name.toLowerCase())) {
                        const content = await getSymbolContent(symbol);
                        results.push({
                            uri: symbol.location.uri,
                            content,
                            symbolInfo: symbol,
                            relevanceScore: 0, // 将在后续打分
                            description: `${symbol.kind} ${symbol.name} in ${symbol.containerName || 'global'}`
                        });
                    }
                }
            }
            break;
            
        case EntityType.FILE:
        case EntityType.MODULE:
            // 搜索文件
            const files = await vscode.workspace.findFiles(`**/*${entity.name}*`);
            for (const file of files.slice(0, 10)) { // 限制结果数量
                const content = await getFileContent(file);
                results.push({
                    uri: file,
                    content,
                    relevanceScore: 0,
                    description: `File: ${file.fsPath}`
                });
            }
            break;
            
        case EntityType.VARIABLE:
        case EntityType.NAMESPACE:
            // 使用文本搜索
            const textResults = await searchInWorkspace(entity.name);
            results.push(...textResults);
            break;
    }
    
    return results;
}

/**
 * 对搜索结果进行相关性打分
 */
async function scoreRelevance(originalPrompt: string, results: SearchResultItem[]): Promise<SearchResultItem[]> {
    const scoringPrompt = `
原始用户提示: "${originalPrompt}"

以下是搜索到的代码片段，请为每个片段的相关性打分(0-1，1为最相关)：

${results.map((result, index) => 
    `${index}: ${result.description}\n` +
    `内容预览: ${result.content.substring(0, 200)}...\n`
).join('\n---\n')}

请以JSON格式返回打分结果，格式为: {"scores": [0.9, 0.7, 0.3, ...]}
只返回JSON，不要其他解释：
`;

    DebugLogger.logGPTCall(scoringPrompt, '');
    const response = await useCopilotChat(scoringPrompt);
    DebugLogger.logGPTCall(scoringPrompt, response);
    
    const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const scoringResult = JSON.parse(cleanResponse);
    
    // 应用打分结果
    if (scoringResult.scores && Array.isArray(scoringResult.scores)) {
        results.forEach((result, index) => {
            if (index < scoringResult.scores.length) {
                result.relevanceScore = scoringResult.scores[index];
            }
        });
    }
    
    // 按相关性排序
    return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * 整合最终上下文
 */
async function integrateFinalContext(originalPrompt: string, scoredResults: SearchResultItem[], intentAnalysis: IntentAnalysis): Promise<string> {
    // 取前N个最相关的结果
    const topResults = scoredResults.slice(0, 10);
    
    // 根据意图类型定制提示
    let intentSpecificInstructions = '';
    switch (intentAnalysis.intent) {
        case 'find_entry':
            intentSpecificInstructions = `
特别关注：
- 项目的入口点文件是什么，在哪里
- 程序如何启动和初始化
- 主要的启动脚本和配置
- 入口函数或类的作用`;
            break;
        case 'find_structure':
            intentSpecificInstructions = `
特别关注：
- 项目的整体架构和目录结构
- 各个模块和文件的职责
- 代码组织方式和设计模式
- 主要组件之间的关系`;
            break;
        case 'find_entity':
            intentSpecificInstructions = `
特别关注：
- 具体实体的定义和实现
- 实体的功能和用途
- 相关的依赖和调用关系
- 使用示例和最佳实践`;
            break;
        case 'understand_flow':
            intentSpecificInstructions = `
特别关注：
- 执行流程和调用链
- 数据流向和状态变化
- 关键的控制逻辑和分支
- 异常处理和错误流程`;
            break;
        default:
            intentSpecificInstructions = `
特别关注：
- 与用户查询最相关的信息
- 提供清晰的代码概述
- 突出关键的技术细节`;
    }

    const contextPrompt = `
用户查询: "${originalPrompt}"
查询意图: ${intentAnalysis.intent}

以下是根据多维度搜索策略找到的相关信息：

${topResults.map((result, index) => 
    `## 信息 ${index + 1} (相关性: ${result.relevanceScore.toFixed(2)})\n` +
    `类型: ${result.description}\n` +
    `位置: ${result.uri.fsPath}\n` +
    `内容:\n\`\`\`\n${result.content}\n\`\`\`\n`
).join('\n---\n')}

${intentSpecificInstructions}

请基于以上信息提供一个完整、准确的回答，帮助用户理解他们的查询。
要求：
1. 直接回答用户的问题
2. 提供具体的文件路径和代码位置
3. 解释相关的技术概念和实现细节
4. 如果涉及多个文件，说明它们之间的关系
5. 保持回答简洁但信息完整

请用中文回答：
`;

    DebugLogger.logGPTCall(contextPrompt, '');
    const response = await useCopilotChat(contextPrompt);
    DebugLogger.logGPTCall(contextPrompt, response);
    
    return response;
}

/**
 * 直接聊天响应（非代码相关）
 */
async function directChatResponse(prompt: string): Promise<string> {
    return await useCopilotChat(prompt);
}

/**
 * 获取符号内容
 */
async function getSymbolContent(symbol: vscode.SymbolInformation): Promise<string> {
    const document = await vscode.workspace.openTextDocument(symbol.location.uri);
    const range = symbol.location.range;
    
    // 扩展范围以获取更多上下文
    const expandedRange = new vscode.Range(
        Math.max(0, range.start.line - 5),
        0,
        Math.min(document.lineCount - 1, range.end.line + 5),
        0
    );
    
    return document.getText(expandedRange);
}

/**
 * 获取文件内容
 */
async function getFileContent(uri: vscode.Uri): Promise<string> {
    const document = await vscode.workspace.openTextDocument(uri);
    // 限制内容长度
    const fullText = document.getText();
    return fullText.length > 2000 ? fullText.substring(0, 2000) + '...' : fullText;
}

/**
 * 获取位置内容
 */
async function getLocationContent(location: vscode.Location): Promise<string> {
    const document = await vscode.workspace.openTextDocument(location.uri);
    const range = location.range;
    
    // 扩展范围以获取上下文
    const expandedRange = new vscode.Range(
        Math.max(0, range.start.line - 3),
        0,
        Math.min(document.lineCount - 1, range.end.line + 3),
        0
    );
    
    return document.getText(expandedRange);
}

/**
 * 在工作区中搜索文本
 */
async function searchInWorkspace(searchText: string): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    // 使用 VS Code 搜索 API
    const searchPattern = new vscode.RelativePattern(vscode.workspace.workspaceFolders![0], '**/*.{ts,js,tsx,jsx,py,java,cpp,c,h}');
    const files = await vscode.workspace.findFiles(searchPattern);
    
    for (const file of files.slice(0, 20)) { // 限制搜索文件数量
        const document = await vscode.workspace.openTextDocument(file);
        const text = document.getText();
        
        if (text.toLowerCase().includes(searchText.toLowerCase())) {
            // 找到匹配行
            const lines = text.split('\n');
            const matchingLines: string[] = [];
            
            lines.forEach((line, index) => {
                if (line.toLowerCase().includes(searchText.toLowerCase())) {
                    // 添加上下文行
                    const start = Math.max(0, index - 2);
                    const end = Math.min(lines.length - 1, index + 2);
                    const contextLines = lines.slice(start, end + 1);
                    matchingLines.push(...contextLines);
                }
            });
            
            if (matchingLines.length > 0) {
                results.push({
                    uri: file,
                    content: matchingLines.join('\n'),
                    relevanceScore: 0,
                    description: `Text match for "${searchText}" in ${file.fsPath}`
                });
            }
        }
    }
    
    return results;
}

/**
 * 执行特定的搜索策略
 */
async function executeSearchStrategy(strategy: string, intentAnalysis: IntentAnalysis): Promise<SearchResultItem[]> {
    const workspaceRoot = vscode.workspace.workspaceFolders![0];
    const results: SearchResultItem[] = [];
    
    switch (strategy) {
        case 'config_files':
            // 搜索配置文件
            const configFiles = ['package.json', 'tsconfig.json', 'webpack.config.js', 'vite.config.js', 
                               'rollup.config.js', '.eslintrc.json', 'jest.config.js', 'Cargo.toml', 
                               'pom.xml', 'build.gradle', 'Makefile', 'Dockerfile'];
            
            for (const configFile of configFiles) {
                try {
                    const fileUri = vscode.Uri.joinPath(workspaceRoot.uri, configFile);
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const content = document.getText();
                    
                    results.push({
                        uri: fileUri,
                        content: content.length > 1500 ? content.substring(0, 1500) + '...' : content,
                        relevanceScore: 0.8,
                        description: `Configuration file: ${configFile}`
                    });
                } catch (error) {
                    // 文件不存在，继续
                }
            }
            break;
            
        case 'file_structure':
            // 分析文件结构
            const commonEntryPaths = [
                'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'src/app.ts', 'src/app.js',
                'index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js',
                'src/extension.ts', 'extension.ts', 'server.ts', 'server.js',
                'lib/index.js', 'dist/index.js'
            ];
            
            for (const entryPath of commonEntryPaths) {
                try {
                    const fileUri = vscode.Uri.joinPath(workspaceRoot.uri, entryPath);
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const content = document.getText();
                    
                    results.push({
                        uri: fileUri,
                        content: content.length > 1000 ? content.substring(0, 1000) + '...' : content,
                        relevanceScore: 0.9,
                        description: `Entry file: ${entryPath}`
                    });
                } catch (error) {
                    // 文件不存在，继续
                }
            }
            break;
            
        case 'workspace_symbols':
            // 使用关键词搜索工作区符号
            for (const term of intentAnalysis.keyTerms.slice(0, 5)) { // 限制搜索词数量
                const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                    'vscode.executeWorkspaceSymbolProvider', 
                    term
                );
                
                if (symbols) {
                    for (const symbol of symbols.slice(0, 10)) { // 限制每个词的结果数量
                        const content = await getSymbolContent(symbol);
                        results.push({
                            uri: symbol.location.uri,
                            content,
                            symbolInfo: symbol,
                            relevanceScore: 0.7,
                            description: `Symbol: ${symbol.name} (${symbol.kind})`
                        });
                    }
                }
            }
            break;
            
        case 'text_search':
            // 文本内容搜索
            for (const term of intentAnalysis.keyTerms.slice(0, 3)) {
                const textResults = await searchInWorkspace(term);
                results.push(...textResults.slice(0, 8)); // 限制每个词的结果数量
            }
            break;
            
        case 'documentation':
            // 搜索文档和注释
            const docFiles = ['README.md', 'README.txt', 'CHANGELOG.md', 'docs/', 'doc/'];
            
            for (const docPath of docFiles) {
                try {
                    let fileUri: vscode.Uri;
                    if (docPath.endsWith('/')) {
                        // 搜索目录下的文件
                        const files = await vscode.workspace.findFiles(`${docPath}**/*.md`);
                        for (const file of files.slice(0, 5)) {
                            const document = await vscode.workspace.openTextDocument(file);
                            const content = document.getText();
                            results.push({
                                uri: file,
                                content: content.length > 1000 ? content.substring(0, 1000) + '...' : content,
                                relevanceScore: 0.6,
                                description: `Documentation: ${file.fsPath}`
                            });
                        }
                    } else {
                        fileUri = vscode.Uri.joinPath(workspaceRoot.uri, docPath);
                        const document = await vscode.workspace.openTextDocument(fileUri);
                        const content = document.getText();
                        
                        results.push({
                            uri: fileUri,
                            content: content.length > 1000 ? content.substring(0, 1000) + '...' : content,
                            relevanceScore: 0.6,
                            description: `Documentation: ${docPath}`
                        });
                    }
                } catch (error) {
                    // 文件不存在，继续
                }
            }
            break;
    }
    
    return results;
}

