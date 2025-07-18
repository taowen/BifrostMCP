// 简单测试脚本来验证项目结构获取功能
const vscode = require('vscode');

// 模拟获取项目结构的函数
async function testProjectStructure() {
    console.log('Testing project structure function...');
    
    // 这里只是一个测试示例，实际的 getProjectStructure 函数
    // 需要在 VS Code 环境中运行
    const mockStructure = `
项目根目录: c:\\games\\BifrostMCP

项目文件树:
├── src/
│   ├── extension.ts
│   ├── tools.ts
│   ├── search/
│   │   ├── index.ts
│   │   ├── intent.ts
│   │   ├── utils.ts
│   │   └── types.ts
│   └── ...
├── package.json
├── tsconfig.json
└── webpack.config.js

重要配置文件:
- package.json: 存在
  名称: bifrost-mcp
  版本: 0.0.14
  描述: VSCode extension that provides MCP server
  入口: ./dist/extension.js
  脚本: compile, package, lint, test...
- tsconfig.json: 存在
- webpack.config.js: 存在
`;
    
    console.log('Mock project structure:');
    console.log(mockStructure);
    
    return mockStructure;
}

if (require.main === module) {
    testProjectStructure();
}

module.exports = { testProjectStructure };
