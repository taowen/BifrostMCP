import { DebugLogger } from './logger';
import { SearchResultItem, RankedResultItem, SearchPlan } from './types';
import { useCopilotChat } from '../copilotChat';
import { searchInWorkspace } from './utils';
import * as vscode from 'vscode';
import * as path from 'path';

/**
 * 上下文整合结果
 */
export interface ContextIntegrationResult {
    /** 排序后的结果 */
    rankedResults: RankedResultItem[];
    /** 搜索摘要 */
    summary: string;
    /** 用户原始查询 */
    originalPrompt: string;
}

/**
 * 第二轮搜索动作
 */
export interface SecondRoundAction {
    type: 'find_usages' | 'go_to_definition' | 'text_search';
    symbol?: string;
    file?: string;
    line?: number;
    keywords?: string[];
    reason?: string;
}

/**
 * 过滤和去重搜索结果
 */
function filterAndDeduplicateResults(results: RankedResultItem[]): RankedResultItem[] {
    // 1. 过滤低质量结果（评分<5的）
    const highQualityResults = results.filter(result => result.score >= 5);
    
    // 2. 按文件分组，每个文件最多保留2个最高分的结果
    const fileGroups = new Map<string, RankedResultItem[]>();
    
    for (const result of highQualityResults) {
        const filePath = result.uri.fsPath;
        if (!fileGroups.has(filePath)) {
            fileGroups.set(filePath, []);
        }
        fileGroups.get(filePath)!.push(result);
    }
    
    // 3. 每个文件只保留前2个最高分结果
    const deduplicatedResults: RankedResultItem[] = [];
    
    for (const [filePath, fileResults] of fileGroups) {
        // 按评分排序，取前2个
        const sortedFileResults = fileResults
            .sort((a, b) => b.score - a.score)
            .slice(0, 2);
        
        deduplicatedResults.push(...sortedFileResults);
    }
    
    // 4. 最终按评分排序
    return deduplicatedResults.sort((a, b) => b.score - a.score);
}

/**
 * 整合最终上下文 - 直接使用排序后的结果
 */
export async function integrateFinalContext(
    originalPrompt: string, 
    rankedResults: RankedResultItem[], 
    searchPlan?: SearchPlan | null
): Promise<ContextIntegrationResult> {
    DebugLogger.log(`Integrating final context for ${rankedResults.length} results`);
    
    // 过滤和去重高质量结果
    const filteredResults = filterAndDeduplicateResults(rankedResults);
    const topResults = filteredResults.slice(0, 8);
    
    // 生成搜索摘要
    const summary = generateSearchSummary(originalPrompt, topResults, searchPlan);
    
    const result: ContextIntegrationResult = {
        rankedResults: topResults,
        summary,
        originalPrompt
    };
    
    DebugLogger.log(`Context integration completed. Found ${topResults.length} results`);
    return result;
}

/**
 * 生成搜索摘要
 */
function generateSearchSummary(
    originalPrompt: string, 
    results: RankedResultItem[], 
    searchPlan?: SearchPlan | null
): string {
    const fileCount = new Set(results.map(r => r.uri.fsPath)).size;
    const resultTypes = results.map(r => r.description).join(', ');
    
    let summary = `针对查询 "${originalPrompt}" 找到 ${results.length} 个相关结果，涉及 ${fileCount} 个文件。`;
    
    // 处理搜索计划信息
    if (searchPlan) {
        // 这是一个 SearchPlan
        const strategyNames = searchPlan.strategies.map(s => s.name).join(', ');
        summary += ` 使用了 ${searchPlan.strategies.length} 种搜索策略: ${strategyNames}。`;
    }
    
    summary += `\n\n主要结果类型：${resultTypes}`;
    
    return summary;
}

/**
 * 格式化上下文结果为文本 - 支持多轮搜索
 */
export async function formatContextResult(context: ContextIntegrationResult): Promise<string> {
    DebugLogger.log('Starting AI-powered context formatting with multi-round support');
    
    // 构建用于大模型的整合提示
    const integrationPrompt = buildIntegrationPrompt(context.originalPrompt, context);
    
    // 调用大模型进行分析
    const aiResponse = await useCopilotChat(integrationPrompt);
    
    DebugLogger.log('AI analysis completed, checking for second round needs');
    
    // 尝试解析JSON响应
    const cleanResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let analysisResult;
    
    try {
        analysisResult = JSON.parse(cleanResponse);
    } catch (parseError) {
        DebugLogger.log('Failed to parse AI response as JSON, using as final result');
        return aiResponse;
    }
    
    // 如果需要第二轮搜索
    if (analysisResult.needsSecondRound && analysisResult.secondRoundActions?.length > 0) {
        DebugLogger.log(`Starting second round with ${analysisResult.secondRoundActions.length} actions`);
        
        const secondRoundResults = await executeSecondRound(analysisResult.secondRoundActions);
        
        // 无论第二轮是否成功，都整合所有信息
        return await generateFactualReport(context.originalPrompt, context.rankedResults, secondRoundResults, analysisResult.factualSummary);
    }
    
    // 如果不需要第二轮，基于第一轮结果生成事实报告
    return await generateFactualReport(context.originalPrompt, context.rankedResults, [], analysisResult.factualSummary);
}

/**
 * 构建用于大模型整合的提示 - 利用已有分析结果，专注于二轮决策
 */
function buildIntegrationPrompt(originalPrompt: string, context: ContextIntegrationResult): string {
    let prompt = `问题："${originalPrompt}"\n\n已分析的结果：\n`;

    // 使用更少的结果，但利用已有的分析
    const maxResults = 6;
    
    const limitedResults = context.rankedResults.slice(0, maxResults);
    limitedResults.forEach((result, index) => {
        prompt += `${index + 1}. ${vscode.workspace.asRelativePath(result.uri)}`;
        
        if (result.symbolInfo?.location?.range) {
            const range = result.symbolInfo.location.range;
            prompt += ` (L${range.start.line + 1})`;
        }
        
        // 利用已有的AI分析结果，避免重复分析代码内容
        if (result.aiAnalysis) {
            prompt += `\n评分: ${result.score}/10`;
            prompt += `\n相关性: ${result.aiAnalysis.relevanceAnalysis}`;
            prompt += `\n关键发现: ${result.aiAnalysis.keyFindings.join(', ')}`;
            prompt += `\n使用场景: ${result.aiAnalysis.usageContext}`;
            prompt += `\n技术洞察: ${result.aiAnalysis.codeInsights}`;
        } else {
            // 回退：如果没有分析结果，显示简化内容
            const truncatedContent = result.content.length > 100 
                ? result.content.substring(0, 100) + '...'
                : result.content;
            prompt += `\n${result.description}\n\`\`\`\n${truncatedContent}\n\`\`\``;
        }
        
        prompt += `\n\n`;
    });
    
    prompt += `分析是否需要第二轮搜索：
- find_usages: 找到定义，需查看使用
- go_to_definition: 找到调用，需查看实现  
- text_search: 信息缺失，需补充搜索

JSON格式：
{
  "factualSummary": "客观事实陈述",
  "needsSecondRound": true/false,
  "secondRoundActions": [
    {"type": "find_usages", "symbol": "符号名", "file": "文件路径", "line": 行号}
  ]
}`;

    return prompt;
}

/**
 * 执行第二轮搜索
 */
async function executeSecondRound(actions: SecondRoundAction[]): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    for (const action of actions) {
        DebugLogger.log(`Executing second round action: ${action.type}`);
        
        switch (action.type) {
            case 'find_usages':
                if (action.file && action.line !== undefined) {
                    const usageResults = await executeFindUsages(action.file, action.line);
                    results.push(...usageResults);
                }
                break;
                
            case 'go_to_definition':
                if (action.file && action.line !== undefined) {
                    const defResults = await executeGoToDefinition(action.file, action.line);
                    results.push(...defResults);
                }
                break;
                
            case 'text_search':
                if (action.keywords && action.keywords.length > 0) {
                    for (const keyword of action.keywords.slice(0, 2)) {
                        const textResults = await searchInWorkspace(keyword);
                        results.push(...textResults.slice(0, 5)); // 每个关键词最多5个结果
                    }
                }
                break;
                
            default:
                DebugLogger.log(`Unsupported second round action: ${action.type}`);
        }
    }
    
    DebugLogger.log(`Second round completed with ${results.length} results`);
    return results;
}

/**
 * 执行find_usages
 */
async function executeFindUsages(filePath: string, line: number): Promise<SearchResultItem[]> {
    try {
        const uri = vscode.Uri.file(filePath);
        const position = new vscode.Position(line - 1, 0); // 转换为0索引
        
        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            uri,
            position
        );
        
        if (!locations || locations.length === 0) {
            return [];
        }
        
        const results: SearchResultItem[] = [];
        
        for (const location of locations.slice(0, 10)) {
            try {
                const document = await vscode.workspace.openTextDocument(location.uri);
                const range = location.range;
                
                // 获取周围上下文
                const startLine = Math.max(0, range.start.line - 3);
                const endLine = Math.min(document.lineCount - 1, range.end.line + 3);
                
                let content = '';
                for (let i = startLine; i <= endLine; i++) {
                    content += document.lineAt(i).text + '\n';
                }
                
                results.push({
                    uri: location.uri,
                    content,
                    description: `Usage found: ${vscode.workspace.asRelativePath(location.uri)} (line ${range.start.line + 1})`
                });
            } catch (error) {
                DebugLogger.log(`Error reading usage location: ${error}`);
            }
        }
        
        return results;
    } catch (error) {
        DebugLogger.log(`Error in find_usages: ${error}`);
        return [];
    }
}

/**
 * 执行go_to_definition
 */
async function executeGoToDefinition(filePath: string, line: number): Promise<SearchResultItem[]> {
    try {
        const uri = vscode.Uri.file(filePath);
        const position = new vscode.Position(line - 1, 0);
        
        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeDefinitionProvider',
            uri,
            position
        );
        
        if (!locations || locations.length === 0) {
            return [];
        }
        
        const results: SearchResultItem[] = [];
        
        for (const location of locations.slice(0, 5)) {
            try {
                const document = await vscode.workspace.openTextDocument(location.uri);
                const range = location.range;
                
                // 获取定义周围的上下文
                const startLine = Math.max(0, range.start.line - 5);
                const endLine = Math.min(document.lineCount - 1, range.end.line + 10);
                
                let content = '';
                for (let i = startLine; i <= endLine; i++) {
                    content += document.lineAt(i).text + '\n';
                }
                
                results.push({
                    uri: location.uri,
                    content,
                    description: `Definition found: ${vscode.workspace.asRelativePath(location.uri)} (line ${range.start.line + 1})`
                });
            } catch (error) {
                DebugLogger.log(`Error reading definition location: ${error}`);
            }
        }
        
        return results;
    } catch (error) {
        DebugLogger.log(`Error in go_to_definition: ${error}`);
        return [];
    }
}

/**
 * 生成事实报告（充分利用已有AI分析结果，避免重复分析）
 */
async function generateFactualReport(
    originalPrompt: string,
    firstRoundResults: RankedResultItem[],
    secondRoundResults: SearchResultItem[],
    firstRoundSummary: string
): Promise<string> {
    DebugLogger.log('Starting optimized factual report generation using existing AI analysis');
    
    const maxResults = 6;
    
    // 构建基于已有分析的信息整合
    let allInformation = `查询: "${originalPrompt}"\n\n初步摘要: ${firstRoundSummary}\n\n详细分析结果:`;

    // 使用已有的AI分析结果，而不是重新分析代码
    const limitedFirstRound = firstRoundResults.slice(0, maxResults);
    limitedFirstRound.forEach((result, index) => {
        allInformation += `\n\n${index + 1}. ${vscode.workspace.asRelativePath(result.uri)}`;
        
        if (result.symbolInfo?.location?.range) {
            const range = result.symbolInfo.location.range;
            allInformation += ` (第${range.start.line + 1}行)`;
        }
        
        // 充分利用已有的AI分析结果
        if (result.aiAnalysis) {
            allInformation += `\n✓ 相关性评分: ${result.score}/10`;
            allInformation += `\n✓ 相关性分析: ${result.aiAnalysis.relevanceAnalysis}`;
            allInformation += `\n✓ 关键发现: ${result.aiAnalysis.keyFindings.join('、')}`;
            allInformation += `\n✓ 使用场景: ${result.aiAnalysis.usageContext}`;
            allInformation += `\n✓ 技术洞察: ${result.aiAnalysis.codeInsights}`;
            allInformation += `\n✓ 简要评价: ${result.comment}`;
        } else {
            // 只在没有AI分析时才显示代码内容
            const truncatedContent = result.content.length > 200 
                ? result.content.substring(0, 200) + '...'
                : result.content;
            allInformation += `\n${result.description}\n\`\`\`\n${truncatedContent}\n\`\`\``;
        }
    });

    // 添加第二轮补充信息（精简）
    if (secondRoundResults.length > 0) {
        allInformation += `\n\n补充发现:`;
        
        const limitedSecondRound = secondRoundResults.slice(0, 3);
        limitedSecondRound.forEach((result, index) => {
            const truncatedContent = result.content.length > 300 
                ? result.content.substring(0, 300) + '...'
                : result.content;
                
            allInformation += `\n+ ${vscode.workspace.asRelativePath(result.uri)}\n${result.description}\n\`\`\`\n${truncatedContent}\n\`\`\`\n`;
        });
    }

    // 构建基于已有分析的整合提示
    const analysisPrompt = `${allInformation}

以上信息已经过AI深度分析。请基于现有的分析结果生成最终报告：

1. 综合所有相关性分析和关键发现
2. 整合技术洞察和使用场景
3. 突出最重要的代码和发现
4. 避免重复分析，直接利用已有结论

**重要要求：**
- 必须包含每个重要文件的完整路径信息
- 在提到代码时，明确标注文件路径和行号
- 使用清晰的格式，便于用户定位代码

生成包含明确路径信息的分析报告：`;

    // 使用AI进行基于已有分析的智能整合
    const aiIntegratedReport = await useCopilotChat(analysisPrompt);
    
    // 只在有足够多高质量结果时才追加文件清单
    let structuredFileList = '';
    
    // 检查是否有多个不同的文件
    const uniqueFiles = new Set(limitedFirstRound.map(r => r.uri.fsPath));
    const hasHighQualityResults = limitedFirstRound.some(r => r.score >= 7);
    
    if (uniqueFiles.size > 1 && hasHighQualityResults) {
        structuredFileList = '\n\n## 📁 关键文件位置\n\n';
        
        // 按文件分组显示
        const fileGroups = new Map<string, RankedResultItem[]>();
        limitedFirstRound.forEach(result => {
            const filePath = result.uri.fsPath;
            if (!fileGroups.has(filePath)) {
                fileGroups.set(filePath, []);
            }
            fileGroups.get(filePath)!.push(result);
        });
        
        for (const [filePath, results] of fileGroups) {
            const bestResult = results.sort((a, b) => b.score - a.score)[0];
            const relativePath = vscode.workspace.asRelativePath(bestResult.uri);
            
            structuredFileList += `**${relativePath}**\n`;
            
            if (bestResult.symbolInfo?.location?.range) {
                const range = bestResult.symbolInfo.location.range;
                structuredFileList += `   📍 第 ${range.start.line + 1} 行`;
            }
            
            structuredFileList += ` (评分: ${bestResult.score}/10)\n`;
            
            if (bestResult.aiAnalysis && bestResult.aiAnalysis.keyFindings.length > 0) {
                structuredFileList += `   🔍 ${bestResult.aiAnalysis.keyFindings[0]}\n`;
            }
            
            structuredFileList += '\n';
        }
        
        // 添加第二轮结果的路径信息
        if (secondRoundResults.length > 0) {
            structuredFileList += '### 补充发现：\n';
            const uniqueSecondRound = new Set<string>();
            secondRoundResults.forEach(result => {
                const relativePath = vscode.workspace.asRelativePath(result.uri);
                if (!uniqueSecondRound.has(relativePath)) {
                    uniqueSecondRound.add(relativePath);
                    structuredFileList += `- ${relativePath}\n`;
                }
            });
        }
    }
    
    DebugLogger.log('AI factual report generation completed successfully');
    return aiIntegratedReport + structuredFileList;
}
