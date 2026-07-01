# ECompany Asst

> 基于 AI 的企业级智能助理系统 · 开源版

## 功能特性

### AI 智能对话
- 多模型 AI 引擎（DeepSeek / 通义千问 / GPT / 文心一言 等）
- 上下文记忆管理
- 角色技能系统
- 自动学习与自我进化

### 多通道通信
- **微信** / **钉钉** / **飞书** / **QQ** / **企业微信**

### 任务调度与自动化
- 智能任务分配与执行
- DAG 工作流引擎
- 定时任务与自动化流程
- 错误自动捕获与重试

### 文件与权限管理
- 版本控制与文件追溯
- 精细读写权限体系
- 安全审计

### 团队管理
- 成员管理、绩效追踪、行为审计、知识库

### 扩展能力
- MCP 工具集成、插件系统、技能市场、OpenAPI/Webhook

## 技术架构

```
F:/
├── backend/          # 后端系统
│   ├── modules/      # 103+ 功能模块
│   └── server-modern.js   # 服务端入口
├── frontend/         # 前端应用
│   ├── src/          # Vue 3 源码（24 页面组件）
│   └── dist/         # 构建产物
├── app/              # Electron 桌面端
└── AI团队/            # AI 角色定义
```

## 快速开始

### 环境要求
- Node.js >= 18

### 安装
```bash
git clone https://github.com/18388853038/guoshaowen-blog.git
cd guoshaowen-blog

# 后端
cd backend && npm install && cd ..

# 前端
cd frontend && npm install && cd ..
```

### 配置
1. 配置 `backend/ai-provider.json` 中的 AI API Key
2. 启动后端: `cd backend && node server-modern.js`
3. 启动前端（开发）: `cd frontend && npm run dev`
4. 访问 `http://localhost:5173`

## 开源协议
MIT License
