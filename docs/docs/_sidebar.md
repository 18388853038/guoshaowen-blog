---
title: 快速开始
---

# 快速开始

## 环境要求

- Node.js 18+ 
- npm 或 yarn
- Git

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

访问 http://localhost:8080 查看网站。

### 4. 构建生产版本

```bash
npm run build
```

## 目录结构

```
my-blog/
├── docs/                     # 文档目录
│   ├── .vuepress/          # VuePress 配置
│   │   └── config.js       # 主题配置
│   ├── blog/               # 博客文章
│   │   ├── category/       # 文章分类
│   │   └── *.md            # 博客文章
│   ├── docs/               # 文档文章
│   │   └── *.md            # 文档页面
│   ├── about/              # 关于页面
│   └── README.md           # 首页
├── .github/                 # GitHub 配置
│   └── workflows/          # CI/CD 流程
│       └── deploy.yml      # 部署配置
├── package.json
└── README.md
```

## 写作指南

### 添加新文章

在 `docs/blog/` 目录下创建新的 Markdown 文件：

```markdown
---
title: 文章标题
date: 2026-04-13
tags: [标签1, 标签2]
categories: 技术
---

# 文章标题

正文内容...
```

### 添加新文档

在 `docs/docs/` 目录下创建新的 Markdown 文件。

### 自定义导航

在 `.vuepress/config.js` 中修改 `navbar` 配置。

### 自定义侧边栏

在 `.vuepress/config.js` 中修改 `sidebar` 配置。

## 下一步

- [部署上线](./deploy.md) - 将网站部署到互联网
- [常见问题](./faq.md) - 常见问题解答