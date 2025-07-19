import { DebugLogger } from './logger';
import { SearchResultItem, RankedResultItem, SearchPlan } from './types';
import { useCopilotChat } from '../copilotChat';
import { searchInWorkspace } from './utils';
import * as vscode from 'vscode';

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
 * 整合最终上下文 - 直接使用排序后的结果
 */
export async function integrateFinalContext(
    originalPrompt: string, 
    rankedResults: RankedResultItem[], 
    searchPlan?: SearchPlan | null
): Promise<ContextIntegrationResult> {
    DebugLogger.log(`Integrating final context for ${rankedResults.length} results`);
    
    // 取前N个最相关的结果
    const topResults = rankedResults.slice(0, 10);
    
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
 * 构建用于大模型整合的提示 - 简化版本，判断是否需要第二轮搜索
 */
function buildIntegrationPrompt(originalPrompt: string, context: ContextIntegrationResult): string {
    let prompt = `用户问题："${originalPrompt}"

搜索结果：
`;

    // 简化的结果格式，让大模型自己理解
    context.rankedResults.forEach((result, index) => {
        prompt += `${index + 1}. ${result.uri.fsPath}`;
        
        if (result.symbolInfo?.location?.range) {
            const range = result.symbolInfo.location.range;
            prompt += ` (行 ${range.start.line + 1}-${range.end.line + 1})`;
        }
        
        prompt += `
${result.description}
\`\`\`
${result.content}
\`\`\`

`;
    });
    
    prompt += `请分析这些搜索结果并判断是否需要第二轮精确搜索：

高价值的第二轮场景：
- find_usages: 找到函数/方法定义，需要查看使用位置
- go_to_definition: 找到调用，需要查看具体实现
- text_search: 发现关键信息缺失，需要补充搜索

输出JSON格式：
{
  "factualSummary": "基于搜索结果的客观事实陈述，不试图回答用户问题，只整合发现的信息",
  "needsSecondRound": true/false,
  "secondRoundActions": [
    {"type": "find_usages", "symbol": "具体符号名", "file": "文件路径", "line": 行号},
    {"type": "text_search", "keywords": ["关键词1", "关键词2"], "reason": "搜索原因"}
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
 * 生成事实报告（使用AI智能整合第一轮和第二轮的所有信息）
 */
async function generateFactualReport(
    originalPrompt: string,
    firstRoundResults: RankedResultItem[],
    secondRoundResults: SearchResultItem[],
    firstRoundSummary: string
): Promise<string> {
    DebugLogger.log('Starting AI-powered factual report generation');
    
    // 构建完整的信息源给大模型分析
    let allInformation = `# 原始查询
"${originalPrompt}"

# 第一轮搜索摘要
${firstRoundSummary}

# 第一轮详细发现
`;

    // 添加第一轮结果的完整信息
    firstRoundResults.forEach((result, index) => {
        allInformation += `\n## 发现 ${index + 1}: ${result.uri.fsPath}`;
        
        if (result.symbolInfo?.location?.range) {
            const range = result.symbolInfo.location.range;
            allInformation += ` (行 ${range.start.line + 1}-${range.end.line + 1})`;
        }
        
        allInformation += `\n**类型**: ${result.description}`;
        
        if (result.score) {
            allInformation += `\n**相关性评分**: ${result.score}/10`;
        }
        
        allInformation += `\n**代码内容**:\n\`\`\`\n${result.content}\n\`\`\`\n`;
    });

    // 添加第二轮补充信息
    if (secondRoundResults.length > 0) {
        allInformation += `\n# 第二轮精确搜索补充信息\n`;
        
        secondRoundResults.forEach((result, index) => {
            allInformation += `\n## 补充发现 ${index + 1}: ${result.uri.fsPath}`;
            allInformation += `\n**类型**: ${result.description}`;
            allInformation += `\n**代码内容**:\n\`\`\`\n${result.content}\n\`\`\`\n`;
        });
    }

    // 构建让大模型智能整合分析的提示
    const analysisPrompt = `${allInformation}

# 分析任务
作为专业的代码分析师，请基于以上所有搜索发现的信息，生成一份高质量的事实整合报告。

## 分析要求：
1. **智能过滤**: 识别并丢弃明显与原始查询无关的信息
2. **信息整合**: 将相关信息组织成完整的叙事逻辑
3. **相关性说明**: 明确解释每部分信息如何支撑回答原始查询
4. **缺失分析**: 指出残缺的代码片段中指向的关联信息
5. **客观结论**: 基于现有证据给出客观的发现总结

## 输出格式要求：
- 使用清晰的标题结构
- 突出关键发现和代码片段
- 避免冗余重复
- 保持客观和事实性

请生成完整的分析报告：`;

    // 使用AI进行智能整合分析
    const aiIntegratedReport = await useCopilotChat(analysisPrompt);
    
    DebugLogger.log('AI factual report generation completed successfully');
    return aiIntegratedReport;
}
