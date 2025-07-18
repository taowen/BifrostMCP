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
只返回JSON格式的结果，格式为: {"rankedIdentifiers": ["标识符1", "标识符2", "标识符3", ...]}

不要包含任何解释或其他文本，只返回JSON：
`;

    DebugLogger.logGPTCall('Intelligent ranking', rankingPrompt);
    
    try {
        const response = await useCopilotChat(rankingPrompt);
        DebugLogger.logGPTCall('Intelligent ranking response', response);
        
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
        
    } catch (error) {
        DebugLogger.log('Error in intelligent ranking:', error);
    }
    
    // 如果排序失败，返回原始结果
    DebugLogger.log('Ranking failed, returning original order');
    return results;
}

/**
 * 整合最终上下文
 */
export async function integrateFinalContext(originalPrompt: string, rankedResults: SearchResultItem[], intentAnalysis?: IntentAnalysis | null): Promise<string> {
    // 取前N个最相关的结果
    const topResults = rankedResults.slice(0, 10);
    
    // 根据意图类型定制提示（如果有意图分析）
    let intentSpecificInstructions = '';
    if (intentAnalysis) {
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
    } else {
        // 没有意图分析时的默认指令
        intentSpecificInstructions = `
特别关注：
- 与用户查询最相关的信息
- 提供清晰的代码概述
- 突出关键的技术细节`;
    }

    const contextPrompt = `
用户查询: "${originalPrompt}"

以下是根据智能搜索和排序找到的最相关信息：

${topResults.map((result, index) => 
    `## 信息 ${index + 1} \n` +
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

    DebugLogger.logGPTCall('Final context integration', contextPrompt);
    const response = await useCopilotChat(contextPrompt);
    DebugLogger.logGPTCall('Final context integration response', response);
    
    return response;
}
