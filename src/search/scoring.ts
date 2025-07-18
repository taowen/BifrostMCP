import { useCopilotChat } from '../copilotChat';
import { DebugLogger } from './logger';
import { SearchResultItem, IntentAnalysis } from './types';

/**
 * 对搜索结果进行相关性打分
 */
export async function scoreRelevance(originalPrompt: string, results: SearchResultItem[]): Promise<SearchResultItem[]> {
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

    DebugLogger.logGPTCall(scoringPrompt, '');
    const response = await useCopilotChat(scoringPrompt);
    DebugLogger.logGPTCall(scoringPrompt, response);
    
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
export async function integrateFinalContext(originalPrompt: string, scoredResults: SearchResultItem[], intentAnalysis: IntentAnalysis): Promise<string> {
    // 取前N个最相关的结果
    const topResults = scoredResults.slice(0, 10);
    
    // 根据意图类型定制提示
    let intentSpecificInstructions = '';
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

    const contextPrompt = `
用户查询: "${originalPrompt}"
查询意图: ${intentAnalysis.intent}

以下是根据多维度搜索策略找到的相关信息：

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