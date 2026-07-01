/**
 * eCompany P2: 共享记忆与知识库模块
 *
 * 功能:
 *  1. 每个 Agent 的记忆文件 (backend/memory/{agentId}.json)
 *  2. 项目级共享工作区 (backend/shared-context.json)
 *  3. 知识库 (backend/knowledge-base.json)
 *  4. Agent 上下文构建（注入到 system prompt）
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const MEMORY_DIR = path.join(BASE, 'memory');
const SHARED_CTX_FILE = path.join(BASE, 'shared-context.json');
const KNOWLEDGE_FILE = path.join(BASE, 'knowledge-base.json');
const CEOMEM_PATH = path.join(BASE, 'memory-ai_ceo.json');

// 确保 memory 目录存在
try { if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true }); } catch(e) {}

// ========== 辅助函数 ==========

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      var raw = fs.readFileSync(file, 'utf-8');
      if (raw.trim().length === 0) return fallback;
      return JSON.parse(raw);
    }
  } catch(e) { /* ignore */ }
  return fallback;
}

function writeJSON(file, data) {
  try {
    var dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch(e) { return false; }
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ========== 1. Agent 记忆 ==========

var DEFAULT_AGENT_MEMORY = {
  agentId: '',
  name_cn: '',
  conversations: [],
  decisions: [],
  notes: [],
  knowledge: {},
  lastUpdated: null
};

function getAgentMemoryPath(agentId) {
  // 优先使用标准路径，并兼容旧的 agent- 前缀路径
  var stdPath = path.join(MEMORY_DIR, agentId + '.json');
  var oldPath = path.join(MEMORY_DIR, 'agent-' + agentId + '.json');
  if (fs.existsSync(stdPath)) return stdPath;
  if (fs.existsSync(oldPath)) return oldPath;
  return stdPath;
}

function getAgentMemory(agentId) {
  var file = getAgentMemoryPath(agentId);
  var data = readJSON(file, null);
  if (!data) {
    // 尝试从旧的 agent-engine 记忆文件读取
    var oldFile = path.join(MEMORY_DIR, 'agent-' + agentId + '.json');
    if (oldFile !== file) data = readJSON(oldFile, null);
  }
  if (!data) {
    data = JSON.parse(JSON.stringify(DEFAULT_AGENT_MEMORY));
    data.agentId = agentId;
    return data;
  }
  // 确保拥有所有字段
  if (!data.agentId) data.agentId = agentId;
  if (!data.conversations) data.conversations = [];
  if (!data.decisions) data.decisions = [];
  if (!data.notes) data.notes = [];
  if (!data.knowledge) data.knowledge = {};
  return data;
}

function updateAgentMemory(agentId, updates) {
  var mem = getAgentMemory(agentId);

  // 追加 conversations/decisions/notes
  if (updates.conversations && Array.isArray(updates.conversations)) {
    mem.conversations = mem.conversations.concat(updates.conversations);
    // 自动压缩：保留最近 100 条
    if (mem.conversations.length > 100) mem.conversations = mem.conversations.slice(-100);
  }
  if (updates.decisions && Array.isArray(updates.decisions)) {
    mem.decisions = mem.decisions.concat(updates.decisions);
    if (mem.decisions.length > 200) mem.decisions = mem.decisions.slice(-200);
  }
  if (updates.notes && Array.isArray(updates.notes)) {
    mem.notes = mem.notes.concat(updates.notes);
    if (mem.notes.length > 100) mem.notes = mem.notes.slice(-100);
  }
  if (updates.knowledge && typeof updates.knowledge === 'object') {
    Object.assign(mem.knowledge, updates.knowledge);
  }
  if (updates.name_cn) mem.name_cn = updates.name_cn;

  mem.lastUpdated = new Date().toISOString();
  var file = path.join(MEMORY_DIR, agentId + '.json');
  writeJSON(file, mem);
  return mem;
}

function saveCEOMemory(m) {
  try {
    if (!m.decisions) m.decisions = [];
    if (!m.conversations) m.conversations = [];
    if (m.decisions.length > 200) m.decisions = m.decisions.slice(-200);
    if (m.conversations.length > 100) m.conversations = m.conversations.slice(-100);
    fs.writeFileSync(CEOMEM_PATH, JSON.stringify(m, null, 2), 'utf-8');
  } catch(e) { /* silently fail */ }
}

// ========== 2. 共享上下文 ==========

function newGoal(title) {
  return {
    id: uuid(),
    title: title || '新目标',
    status: 'active',
    description: '',
    assignee: 'ai_ceo',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    note: '',
    tasks: []
  };
}

// 兼容旧格式（纯字符串数组）：迁移到新格式
function migrateGoals(goals) {
  if (!goals || !Array.isArray(goals)) return [];
  if (goals.length === 0) return [];
  // 如果是对象格式（有id字段），直接返回
  if (typeof goals[0] === 'object' && goals[0].id) return goals;
  // 否则是旧字符串数组，迁移
  return goals.map(function(g) {
    var n = newGoal(typeof g === 'string' ? g : (g.title || ''));
    if (typeof g === 'object' && g.status) n.status = g.status;
    return n;
  });
}

var DEFAULT_SHARED_CONTEXT = {
  projectName: 'eCompany',
  current_goals: [newGoal('多 Agent 协作'), newGoal('全自动化')],
  agreements: ['CORS 动态 Origin', 'CEO 最高权限'],
  active_projects: [],
  recent_decisions: [],
  lastUpdated: null
};

function getSharedContext() {
  var ctx = readJSON(SHARED_CTX_FILE, null);
  if (!ctx) {
    ctx = JSON.parse(JSON.stringify(DEFAULT_SHARED_CONTEXT));
    ctx.lastUpdated = new Date().toISOString();
    writeJSON(SHARED_CTX_FILE, ctx);
  }
  if (!ctx.agreements) ctx.agreements = [];
  ctx.current_goals = migrateGoals(ctx.current_goals || []);
  if (!ctx.active_projects) ctx.active_projects = [];
  if (!ctx.recent_decisions) ctx.recent_decisions = [];
  return ctx;
}

function updateSharedContext(updates) {
  var ctx = getSharedContext();
  if (updates.current_goals) ctx.current_goals = updates.current_goals;
  if (updates.agreements) ctx.agreements = updates.agreements;
  if (updates.active_projects) ctx.active_projects = updates.active_projects;
  if (updates.recent_decisions) {
    ctx.recent_decisions = updates.recent_decisions;
    if (ctx.recent_decisions.length > 50) ctx.recent_decisions = ctx.recent_decisions.slice(-50);
  }
  if (updates.projectName) ctx.projectName = updates.projectName;
  ctx.lastUpdated = new Date().toISOString();
  writeJSON(SHARED_CTX_FILE, ctx);
  return ctx;
}

// ========== 3. 知识库 ==========

var DEFAULT_KNOWLEDGE_BASE = { entries: [] };

function getKnowledgeBase() {
  var kb = readJSON(KNOWLEDGE_FILE, null);
  if (!kb) {
    // 尝试从旧的 memory/knowledge.json 迁移
    var oldKb = readJSON(path.join(MEMORY_DIR, 'knowledge.json'), null);
    if (oldKb && oldKb.entities) {
      kb = { entries: (oldKb.entities || []).map(function(e) {
        return {
          id: uuid(),
          title: e.name || '迁移条目',
          content: JSON.stringify(e),
          tags: [e.type || '迁移', e.confidence || 'medium'],
          author: 'system',
          createdAt: oldKb.updatedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }) };
    } else {
      kb = JSON.parse(JSON.stringify(DEFAULT_KNOWLEDGE_BASE));
    }
    writeJSON(KNOWLEDGE_FILE, kb);
  }
  if (!kb.entries) kb.entries = [];
  return kb;
}

function searchKnowledge(query, tag) {
  var kb = getKnowledgeBase();
  var entries = kb.entries;
  if (query) {
    var q = query.toLowerCase();
    entries = entries.filter(function(e) {
      return (e.title && e.title.toLowerCase().includes(q)) ||
             (e.content && e.content.toLowerCase().includes(q)) ||
             (e.tags && e.tags.some(function(t) { return t.toLowerCase().includes(q); }));
    });
  }
  if (tag) {
    var t = tag.toLowerCase();
    entries = entries.filter(function(e) {
      return e.tags && e.tags.some(function(tg) { return tg.toLowerCase() === t; });
    });
  }
  // 按 updatedAt 降序排列
  entries = entries.sort(function(a, b) {
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
  return entries;
}

function addKnowledge(entry) {
  var kb = getKnowledgeBase();
  var newEntry = {
    id: entry.id || uuid(),
    title: entry.title || '无标题',
    content: entry.content || '',
    tags: entry.tags || [],
    author: entry.author || 'system',
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  kb.entries.push(newEntry);
  writeJSON(KNOWLEDGE_FILE, kb);
  return newEntry;
}

function deleteKnowledge(id) {
  var kb = getKnowledgeBase();
  var idx = kb.entries.findIndex(function(e) { return e.id === id; });
  if (idx === -1) return false;
  kb.entries.splice(idx, 1);
  writeJSON(KNOWLEDGE_FILE, kb);
  return true;
}

// ========== 4. Agent 上下文构建 ==========

/**
 * 为 Agent 构建注入提示词的上下文文本
 * @param {string} agentId - Agent ID
 * @param {Array} tags - Agent 的技能标签列表，用于知识库匹配
 * @returns {string} 上下文文本
 */
function buildAgentContext(agentId, tags) {
  var parts = [];

  // 1. 共享上下文
  var ctx = getSharedContext();
  parts.push('=== 项目共享上下文 ===');
  parts.push('项目名称: ' + ctx.projectName);
  if (ctx.current_goals && ctx.current_goals.length > 0) {
    parts.push('当前目标:');
    ctx.current_goals.forEach(function(g) { parts.push('- ' + g); });
  }
  if (ctx.agreements && ctx.agreements.length > 0) {
    parts.push('团队约定:');
    ctx.agreements.forEach(function(a) { parts.push('- ' + a); });
  }
  if (ctx.active_projects && ctx.active_projects.length > 0) {
    parts.push('活跃项目:');
    ctx.active_projects.forEach(function(p) { parts.push('- ' + (typeof p === 'string' ? p : JSON.stringify(p))); });
  }
  if (ctx.recent_decisions && ctx.recent_decisions.length > 0) {
    parts.push('近期决策:');
    ctx.recent_decisions.slice(-5).forEach(function(d) {
      parts.push('- ' + (typeof d === 'string' ? d : (d.title || d.content || d.type || JSON.stringify(d))));
    });
  }
  parts.push('');

  // 2. 知识库相关条目
  var related = [];
  if (tags && tags.length > 0) {
    tags.forEach(function(tag) {
      var found = searchKnowledge('', tag);
      related = related.concat(found);
    });
    // 去重
    var seen = {};
    related = related.filter(function(e) {
      if (seen[e.id]) return false;
      seen[e.id] = true;
      return true;
    });
    // 限制数量
    related = related.slice(0, 10);
  }
  if (related.length > 0) {
    parts.push('=== 相关知识条目 ===');
    related.forEach(function(e) {
      parts.push('- [' + (e.tags || []).join(', ') + '] ' + e.title);
      var contentPreview = (e.content || '').substring(0, 200);
      if (contentPreview) parts.push('  ' + contentPreview);
    });
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * 构建 CEO 的增强提示词
 */
function buildCEOSystemExtra() {
  var parts = [];

  // 共享上下文
  var ctx = getSharedContext();
  parts.push('\n## 项目共享上下文');
  parts.push('项目名称: ' + ctx.projectName);
  if (ctx.current_goals && ctx.current_goals.length > 0) {
    parts.push('当前目标:');
    ctx.current_goals.forEach(function(g) { parts.push('- ' + g); });
  }
  if (ctx.recent_decisions && ctx.recent_decisions.length > 0) {
    parts.push('近期项目决策:');
    ctx.recent_decisions.slice(-5).forEach(function(d) {
      parts.push('- ' + (typeof d === 'string' ? d : (d.title || d.content || d.type || JSON.stringify(d))));
    });
  }

  // 知识库热点
  var kb = getKnowledgeBase();
  var hotEntries = kb.entries.sort(function(a, b) {
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  }).slice(0, 5);
  if (hotEntries.length > 0) {
    parts.push('');
    parts.push('## 知识库热点（最近更新）');
    hotEntries.forEach(function(e) {
      parts.push('- [' + e.author + '] ' + e.title + ' (' + (e.tags || []).join(', ') + ')');
    });
  }

  return parts.join('\n');
}

// ========== Goals CRUD ==========

var GOALS_HISTORY_FILE = path.join(BASE, 'data', 'goals-history.json');

function getGoalHistory() {
  var h = readJSON(GOALS_HISTORY_FILE, null);
  if (!h) { h = { history: [] }; writeJSON(GOALS_HISTORY_FILE, h); }
  if (!h.history) h.history = [];
  return h;
}

function getAllGoals() {
  var ctx = getSharedContext();
  return {
    active: ctx.current_goals.filter(function(g) { return g.status !== 'completed' && g.status !== 'archived'; }),
    completed: ctx.current_goals.filter(function(g) { return g.status === 'completed' || g.status === 'archived'; })
  };
}

function createGoal(title, desc) {
  var ctx = getSharedContext();
  var g = newGoal(title);
  if (desc) g.description = desc;
  ctx.current_goals.unshift(g);
  updateSharedContext({ current_goals: ctx.current_goals });
  return g;
}

function updateGoal(id, updates) {
  var ctx = getSharedContext();
  var goal = ctx.current_goals.find(function(g) { return g.id === id; });
  if (!goal) return null;
  Object.assign(goal, updates);
  goal.updated_at = new Date().toISOString();
  updateSharedContext({ current_goals: ctx.current_goals });
  return goal;
}

function deleteGoal(id) {
  var ctx = getSharedContext();
  var idx = ctx.current_goals.findIndex(function(g) { return g.id === id; });
  if (idx === -1) return false;
  var removed = ctx.current_goals.splice(idx, 1)[0];
  // 存档到历史记录
  try {
    var h = getGoalHistory();
    h.history.unshift(removed);
    if (h.history.length > 200) h.history = h.history.slice(0, 200);
    writeJSON(GOALS_HISTORY_FILE, h);
  } catch(e) {}
  updateSharedContext({ current_goals: ctx.current_goals });
  return true;
}

function completeGoal(id) {
  var g = updateGoal(id, { status: 'completed', completed_at: new Date().toISOString() });
  if (g) {
    // 归档到历史
    try {
      var h = getGoalHistory();
      h.history.unshift(JSON.parse(JSON.stringify(g)));
      if (h.history.length > 200) h.history = h.history.slice(0, 200);
      writeJSON(GOALS_HISTORY_FILE, h);
    } catch(e) {}
  }
  return g;
}

// ========== 任务-目标自动关联 ==========

/** 自动匹配规则：关键词 → 目标目标ID */
var AUTO_MATCH_RULES = [
  { keywords: ['延迟', 'P95', '优化', '容灾', '故障', '备用', '熔断', '超时', '监控', '健康', '性能'], goalTitle: '全自动化' },
  { keywords: ['协作', 'Agent', '文档', '角色', '闭环', '规范', '流程', '交付'], goalTitle: '多 Agent 协作' }
];

/**
 * 将任务与目标关联
 * @param {string} taskId - 任务ID
 * @param {string} taskTitle - 任务标题
 * @param {string} goalId - 目标ID
 * @returns {boolean} 是否成功
 */
function linkTaskToGoal(taskId, taskTitle, goalId) {
  var ctx = getSharedContext();
  var goal = ctx.current_goals.find(function(g) { return g.id === goalId; });
  if (!goal) return false;
  if (!goal.tasks) goal.tasks = [];
  // 去重
  var exists = goal.tasks.some(function(t) { return t.id === taskId; });
  if (!exists) {
    goal.tasks.push({ id: taskId, title: taskTitle, linked_at: new Date().toISOString() });
    updateSharedContext({ current_goals: ctx.current_goals });
  }
  return true;
}

/**
 * 根据任务标题自动匹配目标
 * @param {string} taskId - 任务ID
 * @param {string} taskTitle - 任务标题
 * @returns {string|null} 匹配到的目标ID，未匹配返回null
 */
function autoMatchAndLinkTask(taskId, taskTitle) {
  if (!taskTitle) return null;
  var ctx = getSharedContext();
  var t = taskTitle.toLowerCase();
  for (var ri = 0; ri < AUTO_MATCH_RULES.length; ri++) {
    var rule = AUTO_MATCH_RULES[ri];
    var matched = false;
    for (var ki = 0; ki < rule.keywords.length; ki++) {
      if (t.indexOf(rule.keywords[ki].toLowerCase()) >= 0) {
        matched = true;
        break;
      }
    }
    if (matched) {
      var goal = ctx.current_goals.find(function(g) { return g.title === rule.goalTitle; });
      if (goal) {
        linkTaskToGoal(taskId, taskTitle, goal.id);
        return goal.id;
      }
    }
  }
  return null;
}

/**
 * 回溯历史任务，自动关联到目标
 */
function backfillAllTasks() {
  try {
    var TASKS_FILE = path.join(BASE, 'tasks.json');
    if (!fs.existsSync(TASKS_FILE)) return { linked: 0, total: 0 };
    var tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    var linked = 0;
    tasks.forEach(function(t) {
      if (t.title && !t.goalId) {
        var gId = autoMatchAndLinkTask(t.id || t.taskId, t.title);
        if (gId) {
          t.goalId = gId;
          linked++;
        }
      }
    });
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
    return { linked: linked, total: tasks.length };
  } catch(e) { return { linked: 0, total: 0, error: e.message }; }
}

// ========== 导出 ==========

module.exports = {
  // Agent 记忆
  getAgentMemory: getAgentMemory,
  updateAgentMemory: updateAgentMemory,
  saveCEOMemory: saveCEOMemory,

  // 共享上下文
  getSharedContext: getSharedContext,
  updateSharedContext: updateSharedContext,

  // Goals
  getAllGoals: getAllGoals,
  createGoal: createGoal,
  updateGoal: updateGoal,
  deleteGoal: deleteGoal,
  completeGoal: completeGoal,
  getGoalHistory: getGoalHistory,

  // 知识库
  searchKnowledge: searchKnowledge,
  addKnowledge: addKnowledge,
  deleteKnowledge: deleteKnowledge,

  // 上下文构建
  buildAgentContext: buildAgentContext,
  buildCEOSystemExtra: buildCEOSystemExtra,

  // 任务-目标关联
  linkTaskToGoal: linkTaskToGoal,
  autoMatchAndLinkTask: autoMatchAndLinkTask,
  backfillAllTasks: backfillAllTasks,

  // 文件路径（外部可读）
  SHARED_CTX_FILE: SHARED_CTX_FILE,
  KNOWLEDGE_FILE: KNOWLEDGE_FILE,
  MEMORY_DIR: MEMORY_DIR,
  CEOMEM_PATH: CEOMEM_PATH
};
