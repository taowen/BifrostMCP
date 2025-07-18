import { DebugLogger } from './logger';
import { SearchResultItem, IntentAnalysis, RankedResultItem } from './types';
import { useCopilotChat } from '../copilotChat';

/**
 * 上下文整合结果
 */
export interface ContextIntegrationResult {
    /** 查询相关的事实信息 */
    facts: FactItem[];
    /** 信息位置和来源 */
    sources: SourceLocation[];
    /** 搜索摘要 */
    summary: string;
}

/**
 * 事实信息项
 */
export interface FactItem {
    /** 事实类型 */
    type: string;
    /** 事实内容 */
    content: string;
    /** 来源索引 */
    sourceIndex: number;
    /** 重要性等级 (1-5) */
    importance: number;
    /** 大模型评论 */
    comment?: string;
    /** 评分 */
    score?: number;
}

/**
 * 源位置信息
 */
export interface SourceLocation {
    /** 文件路径 */
    filePath: string;
    /** 文件类型描述 */
    description: string;
    /** 代码片段 */
    codeSnippet: string;
    /** 行号范围（如果有） */
    lineRange?: string;
    /** 扩展上下文 */
    extendedContext?: string;
    /** 评分 */
    score?: number;
    /** 评论 */
    comment?: string;
}

/**
 * 整合最终上下文 - 返回事实和位置信息
 */
export async function integrateFinalContext(
    originalPrompt: string, 
    rankedResults: RankedResultItem[], 
    intentAnalysis?: IntentAnalysis | null
): Promise<ContextIntegrationResult> {
    DebugLogger.log(`Integrating final context for ${rankedResults.length} results`);
    
    // 取前N个最相关的结果
    const topResults = rankedResults.slice(0, 10);
    
    // 构建源位置信息
    const sources: SourceLocation[] = topResults.map((result, index) => ({
        filePath: result.uri.fsPath,
        description: result.description,
        codeSnippet: result.content,
        lineRange: result.symbolInfo?.location?.range ? 
            `${result.symbolInfo.location.range.start.line + 1}-${result.symbolInfo.location.range.end.line + 1}` : 
            undefined,
        extendedContext: result.extendedContext,
        score: result.score,
        comment: result.comment
    }));
    
    // 提取事实信息
    const facts: FactItem[] = [];
    
    topResults.forEach((result, index) => {
        // 根据结果类型确定事实类型
        let factType = 'code';
        if (result.description.includes('函数')) {
            factType = 'function';
        } else if (result.description.includes('类')) {
            factType = 'class';
        } else if (result.description.includes('接口')) {
            factType = 'interface';
        } else if (result.description.includes('变量')) {
            factType = 'variable';
        } else if (result.description.includes('配置')) {
            factType = 'configuration';
        }
        
        // 使用大模型的评分作为重要性，如果没有评分则基于排序位置
        const importance = result.score ? Math.min(5, Math.ceil(result.score / 2)) : Math.max(1, 5 - Math.floor(index / 2));
        
        facts.push({
            type: factType,
            content: result.content,
            sourceIndex: index,
            importance: importance,
            comment: result.comment,
            score: result.score
        });
    });
    
    // 生成搜索摘要
    const summary = generateSearchSummary(originalPrompt, topResults, intentAnalysis);
    
    const result: ContextIntegrationResult = {
        facts,
        sources,
        summary
    };
    
    DebugLogger.log(`Context integration completed. Found ${facts.length} facts from ${sources.length} sources`);
    return result;
}

/**
 * 生成搜索摘要
 */
function generateSearchSummary(
    originalPrompt: string, 
    results: RankedResultItem[], 
    intentAnalysis?: IntentAnalysis | null
): string {
    const fileCount = new Set(results.map(r => r.uri.fsPath)).size;
    const resultTypes = results.map(r => r.description).join(', ');
    
    let summary = `针对查询 "${originalPrompt}" 找到 ${results.length} 个相关结果，涉及 ${fileCount} 个文件。`;
    
    if (intentAnalysis) {
        switch (intentAnalysis.intent) {
            case 'find_entry':
                summary += ' 重点关注项目入口点和启动流程。';
                break;
            case 'find_structure':
                summary += ' 重点关注项目架构和代码组织。';
                break;
            case 'find_entity':
                summary += ' 重点关注具体实体的定义和实现。';
                break;
            case 'understand_flow':
                summary += ' 重点关注执行流程和调用关系。';
                break;
            default:
                summary += ' 提供相关的代码信息和实现细节。';
        }
    }
    
    summary += `\n\n主要结果类型：${resultTypes}`;
    
    return summary;
}

/**
 * 格式化上下文结果为文本 - 使用大模型整合事实线索
 */
export async function formatContextResult(context: ContextIntegrationResult): Promise<string> {
    try {
        DebugLogger.log('Starting AI-powered context formatting');
        
        // 构建用于大模型的整合提示
        const integrationPrompt = buildIntegrationPrompt(context);
        
        // 调用大模型进行整合
        const aiResponse = await useCopilotChat(integrationPrompt);
        
        DebugLogger.log('AI context integration completed');
        return aiResponse;
        
    } catch (error) {
        DebugLogger.log('AI integration failed, falling back to simple format:', error);
        // 如果大模型调用失败，使用简化的格式化
        return formatContextResultSimple(context);
    }
}

/**
 * 构建用于大模型整合的提示
 */
function buildIntegrationPrompt(context: ContextIntegrationResult): string {
    let prompt = `# 代码搜索结果整合任务

## 任务要求
请基于以下搜索结果，整理出有助于理解代码的**事实线索**，而不是直接给出结论。重点是：
1. 列出关键的代码位置和定义
2. 提供代码片段的上下文说明
3. 指出相关的文件和功能模块
4. 保持客观，提供线索而非判断
5. 对于我们这次发现的代码里提到了，但是没有全文的信息，给用户提示去查看完整代码
6. 输出的条目应该尽可能的少，扔掉明显无关的信息

## 搜索摘要
${context.summary}

## 发现的关键信息

`;

    // 按重要性排序事实
    const sortedFacts = [...context.facts].sort((a, b) => b.importance - a.importance);
    
    // 为每个事实添加详细信息
    sortedFacts.forEach((fact, index) => {
        const source = context.sources[fact.sourceIndex];
        
        prompt += `### 线索 ${index + 1}: ${fact.type.toUpperCase()}
**位置**: ${source.filePath}`;
        
        if (source.lineRange) {
            prompt += ` (行 ${source.lineRange})`;
        }
        
        prompt += `
**描述**: ${source.description}
**重要性**: ${fact.importance}/5`;
        
        if (fact.score) {
            prompt += ` (AI评分: ${fact.score}/10)`;
        }
        
        prompt += `

**代码片段**:
\`\`\`
${fact.content}
\`\`\`

`;
        
        // 如果有扩展上下文，添加部分内容
        if (source.extendedContext && source.extendedContext !== fact.content) {
            prompt += `**扩展上下文**:
\`\`\`
${source.extendedContext.slice(0, 500)}${source.extendedContext.length > 500 ? '...' : ''}
\`\`\`

`;
        }
    });
    
    prompt += `
## 请整理输出
请基于以上信息，整理出：
1. **关键代码位置**: 列出主要的文件和函数/类位置
2. **功能模块**: 说明涉及的主要功能模块
3. **代码关系**: 指出代码片段之间的关联
4. **实现细节**: 提供有助于理解的技术细节

输出格式要求：
- 使用清晰的 Markdown 格式
- 保持客观描述，避免主观判断
- 重点突出位置信息和代码片段
- 如果有多个相关文件，按重要性排序`;

    return prompt;
}

/**
 * 简化的格式化函数（大模型调用失败时的后备方案）
 */
function formatContextResultSimple(context: ContextIntegrationResult): string {
    let output = `# 搜索结果\n\n${context.summary}\n\n`;
    
    // 按重要性排序事实
    const sortedFacts = [...context.facts].sort((a, b) => b.importance - a.importance);
    
    output += '## 关键代码位置\n\n';
    sortedFacts.slice(0, 5).forEach((fact, index) => {
        const source = context.sources[fact.sourceIndex];
        output += `### ${index + 1}. ${source.filePath}`;
        
        if (source.lineRange) {
            output += ` (行 ${source.lineRange})`;
        }
        output += '\n';
        
        output += `**类型**: ${source.description}\n`;
        output += `**重要性**: ${fact.importance}/5\n\n`;
        
        output += '```\n' + fact.content.slice(0, 200) + (fact.content.length > 200 ? '...' : '') + '\n```\n\n';
    });
    
    return output;
}
