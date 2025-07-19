import * as vscode from 'vscode';

/**
 * 搜索结果项
 */
export interface SearchResultItem {
    uri: vscode.Uri;
    content: string;
    symbolInfo?: vscode.SymbolInformation;
    description: string;
}

/**
 * 带有排名和评论的搜索结果项
 */
export interface RankedResultItem extends SearchResultItem {
    score: number;
    comment: string;
    extendedContext?: string;
}



/**
 * 搜索策略类型
 */
export type SearchStrategyType = 
    | 'vscode_workspace_symbols'   // VSCode 工作区符号搜索
    | 'text_search'               // 关键词文本搜索
    | 'file_name_search'          // 文件名搜索
    | 'file_prediction';          // 基于目录结构的文件推测

/**
 * 搜索策略项
 */
export interface SearchStrategy {
    type: SearchStrategyType;
    name: string;
    description: string;
    searchTerms: string[];
    priority: 'high' | 'medium' | 'low';
    expectedResults: number;
    results?: SearchResultItem[];
    status?: 'pending' | 'executing' | 'completed' | 'failed';
    executionTime?: number;
    error?: string;
}

/**
 * 搜索计划
 */
export interface SearchPlan {
    strategies: SearchStrategy[];
    totalEstimatedTime: number;
    confidence: number;
    reasoning: string;
}

/**
 * 分批排序的结果
 */
export interface BatchRankingResult {
    rankedResults: RankedResultItem[];
    processingTime: number;
}

/**
 * 批次处理配置
 */
export interface BatchConfig {
    batchSize: number;
    maxConcurrency: number;
    contextLines: number;
}