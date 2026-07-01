// 高效推送 - 用 tree API 内联 content 避免大量 blob POST
const http = require('https');
const fs = require('fs');
const path = require('path');

const REPO = '18388853038/guoshaowen-blog';
const ROOT = 'F:\\eCompanyClaw';
const FRONTEND_SRC = 'F:\\eCompany-Source\\frontend-v2';

const TOKEN = fs.readFileSync('F:\\eCompanyClaw\\.token_env', 'utf8').split('\n')[0].replace('GH_TOKEN=','').trim();

function api(method, relPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: '/repos/' + REPO + relPath,
      method,
      headers: { 'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'push-script', 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode + ' ' + data.substring(0,200)));
        else { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function collectFiles() {
  const list = [];

  function add(relPath, fullPath) {
    if (!fs.existsSync(fullPath)) return;
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return;
    if (stat.size > 200000) return; // 200KB 上限 - 树内联不能太大
    const ext = path.extname(relPath).toLowerCase();
    if (!['.js','.mjs','.cjs','.json','.yml','.yaml','.html','.vue','.css','.md','.txt','.gitignore'].includes(ext)) return;
    if (['.log','.map','.db','.db-shm','.db-wal','.sqlite','.lock','.tar','.ico','.png',
         '.jpg','.exe','.dll','.node','.gyp','.gypi'].includes(ext)) return;
    // 跳过运行时 JSON 数据文件
    const bn = path.basename(relPath);
    if (bn.endsWith('-history.json') || bn === 'activity-log.json' || bn === 'tasks.json' ||
        bn === 'tasks-wal.json' || bn === 'tasks-wal-broken.json' || bn === 'workflows.json' ||
        bn === 'scheduler-status.json' || bn === 'version-history.json' ||
        bn === 'team-errors.json' || bn === 'team-memory.json' || bn === 'team-performance.json' ||
        bn === 'sub-agent-sessions.json' || bn === 'shared-context.json' ||
        bn === 'skills-repair-queue.json' || bn === 'spec-registry.json' ||
        bn === 'router-config.json' || bn === 'post-process-history.json' ||
        bn === 'operator-profile.json' || bn === 'server-err.log' || bn.startsWith('server-') ||
        bn === 'cron-jobs.json' || bn.endsWith('.log') || bn === 'rpa-flows.json' ||
        bn === 'provider-keys.json' || bn === 'provider-keys-history.json' ||
        bn === 'ai-provider.json' || bn === 'model-router.json') return;
    // 跳过内部临时文档
    if (relPath.startsWith('backend/') && (relPath.includes('审查报告') || relPath.includes('审查与更新'))) return;
    // AI团队工作成果 - 只允许白名单公开
    if (relPath.startsWith('AI团队/工作成果/')) {
      if (!relPath.endsWith('CEO-验收报告.md') && !relPath.endsWith('用户配置指南.md') &&
          !relPath.endsWith('tool-registration-checklist.md')) return;
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    list.push({ path: relPath.replace(/\\/g, '/'), mode: '100644', type: 'blob', content });
  }

  function scan(dir) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) return;
    const items = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const item of items) {
      const relPath = dir ? dir + '/' + item.name : item.name;
      if (item.isDirectory()) {
        const bn = item.name;
        if (['node_modules','config','data','logs','memory','codex-skills','project_data',
             'eval-proposals','temp','uploads','sandbox','workspace','workspaces','files',
             'file-versions','code-projects','scripts','modules-unused','lib','release',
             'node_exe'].includes(bn)) continue;
        scan(relPath);
      } else {
        add(relPath, path.join(ROOT, relPath));
      }
    }
  }

  // 扫描根
  const rootItems = fs.readdirSync(ROOT, { withFileTypes: true });
  for (const item of rootItems) {
    const relPath = item.name;
    if (item.isDirectory()) {
      if (['node_modules','release','config','data'].includes(relPath)) continue;
      scan(relPath);
    } else {
      add(relPath, path.join(ROOT, relPath));
    }
  }

  // 从 frontend-v2 补充/替换前端
  function addFromSource(subDir) {
    const fullDir = path.join(FRONTEND_SRC, subDir);
    if (!fs.existsSync(fullDir)) return;
    const items = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        const childDir = subDir ? subDir + '/' + item.name : item.name;
        const childItems = fs.readdirSync(path.join(fullDir, item.name), { withFileTypes: true });
        for (const ci of childItems) {
          if (ci.isFile()) add('frontend/' + childDir + '/' + ci.name, path.join(fullDir, item.name, ci.name));
        }
      } else {
        add('frontend/' + (subDir ? subDir + '/' : '') + item.name, path.join(fullDir, item.name));
      }
    }
  }

  addFromSource('src');
  addFromSource('src/views');
  addFromSource('src/assets');
  if (fs.existsSync(FRONTEND_SRC + '/src/components')) addFromSource('src/components');
  addFromSource('dist');
  addFromSource('dist/assets');
  if (fs.existsSync(FRONTEND_SRC + '/dist/i18n')) addFromSource('dist/i18n');
  if (fs.existsSync(FRONTEND_SRC + '/public')) addFromSource('public');

  const v2Root = ['package.json','vite.config.js','README.md','.gitignore'];
  for (const f of v2Root) {
    const fp = path.join(FRONTEND_SRC, f);
    if (fs.existsSync(fp)) add('frontend/' + f, fp);
  }

  // 去重
  const seen = new Set();
  return list.filter(e => {
    if (seen.has(e.path)) return false;
    seen.add(e.path);
    return true;
  }).sort((a, b) => a.path.localeCompare(b.path));
}

async function main() {
  const files = collectFiles();
  console.log('总计 ' + files.length + ' 个文件\n');

  // 目录统计
  const groups = {};
  for (const f of files) {
    const d = f.path.includes('/') ? f.path.split('/')[0] : '(root)';
    groups[d] = (groups[d] || 0) + 1;
  }
  for (const [d, c] of Object.entries(groups).sort()) {
    console.log('  ' + d + ': ' + c);
  }

  // 总大小
  const totalSize = files.reduce((s, f) => s + f.content.length, 0);
  console.log('\n总内容大小: ' + (totalSize/1024/1024).toFixed(2) + ' MB');
  if (totalSize > 100 * 1024 * 1024) {
    console.log('⚠️ 超出 tree API content 内联限制，需分批次');
    process.exit(1);
  }

  // 打印前几行文件列表
  console.log('\n文件列表 (前30):');
  files.slice(0, 30).forEach(f => console.log('  ' + f.path));
  if (files.length > 30) console.log('  ...还有 ' + (files.length - 30) + ' 个\n');

  // 1. 创建 tree
  console.log('创建 tree (内联 ' + files.length + ' 个文件)...');
  const tree = await api('POST', '/git/trees', { tree: files.map(f => ({
    path: f.path, mode: '100644', type: 'blob', content: f.content
  })) });
  console.log('  Tree SHA:', tree.sha);

  // 2. 清空 master 并创建 commit
  console.log('获取旧 ref...');
  const refOld = await api('GET', '/git/refs/heads/master');
  
  console.log('创建 commit...');
  const commit = await api('POST', '/git/commits', {
    message: '🐉 ECompany Asst v2.0 - 完全开源版本',
    tree: tree.sha,
    parents: [refOld.object.sha]
  });

  // 3. 更新 master
  console.log('更新 master...');
  const ref = await api('PATCH', '/git/refs/heads/master', { sha: commit.sha, force: true });
  console.log('\n✅ 成功! SHA:', ref.object.sha);

  // 4. 验证
  const verify = await api('GET', '/git/trees/' + commit.tree.sha + '?recursive=1');
  const blobs = verify.tree.filter(t => t.type === 'blob');
  const vg = {};
  for (const t of blobs) {
    const d = t.path.includes('/') ? t.path.split('/')[0] : '(root)';
    vg[d] = (vg[d] || 0) + 1;
  }
  console.log('验证 - 共 ' + blobs.length + ' 个文件:');
  for (const [d, c] of Object.entries(vg).sort()) {
    console.log('  ' + d + ': ' + c);
  }
  
  console.log('\n📍 https://github.com/18388853038/guoshaowen-blog');
}

main().catch(e => { console.error('\n❌ 错误:', e.message); process.exit(1); });
