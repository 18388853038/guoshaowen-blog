const { defineConfig } = require('@vuepress/cli')

module.exports = defineConfig({
  title: '我的个人网站',
  description: '文档与文章分享平台',
  lang: 'zh-CN',
  
  // 主题配置
  themeConfig: {
    logo: '/images/logo.png',
    nav: [
      { text: '首页', link: '/' },
      { text: '文章', link: '/blog/' },
      { text: '文档', link: '/docs/' },
      { text: '关于', link: '/about/' }
    ],
    
    // 博客配置
    blog: {
      title: '文章列表',
      description: '技术文章与分享',
      items: [
        '/blog/article1.md',
        '/blog/article2.md'
      ]
    },
    
    // 侧边栏
    sidebar: {
      '/docs/': [
        {
          title: '快速开始',
          collapsable: false,
          children: ['/README.md', 'install.md', 'deploy.md']
        }
      ],
      '/blog/': [
        {
          title: '文章分类',
          collapsable: false,
          children: ['README.md', 'article1.md', 'article2.md']
        }
      ]
    },
    
    // 社交链接
    socialLinks: [
      { icon: 'github', link: 'https://github.com/your-username' }
    ]
  },
  
  // Markdown配置
  markdown: {
    lineNumbers: true
  },
  
  // 插件
  plugins: [
    '@vuepress/plugin-search',
    '@vuepress/plugin-nprogress'
  ]
})