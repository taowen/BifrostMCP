import { useCopilotChat } from '../copilotChat';
import { DebugLogger } from './logger';
import { SearchResultItem } from './types';
import { searchInWorkspace, getFileContent, getProjectStructure } from './utils';
import * as vscode from 'vscode';

/**
 * 分析查询并直接执行搜索
 * 使用大模型判断应该搜索什么以及如何搜索
 */
export async function analyzeQueryAndSearch(prompt: string): Promise<SearchResultItem[]> {
    // 获取项目结构信息
    DebugLogger.log('Getting project structure...');
    const projectStructure = await getProjectStructure();
    DebugLogger.log('Project structure obtained');
    
    const analysisPrompt = `
你是一个代码搜索专家。分析用户的查询并决定如何搜索相关代码。

用户查询: "${prompt}"

当前项目结构信息:
${projectStructure}

请基于项目结构和用户查询，分析用户想要了解什么，并制定精准的搜索计划。以JSON格式返回：

{
  "searchTerms": ["搜索词1", "搜索词2", "搜索词3"],
  "searchTypes": ["workspace_symbols", "text_search", "file_search"],
  "filePatterns": ["*.ts", "*.js", "*.json"],
  "priority": "high|medium|low"
}

说明：
- searchTerms: 关键搜索词，根据项目结构选择最相关的词汇
- searchTypes: 搜索类型，可包含:
  - "workspace_symbols": 搜索符号（函数、类等）
  - "text_search": 文本内容搜索
  - "file_search": 文件名搜索
- filePatterns: 根据项目类型选择合适的文件模式
- priority: 搜索优先级

注意事项：
1. 根据项目结构判断用户最可能需要的文件和符号
2. 如果用户查询涉及入口点，考虑 package.json 中的 main 字段和 scripts
3. 根据项目文件类型（如 TypeScript、JavaScript 等）调整搜索模式
4. 优先搜索项目根目录下的重要文件

只返回JSON，不要其他解释：
`;

    DebugLogger.logGPTCall(analysisPrompt, '');
    const response = await useCopilotChat(analysisPrompt);
    DebugLogger.logGPTCall(analysisPrompt, response);
    
    const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const searchPlan = JSON.parse(cleanResponse);
    
    DebugLogger.log('Search plan:', searchPlan);
    
    // 执行搜索
    const results: SearchResultItem[] = [];
    
    // 根据搜索计划执行相应的搜索
    for (const searchType of searchPlan.searchTypes) {
        switch (searchType) {
            case 'workspace_symbols':
                for (const term of searchPlan.searchTerms.slice(0, 3)) {
                    const symbolResults = await searchWorkspaceSymbols(term);
                    results.push(...symbolResults);
                }
                break;
                
            case 'text_search':
                for (const term of searchPlan.searchTerms.slice(0, 3)) {
                    const textResults = await searchInWorkspace(term);
                    results.push(...textResults);
                }
                break;
                
            case 'file_search':
                for (const term of searchPlan.searchTerms.slice(0, 3)) {
                    const fileResults = await searchFiles(term, searchPlan.filePatterns);
                    results.push(...fileResults);
                }
                break;
        }
    }
    
    return results;
}

/**
 * 搜索工作区符号
 */
async function searchWorkspaceSymbols(searchTerm: string): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    try {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider', 
            searchTerm
        );
        
        if (symbols) {
            for (const symbol of symbols.slice(0, 10)) {
                try {
                    const document = await vscode.workspace.openTextDocument(symbol.location.uri);
                    const range = symbol.location.range;
                    
                    // 获取符号周围的上下文
                    const startLine = Math.max(0, range.start.line - 5);
                    const endLine = Math.min(document.lineCount - 1, range.end.line + 5);
                    
                    let content = '';
                    for (let i = startLine; i <= endLine; i++) {
                        content += document.lineAt(i).text + '\n';
                    }
                    
                    results.push({
                        uri: symbol.location.uri,
                        content,
                        symbolInfo: symbol,
                        description: `Symbol: ${symbol.name} (${vscode.SymbolKind[symbol.kind]})`
                    });
                } catch (error) {
                    DebugLogger.log(`Error reading symbol content: ${error}`);
                }
            }
        }
    } catch (error) {
        DebugLogger.log(`Error searching workspace symbols: ${error}`);
    }
    
    return results;
}

/**
 * 搜索文件
 */
async function searchFiles(searchTerm: string, patterns?: string[]): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    try {
        const searchPattern = patterns && patterns.length > 0 
            ? `**/*${searchTerm}*{${patterns.join(',')}}` 
            : `**/*${searchTerm}*`;
            
        const files = await vscode.workspace.findFiles(searchPattern, '**/node_modules/**', 20);
        
        for (const file of files) {
            const content = await getFileContent(file);
            results.push({
                uri: file,
                content: content.length > 1000 ? content.substring(0, 1000) + '...' : content,
                description: `File: ${vscode.workspace.asRelativePath(file)}`
            });
        }
    } catch (error) {
        DebugLogger.log(`Error searching files: ${error}`);
    }
    
    return results;
}

/**
 * 分析用户意图并提取关键实体
 * @deprecated 使用 analyzeQueryAndSearch 替代
 */
export async function analyzeIntentAndExtractEntities(prompt: string): Promise<any> {
    // 获取项目结构信息
    const projectStructure = await getProjectStructure();
    
    const analysisPrompt = `
你是一个代码搜索专家。分析用户的查询意图，提取关键信息，并制定搜索策略。

用户查询: "${prompt}"

当前项目结构信息:
${projectStructure}

请基于项目结构分析用户想要了解什么，并以JSON格式返回：

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

注意事项：
1. 根据项目结构判断用户最可能需要的文件和符号
2. 如果用户查询涉及入口点，考虑 package.json 中的信息
3. 根据项目类型调整搜索策略

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
 * 直接使用聊天响应（当无法提取有用信息时）
 */
export async function directChatResponse(prompt: string): Promise<string> {
    return await useCopilotChat(prompt);
}