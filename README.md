# ECompany Asst 🐉

**ECompany Asst** 是一个智能化的企业 AI 助手管理平台，集成了多通道 AI 对话、任务调度、技能系统、文件管理、企业微信/钉钉/飞书等第三方集成。

> ⚠️ **从源码运行，非安装包**
>
> 本仓库包含 ECompany Asst 的**完整源代码**，而非预编译安装包。
> 如需下载 Windows 桌面安装包，请见下方下载方式。

---

## 📥 下载方式

### 方式一：百度网盘（推荐）

| 文件 | 链接 | 提取码 |
|------|------|--------|
| `ECompany Asst -Windows版本.zip` | [百度网盘下载](https://pan.baidu.com/s/1WiEv0oGxYxU7KVBER9Rtlw?pwd=mktf) | `mktf` |

> 百度网盘下载更稳定，适合国内用户。

### 方式二：GitHub Releases

安装包以 LFS 形式托管在 [GitHub Releases](https://github.com/18388853038/guoshaowen-blog/releases) 页面，下载速度受网络影响。

---

## 📋 项目结构

```
ECompany Asst/
├── backend/                  # 后端服务（Node.js）
│   ├── modules/              # 核心模块（127+ 个）
│   ├── routes/               # API 路由
│   ├── plugins/              # 通道插件（微信、钉钉、飞书等）
│   ├── skills-runner/        # 技能处理器（38+ 个）
│   ├── server-modern.js      # 主服务入口
│   ├── server-core.js        # 核心服务
│   └── package.json
├── frontend/                 # 前端（Vue 3 + Vite）
│   ├── src/                  # 源码（24 个页面组件）
│   └── dist/                 # 构建产物
├── AI团队/                   # AI 员工管理系统
│   ├── 团队名册.md
│   ├── 员工/                 # 19 个 AI 员工身份定义
│   └── 调度系统/
├── docs/                     # 文档
├── electron-main.cjs         # Electron 桌面壳
├── electron-builder.yml      # 打包配置
├── preload.js                # Electron 预加载脚本
└── package.json              # 项目根配置
```

## 🚀 快速开始

### 从源码运行

```bash
# 1. 安装后端依赖
cd backend
npm install

# 2. 配置 AI 提供商
cp backend/modules/ai-provider.example.json backend/modules/ai-provider.json
# 编辑 ai-provider.json 填入你的 API Key

# 3. 启动后端
node backend/server-modern.js

# 4. 访问前端
# 浏览器打开 http://localhost:3000
```

### 构建桌面版

```bash
# 安装根目录依赖
npm install

# 构建前端
cd frontend
npm install
npm run build

# 打包 exe 安装包
cd ..
npx electron-builder --win
```

## 🧩 功能特性

- **多通道集成**：微信、企业微信、钉钉、飞书、Telegram、Discord、Slack
- **AI 员工管理**：19 个角色化 AI 员工，可定制分配任务
- **技能系统**：浏览器自动化、桌面控制、文档处理、截图分析等 38+ 技能
- **任务调度**：智能任务分配与进度追踪
- **文件管理**：文件版本控制、权限管理
- **工作流引擎**：自愈流程、自动化规则

## 📖 更多文档

- [安装指南](docs/INSTALL_GUIDE.md)
- [功能特性](docs/FEATURES.md)
- [免责声明](docs/DISCLAIMER.md)
- [发布说明](docs/release/changelog-v2.0.0.md)

## 📦 Releases

从 [GitHub Releases](https://github.com/18388853038/guoshaowen-blog/releases) 下载：

| 版本 | 文件 | 说明 |
|------|------|------|
| v2.0.0 | `ECompany Asst Setup 2.0.0.exe` | Windows 安装包（NSIS） |

## 🪪 许可证

[MIT License](LICENSE)
