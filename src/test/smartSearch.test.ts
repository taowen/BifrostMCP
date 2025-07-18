import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { smartSearch } from '../search';

suite('Smart Search Test Suite', () => {
    vscode.window.showInformationMessage('Starting Smart Search tests.');

    // 在测试开始前设置工作区
    suiteSetup(async () => {
        console.log('Setting up workspace for Smart Search tests...');
        
        // 检查是否有工作区文件夹
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            console.log('Warning: No workspace folders available for testing');
            console.log('Attempting to open the project workspace...');
            
            // 尝试打开项目根目录作为工作区
            const projectRoot = path.resolve(__dirname, '../../');
            const workspaceUri = vscode.Uri.file(projectRoot);
            
            try {
                await vscode.commands.executeCommand('vscode.openFolder', workspaceUri, false);
                console.log('Workspace opened successfully');
                
                // 等待工作区文件夹被设置
                await new Promise(resolve => {
                    const disposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
                        disposable.dispose();
                        resolve(void 0);
                    });
                    
                    // 超时保护
                    setTimeout(() => {
                        disposable.dispose();
                        resolve(void 0);
                    }, 2000);
                });
            } catch (error) {
                console.warn('Could not open workspace folder:', error);
            }
        }
        
        // 输出当前工作区状态
        if (vscode.workspace.workspaceFolders) {
            console.log('Workspace folders:', vscode.workspace.workspaceFolders.map(f => f.uri.fsPath));
        } else {
            console.log('No workspace folders found after setup');
        }
    });


    test('Smart Search - Handle model unavailable with retry', async () => {
        try {
            // 测试处理模型不可用的情况
            const result = await smartSearchWithRetry('找到 extension.ts 文件的主要功能');
            
            assert.ok(result.length > 0, 'Should return result even when model is unavailable');
            console.log('✅ Model unavailable handling test passed');
            console.log('Result preview:', result.substring(0, 200) + '...');
            
        } catch (error) {
            console.error('❌ Model unavailable test failed:', error);
            assert.fail(`Should handle model unavailable gracefully: ${error}`);
        }
    }).timeout(95000);
});

/**
 * 带重试机制的智能搜索，处理模型不可用的情况
 */
async function smartSearchWithRetry(prompt: string, maxRetries: number = 9): Promise<string> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const result = await smartSearch(prompt);
            
            // 如果结果包含模型不可用的错误信息，等待后重试
            if (result.includes('No Copilot models available') || 
                result.includes('Failed to use Copilot chat') ||
                result.includes('model 不可用')) {
                
                console.log(`Attempt ${i + 1}: Model unavailable, retrying in ${(i + 1) * 2} seconds...`);
                await new Promise(resolve => setTimeout(resolve, (i + 1) * 10000));
                continue;
            }
            
            return result;
        } catch (error) {
            console.log(`Attempt ${i + 1} failed:`, error);
            if (i === maxRetries - 1) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, (i + 1) * 2000));
        }
    }
    
    throw new Error('Max retries exceeded');
}
