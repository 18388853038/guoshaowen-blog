const builder = require('electron-builder');
const path = require('path');

async function build() {
  console.log('[BUILD] 开始打包 eCompany Dev v3.6.0...');
  console.time('build');
  
  try {
    const result = await builder.build({
      projectDir: __dirname,
      config: {
        appId: 'com.ecompany.desktop.dev',
        productName: 'eCompany Dev',
        directories: {
          output: path.resolve(__dirname, '..', 'dist-desktop-dev')
        },
        files: [
          'main.js',
          'preload.js',
          'detect-lang.js',
          'package.json'
        ],
        extraResources: [
          { from: '../backend', to: 'backend', filter: ['**/*', '!**/node_modules/**/*.md', '!**/node_modules/**/test/**', '!**/node_modules/**/tests/**', '!**/node_modules/**/docs/**'] },
          { from: '../frontend/dist', to: 'frontend/dist' },
          { from: '../node.exe', to: 'node.exe' },
          { from: '../.browsers', to: '.browsers', filter: ['**/*', '!**/locales/**', '**/locales/zh-CN*', '**/locales/en-US*', '**/locales/ja*', '**/locales/ko*'] },
          { from: '../browser-auto-embedded.cjs', to: 'browser-auto-embedded.cjs' },
          { from: '../desktop-control.py', to: 'desktop-control.py' },
          { from: '../desktop-control.cjs', to: 'desktop-control.cjs' },
          { from: '../desktop-control-env', to: 'desktop-control-env', filter: ['**/*', '!**/__pycache__/**', '!**/*.pyc'] },
          { from: '../AI团队', to: 'AI团队' },
          { from: '../memory', to: 'memory' },
          { from: '../arch-plan.md', to: 'arch-plan.md' },
          { from: '../post-build.js', to: 'post-build.js' },
          { from: '../启动(静默).bat', to: '启动(静默).bat' }
        ],
        win: {
          target: ['dir'],
          icon: '../frontend/dist/logo.jpg'
        }
      }
    });
    
    console.log('[BUILD] ✅ 打包成功！');
    console.log('[BUILD] 输出:', JSON.stringify(result));
    console.timeEnd('build');
  } catch (err) {
    console.error('[BUILD] ❌ 打包失败:', err.message);
    process.exit(1);
  }
}

build();
