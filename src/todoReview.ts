import * as vscode from 'vscode';

/**
 * 处理待办事项列表审查
 */
export async function handleTodoListReview(args: any) {
    const message = args.optionalShortDesign || 'Please review the todo list';
    const todoItems = args.todoItems || [];
    
    // 创建待办事项的快速选择项
    const todoQuickPickItems = todoItems.map((item: any, index: number) => ({
        label: item.description,
        picked: item.completed
    }));
    
    // 显示待办事项列表并等待用户操作
    return await showTodoReviewDialog(todoQuickPickItems, message);
}

/**
 * 显示待办事项审查对话框
 */
async function showTodoReviewDialog(items: any[], title: string): Promise<any> {
    return new Promise((resolve) => {
        const quickPick = createQuickPickForTodoReview(items, title);
        
        // 处理按钮点击事件
        quickPick.onDidTriggerButton(async (button) => {
            quickPick.hide();
            
            if (button.tooltip === '同意') {
                resolve({
                    approvalComment: '同意',
                    action: 'approve'
                });
            } else if (button.tooltip === '放弃执行') {
                resolve({
                    approvalComment: '放弃执行',
                    action: 'abandon'
                });
            } else if (button.tooltip === '再改改') {
                // 显示输入框让用户输入修改意见
                const modificationComment = await vscode.window.showInputBox({
                    prompt: '请输入您的修改意见:',
                    placeHolder: '请描述需要修改的内容...',
                    ignoreFocusOut: true,
                    value: ''
                });
                
                resolve({
                    approvalComment: modificationComment || '需要修改'
                });
            }
        });
        
        // 处理直接按回车（接受）
        quickPick.onDidAccept(() => {
            quickPick.hide();
            resolve({
                approvalComment: '同意',
                action: 'approve'
            });
        });
        quickPick.show();
    });
}

/**
 * 创建带有操作按钮的快速选择器
 */
function createQuickPickForTodoReview(items: any[], title: string) {
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = title;
    quickPick.placeholder = 'Review the todo items - 使用按钮选择操作';
    quickPick.items = items;
    quickPick.canSelectMany = true;
    quickPick.ignoreFocusOut = true;
    
    // 添加操作按钮
    const buttons: vscode.QuickInputButton[] = [
        {
            iconPath: new vscode.ThemeIcon('check'),
            tooltip: '同意'
        },
        {
            iconPath: new vscode.ThemeIcon('close'),
            tooltip: '放弃执行'
        },
        {
            iconPath: new vscode.ThemeIcon('edit'),
            tooltip: '再改改'
        }
    ];
    
    quickPick.buttons = buttons;
    
    return quickPick;
}
