/**
 * config-utils.js — 配置工具模块
 *
 * 对标 .codex .codex.toml 设计，提供统一配置加载
 *
 * 功能：
 *   1. TOML 解析（基础键值对 + 节区）
 *   2. JSON 配置合并（TOML 优先覆盖 JSON）
 *   3. 配置层级：config.toml → data/*.json（TOML 作为覆写层）
 *   4. 项目级 .ecompany.toml 发现
 */

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.join(__dirname, '..');

// ========== 1. TOML 解析器（轻量，仅支持基础语法） ==========

/**
 * 解析 TOML 文件到 JS 对象
 * 支持：
 *   - 键值对
 *   - 节区 [section]
 *   - 嵌套节区 [section.sub]
 *   - 字符串（单/双引号）
 *   - 数字
 *   - 布尔值
 *   - 数组 [1, 2, 3]
 *   - 内联表 {key = "val"}
 *   - 注释 #
 */
function parseTOML(content) {
  const root = {};
  let currentSection = root;
  const sectionStack = [root];

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 节区
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const sectionPath = sectionMatch[1].trim().split('.');
      currentSection = root;
      for (const seg of sectionPath) {
        const key = seg.trim();
        if (!currentSection[key]) currentSection[key] = {};
        currentSection = currentSection[key];
      }
      sectionStack.push(currentSection);
      continue;
    }

    // 键值对
    const kvMatch = trimmed.match(/^(\w[\w\-_.]*)\s*=\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let val = kvMatch[2].trim();
      currentSection[key] = parseTOMLValue(val);
    }
  }

  return root;
}

/**
 * 解析 TOML 值
 */
function parseTOMLValue(val) {
  // 数组 [1, 2, "a"]
  if (val.startsWith('[') && (val.endsWith(']') || true)) {
    try {
      // 简单数组解析
      const inner = val.slice(1, val.endsWith(']') ? -1 : val.length).trim();
      if (!inner) return [];
      const items = [];
      let current = '';
      let inQuote = false;
      let quoteChar = '';
      for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (inQuote) {
          if (c === quoteChar) {
            inQuote = false;
            items.push(current);
            current = '';
          } else {
            current += c;
          }
        } else if (c === '"' || c === "'") {
          inQuote = true;
          quoteChar = c;
        } else if (c === ',') {
          const trimmed = current.trim();
          if (trimmed) items.push(parseTOMLPrimitive(trimmed));
          current = '';
        } else {
          current += c;
        }
      }
      const trimmed = current.trim();
      if (trimmed) items.push(parseTOMLPrimitive(trimmed));
      return items;
    } catch(e) {
      return [];
    }
  }

  // 内联表 { key = "val" }
  if (val.startsWith('{') && val.endsWith('}')) {
    try {
      const inner = val.slice(1, -1).trim();
      const obj = {};
      const pairs = inner.split(',').map(s => s.trim()).filter(Boolean);
      for (const pair of pairs) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const k = pair.substring(0, eq).trim();
        const v = pair.substring(eq + 1).trim();
        obj[k] = parseTOMLValue(v);
      }
      return obj;
    } catch(e) {
      return {};
    }
  }

  return parseTOMLPrimitive(val);
}

function parseTOMLPrimitive(val) {
  // 去掉周围空格
  val = val.trim();

  // 引号字符串
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }

  // 布尔值
  if (val === 'true') return true;
  if (val === 'false') return false;

  // 数字
  if (/^-?\d+(\.\d+)?$/.test(val)) {
    return val.includes('.') ? parseFloat(val) : parseInt(val, 10);
  }

  return val;
}

// ========== 2. 配置加载 ==========

/**
 * 查找配置文件（从当前目录向上搜索）
 */
function findConfig(startDir, filename) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (true) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) return filePath;
    if (dir === root) break;
    dir = path.dirname(dir);
  }

  return null;
}

/**
 * 加载配置链
 * 优先级（从高到低）：
 *   1. 项目级 .ecompany.toml（在 outputs 目录或当前工作目录）
 *   2. 系统级 config.toml（项目根）
 *   3. data/*.json（最底层）
 */
function loadConfigChain(extraSearchDirs) {
  const config = {};

  // 1. 从各搜索目录发现项目级配置
  const searchDirs = extraSearchDirs || [process.cwd()];
  const projectConfigs = [];
  for (const dir of searchDirs) {
    const cfgPath = findConfig(dir, '.ecompany.toml');
    if (cfgPath && !projectConfigs.find(c => c.path === cfgPath)) {
      try {
        const content = fs.readFileSync(cfgPath, 'utf-8');
        projectConfigs.push({ path: cfgPath, data: parseTOML(content) });
      } catch(e) {}
    }
  }

  // 2. 加载系统级 config.toml
  const systemTomlPath = path.join(BACKEND_DIR, '..', 'config.toml');
  let systemConfig = {};
  if (fs.existsSync(systemTomlPath)) {
    try {
      const content = fs.readFileSync(systemTomlPath, 'utf-8');
      systemConfig = parseTOML(content);
    } catch(e) {
      console.error('[config-utils] 系统 config.toml 解析失败:', e.message);
    }
  }

  // 3. 合并：项目级覆盖系统级
  Object.assign(config, systemConfig);
  for (const pc of projectConfigs) {
    deepMerge(config, pc.data);
  }

  return config;
}

/**
 * 深合并
 */
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] instanceof Object && target[key] instanceof Object && !Array.isArray(source[key])) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ========== 3. JSON 迁移/兼容 ==========

/**
 * 将 JSON 配置转换为 TOML 兼容结构
 * 用于逐步迁移 data/*.json → config.toml
 */
function jsonToTomlStyle(jsonObj) {
  function tomlify(obj, prefix) {
    let result = '';
    for (const [key, val] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        result += `[${fullKey}]\n`;
        result += tomlify(val, fullKey);
      } else {
        result += `${key} = ${JSON.stringify(val)}\n`;
      }
    }
    return result;
  }
  return `# Auto-generated from JSON config\n${tomlify(jsonObj, '')}`;
}

/**
 * 从 JSON 文件加载配置（带缓存）
 */
const _jsonCache = new Map();

function loadJSON(filePath) {
  if (_jsonCache.has(filePath)) {
    return JSON.parse(JSON.stringify(_jsonCache.get(filePath)));
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    _jsonCache.set(filePath, data);
    return JSON.parse(JSON.stringify(data));
  } catch(e) {
    return {};
  }
}

// 清理缓存（文件变更时调用）
function clearCache(filePath) {
  if (filePath) {
    _jsonCache.delete(filePath);
  } else {
    _jsonCache.clear();
  }
}

// ========== 4. 项目/工作区管理 ==========

/**
 * 项目结构
 * project/
 *   .ecompany.toml    项目配置
 *   structure.md       项目结构说明
 *   tasks.json         项目任务
 *   outputs/           产出物目录
 *   references/        参考材料
 */

function createProject(name, basePath) {
  const dir = path.join(basePath || path.join(BACKEND_DIR, '..', 'projects'), name);

  // 创建目录结构
  const subdirs = ['outputs', 'references', 'tasks'];
  for (const d of [dir, ...subdirs.map(s => path.join(dir, s))]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch(e) {}
  }

  // 创建 .ecompany.toml
  const tomlContent = `# .ecompany.toml — 项目配置
[project]
name = "${name}"
created = "${new Date().toISOString()}"
status = "active"

[output]
path = "outputs"
format = "auto"

[sandbox]
enabled = true
auto_clean = false

[skills]
enabled = true
`;

  fs.writeFileSync(path.join(dir, '.ecompany.toml'), tomlContent, 'utf-8');

  // 创建 structure.md
  const structure = `# ${name} 项目结构

## 目录说明
- \`outputs/\` — 产出物目录
- \`references/\` — 参考材料
- \`tasks/\` — 任务管理

## 创建时间
${new Date().toLocaleString('zh-CN')}
`;

  fs.writeFileSync(path.join(dir, 'structure.md'), structure, 'utf-8');

  return { dir, name };
}

/**
 * 发现所有项目
 */
function listProjects(basePath) {
  const projectsDir = basePath || path.join(BACKEND_DIR, '..', 'projects');
  const results = [];
  try {
    if (!fs.existsSync(projectsDir)) return results;
    const entries = fs.readdirSync(projectsDir);
    for (const entry of entries) {
      const projectDir = path.join(projectsDir, entry);
      if (!fs.statSync(projectDir).isDirectory()) continue;
      const tomlPath = path.join(projectDir, '.ecompany.toml');
      let config = {};
      if (fs.existsSync(tomlPath)) {
        try {
          config = parseTOML(fs.readFileSync(tomlPath, 'utf-8'));
        } catch(e) {}
      }
      results.push({
        name: entry,
        dir: projectDir,
        config: config.project || {},
        created: config.project ? config.project.created : null,
        hasOutputs: fs.existsSync(path.join(projectDir, 'outputs'))
      });
    }
  } catch(e) {}
  return results;
}

// ========== 导出 ==========

/**
 * 获取指定项目目录路径
 * @param {string} projectName 项目名称
 * @param {string} [basePath] 项目根目录
 * @returns {string|null} 项目目录绝对路径，不存在则返回 null
 */
function getProjectDir(projectName, basePath) {
  if (!projectName) return null;
  const projectsDir = basePath || path.join(BACKEND_DIR, '..', 'projects');
  const dir = path.join(projectsDir, projectName);
  if (fs.existsSync(dir)) {
    return path.resolve(dir);
  }
  return null;
}

module.exports = {
  parseTOML,
  parseTOMLValue,
  parseTOMLPrimitive,
  findConfig,
  loadConfigChain,
  jsonToTomlStyle,
  loadJSON,
  clearCache,
  createProject,
  listProjects,
  getProjectDir
};
