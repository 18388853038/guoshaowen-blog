// 干净推送 ECompany Asst 产品源码到 master
const http = require('https');
const fs = require('fs');
const path = require('path');

const REPO = '18388853038/guoshaowen-blog';
const ROOT = 'F:\\eCompanyClaw';
const FRONTEND_SRC = 'F:\\eCompany-Source\\frontend-v2';

const TOKEN = fs.readFileSync('F:\\eCompanyClaw\\.token_env', 'utf8').split('\n')[0].replace('GH_TOKEN=','').trim();

let blobCount = 0;

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
        if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode));
        else { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function isTextFile(name) {
  const ext = path.extname(name).toLowerCase();
  return ['.js','.mjs','.cjs','.json','.yml','.yaml','.html','.vue','.css','.md','.txt','.bat','.gitignore'].includes(ext);
}

function collectFiles() {
  const list = [];
  const seen = new Set();

  function add(relPath, fullPath) {
    if (!fs.existsSync(fullPath)) return;
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return;
    if (stat.size > 5000000) return; // >5MB skip
    if (!isTextFile(relPath)) return; // 只文本文件
    if (seen.has(relPath)) return;
    seen.add(relPath);
    list.push([relPath.replace(/\\/g, '/'), fullPath]);
  }

  // 从 F:\eCompanyClaw 扫描
  function scan(dir, prefix) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) return;
    const items = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const item of items) {
      const relPath = dir ? dir + '/' + item.name : item.name;
      if (item.isDirectory()) {
        // 跳过所有 node_modules 和内部目录
        const baseName = item.name;
        if (['node_modules','config','data','logs','memory','codex-skills','project_data','eval-proposals',
             'temp','uploads','sandbox','workspace','workspaces','files','file-versions',
             'code-projects','scripts','modules-unused','lib'].includes(baseName)) continue;
        scan(relPath, '');
      } else {
        // 跳过特定扩展名
        if (['.log','.map','.db','.db-shm','.db-wal','.sqlite','.lock','.tar','.ico','.png',
             '.jpg','.exe','.dll','.node','.gyp','.gypi'].includes(path.extname(relPath).toLowerCase())) return;
        add(relPath, path.join(ROOT, relPath));
      }
    }
  }

  // 扫描根目录和子目录
  const rootItems = fs.readdirSync(ROOT, { withFileTypes: true });
  for (const item of rootItems) {
    const relPath = item.name;
    const fullPath = path.join(ROOT, relPath);
    if (item.isDirectory()) {
      // 跳过 node_modules、release、config、data
      if (['node_modules','release','config','data'].includes(relPath)) continue;
      scan(relPath, '');
    } else {
      add(relPath, fullPath);
    }
  }

  // 从 frontend-v2 补充/替换前端源码
  function addFromSource(subDir) {
    const fullDir = path.join(FRONTEND_SRC, subDir);
    if (!fs.existsSync(fullDir)) return;
    const items = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        const childDir = subDir ? subDir + '/' + item.name : item.name;
        const childItems = fs.readdirSync(path.join(fullDir, item.name), { withFileTypes: true });
        for (const ci of childItems) {
          if (ci.isFile()) {
            add('frontend/' + childDir + '/' + ci.name, path.join(fullDir, item.name, ci.name));
          }
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

  // frontend 根目录补充
  const v2Root = ['package.json','vite.config.js','README.md','.gitignore'];
  for (const f of v2Root) {
    const fp = path.join(FRONTEND_SRC, f);
    if (fs.existsSync(fp)) {
      add('frontend/' + f, fp);
    }
  }

  // 排序
  list.sort((a, b) => a[0].localeCompare(b[0]));
  return list;
}

async function main() {
  const files = collectFiles();
  console.log('总计 ' + files.length + ' 个文件\n');

  // 目录分布
  const groups = {};
  for (const [rp] of files) {
    const dir = rp.includes('/') ? rp.split('/')[0] : '(root)';
    groups[dir] = (groups[dir] || 0) + 1;
  }
  for (const [d, c] of Object.entries(groups).sort()) {
    console.log('  ' + d + ': ' + c);
  }

  // 1. 清空 master（保留历史）
  console.log('\n清空 master...');
  const refOld = await api('GET', '/git/refs/heads/master');
  const emptyTree = await api('POST', '/git/trees', {
    tree: [{ path: '.gitkeep', mode: '100644', type: 'blob', content: '' }]
  });
  const clearCommit = await api('POST', '/git/commits', {
    message: '🎉 重置：ECompany Asst v2.0 精洁推送',
    tree: emptyTree.sha,
    parents: [refOld.object.sha]
  });
  await api('PATCH', '/git/refs/heads/master', { sha: clearCommit.sha, force: true });
  console.log('  已清空');

  // 2. 上传所有文件
  console.log('上传 blob...');
  const treeEntries = [];
  let skip = 0;

  for (const [relPath, filePath] of files) {
    try {
      const buf = fs.readFileSync(filePath);
      const base64 = buf.toString('base64');
      const blob = await api('POST', '/git/blobs', { content: base64, encoding: 'base64' });
      treeEntries.push({ path: relPath, mode: '100644', type: 'blob', sha: blob.sha });
      blobCount++;
      if (blobCount % 30 === 0) process.stdout.write('.');
    } catch(e) {
      skip++;
    }
  }

  console.log('\n  上传 ' + blobCount + ' blob, 跳过 ' + skip);

  // 3. 创建 tree
  console.log('创建 tree...');
  const tree = await api('POST', '/git/trees', { tree: treeEntries });

  // 4. commit
  console.log('创建 commit...');
  const commit = await api('POST', '/git/commits', {
    message: '🎉 ECompany Asst v2.0 - 完全开源版本',
    tree: tree.sha,
    parents: [clearCommit.sha]
  });

  // 5. 更新 master
  console.log('更新 master...');
  const ref = await api('PATCH', '/git/refs/heads/master', { sha: commit.sha, force: true });
  console.log('\n✅ 成功! SHA:', ref.object.sha, '\n共 ' + treeEntries.length + ' 个文件');

  // 6. 验证
  const verify = await api('GET', '/git/trees/' + tree.sha + '?recursive=1');
  const vg = {};
  for (const t of verify.tree) {
    const d = t.path.includes('/') ? t.path.split('/')[0] : '(root)';
    vg[d] = (vg[d] || 0) + 1;
  }
  console.log('\n验证 - 目录分布:');
  for (const [d, c] of Object.entries(vg).sort()) {
    console.log('  ' + d + ': ' + c);
  }
  console.log('\n网址: https://github.com/18388853038/guoshaowen-blog');
}

main().catch(e => { console.error('\n❌ 错误:', e.message); process.exit(1); });
