---
title: VuePress 2.x 完全指南
date: 2026-04-13
tags: [VuePress, 前端, 教程]
categories: 技术
---

# VuePress 2.x 完全指南

VuePress 是一个基于 Vue 的静态网站生成器，特别适合用来写文档。

## 为什么选择 VuePress

1. **基于 Vue** - 如果你熟悉 Vue，上手很快
2. **Markdown 优先** - 用 Markdown 写内容，同时可以使用 Vue 组件
3. **主题丰富** - 有默认主题，也可以自定义
4. **插件系统** - 强大的插件系统，可以扩展功能

## 安装步骤

```bash
# 创建项目
npm init -y

# 安装依赖
npm install -D vuepress@next @vuepress/bundler-vite@next

# 创建文档目录
mkdir docs

# 开始写文档
```

## 基础配置

在 `.vuepress/config.js` 中配置：

```javascript
export default {
  title: '我的网站',
  description: '网站描述',
  theme: defaultTheme({
    navbar: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about/' }
    ])
  }
}
```

## 部署到 GitHub Pages

1. 在 GitHub 创建仓库
2. 推送代码
3. 启用 GitHub Pages

## 总结

VuePress 是编写文档的好工具，推荐使用！