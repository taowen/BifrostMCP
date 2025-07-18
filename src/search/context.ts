import { DebugLogger } from './logger';
import { SearchResultItem, IntentAnalysis } from './types';

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
}

/**
 * 整合最终上下文 - 返回事实和位置信息
 */
export async function integrateFinalContext(
    originalPrompt: string, 
    rankedResults: SearchResultItem[], 
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
            undefined
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
        
        // 计算重要性（基于排序位置，前面的更重要）
        const importance = Math.max(1, 5 - Math.floor(index / 2));
        
        facts.push({
            type: factType,
            content: result.content,
            sourceIndex: index,
            importance: importance
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
    results: SearchResultItem[], 
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
 * 格式化上下文结果为文本
 */
export function formatContextResult(context: ContextIntegrationResult): string {
    let output = `# 搜索结果\n\n${context.summary}\n\n`;
    
    // 按重要性排序事实
    const sortedFacts = [...context.facts].sort((a, b) => b.importance - a.importance);
    
    output += '## 关键信息\n\n';
    sortedFacts.forEach((fact, index) => {
        const source = context.sources[fact.sourceIndex];
        output += `### ${index + 1}. ${fact.type.toUpperCase()}\n`;
        output += `**位置**: ${source.filePath}`;
        if (source.lineRange) {
            output += ` (行 ${source.lineRange})`;
        }
        output += `\n**类型**: ${source.description}\n\n`;
        output += '```\n' + fact.content + '\n```\n\n';
    });
    
    return output;
}
