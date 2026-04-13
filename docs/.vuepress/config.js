import { defineUserConfig } from '@vuepress/cli'
import { defaultTheme } from '@vuepress/theme-default'
import viteBundler from '@vuepress/bundler-vite'

export default defineUserConfig({}) {
  // keyfix: build output to docs directory, not default .vuepress/dist
  dest: 'docs',
  bundler: viteBundler(),
  lang: 'z-CN',
  title: 'My Personal Website',
  description: 'Documentation + Article Sharing Platform | Zero Cost | Comments',
  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['script', { 
      src: 'https://cdn.jsdelivr.net/npm/@waline/client@4/dist/Waline.min.js' 
    }]
  ],

  theme: defaultTheme({
    navbar: [
      { text: 'Home', link: '/' },
      { text: 'Articles', link: '/blog/' },
      ["documents", "/docs/"],
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
        Email: 'mailto:your-email@xmple.com'
      }
    }
  })
})