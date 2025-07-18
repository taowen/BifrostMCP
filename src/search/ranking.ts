import { useCopilotChat } from '../copilotChat';
import { DebugLogger } from './logger';
import { SearchResultItem, IntentAnalysis } from './types';

/**
 * 使用大模型直接对搜索结果进行智能排序
 * @param originalPrompt 原始查询
 * @param results 搜索结果
 * @returns 按相关性排序的结果
 */
export async function rankResultsByRelevance(originalPrompt: string, results: SearchResultItem[]): Promise<SearchResultItem[]> {
    DebugLogger.log(`Starting intelligent ranking for ${results.length} results`);
    
    if (results.length === 0) {
        return results;
    }

    // 为每个结果生成一个唯一的文本标识符
    const resultIdentifiers = results.map((result, index) => {
        const fileName = result.uri.fsPath.split(/[\\\/]/).pop() || 'unknown';
        const pathParts = result.uri.fsPath.split(/[\\\/]/).slice(-3).join('/');
        return `[${fileName}_${pathParts.replace(/[^a-zA-Z0-9_]/g, '_')}_${index}]`;
    });

    // 构建排序提示词
    const rankingPrompt = `
用户查询: "${originalPrompt}"

以下是搜索到的代码片段，请根据与用户查询的相关性进行智能排序。

${results.map((result, index) => 
    `标识符: ${resultIdentifiers[index]}\n` +
    `类型: ${result.description}\n` +
    `文件: ${result.uri.fsPath}\n` +
    `代码内容:\n${result.content}\n`
).join('\n---\n')}

请仔细分析每个代码片段与用户查询的相关性，考虑以下因素：
1. 直接回答用户问题的程度
2. 代码的重要性和核心程度  
3. 与查询主题的匹配度
4. 代码的完整性和可理解性
5. 实用价值和参考意义

请按照相关性从高到低的顺序，返回排序后的标识符列表。
只返回JSON格式的结果，格式为: {"reason": "why you picked them", "rankedIdentifiers": ["标识符1", "标识符2", "标识符3", ...]}

不要包含任何解释或其他文本，只返回JSON：
`;

    
    const response = await useCopilotChat(rankingPrompt);
    DebugLogger.logGPTCall('Intelligent ranking', rankingPrompt, response);
    
    const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const rankingResult = JSON.parse(cleanResponse);
    
    if (rankingResult.rankedIdentifiers && Array.isArray(rankingResult.rankedIdentifiers)) {
        // 根据排序结果重新组织搜索结果
        const rankedResults: SearchResultItem[] = [];
        const usedIndices = new Set<number>();
        
        // 按照大模型返回的顺序添加结果
        for (const identifier of rankingResult.rankedIdentifiers) {
            const index = resultIdentifiers.findIndex(id => id === identifier);
            if (index >= 0 && !usedIndices.has(index)) {
                const result = results[index];
                rankedResults.push(result);
                usedIndices.add(index);
            }
        }
        
        // 添加任何遗漏的结果（以防大模型遗漏了某些标识符）
        for (let i = 0; i < results.length; i++) {
            if (!usedIndices.has(i)) {
                const result = results[i];
                rankedResults.push(result);
            }
        }
        
        DebugLogger.log(`Ranking completed. Reordered ${rankedResults.length} results`);
        return rankedResults;
    }
    return results;
}
