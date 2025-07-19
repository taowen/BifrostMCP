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
 * 格式化上下文结果为文本 - 基于第一轮搜索结果
 */
export async function formatContextResult(context: ContextIntegrationResult): Promise<string> {
    DebugLogger.log('Starting AI-powered context formatting based on first round results');
    
    // 构建用于大模型的整合提示
    const integrationPrompt = buildIntegrationPrompt(context.originalPrompt, context);
    
    // 调用大模型进行分析
    const aiResponse = await useCopilotChat(integrationPrompt);
    
    DebugLogger.log('AI analysis completed, generating enhanced report');
    
    // 生成增强的报告，包含文件清单等功能
    return await generateEnhancedReport(context.originalPrompt, context.rankedResults, aiResponse);
}

/**
 * 构建用于大模型整合的提示 - 利用已有分析结果生成客观总结
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
    
    prompt += `

请基于以上搜索结果生成详细的分析报告。

**要求：**
1. 提供客观、准确的技术分析
2. 明确标注每个重要发现的文件路径和行号
3. 突出最相关和最重要的代码片段
4. 使用清晰的格式，便于开发者理解和定位

请直接生成分析报告：`;

    return prompt;
}

/**
 * 生成增强报告（保留原有功能但去掉第二轮搜索）
 */
async function generateEnhancedReport(
    originalPrompt: string,
    firstRoundResults: RankedResultItem[],
    aiAnalysisReport: string
): Promise<string> {
    DebugLogger.log('Starting enhanced report generation with file listing');
    
    const maxResults = 6;
    const limitedFirstRound = firstRoundResults.slice(0, maxResults);
    
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
    }
    
    DebugLogger.log('Enhanced report generation completed successfully');
    return aiAnalysisReport + structuredFileList;
}
