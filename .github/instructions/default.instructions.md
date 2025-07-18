---
applyTo: '**'
---

# BifrostMCP 项目开发指南

## 项目概述
BifrostMCP 是一个 VSCode 扩展，提供 Model Context Protocol (MCP) 服务器，将 VSCode 的开发工具和语言功能暴露给支持 MCP 协议的 AI 工具。

### 技术栈
- **语言**: TypeScript
- **框架**: VSCode Extension API, Express.js, MCP SDK
- **构建工具**: Webpack
- **测试**: Mocha (通过 vscode-test)
- **代码检查**: ESLint

## 目录结构
```
src/                      # TypeScript 源代码
├── extension.ts          # 扩展入口点
├── tools.ts             # MCP 工具定义 (875行核心工具集)
├── toolRunner.ts        # 工具执行逻辑 
├── config.ts            # 配置文件处理
├── debugPanel.ts        # 调试面板
├── globals.ts           # 全局变量
├── helpers.ts           # 工具函数
├── mcpresponses.ts      # MCP 响应处理
├── rosyln.ts           # Roslyn 集成
├── webview.ts          # 网页视图
└── test/               # 测试文件
    └── extension.test.ts
dist/                    # Webpack 打包输出
webpack.config.js        # Webpack 配置
tsconfig.json           # TypeScript 配置
package.json            # npm 配置和脚本
```

## 开发环境配置

### 初始化项目
```powershell
# 安装依赖
npm install

# 编译项目
npm run compile
```

### 可用的 npm 脚本
- `npm run compile` - 编译 TypeScript 代码
- `npm run package` - 生产环境打包
- `npm run compile-tests` - 编译测试文件
- `npm run lint` - 代码风格检查
- `npm run test` - 运行测试套件（包含预编译、构建、代码检查）

## 开发工作流

### 2. 测试
```powershell
# 运行完整测试套件（包含编译、代码检查）
npm test

# 仅运行代码检查
npm run lint

# 修复 ESLint 警告
npm run lint -- --fix
```

### 3. 打包发布
```powershell
# 生产环境打包
npm run package

# 生成的文件在 dist/extension.js
```

## 核心功能模块

### 1. MCP 工具集 (tools.ts)
- **代码导航**: find_usages, go_to_definition, find_implementations
- **符号搜索**: get_workspace_symbols, get_document_symbols  
- **类型分析**: get_type_definition, get_type_hierarchy
- **代码操作**: get_code_actions, rename, get_completions
- **调用层级**: get_call_hierarchy
- **语义信息**: get_hover_info, get_semantic_tokens

### 2. 配置系统 (config.ts)
- 支持 `bifrost.config.json` 配置文件
- 默认配置：端口 8008，项目名 "language-tools"
- 示例配置文件：`example.bifrost.config.json`

### 3. 扩展命令
- `bifrost-mcp.startServer` - 启动 MCP 服务器
- `bifrost-mcp.startServerOnPort` - 在指定端口启动服务器
- `bifrost-mcp.stopServer` - 停止服务器
- `bifrost-mcp.openDebugPanel` - 打开调试面板

## 代码规范

### 当前代码问题
项目存在一些 ESLint 警告需要修复：
- `debugPanel.ts:24` - if 语句需要花括号
- `globals.ts:9,13` - 缺少分号
- `toolRunner.ts:627` - 缺少分号

### 编码建议
1. 遵循 TypeScript 严格模式设置
2. 使用 ESLint 检查代码风格
3. 所有异步操作使用 async/await
4. 错误处理要完整
5. 添加适当的 JSDoc 注释

## 调试指南

### 1. 扩展调试
- 在 VS Code 中打开项目
- 按 F5 启动扩展开发实例
- 在新窗口中测试扩展功能

### 2. MCP 服务器调试
- 使用 `bifrost-mcp.openDebugPanel` 命令打开调试面板
- 检查服务器日志和请求/响应

### 3. 常见问题
- 编译错误：检查 TypeScript 配置和依赖版本
- 扩展不加载：确保 `dist/extension.js` 存在且正确编译
- MCP 连接问题：检查端口冲突和防火墙设置

## 项目依赖

### 主要依赖
- `@modelcontextprotocol/sdk` - MCP 协议实现
- `express` - HTTP 服务器
- `cors` - 跨域支持

### 开发依赖
- `typescript` - TypeScript 编译器
- `webpack` - 打包工具
- `@vscode/test-cli` - VS Code 测试框架
- `eslint` - 代码检查

## 发布流程
1. 更新 `package.json` 中的版本号
2. 运行 `npm run package` 生成生产版本
3. 测试扩展功能
4. 提交代码并打 tag
5. 发布到 VS Code Marketplace