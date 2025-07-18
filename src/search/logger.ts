import * as vscode from 'vscode';

/**
 * 调试日志管理器
 */
export class DebugLogger {
    private static outputChannel: vscode.OutputChannel | null = null;
    
    static init() {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('Smart Search Debug');
        }
    }
    
    static log(message: string, data?: any) {
        this.init();
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage, data || '');
        this.outputChannel?.appendLine(logMessage);
        if (data) {
            this.outputChannel?.appendLine(JSON.stringify(data, null, 2));
        }
    }
    
    static logGPTCall(prompt: string, response: string) {
        this.init();
        this.outputChannel?.appendLine('=== GPT 调用 ===');
        this.outputChannel?.appendLine('Prompt:');
        this.outputChannel?.appendLine(prompt);
        this.outputChannel?.appendLine('\nResponse:');
        this.outputChannel?.appendLine(response);
        this.outputChannel?.appendLine('================');
    }
    
    static show() {
        this.init();
        this.outputChannel?.show(true);
    }
}