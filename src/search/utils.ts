import * as vscode from 'vscode';
import { SearchResultItem } from './types';

/**
 * 获取符号内容
 */
export async function getSymbolContent(symbol: vscode.SymbolInformation): Promise<string> {
    const document = await vscode.workspace.openTextDocument(symbol.location.uri);
    const range = symbol.location.range;
    
    // 扩展范围以获取更多上下文
    const expandedRange = new vscode.Range(
        Math.max(0, range.start.line - 5),
        0,
        Math.min(document.lineCount - 1, range.end.line + 5),
        0
    );
    
    return document.getText(expandedRange);
}

/**
 * 获取文件内容
 */
export async function getFileContent(uri: vscode.Uri): Promise<string> {
    const document = await vscode.workspace.openTextDocument(uri);
    // 限制内容长度
    const fullText = document.getText();
    return fullText.length > 2000 ? fullText.substring(0, 2000) + '...' : fullText;
}

/**
 * 获取位置内容
 */
export async function getLocationContent(location: vscode.Location): Promise<string> {
    const document = await vscode.workspace.openTextDocument(location.uri);
    const range = location.range;
    
    // 扩展范围以获取上下文
    const expandedRange = new vscode.Range(
        Math.max(0, range.start.line - 3),
        0,
        Math.min(document.lineCount - 1, range.end.line + 3),
        0
    );
    
    return document.getText(expandedRange);
}

/**
 * 在工作区中搜索文本
 */
export async function searchInWorkspace(searchText: string): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    // 使用 VS Code 搜索 API
    const searchPattern = new vscode.RelativePattern(vscode.workspace.workspaceFolders![0], '**/*.{ts,js,tsx,jsx,py,java,cpp,c,h}');
    const files = await vscode.workspace.findFiles(searchPattern);
    
    for (const file of files.slice(0, 20)) { // 限制搜索文件数量
        const document = await vscode.workspace.openTextDocument(file);
        const text = document.getText();
        
        if (text.toLowerCase().includes(searchText.toLowerCase())) {
            // 找到匹配行
            const lines = text.split('\n');
            const matchingLines: string[] = [];
            
            lines.forEach((line, index) => {
                if (line.toLowerCase().includes(searchText.toLowerCase())) {
                    // 添加上下文行
                    const start = Math.max(0, index - 2);
                    const end = Math.min(lines.length - 1, index + 2);
                    const contextLines = lines.slice(start, end + 1);
                    matchingLines.push(...contextLines);
                }
            });
            
            if (matchingLines.length > 0) {
                results.push({
                    uri: file,
                    content: matchingLines.join('\n'),
                    relevanceScore: 0,
                    description: `Text match for "${searchText}" in ${file.fsPath}`
                });
            }
        }
    }
    
    return results;
}