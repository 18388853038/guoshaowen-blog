const fs = require('fs');
const path = require('path');

const BACKEND_DIR = 'F:\\eCompanyClaw\\backend';
const SERVER_FILE = path.join(BACKEND_DIR, 'server-modern.js');
const MODULES_DIR = path.join(BACKEND_DIR, 'modules');

// 1. 扫描 server-modern.js 中所有 require 的模块
const content = fs.readFileSync(SERVER_FILE, 'utf-8');
const usedModules = new Set();

// 匹配 require('./modules/xxx') 或 require('../modules/xxx')
const requirePattern = /require\(['"](?:\.\/|\.\.\/)?modules\/([^'"]+)['"]\)/g;
let match;

while ((match = requirePattern.exec(content)) !== null) {
  const moduleName = match[1].replace(/\\/g, '/').replace(/\.js$/, '');
  usedModules.add(moduleName);
}

// 2. 扫描所有 .js 文件中的 require
function scanRequires(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      scanRequires(filePath);
    } else if (file.endsWith('.js')) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      let m;
      while ((m = requirePattern.exec(fileContent)) !== null) {
        const modName = m[1].replace(/\\/g, '/').replace(/\.js$/, '');
        usedModules.add(modName);
      }
    }
  }
}

scanRequires(MODULES_DIR);
