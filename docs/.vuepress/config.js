import { defineUserConfig } from '@vuepress/cli'
import { defaultTheme } from '@vuepress/theme-default'
import viteBundler from '@vuepress/bundler-vite'

export default defineUserConfig({
  bundler: viteBundler(),
  lang: 'zh-CN',
  title: '我的个人网站',
  description: '文档与文章分享平台 | 零成本 | 极简运维',
  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['script', { 
      src: 'https://cdn.jsdelivr.net/npm/@waline/client@2/dist/Waline.min.js' 
    }]
  ],

  theme: defaultTheme({
    navbar: [
      { text: '首页', link: '/' },
      { text: '文章', link: '/blog/' },
      { text: '文档', link: '/docs/' },
      { text: '关于', link: '/about/' }
    ],
    sidebar: {
      '/docs/': [
        {
          title: '快速开始',
          collapsable: false,
          children: ['README.md', 'install.md', 'deploy.md']
        }
      ],
      '/blog/': [
        {
          title: '文章分类',
          collapsable: false,
          children: [
            ['/blog/README.md', '文章列表'],
            ['/blog/category/tech.md', '技术文章'],
            ['/blog/category/share.md', '经验分享']
          ]
        }
      ]
    },
    
    // 博客配置
    blog: {
      title: '我的博客',
      description: '技术文章与分享',
      medias: {
        GitHub: 'https://github.com/your-username',
        Email: 'mailto:your-email@example.com'
      }
    }
  })
})