import * as vscode from 'vscode';
import { DebugLogger } from './logger';
import { analyzeIntentAndExtractEntities, directChatResponse } from './intent';
import { executeSearchStrategy, searchForEntity } from './strategies';
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
        
        // 第一步：分析意图并提取实体
        DebugLogger.log('Step 1: Analyzing intent and extracting entities');
        const intentAnalysis = await analyzeIntentAndExtractEntities(prompt);
        DebugLogger.log('Intent analysis result:', intentAnalysis);
        
        if (intentAnalysis.intent === 'other' && intentAnalysis.entities.length === 0 && intentAnalysis.keyTerms.length === 0) {
            DebugLogger.log('No actionable information found, using direct chat response');
            return await directChatResponse(prompt);
        }
        
        // 第二步：根据搜索策略执行多维度搜索
        DebugLogger.log('Step 2: Executing multi-dimensional search');
        let searchResults: SearchResultItem[] = [];
        
        for (const strategy of intentAnalysis.searchStrategy) {
            DebugLogger.log(`Executing search strategy: ${strategy}`);
            const strategyResults = await executeSearchStrategy(strategy, intentAnalysis);
            DebugLogger.log(`Found ${strategyResults.length} results for strategy: ${strategy}`);
            searchResults.push(...strategyResults);
        }
        
        // 第三步：根据实体进行精准搜索
        if (intentAnalysis.entities.length > 0) {
            DebugLogger.log('Step 3: Searching for specific entities');
            for (const entity of intentAnalysis.entities) {
                if (entity.type !== 'concept') { // 跳过概念性实体
                    DebugLogger.log(`Searching for entity: ${entity.name} (${entity.type})`);
                    const entityResults = await searchForEntity(entity);
                    DebugLogger.log(`Found ${entityResults.length} results for entity ${entity.name}`);
                    searchResults.push(...entityResults);
                }
            }
        }
        
        // 第四步：相关性打分和排序
        DebugLogger.log('Step 4: Scoring relevance');
        const scoredResults = await scoreRelevance(prompt, searchResults);
        DebugLogger.log(`Scored ${scoredResults.length} results`);
        
        // 第五步：整合上下文信息
        DebugLogger.log('Step 5: Integrating final context');
        const finalContext = await integrateFinalContext(prompt, scoredResults, intentAnalysis);
        
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
export * from './strategies';
export * from './scoring';
export * from './utils';