import { useCopilotChat } from '../copilotChat';
import { DebugLogger } from './logger';
import { SearchResultItem, IntentAnalysis } from './types';

/**
 * 让大模型分析并返回最相关的内容
 */
export async function scoreRelevance(originalPrompt: string, results: SearchResultItem[]): Promise<SearchResultItem[]> {
    const selectionPrompt = `
用户查询: "${originalPrompt}"

以下是搜索到的代码片段，请分析并选择最相关的内容。请按相关性从高到低排序，并返回索引列表：

${results.map((result, index) => 
    `索引 ${index}: ${result.description}\n` +
    `文件: ${result.uri.fsPath}\n` +
    `内容预览: ${result.content.substring(0, 300)}...\n`
).join('\n---\n')}

请分析每个代码片段与用户查询的相关性，并按照以下标准进行排序：
1. 直接回答用户问题的代码
2. 与查询主题密切相关的实现
3. 相关的配置或辅助代码
4. 间接相关的代码

请以JSON格式返回排序后的索引列表，格式为: {"sortedIndexes": [3, 0, 1, 2, ...]}
索引按相关性从高到低排列。只返回JSON，不要其他解释：
`;

    DebugLogger.logGPTCall(selectionPrompt, '');
    const response = await useCopilotChat(selectionPrompt);
    DebugLogger.logGPTCall(selectionPrompt, response);
    
    try {
        const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const selectionResult = JSON.parse(cleanResponse);
        
        // 根据大模型返回的排序重新组织结果
        if (selectionResult.sortedIndexes && Array.isArray(selectionResult.sortedIndexes)) {
            const sortedResults: SearchResultItem[] = [];
            
            // 按照大模型建议的顺序重新排列
            selectionResult.sortedIndexes.forEach((index: number, position: number) => {
                if (index >= 0 && index < results.length) {
                    const result = results[index];
                    // 设置相关性分数，越靠前分数越高
                    result.relevanceScore = 1.0 - (position * 0.1);
                    sortedResults.push(result);
                }
            });
            
            // 添加任何遗漏的结果（以防大模型没有包含所有索引）
            results.forEach((result, index) => {
                if (!selectionResult.sortedIndexes.includes(index)) {
                    result.relevanceScore = 0.1; // 给遗漏的结果最低分
                    sortedResults.push(result);
                }
            });
            
            DebugLogger.log(`Reordered ${sortedResults.length} results based on AI analysis`);
            return sortedResults;
        }
    } catch (error) {
        DebugLogger.log('Error parsing AI selection response, falling back to original order:', error);
    }
    
    // 如果解析失败，返回原始结果并设置默认分数
    results.forEach((result, index) => {
        result.relevanceScore = 1.0 - (index * 0.1);
    });
    
    return results;
}

/**
 * 整合最终上下文
 */
export async function integrateFinalContext(originalPrompt: string, scoredResults: SearchResultItem[], intentAnalysis?: IntentAnalysis | null): Promise<string> {
    // 取前N个最相关的结果
    const topResults = scoredResults.slice(0, 10);
    
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

以下是根据智能搜索找到的相关信息：

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