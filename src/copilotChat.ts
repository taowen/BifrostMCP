import * as vscode from 'vscode';

// 使用 VS Code 的 Language Model API
export async function useCopilotChat(message: string = 'Hello world'): Promise<string> {
    // 获取可用的语言模型
    const models = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: 'gpt-4'
    });

    if (models.length === 0) {
        throw new Error('No Copilot models available');
    }

    const model = models[0];
    
    // 发送请求
    const request = await model.sendRequest([
        vscode.LanguageModelChatMessage.User(message)
    ], {}, new vscode.CancellationTokenSource().token);

    // 处理响应
    let response = '';
    for await (const chunk of request.text) {
        response += chunk;
    }
    
    return response;
}
