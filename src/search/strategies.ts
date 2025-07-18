import * as vscode from 'vscode';
import { SearchResultItem, IntentAnalysis, ExtractedEntity, EntityType } from './types';
import { getSymbolContent, getFileContent, searchInWorkspace } from './utils';

/**
 * 根据实体搜索相关信息
 */
export async function searchForEntity(entity: ExtractedEntity): Promise<SearchResultItem[]> {
    const results: SearchResultItem[] = [];
    
    switch (entity.type) {
        case EntityType.FUNCTION:
        case EntityType.CLASS:
        case EntityType.INTERFACE:
        case EntityType.TYPE:
            // 使用 workspace symbols 搜索
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider', 
                entity.name
            );
            
            if (symbols) {
                for (const symbol of symbols) {
                    if (symbol.name.toLowerCase().includes(entity.name.toLowerCase())) {
                        const content = await getSymbolContent(symbol);
                        results.push({
                            uri: symbol.location.uri,
                            content,
                            symbolInfo: symbol,
                            relevanceScore: 0, // 将在后续打分
                            description: `${symbol.kind} ${symbol.name} in ${symbol.containerName || 'global'}`
                        });
                    }
                }
            }
            break;
            
        case EntityType.FILE:
        case EntityType.MODULE:
            // 搜索文件
            const files = await vscode.workspace.findFiles(`**/*${entity.name}*`);
            for (const file of files.slice(0, 10)) { // 限制结果数量
                const content = await getFileContent(file);
                results.push({
                    uri: file,
                    content,
                    relevanceScore: 0,
                    description: `File: ${file.fsPath}`
                });
            }
            break;
            
        case EntityType.VARIABLE:
        case EntityType.NAMESPACE:
            // 使用文本搜索
            const textResults = await searchInWorkspace(entity.name);
            results.push(...textResults);
            break;
    }
    
    return results;
}

/**
 * 执行特定的搜索策略
 */
export async function executeSearchStrategy(strategy: string, intentAnalysis: IntentAnalysis): Promise<SearchResultItem[]> {
    const workspaceRoot = vscode.workspace.workspaceFolders![0];
    const results: SearchResultItem[] = [];
    
    switch (strategy) {
        case 'config_files':
            // 搜索配置文件
            const configFiles = ['package.json', 'tsconfig.json', 'webpack.config.js', 'vite.config.js', 
                               'rollup.config.js', '.eslintrc.json', 'jest.config.js', 'Cargo.toml', 
                               'pom.xml', 'build.gradle', 'Makefile', 'Dockerfile'];
            
            for (const configFile of configFiles) {
                try {
                    const fileUri = vscode.Uri.joinPath(workspaceRoot.uri, configFile);
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const content = document.getText();
                    
                    results.push({
                        uri: fileUri,
                        content: content.length > 1500 ? content.substring(0, 1500) + '...' : content,
                        relevanceScore: 0.8,
                        description: `Configuration file: ${configFile}`
                    });
                } catch (error) {
                    // 文件不存在，继续
                }
            }
            break;
            
        case 'file_structure':
            // 分析文件结构
            const commonEntryPaths = [
                'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'src/app.ts', 'src/app.js',
                'index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js',
                'src/extension.ts', 'extension.ts', 'server.ts', 'server.js',
                'lib/index.js', 'dist/index.js'
            ];
            
            for (const entryPath of commonEntryPaths) {
                try {
                    const fileUri = vscode.Uri.joinPath(workspaceRoot.uri, entryPath);
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const content = document.getText();
                    
                    results.push({
                        uri: fileUri,
                        content: content.length > 1000 ? content.substring(0, 1000) + '...' : content,
                        relevanceScore: 0.9,
                        description: `Entry file: ${entryPath}`
                    });
                } catch (error) {
                    // 文件不存在，继续
                }
            }
            break;
            
        case 'workspace_symbols':
            // 使用关键词搜索工作区符号
            for (const term of intentAnalysis.keyTerms.slice(0, 5)) { // 限制搜索词数量
                const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                    'vscode.executeWorkspaceSymbolProvider', 
                    term
                );
                
                if (symbols) {
                    for (const symbol of symbols.slice(0, 10)) { // 限制每个词的结果数量
                        const content = await getSymbolContent(symbol);
                        results.push({
                            uri: symbol.location.uri,
                            content,
                            symbolInfo: symbol,
                            relevanceScore: 0.7,
                            description: `Symbol: ${symbol.name} (${symbol.kind})`
                        });
                    }
                }
            }
            break;
            
        case 'text_search':
            // 文本内容搜索
            for (const term of intentAnalysis.keyTerms.slice(0, 3)) {
                const textResults = await searchInWorkspace(term);
                results.push(...textResults.slice(0, 8)); // 限制每个词的结果数量
            }
            break;
            
        case 'documentation':
            // 搜索文档和注释
            const docFiles = ['README.md', 'README.txt', 'CHANGELOG.md', 'docs/', 'doc/'];
            
            for (const docPath of docFiles) {
                try {
                    let fileUri: vscode.Uri;
                    if (docPath.endsWith('/')) {
                        // 搜索目录下的文件
                        const files = await vscode.workspace.findFiles(`${docPath}**/*.md`);
                        for (const file of files.slice(0, 5)) {
                            const document = await vscode.workspace.openTextDocument(file);
                            const content = document.getText();
                            results.push({
                                uri: file,
                                content: content.length > 1000 ? content.substring(0, 1000) + '...' : content,
                                relevanceScore: 0.6,
                                description: `Documentation: ${file.fsPath}`
                            });
                        }
                    } else {
                        fileUri = vscode.Uri.joinPath(workspaceRoot.uri, docPath);
                        const document = await vscode.workspace.openTextDocument(fileUri);
                        const content = document.getText();
                        
                        results.push({
                            uri: fileUri,
                            content: content.length > 1000 ? content.substring(0, 1000) + '...' : content,
                            relevanceScore: 0.6,
                            description: `Documentation: ${docPath}`
                        });
                    }
                } catch (error) {
                    // 文件不存在，继续
                }
            }
            break;
    }
    
    return results;
}