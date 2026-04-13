---
title: 快速开始
---

# 快速开始

## 环境要求

- Node.js 18+
- npm 或 yarn

## 安装步骤

### 1. 克隆项目

```bash
git clone https://github.com/your-username/my-blog.git
cd my-blog
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动开发服务器

```bash
npm run dev
```

### 4. 构建生产版本

```bash
npm run build
```

## 目录结构

```
my-blog/
├── docs/                 # 文档目录
│   ├── .vuepress/       # VuePress 配置
│   │   └── config.js    # 主题配置
│   ├── blog/            # 博客文章
│   ├── docs/            # 文档文章
│   └── README.md        # 首页
├── package.json
└── README.md
```

## 下一步

- [部署上线](./deploy.md)