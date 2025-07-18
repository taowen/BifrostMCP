import * as vscode from 'vscode';
import { useCopilotChat } from './copilotChat';

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
    NAMESPACE = 'namespace'
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
    intent: 'read' | 'modify' | 'search' | 'understand' | 'other';
    entities: ExtractedEntity[];
    nextSteps?: string[];
    needsMoreContext?: boolean;
}

/**
 * 智能搜索主函数
 * @param prompt 用户输入的提示语
 * @returns 整理后的上下文信息
 */
export async function smartSearch(prompt: string): Promise<string> {
    try {
        console.log('Starting smart search for prompt:', prompt);
        
        // 检查工作区
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return '❌ 没有打开的工作区文件夹。请先打开一个包含代码的文件夹。';
        }
        
        // 第一步：分析意图并提取实体
        const intentAnalysis = await analyzeIntentAndExtractEntities(prompt);
        console.log('Intent analysis result:', intentAnalysis);
        
        if (intentAnalysis.intent === 'other' && intentAnalysis.entities.length === 0) {
            return await directChatResponse(prompt);
        }
        
        // 第二步：根据实体类型搜索相关信息
        let searchResults: SearchResultItem[] = [];
        
        for (const entity of intentAnalysis.entities) {
            const entityResults = await searchForEntity(entity);
            searchResults.push(...entityResults);
        }
        
        // 如果没有找到实体相关的结果，尝试关键词搜索
        if (searchResults.length === 0) {
            const keywords = await extractKeywords(prompt);
            for (const keyword of keywords) {
                const keywordResults = await searchInWorkspace(keyword);
                searchResults.push(...keywordResults);
            }
        }
        
        // 第三步：如果需要更多上下文，进行关联搜索
        if (intentAnalysis.needsMoreContext && intentAnalysis.nextSteps && searchResults.length > 0) {
            for (const nextStep of intentAnalysis.nextSteps) {
                const additionalResults = await searchRelatedEntities(nextStep, searchResults);
                searchResults.push(...additionalResults);
            }
        }
        
        // 第四步：相关性打分和排序
        const scoredResults = await scoreRelevance(prompt, searchResults);
        
        // 第五步：整合上下文信息
        const finalContext = await integrateFinalContext(prompt, scoredResults);
        
        return finalContext;
        
    } catch (error) {
        console.error('Smart search error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : 'No stack trace available';
        console.error('Error stack:', errorStack);
        return `搜索过程中出现错误: ${errorMessage}\n\n详细错误信息请查看开发者控制台 (F12)`;
    }
}

/**
 * 从提示中提取关键词
 */
async function extractKeywords(prompt: string): Promise<string[]> {
    const keywordPrompt = `
从以下用户提示中提取最相关的关键词，用于代码搜索：

用户提示: "${prompt}"

请提取可能是代码标识符、函数名、类名、文件名等的关键词。
请以JSON格式返回结果，格式为: {"keywords": ["keyword1", "keyword2", ...]}
最多返回5个最重要的关键词。

只返回JSON，不要其他解释：
`;

    const response = await useCopilotChat(keywordPrompt);
    const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(cleanResponse);
    return result.keywords || [];
}

/**
 * 分析用户意图并提取关键实体
 */
async function analyzeIntentAndExtractEntities(prompt: string): Promise<IntentAnalysis> {
    const analysisPrompt = `
分析以下用户提示的意图和关键实体：

用户提示: "${prompt}"

请以JSON格式返回分析结果，包含：
1. intent: "read"(阅读代码) | "modify"(修改代码) | "search"(搜索) | "understand"(理解) | "other"(其他)
2. entities: 提取的关键实体数组，每个实体包含:
   - name: 实体名称
   - type: "function" | "class" | "variable" | "file" | "module" | "interface" | "type" | "namespace"
   - confidence: 置信度(0-1)
3. needsMoreContext: 是否需要更多上下文(boolean)
4. nextSteps: 下一步需要查找的关联实体(string数组)

示例:
{
  "intent": "read",
  "entities": [
    {"name": "UserService", "type": "class", "confidence": 0.9},
    {"name": "createUser", "type": "function", "confidence": 0.8}
  ],
  "needsMoreContext": true,
  "nextSteps": ["find callers of createUser", "find UserService dependencies"]
}

只返回JSON，不要其他解释：
`;

    const response = await useCopilotChat(analysisPrompt);
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
 * 搜索关联实体
 */
async function searchRelatedEntities(nextStep: string, currentResults: SearchResultItem[]): Promise<SearchResultItem[]> {
    // 基于当前结果和下一步指令搜索相关实体
    const relatedResults: SearchResultItem[] = [];
    
    for (const result of currentResults) {
        if (result.symbolInfo) {
            // 查找引用
            if (nextStep.toLowerCase().includes('caller') || nextStep.toLowerCase().includes('reference')) {
                const references = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider',
                    result.uri,
                    result.symbolInfo.location.range.start
                );
                
                if (references) {
                    for (const ref of references.slice(0, 5)) {
                        const content = await getLocationContent(ref);
                        relatedResults.push({
                            uri: ref.uri,
                            content,
                            relevanceScore: 0,
                            description: `Reference to ${result.symbolInfo.name}`
                        });
                    }
                }
            }
            
            // 查找定义
            if (nextStep.toLowerCase().includes('definition') || nextStep.toLowerCase().includes('dependency')) {
                const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeDefinitionProvider',
                    result.uri,
                    result.symbolInfo.location.range.start
                );
                
                if (definitions) {
                    for (const def of definitions) {
                        const content = await getLocationContent(def);
                        relatedResults.push({
                            uri: def.uri,
                            content,
                            relevanceScore: 0,
                            description: `Definition of ${result.symbolInfo.name}`
                        });
                    }
                }
            }
        }
    }
    
    return relatedResults;
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

    const response = await useCopilotChat(scoringPrompt);
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
async function integrateFinalContext(originalPrompt: string, scoredResults: SearchResultItem[]): Promise<string> {
    // 取前N个最相关的结果
    const topResults = scoredResults.slice(0, 10);
    
    const contextPrompt = `
原始用户提示: "${originalPrompt}"

以下是搜索到的相关代码信息：

${topResults.map((result, index) => 
    `## 结果 ${index + 1} (相关性: ${result.relevanceScore.toFixed(2)})\n` +
    `描述: ${result.description}\n` +
    `文件: ${result.uri.fsPath}\n` +
    `内容:\n\`\`\`\n${result.content}\n\`\`\`\n`
).join('\n---\n')}

请根据上述信息，整合出一个能够帮助理解或处理原始用户提示的综合上下文。
要求：
1. 突出与用户提示最相关的信息
2. 提供清晰的代码结构概述
3. 如果是修改请求，指出需要关注的关键点
4. 保持简洁但信息完整

请用中文回答：
`;

    return await useCopilotChat(contextPrompt);
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
