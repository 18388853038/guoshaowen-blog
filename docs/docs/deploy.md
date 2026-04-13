---
title: 部署指南
---

# 部署指南

本指南帮助你将网站部署到 GitHub Pages。

## 部署到 GitHub Pages

### 1. 创建 GitHub 仓库

1. 登录 [GitHub](https://github.com)
2. 点击右上角 **+** → **New repository**
3. 仓库名称填 `my-blog`
4. 选择 **Public**
5. 点击 **Create repository**

### 2. 本地关联远程仓库

```bash
git remote add origin https://github.com/your-username/my-blog.git
```

### 3. 推送代码

```bash
git add .
git commit -m "Initial commit"
git push -u origin main
```

### 4. 启用 GitHub Pages

1. 进入仓库 **Settings**
2. 左侧菜单找到 **Pages**
3. Source 选择 `main` 分支和 `/docs` 文件夹
4. 点击 **Save**

### 5. 等待部署

几分钟后，你的网站将上线：
`https://your-username.github.io/my-blog/`

## 使用自定义域名（可选）

1. 购买域名（如从 Freenom 免费获取）
2. 在 GitHub Pages 设置自定义域名
3. 配置 DNS 解析

## 自动化部署

使用 GitHub Actions 实现推送自动部署。"""