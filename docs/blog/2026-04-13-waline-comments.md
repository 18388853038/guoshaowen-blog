---
title: 为网站添加 Waline 评论系统
date: 2026-04-13
tags: [Waline, 评论系统, 教程]
categories: 技术
---

# 为网站添加 Waline 评论系统

Waline 是一个简洁、安全的评论系统，支持匿名评论，不需要登录。

## 为什么选择 Waline

1. **轻量** - 只需引入一个 JS 文件
2. **安全** - 支持评论审核
3. **免费** - 可以使用 LeanCloud 免费版
4. **易于部署** - 支持 Vercel 一键部署

## 注册 LeanCloud

1. 访问 [LeanCloud](https://leancloud.cn)
2. 创建应用（国际版）
3. 获取 AppID 和 AppKey

## Vercel 部署 Waline 服务

1. Fork [Waline 仓库](https://github.com/walinejs/waline)
2. 在 Vercel 中导入
3. 设置环境变量：
   - `LEAN_ID`: 你的 AppID
   - `LEAN_KEY`: 你的 AppKey
4. 部署

## 在 VuePress 中集成

在 `.vuepress/config.js` 中添加：

```javascript
export default {
  head: [
    ['script', { 
      src: 'https://cdn.jsdelivr.net/npm/@waline/client@2/dist/Waline.min.js' 
    }]
  ]
}
```

## 评论功能

评论系统现在已经可以使用了！读者可以在文章底部发表评论。

## 总结

Waline 是一个简单易用的评论系统，推荐个人网站使用！