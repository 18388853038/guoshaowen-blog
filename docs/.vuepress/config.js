import { defineUserConfig } from '@vuepress/cli'
import { defaultTheme } from '@vuepress/theme-default'
import viteBundler from '@vuepress/bundler-vite'

export default defineUserConfig({
  bundler: viteBundler(),
  lang: 'zh-CN',
  title: '我的个人网站',
  description: '文档与文章分享平台',
  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }]
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
          title: '文章',
          collapsable: false,
          children: ['README.md', 'article1.md', 'article2.md']
        }
      ]
    }
  })
})