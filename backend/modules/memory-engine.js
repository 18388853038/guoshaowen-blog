/**
 * memory-engine.js — 对话记忆系统 v2
 *
 * 对标 .codex 的 global/ + projects/ 设计
 *
 * 结构：
 *   data/memory/global/
 *     sessions/        全局会话（无项目关联）
 *     knowledge/       全局知识库
 *     evolve/          自我进化记录
 *     logs/            日志归档
 *   data/memory/projects/<projName>/
 *     sessions/        项目关联会话
 *     knowledge/       项目知识
 *     evolve/          进化记录
 *
 * 设计原则：
 *   1. 简化存储层级，改用分文件存储代替单 JSON
 *   2. 旧版 session-memory.json 作为兼容 fallback
 *   3. 自动关联对话到当前活跃项目
 *   4. 项目切换时，记忆上下文自动切换
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const MEMORY_ROOT = path.join(BASE, 'data', 'memory');
const GLOBAL_DIR = path.join(MEMORY_ROOT, 'global', 'sessions');
const GLOBAL_KNOWLEDGE = path.join(MEMORY_ROOT, 'global', 'knowledge');
const GLOBAL_EVOLVE = path.join(MEMORY_ROOT, 'global', 'evolve');
const PROJECTS_DIR = path.join(BASE, '..', 'projects');

// 兼容旧的 session-memory.json 路径
const OLD_SESSION_FILE = path.join(BASE, 'data', 'session-memory.json');

// ----- 初始化目录 -----
function ensureDirs() {
  [GLOBAL_DIR, GLOBAL_KNOWLEDGE, GLOBAL_EVOLVE,
   path.join(MEMORY_ROOT, 'global', 'logs')].forEach(function(d) {
    try { fs.mkdirSync(d, { recursive: true }); } catch(e) {}
  });
}

// ========== 会话记忆 ==========

/**
 * 获取当前会话文件路径（按 sessionId 或日期分文件）
 */
function getSessionPath(sessionId, projectName) {
  var base = GLOBAL_DIR;
  if (projectName) {
    var projMemDir = path.join(PROJECTS_DIR, projectName, 'memory', 'sessions');
    try { fs.mkdirSync(projMemDir, { recursive: true }); } catch(e) {}
    base = projMemDir;
  }
  if (sessionId) return path.join(base, sessionId + '.json');
  // 按日期分文件
  var today = new Date().toISOString().substring(0, 10);
  return path.join(base, 'session-' + today + '.json');
}

/**
 * 加载会话记忆
 */
function loadSession(sessionId, projectName) {
  var sp = getSessionPath(sessionId, projectName);
  try {
    if (fs.existsSync(sp)) return JSON.parse(fs.readFileSync(sp, 'utf8'));
  } catch(e) {}

  // fallback：旧版 session-memory.json
  try {
    if (fs.existsSync(OLD_SESSION_FILE)) {
      var old = JSON.parse(fs.readFileSync(OLD_SESSION_FILE, 'utf8'));
      if (Array.isArray(old) && old.length > 0) return old;
    }
  } catch(e) {}

  return [];
}

/**
 * 追加会话记忆
 */
function addSessionMessage(role, content, sessionId, projectName, maxEntries) {
  maxEntries = maxEntries || 50;
  var messages = loadSession(sessionId, projectName);
  messages.push({
    role: role,
    content: String(content).substring(0, 3000),
    timestamp: new Date().toISOString()
  });

  // 裁剪到 maxEntries
  while (messages.length > maxEntries) messages.shift();

  // 写入分文件
  var sp = getSessionPath(sessionId, projectName);
  try {
    fs.writeFileSync(sp, JSON.stringify(messages, null, 2), 'utf8');
  } catch(e) {}

  // 也写一份到全局日志（仅关键内容，不推荐用于恢复）
  try {
    var logPath = path.join(MEMORY_ROOT, 'global', 'logs', 'session-flow.log');
    var projectTag = projectName ? '[' + projectName + '] ' : '';
    var logLine = '[' + new Date().toISOString() + '] ' + projectTag + role + ': ' + String(content).substring(0, 200) + '\n';
    fs.appendFileSync(logPath, logLine, 'utf8');
  } catch(e) {}

  return messages;
}

/**
 * 获取最近 N 条对话上下文
 */
function getRecentContext(n, sessionId, projectName) {
  n = n || 10;
  var messages = loadSession(sessionId, projectName);
  return messages.slice(-n);
}

// ========== 知识库 ==========

/**
 * 写入知识条目
 */
function addKnowledge(title, content, type, tags, projectName) {
  if (!content || !content.trim()) return;

  var kbDir = GLOBAL_KNOWLEDGE;
  if (projectName) {
    kbDir = path.join(PROJECTS_DIR, projectName, 'memory', 'knowledge');
    try { fs.mkdirSync(kbDir, { recursive: true }); } catch(e) {}
  }

  var entry = {
    id: 'k_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    title: String(title).substring(0, 100),
    content: String(content).substring(0, 5000),
    type: type || 'general',
    tags: tags || [],
    timestamp: new Date().toISOString(),
    source: 'orchestrator',
    project: projectName || null
  };

  var filePath = path.join(kbDir, entry.id + '.json');
  // 去重：检查是否已有相同标题+前50字
  try {
    var existing = fs.readdirSync(kbDir).filter(function(f) { return f.endsWith('.json'); });
    for (var i = 0; i < existing.length; i++) {
      try {
        var eData = JSON.parse(fs.readFileSync(path.join(kbDir, existing[i]), 'utf8'));
        if (eData.title === entry.title && eData.content.substring(0, 50) === entry.content.substring(0, 50)) return;
      } catch(du) {}
    }
  } catch(e) {}

  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
}

/**
 * 搜索知识库（混合目录搜索）
 */
function searchKnowledge(query, projectName) {
  if (!query || !query.trim()) {
    // 无查询：返回全局和项目的最新 N 条
    return loadRecentKnowledge(10, projectName);
  }

  var q = query.toLowerCase();
  var results = [];

  // 搜索全局 KB
  try {
    var files = fs.readdirSync(GLOBAL_KNOWLEDGE).filter(function(f) { return f.endsWith('.json'); });
    for (var i = 0; i < files.length; i++) {
      try {
        var data = JSON.parse(fs.readFileSync(path.join(GLOBAL_KNOWLEDGE, files[i]), 'utf8'));
        var score = calcScore(data, q);
        if (score > 0) results.push({ item: data, score: score });
      } catch(e) {}
    }
  } catch(e) {}

  // 搜索项目 KB
  if (projectName) {
    var projKbDir = path.join(PROJECTS_DIR, projectName, 'memory', 'knowledge');
    try {
      var projFiles = fs.readdirSync(projKbDir).filter(function(f) { return f.endsWith('.json'); });
      for (var i = 0; i < projFiles.length; i++) {
        try {
          var data = JSON.parse(fs.readFileSync(path.join(projKbDir, projFiles[i]), 'utf8'));
          var score = calcScore(data, q);
          if (score > 0) results.push({ item: data, score: score + 3 }); // 项目知识+3加权
        } catch(e) {}
      }
    } catch(e) {}
  }

  results.sort(function(a, b) { return b.score - a.score; });
  return results.slice(0, 10).map(function(r) { return r.item; });
}

function calcScore(entry, query) {
  var score = 0;
  var inTitle = (entry.title || '').toLowerCase();
  var inContent = (entry.content || '').toLowerCase();
  var inTags = ((entry.tags || []).join(' ')).toLowerCase();

  if (inTitle.includes(query)) score += 15;
  if (inContent.includes(query)) score += 8;
  if (inTags.includes(query)) score += 4;

  return score;
}

function loadRecentKnowledge(n, projectName) {
  n = n || 10;
  var all = [];

  try {
    var files = fs.readdirSync(GLOBAL_KNOWLEDGE).filter(function(f) { return f.endsWith('.json'); });
    for (var i = 0; i < files.length; i++) {
      try { all.push(JSON.parse(fs.readFileSync(path.join(GLOBAL_KNOWLEDGE, files[i]), 'utf8'))); } catch(e) {}
    }
  } catch(e) {}

  if (projectName) {
    var projKbDir = path.join(PROJECTS_DIR, projectName, 'memory', 'knowledge');
    try {
      var projFiles = fs.readdirSync(projKbDir).filter(function(f) { return f.endsWith('.json'); });
      for (var i = 0; i < projFiles.length; i++) {
        try { all.push(JSON.parse(fs.readFileSync(path.join(projKbDir, projFiles[i]), 'utf8'))); } catch(e) {}
      }
    } catch(e) {}
  }

  all.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  return all.slice(0, n);
}

// ========== 进化记忆 ==========

/**
 * 写入进化记忆
 */
function addEvolveMemory(type, event, analysis, suggestion, projectName) {
  var evDir = GLOBAL_EVOLVE;
  if (projectName) {
    evDir = path.join(PROJECTS_DIR, projectName, 'memory', 'evolve');
    try { fs.mkdirSync(evDir, { recursive: true }); } catch(e) {}
  }

  var entry = {
    id: 'e_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    type: type,
    event: String(event).substring(0, 500),
    analysis: String(analysis).substring(0, 1000),
    suggestion: String(suggestion).substring(0, 500),
    timestamp: new Date().toISOString(),
    project: projectName || null
  };

  // 只保留最近 100 条
  var filePath = path.join(evDir, entry.id + '.json');
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');

  // 清理超过 100 条的文件
  try {
    var files = fs.readdirSync(evDir).filter(function(f) { return f.endsWith('.json'); });
    if (files.length > 100) {
      files.sort();
      var toDelete = files.slice(0, files.length - 100);
      for (var i = 0; i < toDelete.length; i++) {
        try { fs.unlinkSync(path.join(evDir, toDelete[i])); } catch(e) {}
      }
    }
  } catch(e) {}
}

/**
 * 读取进化记忆（最近 N 条）
 */
function getRecentEvolve(n, projectName) {
  n = n || 5;
  var all = [];

  try {
    var files = fs.readdirSync(GLOBAL_EVOLVE).filter(function(f) { return f.endsWith('.json'); });
    for (var i = 0; i < files.length; i++) {
      try { all.push(JSON.parse(fs.readFileSync(path.join(GLOBAL_EVOLVE, files[i]), 'utf8'))); } catch(e) {}
    }
  } catch(e) {}

  if (projectName) {
    var projEvDir = path.join(PROJECTS_DIR, projectName, 'memory', 'evolve');
    try {
      var projFiles = fs.readdirSync(projEvDir).filter(function(f) { return f.endsWith('.json'); });
      for (var i = 0; i < projFiles.length; i++) {
        try { all.push(JSON.parse(fs.readFileSync(path.join(projEvDir, projFiles[i]), 'utf8'))); } catch(e) {}
      }
    } catch(e) {}
  }

  all.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  return all.slice(0, n);
}

// ========== 统计 ==========

function getStats() {
  var stats = { global: {}, projects: {} };

  // 全局
  try {
    stats.global.sessions = (fs.readdirSync(GLOBAL_DIR) || []).filter(function(f) { return f.endsWith('.json'); }).length;
  } catch(e) { stats.global.sessions = 0; }
  try {
    stats.global.knowledge = (fs.readdirSync(GLOBAL_KNOWLEDGE) || []).filter(function(f) { return f.endsWith('.json'); }).length;
  } catch(e) { stats.global.knowledge = 0; }
  try {
    stats.global.evolve = (fs.readdirSync(GLOBAL_EVOLVE) || []).filter(function(f) { return f.endsWith('.json'); }).length;
  } catch(e) { stats.global.evolve = 0; }

  return stats;
}

// ========== 路由注册 ==========

function registerRoutes(registerRoute, parseBody, json) {
  // GET /api/memory/stats
  registerRoute(['GET'], /^\/api\/mem\/stats$/, function(req, res) {
    try {
      json(res, { ok: true, stats: getStats() });
    } catch(e) {
      json(res, { ok: false, error: e.message });
    }
  });

  // GET /api/memory/session?project=<name>
  registerRoute(['GET'], /^\/api\/mem\/session$/, function(req, res, m) {
    try {
      var url = new URL(req.url, 'http://localhost');
      var project = url.searchParams.get('project') || null;
      var sessionId = url.searchParams.get('sessionId') || null;
      var msgs = loadSession(sessionId, project);
      json(res, { ok: true, messages: msgs.slice(-20), total: msgs.length, project: project });
    } catch(e) {
      json(res, { ok: false, error: e.message });
    }
  });

  // GET /api/memory/knowledge?q=<query>&project=<name>
  registerRoute(['GET'], /^\/api\/mem\/knowledge$/, function(req, res, m) {
    try {
      var url = new URL(req.url, 'http://localhost');
      var q = url.searchParams.get('q') || '';
      var project = url.searchParams.get('project') || null;
      var results = q ? searchKnowledge(q, project) : loadRecentKnowledge(20, project);
      json(res, { ok: true, results: results, query: q });
    } catch(e) {
      json(res, { ok: false, error: e.message });
    }
  });

  // POST /api/memory/evolve/add
  registerRoute(['POST'], /^\/api\/mem\/evolve\/add$/, async function(req, res) {
    try {
      var b = await parseBody(req);
      if (typeof b === 'string') try { b = JSON.parse(b); } catch(du) {}
      if (!b || !b.type) return json(res, { ok: false, error: '缺少 type' });
      addEvolveMemory(b.type, b.event || '', b.analysis || '', b.suggestion || '', b.project || null);
      json(res, { ok: true });
    } catch(e) {
      json(res, { ok: false, error: e.message });
    }
  });
}

// ========== 旧数据兼容迁移 ==========

function migrateFromOldFormat() {
  try {
    // 迁移旧会话记忆
    if (fs.existsSync(OLD_SESSION_FILE)) {
      var oldSessions = JSON.parse(fs.readFileSync(OLD_SESSION_FILE, 'utf8'));
      if (Array.isArray(oldSessions) && oldSessions.length > 0) {
        var todayPath = getSessionPath(null, null);
        if (!fs.existsSync(todayPath)) {
          fs.writeFileSync(todayPath, JSON.stringify(oldSessions, null, 2), 'utf8');
          console.log('[memory-engine] 已迁移 ' + oldSessions.length + ' 条旧会话记忆');
        }
      }
    }
  } catch(e) {
    console.log('[memory-engine] 迁移跳过: ' + e.message);
  }
}

// ========== 初始化 ==========
ensureDirs();
migrateFromOldFormat();

module.exports = {
  loadSession: loadSession,
  addSessionMessage: addSessionMessage,
  getRecentContext: getRecentContext,
  addKnowledge: addKnowledge,
  searchKnowledge: searchKnowledge,
  addEvolveMemory: addEvolveMemory,
  getRecentEvolve: getRecentEvolve,
  getStats: getStats,
  registerRoutes: registerRoutes
};
