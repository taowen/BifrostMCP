import { useCopilotChat } from '../copilotChat';
import { DebugLogger } from './logger';
import { IntentAnalysis } from './types';

/**
 * 分析用户意图并提取关键实体
 */
export async function analyzeIntentAndExtractEntities(prompt: string): Promise<IntentAnalysis> {
    const analysisPrompt = `
你是一个代码搜索专家。分析用户的查询意图，提取关键信息，并制定搜索策略。

用户查询: "${prompt}"

请分析用户想要了解什么，并以JSON格式返回：

1. intent: 用户的主要意图
   - "find_entry" - 查找项目入口点、启动方式
   - "find_structure" - 了解项目结构、架构
   - "find_entity" - 查找特定的函数、类、变量等
   - "understand_flow" - 理解执行流程、调用关系
   - "find_usage" - 查找某个实体的使用方式
   - "debug_issue" - 调试问题、查找错误原因
   - "other" - 其他

2. entities: 从查询中提取的关键实体，每个包含:
   - name: 实体名称（如果是概念性的如"入口点"，使用相关关键词）
   - type: "function" | "class" | "variable" | "file" | "module" | "interface" | "type" | "concept"
   - confidence: 置信度(0-1)

3. searchStrategy: 推荐的搜索策略数组，按优先级排序:
   - "workspace_symbols" - 使用工作区符号搜索
   - "text_search" - 文本内容搜索
   - "file_structure" - 文件结构分析
   - "config_files" - 配置文件分析
   - "documentation" - 文档和注释搜索

4. keyTerms: 提取的关键搜索词数组，用于文本搜索

示例:
{
  "intent": "find_entry",
  "entities": [
    {"name": "入口点", "type": "concept", "confidence": 0.9},
    {"name": "main", "type": "function", "confidence": 0.7}
  ],
  "searchStrategy": ["config_files", "file_structure", "workspace_symbols", "text_search"],
  "keyTerms": ["main", "index", "entry", "activate", "启动", "入口"]
}

只返回JSON，不要其他解释：
`;

    DebugLogger.logGPTCall(analysisPrompt, '');
    const response = await useCopilotChat(analysisPrompt);
    DebugLogger.logGPTCall(analysisPrompt, response);
    
    const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanResponse);
}

/**
 * 直接使用聊天响应（当无法提取有用信息时）
 */
export async function directChatResponse(prompt: string): Promise<string> {
    return await useCopilotChat(prompt);
}