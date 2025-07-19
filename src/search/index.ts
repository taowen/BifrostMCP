import * as vscode from 'vscode';
import { DebugLogger } from './logger';
import { analyzeQueryAndSearch, executeSearchPlan } from './intent';
import { rankResultsByRelevance } from './ranking';
import { integrateFinalContext, formatContextResult } from './context';
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
        
        // 使用大模型分析查询并生成搜索计划
        DebugLogger.log('Step 1: Analyzing query and generating search plan');
        const searchPlan = await analyzeQueryAndSearch(prompt);
        DebugLogger.log(`Generated search plan with ${searchPlan.strategies.length} strategies`);
        
        // 执行搜索计划
        DebugLogger.log('Step 2: Executing search plan');
        const searchResults = await executeSearchPlan(searchPlan);
        DebugLogger.log(`Found ${searchResults.length} total results from all strategies`);
        
        if (searchResults.length === 0) {
            DebugLogger.log('No search results found');
            return 'nothing found';
        }
        
        // 智能排序
        DebugLogger.log('Step 3: Ranking results by relevance');
        const rankedResults = await rankResultsByRelevance(prompt, searchResults);
        DebugLogger.log(`Processed ${rankedResults.length} results with intelligent ranking`);
        
        // 整合最终上下文信息
        DebugLogger.log('Step 4: Integrating final context');
        const contextResult = await integrateFinalContext(prompt, rankedResults, searchPlan);
        
        DebugLogger.log('Smart search completed successfully');
        
        return await formatContextResult(contextResult);
        
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
export * from './ranking';
export * from './context';
export * from './utils';