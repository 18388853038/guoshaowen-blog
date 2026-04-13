# 个人社区网站

> 低成本个人社区网站 - 文档+文章 | 零成本方案

## 🎯 项目简介

使用 VuePress + GitHub Pages 搭建的个人网站，实现文档发布和文章分享功能。

## ✨ 特性

- 📝 文档中心 - 分类、搜索、标签
- 📰 文章分享 - 评论、点赞、收藏
- 💰 零成本 - 免费托管、免费图床
- 🚀 快速部署 - 一键推送，自动上线
- 📱 响应式 - 移动端自适应

## 🛠 技术栈

| 模块 | 工具 |
|------|------|
| 框架 | VuePress 2 |
| 托管 | GitHub Pages |
| 评论 | Waline |
| 图床 | GitHub 图床 |
| 域名 | GitHub 免费二级域名 |

## 📖 快速开始

```bash
# 克隆项目
git clone https://github.com/your-username/my-blog.git
cd my-blog

# 安装依赖
npm install

# 开发预览
npm run dev

# 构建发布
npm run build
```

## 📂 目录结构

```
my-blog/
├── docs/
│   ├── .vuepress/      # VuePress 配置
│   │   └── config.js   # 主题配置
│   ├── blog/           # 博客文章
│   ├── docs/           # 文档文章
│   ├── about/          # 关于页面
│   ├── images/         # 图片资源
│   └── README.md       # 首页
├── package.json
└── README.md
```

## 🚀 部署

详细部署指南请查看 [部署文档](./docs/docs/deploy.md)

1. 创建 GitHub 仓库
2. 推送代码
3. 启用 GitHub Pages
4. 访问网站

## 📄 许可证

MIT License

---

**总成本：0元 | 运维：零成本 | 上线时间：3天**
**版本：v1.0.0 | 更新：2026-04-13**