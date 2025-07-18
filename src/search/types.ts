import * as vscode from 'vscode';

/**
 * 实体类型枚举
 */
export enum EntityType {
    FUNCTION = 'function',
    CLASS = 'class',
    VARIABLE = 'variable',
    FILE = 'file',
    MODULE = 'module',
    INTERFACE = 'interface',
    TYPE = 'type',
    NAMESPACE = 'namespace',
    CONCEPT = 'concept'
}

/**
 * 提取的实体信息
 */
export interface ExtractedEntity {
    name: string;
    type: EntityType;
    confidence: number;
}

/**
 * 搜索结果项
 */
export interface SearchResultItem {
    uri: vscode.Uri;
    content: string;
    symbolInfo?: vscode.SymbolInformation;
    relevanceScore: number;
    description: string;
}

/**
 * 意图分析结果
 */
export interface IntentAnalysis {
    intent: 'find_entry' | 'find_structure' | 'find_entity' | 'understand_flow' | 'find_usage' | 'debug_issue' | 'other';
    entities: ExtractedEntity[];
    searchStrategy: ('workspace_symbols' | 'text_search' | 'file_structure' | 'config_files' | 'documentation')[];
    keyTerms: string[];
}