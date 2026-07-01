/**
 * memory.js - 统一的记忆系统
 * 合并自: core-memory.js, knowledge-engine.js, team-memory.js, layered-memory.js, memory-api.js, knowledge-repo.js
 * 
 * 功能:
 * 1. 知识库管理 (knowledge)
 * 2. 团队记忆 (team)
 * 3. 对话上下文 (context)
 * 4. 用户偏好 (preference)
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const MEMORY_DIR = path.join(BASE, 'memory');

// 数据文件路径
const FILES = {
  knowledge: path.join(MEMORY_DIR, 'knowledge-base.json'),
  team: path.join(MEMORY_DIR, 'team-memory.json'),
  context: path.join(MEMORY_DIR, 'context.json'),
  preference: path.join(MEMORY_DIR, 'preferences.json')
};

// 确保目录存在
function ensureDirs() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

// 加载数据
function load(type) {
  ensureDirs();
  const file = FILES[type];
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (e) {
    console.error('[memory] 加载失败:', type, e.message);
  }
  return type === 'knowledge' ? [] : {};
}

// 保存数据
function save(type, data) {
  ensureDirs();
  const file = FILES[type];
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[memory] 保存失败:', type, e.message);
    return false;
  }
}

// ========== 知识库 API ==========

function addKnowledge(entry) {
  const knowledge = load('knowledge');
  const item = {
    id: entry.id || Date.now().toString(),
    title: entry.title || '',
    content: entry.content || '',
    category: entry.category || '未分类',
    tags: entry.tags || [],
    createdAt: new Date().toISOString()
  };
  knowledge.push(item);
  save('knowledge', knowledge);
  return item;
}

function searchKnowledge(query, options = {}) {
  const knowledge = load('knowledge');
  const limit = options.limit || 10;
  
  if (!query) return knowledge.slice(0, limit);
  
  const results = knowledge.filter(item => {
    const searchText = (item.title + ' ' + item.content + ' ' + item.tags.join(' ')).toLowerCase();
    return searchText.includes(query.toLowerCase());
  });
  
  return results.slice(0, limit);
}

// ========== 团队记忆 API ==========

function addTeamMemory(entry) {
  const team = load('team');
  const item = {
    id: entry.id || Date.now().toString(),
    type: entry.type || 'general',
    content: entry.content || '',
    createdAt: new Date().toISOString()
  };
  team.push(item);
  save('team', team);
  return item;
}

function getTeamMemory(type) {
  const team = load('team');
  if (type) {
    return team.filter(item => item.type === type);
  }
  return team;
}

// ========== 统一导出 ==========

module.exports = {
  // 核心
  load,
  save,
  
  // 知识库
  addKnowledge,
  searchKnowledge,
  
  // 团队记忆
  addTeamMemory,
  getTeamMemory,
  
  // 工具
  ensureDirs
};
