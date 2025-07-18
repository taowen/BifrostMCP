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
                    description: `Text match for "${searchText}" in ${file.fsPath}`
                });
            }
        }
    }
    
    return results;
}

/**
 * 获取项目结构信息
 */
export async function getProjectStructure(): Promise<string> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return '没有打开的工作区文件夹';
        }

        const rootPath = workspaceFolders[0].uri;
        let structure = `项目根目录: ${rootPath.fsPath}\n\n`;
        
        // 获取目录树结构
        structure += '项目文件树:\n';
        structure += await buildDirectoryTree(rootPath, '', 0, 3); // 限制深度为3层
        
        // 获取重要配置文件信息
        structure += '\n\n重要配置文件:\n';
        const configFiles = await getConfigFilesInfo(rootPath);
        structure += configFiles;
        
        return structure;
    } catch (error) {
        return `获取项目结构失败: ${error}`;
    }
}

/**
 * 构建目录树
 */
async function buildDirectoryTree(uri: vscode.Uri, prefix: string, depth: number, maxDepth: number): Promise<string> {
    if (depth > maxDepth) {
        return '';
    }
    
    let tree = '';
    try {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        // 过滤掉不重要的目录
        const filteredEntries = entries.filter(([name, type]) => {
            const ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'out', '.vscode', 'coverage'];
            const ignoreFiles = ['.DS_Store', 'Thumbs.db'];
            
            if (type === vscode.FileType.Directory && ignoreDirs.includes(name)) {
                return false;
            }
            if (type === vscode.FileType.File && ignoreFiles.includes(name)) {
                return false;
            }
            return true;
        });
        
        // 排序：目录在前，然后按名称排序
        filteredEntries.sort(([nameA, typeA], [nameB, typeB]) => {
            if (typeA === typeB) {
                return nameA.localeCompare(nameB);
            }
            return typeA === vscode.FileType.Directory ? -1 : 1;
        });
        
        for (let i = 0; i < Math.min(filteredEntries.length, 20); i++) { // 限制每层显示的条目数
            const [name, type] = filteredEntries[i];
            const isLast = i === filteredEntries.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const nextPrefix = prefix + (isLast ? '    ' : '│   ');
            
            if (type === vscode.FileType.Directory) {
                tree += `${prefix}${connector}${name}/\n`;
                const subUri = vscode.Uri.joinPath(uri, name);
                tree += await buildDirectoryTree(subUri, nextPrefix, depth + 1, maxDepth);
            } else {
                tree += `${prefix}${connector}${name}\n`;
            }
        }
        
        if (filteredEntries.length > 20) {
            tree += `${prefix}... (还有 ${filteredEntries.length - 20} 个项目)\n`;
        }
    } catch (error) {
        tree += `${prefix}错误: 无法读取目录\n`;
    }
    
    return tree;
}

/**
 * 获取重要配置文件信息
 */
async function getConfigFilesInfo(rootUri: vscode.Uri): Promise<string> {
    let info = '';
    const configFiles = [
        'package.json',
        'tsconfig.json', 
        'webpack.config.js',
        'vite.config.js',
        'rollup.config.js',
        'babel.config.js',
        '.eslintrc.json',
        '.eslintrc.js',
        'eslint.config.mjs',
        'prettier.config.js',
        'README.md',
        'CHANGELOG.md'
    ];
    
    for (const fileName of configFiles) {
        try {
            const fileUri = vscode.Uri.joinPath(rootUri, fileName);
            const stat = await vscode.workspace.fs.stat(fileUri);
            if (stat.type === vscode.FileType.File) {
                info += `- ${fileName}: 存在\n`;
                
                // 对于 package.json，获取一些关键信息
                if (fileName === 'package.json') {
                    try {
                        const content = await vscode.workspace.fs.readFile(fileUri);
                        const packageJson = JSON.parse(content.toString());
                        if (packageJson.name) info += `  名称: ${packageJson.name}\n`;
                        if (packageJson.version) info += `  版本: ${packageJson.version}\n`;
                        if (packageJson.description) info += `  描述: ${packageJson.description}\n`;
                        if (packageJson.main) info += `  入口: ${packageJson.main}\n`;
                        if (packageJson.scripts) {
                            const scripts = Object.keys(packageJson.scripts);
                            info += `  脚本: ${scripts.slice(0, 5).join(', ')}${scripts.length > 5 ? '...' : ''}\n`;
                        }
                    } catch (e) {
                        info += `  (无法解析内容)\n`;
                    }
                }
            }
        } catch (error) {
            // 文件不存在，跳过
        }
    }
    
    if (info === '') {
        info = '未找到常见配置文件\n';
    }
    
    return info;
}