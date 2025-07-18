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
 * 意图分析结果
 */
export interface IntentAnalysis {
    intent: 'find_entry' | 'find_structure' | 'find_entity' | 'understand_flow' | 'find_usage' | 'debug_issue' | 'other';
    searchStrategy: ('workspace_symbols' | 'text_search' | 'file_structure' | 'config_files' | 'documentation')[];
    keyTerms: string[];
}