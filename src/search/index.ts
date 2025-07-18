import * as vscode from 'vscode';
import { DebugLogger } from './logger';
import { analyzeQueryAndSearch, directChatResponse } from './intent';
import { scoreRelevance, integrateFinalContext } from './scoring';
import { SearchResultItem } from './types';

/**
 * 智能搜索主函数
 * @param prompt 用户输入的提示语
 * @returns 整理后的上下文信息
 */
export async function smartSearch(prompt: string): Promise<string> {
    try {
        DebugLogger.log('Starting smart search for prompt:', prompt);
        DebugLogger.show(); // 立即显示调试面板
        
        // 检查工作区
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return '❌ 没有打开的工作区文件夹。请先打开一个包含代码的文件夹。';
        }
        
        // 使用大模型分析查询并执行搜索
        DebugLogger.log('Step 1: Analyzing query and executing search');
        const searchResults = await analyzeQueryAndSearch(prompt);
        DebugLogger.log(`Found ${searchResults.length} initial results`);
        
        // 如果没有找到任何结果，使用直接聊天响应
        if (searchResults.length === 0) {
            DebugLogger.log('No search results found, using direct chat response');
            return await directChatResponse(prompt);
        }
        
        // 相关性打分和排序
        DebugLogger.log('Step 2: Scoring relevance');
        const scoredResults = await scoreRelevance(prompt, searchResults);
        DebugLogger.log(`Scored ${scoredResults.length} results`);
        
        // 整合最终上下文信息
        DebugLogger.log('Step 3: Integrating final context');
        const finalContext = await integrateFinalContext(prompt, scoredResults, null);
        
        DebugLogger.log('Smart search completed successfully');
        
        return finalContext;
        
    } catch (error) {
        DebugLogger.log('Smart search error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : 'No stack trace available';
        DebugLogger.log('Error stack:', errorStack);
        return `搜索过程中出现错误: ${errorMessage}\n\n详细错误信息请查看 "Smart Search Debug" 输出面板`;
    }
}

// 导出所有类型，供其他模块使用
export * from './types';
export * from './logger';
export * from './intent';
export * from './scoring';
export * from './utils';