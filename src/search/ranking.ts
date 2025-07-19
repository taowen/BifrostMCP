import { useCopilotChat } from '../copilotChat';
import { DebugLogger } from './logger';
import { SearchResultItem, RankedResultItem, BatchConfig, BatchRankingResult } from './types';
import { getExtendedContext } from './utils';

/**
 * 默认批次处理配置
 */
const DEFAULT_BATCH_CONFIG: BatchConfig = {
    batchSize: 8,           // 每批次处理8个结果
    maxConcurrency: 3,      // 最多3个并发
    contextLines: 15        // 上下文行数
};

/**
 * 使用大模型直接对搜索结果进行智能排序
 * @param originalPrompt 原始查询
 * @param results 搜索结果
 * @param config 批次配置
 * @returns 按相关性排序的结果
 */
export async function rankResultsByRelevance(
    originalPrompt: string, 
    results: SearchResultItem[], 
    config: BatchConfig = DEFAULT_BATCH_CONFIG
): Promise<RankedResultItem[]> {
    DebugLogger.log(`Starting intelligent ranking for ${results.length} results`);
    
    if (results.length === 0) {
        return [];
    }

    // 如果结果很少，使用单批次处理
    if (results.length <= config.batchSize) {
        const batchResult = await processBatch(originalPrompt, results, config.contextLines);
        return batchResult.rankedResults;
    }

    // 分批处理
    const batches = createBatches(results, config.batchSize);
    DebugLogger.log(`Split ${results.length} results into ${batches.length} batches`);

    // 并发处理所有批次
    const allRankedResults = await processBatchesConcurrently(
        originalPrompt, 
        batches, 
        config.maxConcurrency, 
        config.contextLines
    );

    // 对所有批次的结果进行最终排序
    const finalSortedResults = await finalSortResults(originalPrompt, allRankedResults);
    
    DebugLogger.log(`Ranking completed. Final ${finalSortedResults.length} results`);
    return finalSortedResults;
}

/**
 * 创建批次
 */
function createBatches(results: SearchResultItem[], batchSize: number): SearchResultItem[][] {
    const batches: SearchResultItem[][] = [];
    for (let i = 0; i < results.length; i += batchSize) {
        batches.push(results.slice(i, i + batchSize));
    }
    return batches;
}

/**
 * 并发处理批次
 */
async function processBatchesConcurrently(
    originalPrompt: string,
    batches: SearchResultItem[][],
    maxConcurrency: number,
    contextLines: number
): Promise<RankedResultItem[]> {
    const allResults: RankedResultItem[] = [];
    
    // 分组并发处理
    for (let i = 0; i < batches.length; i += maxConcurrency) {
        const concurrentBatches = batches.slice(i, i + maxConcurrency);
        
        DebugLogger.log(`Processing batch group ${Math.floor(i / maxConcurrency) + 1}/${Math.ceil(batches.length / maxConcurrency)} with ${concurrentBatches.length} concurrent batches`);
        
        // 并发处理当前组的所有批次
        const batchPromises = concurrentBatches.map(batch => 
            processBatch(originalPrompt, batch, contextLines)
        );
        
        const batchResults = await Promise.all(batchPromises);
        
        // 合并结果
        for (const batchResult of batchResults) {
            allResults.push(...batchResult.rankedResults);
        }
    }
    
    return allResults;
}

/**
 * 处理单个批次
 */
async function processBatch(
    originalPrompt: string,
    batch: SearchResultItem[],
    contextLines: number
): Promise<BatchRankingResult> {
    const startTime = Date.now();
    
    DebugLogger.log(`Processing batch with ${batch.length} results`);
    
    // 为每个结果获取扩展上下文
    const enhancedResults = await Promise.all(
        batch.map(async (result, index) => {
            const extendedContext = await getExtendedContext(result.uri, undefined, contextLines);
            return {
                ...result,
                batchIndex: index,
                extendedContext
            };
        })
    );

    // 为每个结果生成一个唯一的文本标识符
    const resultIdentifiers = enhancedResults.map((result, index) => {
        const fileName = result.uri.fsPath.split(/[\\\/]/).pop() || 'unknown';
        const pathParts = result.uri.fsPath.split(/[\\\/]/).slice(-3).join('/');
        return `[${fileName}_${pathParts.replace(/[^a-zA-Z0-9_]/g, '_')}_${index}]`;
    });

    // 构建排序提示词
    const rankingPrompt = `
用户查询: "${originalPrompt}"

以下是搜索到的代码片段，请根据与用户查询的相关性进行智能排序和分析。

${enhancedResults.map((result, index) => 
    `标识符: ${resultIdentifiers[index]}\n` +
    `类型: ${result.description}\n` +
    `文件: ${result.uri.fsPath}\n` +
    `代码内容:\n${result.content}\n` +
    `上下文:\n${result.extendedContext}\n`
).join('\n---\n')}

**重要：请严格按照以下标准评分，避免所有结果都给相同评分**

评分标准：
- 9-10分：直接回答用户问题的核心代码，完全匹配查询意图
- 7-8分：与查询高度相关，提供重要信息或实现
- 5-6分：与查询相关，但不是核心功能或主要实现
- 3-4分：间接相关，可能提供参考价值
- 1-2分：基本无关或重复信息

分析要求：
1. 仔细阅读代码内容，理解其具体功能
2. 判断代码与查询的直接关联程度
3. 识别关键实现细节和技术要点
4. 评估代码的实用性和参考价值
5. 确保评分有明显区分度

对于每个代码片段，请提供详细分析：
- 相关性评分（1-10分）
- 相关性分析：为什么与查询相关/不相关
- 关键发现：从代码中发现的重要信息（数组）
- 使用场景：这段代码的典型用途
- 代码洞察：技术实现的要点或值得注意的地方
- 简短评论：一句话总结价值

请按照相关性从高到低的顺序，返回排序后的结果。
返回JSON格式，格式为: {
    "reason": "整体排序的原因",
    "rankedResults": [
        {
            "identifier": "标识符",
            "score": 评分,
            "comment": "一句话总结价值",
            "relevanceAnalysis": "详细的相关性分析",
            "keyFindings": ["发现1", "发现2", "发现3"],
            "usageContext": "使用场景描述",
            "codeInsights": "技术洞察"
        }
    ]
}

不要包含任何解释或其他文本，只返回JSON：
`;

    try {
        const response = await useCopilotChat(rankingPrompt);
        DebugLogger.logGPTCall('Batch ranking', rankingPrompt, response);
        
        const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const rankingResult = JSON.parse(cleanResponse);
        
        const rankedResults: RankedResultItem[] = [];
        
        if (rankingResult.rankedResults && Array.isArray(rankingResult.rankedResults)) {
            // 根据排序结果创建增强的搜索结果
            for (const rankedItem of rankingResult.rankedResults) {
                const index = resultIdentifiers.findIndex(id => id === rankedItem.identifier);
                if (index >= 0) {
                    const originalResult = enhancedResults[index];
                    rankedResults.push({
                        uri: originalResult.uri,
                        content: originalResult.content,
                        symbolInfo: originalResult.symbolInfo,
                        description: originalResult.description,
                        score: rankedItem.score || 5,
                        comment: rankedItem.comment || '无评论',
                        extendedContext: originalResult.extendedContext,
                        // 保存AI分析结果，供后续使用
                        aiAnalysis: {
                            relevanceAnalysis: rankedItem.relevanceAnalysis || '',
                            keyFindings: rankedItem.keyFindings || [],
                            usageContext: rankedItem.usageContext || '',
                            codeInsights: rankedItem.codeInsights || '',
                            batchReason: rankingResult.reason || ''
                        }
                    });
                }
            }
            
            // 添加任何遗漏的结果
            for (let i = 0; i < enhancedResults.length; i++) {
                const found = rankedResults.find(r => 
                    r.uri.fsPath === enhancedResults[i].uri.fsPath && 
                    r.content === enhancedResults[i].content
                );
                if (!found) {
                    const originalResult = enhancedResults[i];
                    rankedResults.push({
                        uri: originalResult.uri,
                        content: originalResult.content,
                        symbolInfo: originalResult.symbolInfo,
                        description: originalResult.description,
                        score: 3,
                        comment: '未被大模型评估的结果',
                        extendedContext: originalResult.extendedContext,
                        aiAnalysis: {
                            relevanceAnalysis: '未进行AI分析',
                            keyFindings: [],
                            usageContext: '未知',
                            codeInsights: '无分析',
                            batchReason: '遗漏结果'
                        }
                    });
                }
            }
        } else {
            // 如果大模型返回格式不正确，使用原始顺序
            for (const result of enhancedResults) {
                rankedResults.push({
                    uri: result.uri,
                    content: result.content,
                    symbolInfo: result.symbolInfo,
                    description: result.description,
                    score: 5,
                    comment: '大模型返回格式错误，使用默认评分',
                    extendedContext: result.extendedContext,
                    aiAnalysis: {
                        relevanceAnalysis: '大模型返回格式错误',
                        keyFindings: [],
                        usageContext: '未知',
                        codeInsights: '无分析',
                        batchReason: '格式错误回退'
                    }
                });
            }
        }
        
        const processingTime = Date.now() - startTime;
        DebugLogger.log(`Batch processed in ${processingTime}ms with ${rankedResults.length} results`);
        
        return {
            rankedResults,
            processingTime
        };
    } catch (error) {
        DebugLogger.log(`Batch processing error: ${error}`);
        
        // 错误处理：返回原始结果
        const fallbackResults: RankedResultItem[] = enhancedResults.map(result => ({
            uri: result.uri,
            content: result.content,
            symbolInfo: result.symbolInfo,
            description: result.description,
            score: 5,
            comment: `批次处理失败: ${error}`,
            extendedContext: result.extendedContext,
            aiAnalysis: {
                relevanceAnalysis: `处理失败: ${error}`,
                keyFindings: [],
                usageContext: '未知',
                codeInsights: '无分析',
                batchReason: '处理异常'
            }
        }));
        
        return {
            rankedResults: fallbackResults,
            processingTime: Date.now() - startTime
        };
    }
}

/**
 * 对所有批次的结果进行最终排序
 */
async function finalSortResults(
    originalPrompt: string,
    allResults: RankedResultItem[]
): Promise<RankedResultItem[]> {
    DebugLogger.log('Starting final sort of all batch results');
    
    // 如果结果数量不多，直接按分数排序
    if (allResults.length <= 20) {
        return allResults.sort((a, b) => b.score - a.score);
    }
    
    // 如果结果很多，先按分数排序，然后对前20个进行精细排序
    const sortedByScore = allResults.sort((a, b) => b.score - a.score);
    const top20 = sortedByScore.slice(0, 20);
    const rest = sortedByScore.slice(20);
    
    try {
        const finalSortPrompt = `
用户查询: "${originalPrompt}"

以下是已经经过批次排序的高质量候选结果，每个都有评分和评论。
请根据整体相关性进行最终排序：

${top20.map((result, index) => 
    `序号: ${index + 1}\n` +
    `文件: ${result.uri.fsPath}\n` +
    `评分: ${result.score}\n` +
    `评论: ${result.comment}\n` +
    `描述: ${result.description}\n`
).join('\n---\n')}

请重新排序这些结果，考虑：
1. 与用户查询的直接相关性
2. 代码的重要性和核心程度
3. 评论中提到的价值
4. 整体的实用性

返回JSON格式: {
    "reason": "最终排序的原因",
    "finalOrder": [1, 2, 3, ...] // 按新的排序返回序号数组
}

不要包含任何解释或其他文本，只返回JSON：
`;

        const response = await useCopilotChat(finalSortPrompt);
        DebugLogger.logGPTCall('Final sort', finalSortPrompt, response);
        
        const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const finalSortResult = JSON.parse(cleanResponse);
        
        if (finalSortResult.finalOrder && Array.isArray(finalSortResult.finalOrder)) {
            const finalResults: RankedResultItem[] = [];
            
            // 按照最终排序添加结果
            for (const order of finalSortResult.finalOrder) {
                const index = order - 1; // 转换为0基索引
                if (index >= 0 && index < top20.length) {
                    finalResults.push(top20[index]);
                }
            }
            
            // 添加任何遗漏的top20结果
            for (let i = 0; i < top20.length; i++) {
                if (!finalResults.find(r => r === top20[i])) {
                    finalResults.push(top20[i]);
                }
            }
            
            // 添加剩余的结果
            finalResults.push(...rest);
            
            DebugLogger.log(`Final sort completed with ${finalResults.length} results`);
            return finalResults;
        }
    } catch (error) {
        DebugLogger.log(`Final sort error: ${error}`);
    }
    
    // 如果最终排序失败，返回按分数排序的结果
    return sortedByScore;
}
