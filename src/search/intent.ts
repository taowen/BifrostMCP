import { useCopilotChat } from '../copilotChat';
import { DebugLogger } from './logger';
import { SearchResultItem, SearchPlan, SearchStrategy, SearchStrategyType } from './types';
import { searchInWorkspace, getFileContent, getProjectStructure } from './utils';
import * as vscode from 'vscode';

/**
 * 分析查询并生成搜索计划
 * 使用大模型制定多种搜索策略
 */
export async function analyzeQueryAndSearch(prompt: string): Promise<SearchPlan> {
    // 获取项目结构信息
    DebugLogger.log('Getting project structure...');
    const projectStructure = await getProjectStructure();
    DebugLogger.log('Project structure obtained');
    
    const analysisPrompt = `
你是一个代码搜索专家。分析用户的查询并制定多种搜索策略。

用户查询: "${prompt}"

当前项目结构信息:
${projectStructure}

请基于项目结构和用户查询，制定多种搜索策略。以JSON格式返回：

{
  "reasoning": "简要说明分析思路和为什么选择这些策略",
  "confidence": 0.9,
  "strategies": [
    {
      "type": "vscode_workspace_symbols",
      "name": "符号搜索",
      "description": "搜索工作区中的函数、类、变量等符号",
      "searchTerms": ["关键词1", "关键词2"]
    },
    {
      "type": "file_prediction",
      "name": "文件推测",
      "description": "基于项目结构直接推测相关文件",
      "searchTerms": ["推测的文件名1", "推测的文件名2"]
    },
    {
      "type": "text_search",
      "name": "文本搜索",
      "description": "在代码文件内容中搜索关键词或文本片段",
      "searchTerms": ["关键词1", "关键词2"]
    },
    {
      "type": "file_name_search",
      "name": "文件名搜索", 
      "description": "通过文件名或路径模式搜索相关文件",
      "searchTerms": ["文件名模式1", "文件名模式2"]
    }
  ]
}

可用的搜索策略类型：
- "vscode_workspace_symbols": VSCode 工作区符号搜索 (搜索工作区中的函数、类、变量等符号，支持模糊匹配)
- "text_search": 关键词文本搜索 (在代码文件内容中搜索特定关键词或文本片段)
- "file_name_search": 文件名搜索 (通过文件名或文件路径进行搜索，支持通配符匹配)
- "file_prediction": 基于目录结构的文件推测 (根据项目结构和命名规范推测可能相关的文件)

策略选择原则：
1. 根据用户查询意图选择最合适的搜索策略组合
2. vscode_workspace_symbols 适用于搜索函数、类、变量等具体符号
3. text_search 适用于搜索代码片段、注释、字符串等文本内容
4. file_name_search 适用于查找特定的文件或按文件名模式搜索
5. file_prediction 适用于根据项目结构推测可能相关的文件位置
6. 每个策略应该有明确的搜索关键词和预期结果数量
7. 优先级应该根据策略对用户查询的相关性和有效性设置
8. 合理预测文件路径并包含在 file_prediction 策略中

只返回JSON，不要其他解释：
`;

    const response = await useCopilotChat(analysisPrompt);
    DebugLogger.logGPTCall('Search plan generation', analysisPrompt, response);
    
    const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const planData = JSON.parse(cleanResponse);
    
    // 构建搜索计划
    const searchPlan: SearchPlan = {
        strategies: planData.strategies.map((s: any) => ({
            ...s,
            status: 'pending' as const
        })),
        totalEstimatedTime: planData.strategies.length * 2000, // 估算每个策略2秒
        confidence: planData.confidence || 0.8,
        reasoning: planData.reasoning || '基于项目结构和用户查询生成的搜索计划'
    };
    
    DebugLogger.log('Generated search plan:', searchPlan);
    
    return searchPlan;
}

/**
 * 执行搜索计划
 */
export async function executeSearchPlan(plan: SearchPlan): Promise<SearchResultItem[]> {
    const allResults: SearchResultItem[] = [];
    
    for (const strategy of plan.strategies) {
        try {
            strategy.status = 'executing';
            const startTime = Date.now();
            
            let results: SearchResultItem[] = [];
            
            switch (strategy.type) {
                case 'vscode_workspace_symbols':
                    results = await executeWorkspaceSymbolsSearch(strategy.searchTerms);
                    break;
                case 'text_search':
                    results = await executeTextSearch(strategy.searchTerms);
                    break;
                case 'file_name_search':
                    results = await executeFileNameSearch(strategy.searchTerms);
                    break;
                case 'file_prediction':
                    results = await executeFilePrediction(strategy.searchTerms);
                    break;
                default:
                    DebugLogger.log(`Unsupported strategy type: ${strategy.type}`);
                    continue;
            }
            
            strategy.results = results;
            strategy.status = 'completed';
            strategy.executionTime = Date.now() - startTime;
            
            allResults.push(...results);
            
            DebugLogger.log(`Strategy ${strategy.name} completed with ${results.length} results`);
            
        } catch (error) {
            strategy.status = 'failed';
            strategy.error = error instanceof Error ? error.message : String(error);
            DebugLogger.log(`Strategy ${strategy.name} failed:`, error);
        }
    }
    
    return allResults;
}

/**
 * 执行工作区符号搜索策略
 */
async function executeWorkspaceSymbolsSearch(searchTerms: string[]): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    for (const term of searchTerms.slice(0, 3)) {
        const symbolResults = await searchWorkspaceSymbols(term);
        results.push(...symbolResults);
    }
    
    return results;
}

/**
 * 执行文本搜索策略
 */
async function executeTextSearch(searchTerms: string[]): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    for (const term of searchTerms.slice(0, 3)) {
        const textResults = await searchInWorkspace(term);
        results.push(...textResults);
    }
    
    return results;
}

/**
 * 执行文件名搜索策略
 */
async function executeFileNameSearch(searchTerms: string[]): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    for (const term of searchTerms.slice(0, 3)) {
        const fileResults = await searchFiles(term);
        results.push(...fileResults);
    }
    
    return results;
}

/**
 * 执行文件推测策略
 */
async function executeFilePrediction(predictedFiles: string[]): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    for (const filePath of predictedFiles) {
        try {
            // 尝试找到匹配的文件
            const files = await vscode.workspace.findFiles(
                `**/*${filePath}*`,
                '**/node_modules/**',
                10
            );
            
            for (const file of files) {
                const content = await getFileContent(file);
                results.push({
                    uri: file,
                    content: content.length > 1000 ? content.substring(0, 1000) + '...' : content,
                    description: `Predicted file: ${vscode.workspace.asRelativePath(file)}`
                });
            }
        } catch (error) {
            DebugLogger.log(`Error in file prediction for ${filePath}:`, error);
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