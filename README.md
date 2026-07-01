# ECompany Asst — 企业级 AI 助手桌面客户端

> 智能 · 高效 · 一体化  
> 基于 OpenClaw AI 引擎，通过自然语言操控桌面、管理文件、执行任务

---

## 下载安装

**[⬇ 下载最新安装包](https://github.com/18388853038/guoshaowen-blog/releases/latest)**

| 版本 | 文件 | 大小 | 系统 |
|------|------|------|------|
| v2.0.0 | `ECompany.Asst.Setup.2.0.0.exe` | 160.6 MB | Windows 10/11 x64 |

## 快速上手

```bash
# 1. 下载安装包
# 2. 双击运行，一路 Next
# 3. 启动后，在对话窗口与 AI CEO 对话
```

### 试试这些指令

```
"帮我看看桌面上有什么"
"打开我的电脑"
"截个屏"
"在桌面新建一个文件夹，命名为'项目资料'"
"帮我搜索一下昨天跟张三讨论的方案"
```

详细说明请查看：
- 📖 [安装指南](docs/release/install-guide.md)
- 🚀 [快速上手指南](docs/release/quickstart-guide.md)
- 📋 [版本发布说明](docs/release/changelog-v2.0.0.md)

## 功能特性

| | 功能 | 说明 |
|---|------|------|
| 🤖 | **AI CEO 对话** | 自然语言交互，理解意图并执行多步骤操作 |
| 🖱️ | **桌面操控** | 鼠标移动/点击、键盘输入、窗口管理、屏幕截图 |
| 📁 | **文件管理** | 文件读写、目录遍历、JSON/CSV 解析 |
| 🧩 | **工具扩展** | 支持动态安装/卸载自定义工具 |
| 👥 | **分身协作** | Sub-Agent 并行执行复杂任务 |
| 🧠 | **持久记忆** | 记忆引擎存储与语义检索 |
| 🛡️ | **审批机制** | 敏感操作需用户授权确认 |

## 技术架构

```
Electron 42 → Vue 3 + Vite（前端）
           → Node.js + Express（后端）
           → OpenClaw AI Engine
           → 230+ 内置工具 | MCP 协议
```

## 系统要求

- **操作系统**: Windows 10 / 11（64位）
- **内存**: 4 GB 以上（推荐 8 GB）
- **磁盘**: 500 MB 可用空间
- **运行时**: 无需预装（内置 Node.js）

## 项目结构

```
ECompany Asst/
├── frontend/          # Vue 3 前端应用
│   └── dist/          # 构建产物
├── backend/           # Node.js 后端服务
│   ├── modules/       # 核心模块（引擎、工具、路由）
│   └── docs/          # 项目文档
├── electron-main.cjs  # Electron 主进程
├── preload.js         # 预加载脚本
└── electron-builder.yml # 打包配置
```

## 版本历史

| 版本 | 日期 | 亮点 |
|------|------|------|
| v2.0.0 | 2026-07-01 | 首次正式发布 |

## 开发构建

```bash
# 克隆并安装依赖
git clone https://github.com/18388853038/guoshaowen-blog.git
cd guoshaowen-blog

# 前端构建
cd frontend && npm install && npm run build

# 启动开发模式
cd ../backend && npm install && node server-modern.js

# 打包桌面安装包
npm run build:win    # 需在 Windows 下执行
```

## 许可证

MIT License © 2026 ECompany
