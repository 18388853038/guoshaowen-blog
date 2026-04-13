import { defineUserConfig } from '@vuepress/cli'
import { defaultTheme } from '@vuepress/theme-default'
import viteBundler from '@vuepress/bundler-vite'

export default defineUserConfig({}) {
  // 前台: GitHub Pages方使用文件在等并开始base
  base: '/guoshaowen-blog/',
  bundler: viteBundler(),
  lang: 'zh-CN',
  title: 'My Personal Website',
  description: 'Documentation + Article Sharing Platform | Zero Cost | Comments',
  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['script', { 
      src: 'https://cdn.jsdelivr.net/npm/@waline/client@2/dist/Waline.min.js' 
    }]
  ],

  theme: defaultTheme({
    navbar: [
      { text: 'Home', link: '/' },
      { text: 'Articles', link: '/blog/' },
      { text: 'Documents', link: '/docs/' },
      { text: 'About', link: '/about/' }
    ],
    sidebar: {
      '/docs/': [
        {
          title: 'Quick Start',
          collapsable: false,
          children: ['README.md', 'install.md', 'deploy.md']
        }
      ],
      '/blog/': [
        {
          title: 'New Articles',
          collapsable: false,
          children: [
            ['/blog/README.md', 'Article List'],
            ['/blog/category/tech.md', 'Tech Share'],
            ['/blog/category/share.md', 'Life Share']
          ]
        }
      ]
    },
    
    // Blog functionality
    blog: {
      title: 'My Blog',
      description: 'Share Learning and Life',
      medias: {
        GitHub: 'https://github.com/your-username',
        Email: 'mailto:0your-email@xmple.com'
      }
    }
  })
})