// cognition-engine-v2.js — 百度级认知关联引擎 v2
// 零外部依赖，使用已有数据库表构建知识图谱和语义关联
// 特性：实体抽取、关联分数计算、跨域搜索、热搜排序、智能路由

'use strict';

var fs = require('fs');
var path = require('path');

function CognitionEngineV2() {
  this._initialized = false;
  this._entityCache = null;   // { entities: [...], relations: [...] }
  this._lastBuild = 0;
  this._cacheTTL = 60000;     // 1分钟缓存
  this._hotTerms = {};        // 热搜词频率
  this._relationMemory = [];    // 运行时学习的关系（从 agent_memories 加载）
  this._crossSessionLinks = {}; // 跨 session 关联 index { entityId: [sessionId,...] }
  this._logger = console.log;
  // 构造时自动加载已持久化的运行时关系
  try {
    var dbMod = require('./database');
    var db = dbMod.db();
    if (db && typeof db.prepare === 'function') {
      var saved = db.prepare("SELECT content FROM agent_memories WHERE memory_type='runtime_cognition' ORDER BY created_at DESC LIMIT 500").all();
      if (Array.isArray(saved)) {
        var self = this;
        saved.forEach(function(r) {
          try {
            var parsed = JSON.parse(r.content);
            if (parsed && parsed.from && parsed.to) {
              self._relationMemory.push(parsed);
            }
          } catch(e){}
        });
        this._logger('[CogV2] 加载运行时关系: ' + this._relationMemory.length + ' 条');
      }
    }
  } catch(e) {}
}

// ========== 实体与关联构建 ==========

CognitionEngineV2.prototype.buildKnowledgeGraph = function() {
  try {
    var dbMod = require('./database');
    var db = dbMod.db();
    var entities = [];
    var relations = [];

    // 1. Agent 实体
    var agents = db.prepare("SELECT id, name, name_cn, category, role, title, status, description, reports_to FROM agents").all();
    if (Array.isArray(agents)) agents.forEach(function(a) {
      var et = { id: 'agent:' + a.id, type: 'agent', label: a.name_cn || a.name || a.id, category: a.category || 'member', status: a.status, desc: (a.description || '').substring(0, 80), role: a.role || '' };
      entities.push(et);
      // 汇报关系→关联
      if (a.reports_to && a.reports_to !== 'none') {
        relations.push({ from: et.id, to: 'agent:' + a.reports_to, type: 'reports_to', weight: 1 });
      }
    });

    // 2. Task 实体
    var tasks = db.prepare("SELECT id, title, description, status, priority, assignee_id, tags, created_at, completed_at FROM tasks ORDER BY created_at DESC LIMIT 200").all();
    if (Array.isArray(tasks)) tasks.forEach(function(t) {
      var et = { id: 'task:' + t.id, type: 'task', label: t.title, status: t.status, priority: t.priority, desc: (t.description || '').substring(0, 80), created: t.created_at };
      entities.push(et);
      // 指派人关联
      if (t.assignee_id) {
        relations.push({ from: et.id, to: 'agent:' + t.assignee_id, type: 'assigned_to', weight: 2 });
      }
      // 标签关联（关键词标签→实体）
      try {
        var tags = JSON.parse(t.tags || '[]');
        if (Array.isArray(tags)) tags.forEach(function(tag) {
          var tid = 'tag:' + tag.toLowerCase().replace(/\s+/g, '_');
          entities.push({ id: tid, type: 'tag', label: tag });
          relations.push({ from: et.id, to: tid, type: 'tagged', weight: 1 });
        });
      } catch(e) {}
    });

    // 3. Activity 实体
    var acts = db.prepare("SELECT id, agent_id, agent_name, action, target, details, timestamp FROM activities ORDER BY timestamp DESC LIMIT 200").all();
    if (Array.isArray(acts)) acts.forEach(function(a) {
      var et = { id: 'activity:' + a.id, type: 'activity', label: (a.agent_name || '?') + ' ' + a.action + ' ' + (a.target || ''), action: a.action, agent: a.agent_name, target: a.target, ts: a.timestamp };
      entities.push(et);
      if (a.agent_id) relations.push({ from: 'agent:' + a.agent_id, to: et.id, type: 'performed', weight: 1 });
      if (a.target) {
        relations.push({ from: et.id, to: 'target:' + a.target.replace(/\s+/g, '_'), type: 'targets', weight: 1 });
        entities.push({ id: 'target:' + a.target.replace(/\s+/g, '_'), type: 'target', label: a.target });
      }
    });

    // 4. Conversation 实体（摘要级别）
    var convs = db.prepare("SELECT id, agent_id, role, content, created_at FROM conversations ORDER BY created_at DESC LIMIT 100").all();
    if (Array.isArray(convs)) convs.forEach(function(c) {
      var snippet = (c.content || '').substring(0, 40);
      if (!snippet) return;
      var et = { id: 'conv:' + c.id, type: 'conversation', label: snippet, role: c.role, ts: c.created_at };
      entities.push(et);
      if (c.agent_id) relations.push({ from: 'agent:' + c.agent_id, to: et.id, type: 'had_conversation', weight: 1 });
    });

    // 5. memory 实体
    var mems = db.prepare("SELECT id, key, value, created_at FROM memory ORDER BY created_at DESC LIMIT 100").all();
    if (Array.isArray(mems)) mems.forEach(function(m) {
      var val = (m.value || '').substring(0, 60);
      if (!val) return;
      entities.push({ id: 'mem:' + m.id, type: 'memory', label: m.key, value: val, ts: m.created_at });
    });

    // 6. 去重 + 建立倒排索引
    var seen = {};
    entities = entities.filter(function(e) {
      if (seen[e.id]) return false;
      seen[e.id] = true;
      return true;
    });

    

// ========== 运行时学习：增量关系学习（90%→100% 核心功能） ==========

CognitionEngineV2.prototype.learnRelation = function(sourceKey, targetKey, relationType, weight) {
  weight = weight || 1;
  if (!sourceKey || !targetKey) return { ok: false, error: 'sourceKey 和 targetKey 必填' };
  var relation = { from: sourceKey, to: targetKey, type: relationType || 'learned', weight: weight, learnedAt: Date.now() };
  this._relationMemory.push(relation);
  // 持久化到 agent_memories 表
  try {
    var dbMod = require('./database');
    var db = dbMod.db();
    if (db && typeof db.prepare === 'function') {
      db.prepare("INSERT INTO agent_memories (key, agent_id, content, memory_type, created_at) VALUES (?, ?, ?, ?, ?)")
        .run('cog_rel_' + Date.now() + '_' + Math.random().toString(36).substring(2,8), 'system', JSON.stringify(relation), 'runtime_cognition', Date.now());
    }
  } catch(e) {}
  // 同时注入内存缓存
  if (this._entityCache) {
    this._entityCache.relations.push(relation);
  }
  return { ok: true, relation: relation };
};

// 跨 session 关联识别：从 conversations 表中按 session 分组建立跨会话链接
CognitionEngineV2.prototype._buildCrossSessionLinks = function() {
  try {
    var dbMod = require('./database');
    var db = dbMod.db();
    if (!db || typeof db.prepare !== 'function') return {};
    var convs = db.prepare("SELECT id, agent_id, role, content, session_id, created_at FROM conversations ORDER BY created_at DESC LIMIT 500").all();
    if (!Array.isArray(convs) || convs.length === 0) return {};
    var self = this;
    var sessionGroups = {};
    convs.forEach(function(c) {
      var sid = c.session_id || 'default:' + (c.agent_id || '0');
      if (!sessionGroups[sid]) sessionGroups[sid] = [];
      // 提取关键词作为实体关联
      var content = (c.content || '').toLowerCase();
      var words = content.match(/[\u4e00-\u9fa5a-zA-Z0-9_]{2,}/g) || [];
      sessionGroups[sid] = sessionGroups[sid].concat(words);
    });
    // 跨 session 共现词关联（同一关键词出现在不同 session 中）
    var crossLinks = {};
    var sessionIds = Object.keys(sessionGroups);
    sessionIds.forEach(function(sid) {
      var words = sessionGroups[sid];
      var seen = {};
      var uniqueWords = words.filter(function(w) { if (seen[w]) return false; seen[w] = true; return true; });
      uniqueWords.forEach(function(w) {
        if (!crossLinks[w]) crossLinks[w] = [];
        if (crossLinks[w].indexOf(sid) < 0) crossLinks[w].push(sid);
      });
    });
    this._crossSessionLinks = crossLinks;
    return crossLinks;
  } catch(e) {
    this._logger('[CogV2] 跨 session 构建失败: ' + e.message);
    return {};
  }
};

// 获取某个实体的跨 session 关联实体
CognitionEngineV2.prototype.getSessionRelations = function(entityLabel, options) {
  options = options || {};
  var limit = options.limit || 10;
  if (!entityLabel) return [];
  var q = entityLabel.toLowerCase().trim();
  // 先在运行时关系中查找
  var results = [];
  var self = this;
  this._relationMemory.forEach(function(r) {
    var fromMatch = r.from && r.from.indexOf(q) >= 0;
    var toMatch = r.to && r.to.indexOf(q) >= 0;
    if (fromMatch || toMatch) {
      var target = fromMatch ? r.to : r.from;
      var targetLabel = target ? target.replace(/^(agent:|task:|tag:|target:|activity:|conv:|mem:)/, '') : '';
      results.push({ entityId: target, label: targetLabel, type: r.type, weight: r.weight, learnedAt: r.learnedAt });
    }
  });
  // 跨 session 共现词关联
  var crossKeys = Object.keys(this._crossSessionLinks);
  if (crossKeys.length > 0 && this._crossSessionLinks[q]) {
    var mySessions = this._crossSessionLinks[q];
    crossKeys.forEach(function(k) {
      if (k === q) return;
      var otherSessions = self._crossSessionLinks[k];
      // 计算共享 session 的 jaccard 相似度
      var shared = mySessions.filter(function(s) { return otherSessions.indexOf(s) >= 0; });
      if (shared.length > 0) {
        var union = mySessions.length + otherSessions.length - shared.length;
        var jaccard = shared.length / (union || 1);
        if (jaccard > 0.1) {
          results.push({ entityId: k, label: k, type: 'cross_session', weight: Math.round(jaccard * 10), sessions: shared.length });
        }
      }
    });
  }
  results.sort(function(a, b) { return (b.weight || 0) - (a.weight || 0); });
  return results.slice(0, limit);
};

// 运行中自动学习：search 命中后建立查询词与实体的关联
CognitionEngineV2.prototype._autoLearnFromSearch = function(query, hitEntities) {
  if (!query || !Array.isArray(hitEntities) || hitEntities.length === 0) return;
  var self = this;
  hitEntities.slice(0, 5).forEach(function(hit) {
    if (hit.entity && hit.entity.id) {
      self.learnRelation('query:' + query.toLowerCase().replace(/\s+/g, '_'), hit.entity.id, 'auto_search', Math.min(Math.round(hit.score), 5));
    }
  });
};
    this._entityCache = { entities: entities, relations: relations, builtAt: Date.now() };
    this._initialized = true;
    this._logger('[CogV2] 知识图谱构建完成: ' + entities.length + ' 实体, ' + relations.length + ' 关联');
    return { entities: entities.length, relations: relations.length };
  } catch(e) {
    this._logger('[CogV2] 构建失败: ' + e.message);
    return { entities: 0, relations: 0, error: e.message };
  }
};

// ========== 语义搜索 ==========

CognitionEngineV2.prototype.search = function(query, options) {
  options = options || {};
  var limit = options.limit || 15;
  var minScore = options.minScore || 0;

  // 懒构建
  if (!this._initialized || !this._entityCache || Date.now() - this._lastBuild > this._cacheTTL) {
    this.buildKnowledgeGraph();
    this._lastBuild = Date.now();
  }
  // ★ 跨 session 懒构建
  if (Object.keys(this._crossSessionLinks).length === 0) {
    this._buildCrossSessionLinks();
  }
  if (!this._entityCache) return [];

  // 记录热搜
  this._hotTerms[query] = (this._hotTerms[query] || 0) + 1;

  var q = query.toLowerCase().trim();
  var keywords = q.split(/\s+/).filter(function(w){ return w.length >= 2; });
  if (keywords.length === 0) keywords = [q];

  var results = [];
  var cache = this._entityCache;
  var seen = {};

  cache.entities.forEach(function(ent) {
    var score = 0;
    var text = (ent.label + ' ' + (ent.desc || '') + ' ' + (ent.value || '') + ' ' + ent.type + ' ' + (ent.role || '') + ' ' + (ent.action || '') + ' ' + (ent.target || '') + ' ' + (ent.category || '') + ' ' + (ent.status || '')).toLowerCase();

    // 精确匹配加分
    if (text.indexOf(q) >= 0) { score += 10; }

    // 关键词匹配
    keywords.forEach(function(kw) {
      var idx = text.indexOf(kw);
      if (idx >= 0) {
        var add = 3;
        // 在标签/标题开头匹配加分
        if (idx === 0) add += 3;
        score += add;
      }
    });

    // 实体类型权重
    switch(ent.type) {
      case 'agent': score += 2; break;
      case 'task': score += 1; break;
      case 'activity': score += 0.5; break;
      case 'tag': score += 1.5; break;
      case 'conversation': score += 0.3; break;
    }

    if (score > 0 && score >= minScore) {
      results.push({ entity: ent, score: score, type: ent.type });
    }
  });

  // 排序
  // ★ 注入运行时关系评分
  var self = this;
  if (this._relationMemory.length > 0) {
    // 缓存中已有实体的 id 集合
    var entityTexts = results.map(function(r){ return (r.entity.label || '').toLowerCase(); });
    var runtimeBoost = {};
    this._relationMemory.forEach(function(rr) {
      entityTexts.forEach(function(et, idx) {
        if ((rr.from && rr.from.indexOf(et) >= 0) || (rr.to && rr.to.indexOf(et) >= 0) ||
            (rr.from && et.indexOf(rr.from.replace(/^(agent:|task:|tag:|target:|activity:|conv:|mem:)/,'')) >= 0)) {
          runtimeBoost[idx] = (runtimeBoost[idx] || 0) + rr.weight;
        }
      });
    });
    Object.keys(runtimeBoost).forEach(function(idx) {
      results[idx].score += runtimeBoost[idx];
    });
  }
  // ★ 跨 session 评分：同一实体出现在多个 session 中加分
  if (Object.keys(this._crossSessionLinks).length > 0) {
    results.forEach(function(r) {
      var label = (r.entity.label || '').toLowerCase();
      if (self._crossSessionLinks[label]) {
        var count = self._crossSessionLinks[label].length;
        if (count > 1) r.score += count * 0.5; // 每个额外 session 加 0.5 分
      }
    });
  }
  // ★ 自动学习：高频查询自动建立关联
  try {
    var hotCount = this._hotTerms[query] || 0;
    if (hotCount >= 3 && results.length > 0) {
      this._autoLearnFromSearch(query, results);
    }
  } catch(e){}

  results.sort(function(a, b) { return b.score - a.score; });
  return results.slice(0, limit);
};

// ========== 关联发现（"你可能还关心"） ==========

CognitionEngineV2.prototype.relatedTo = function(entityId, options) {
  options = options || {};
  var limit = options.limit || 8;

  if (!this._initialized || !this._entityCache) { this.buildKnowledgeGraph(); this._lastBuild = Date.now(); }

  var cache = this._entityCache;
  var directRelations = cache.relations.filter(function(r) { return r.from === entityId || r.to === entityId; });
  var relatedIds = {};
  directRelations.forEach(function(r) {
    var other = r.from === entityId ? r.to : r.from;
    relatedIds[other] = (relatedIds[other] || 0) + r.weight;
  });

  var results = [];
  Object.keys(relatedIds).forEach(function(id) {
    var ent = cache.entities.find(function(e) { return e.id === id; });
    if (ent) results.push({ entity: ent, score: relatedIds[id] });
  });

  results.sort(function(a, b) { return b.score - a.score; });
  return results.slice(0, limit);
};

// ========== 智能路由：自动选择最优认知域工具 ==========

CognitionEngineV2.prototype.smartRoute = function(query) {
  var q = query.toLowerCase();

  // 先跑语义搜索，看最佳匹配类型
  var results = this.search(q, { limit: 5, minScore: 5 });
  var typeScores = { cognition_market: 0, cognition_supply_chain: 0, cognition_knowledge_base: 0 };

  if (Array.isArray(results)) results.forEach(function(r) {
    switch(r.type) {
      case 'agent': typeScores.cognition_supply_chain += r.score * 2; break;
      case 'task': typeScores.cognition_supply_chain += r.score; break;
      case 'activity': typeScores.cognition_market += r.score * 2; break;
      case 'conversation': typeScores.cognition_knowledge_base += r.score; break;
      case 'memory': typeScores.cognition_knowledge_base += r.score; break;
      case 'tag': typeScores.cognition_knowledge_base += r.score * 0.5; typeScores.cognition_supply_chain += r.score * 0.5; break;
    }
  });

  // 关键词判定（补足冷启动场景）
  if (/(市场|行情|商业|竞争|趋势|活动|活跃|绩效|业绩|KPI)/i.test(q)) typeScores.cognition_market += 8;
  if (/(团队|员工|人员|资源|人力|组织|汇报|架构|供应链|supply)/i.test(q)) typeScores.cognition_supply_chain += 8;
  if (/(知识|学习|经验|教训|记忆|规则|规范|know|KB|知识库)/i.test(q)) typeScores.cognition_knowledge_base += 8;

  var best = 'cognition_market';
  var bestScore = 0;
  Object.keys(typeScores).forEach(function(k) {
    if (typeScores[k] > bestScore) { bestScore = typeScores[k]; best = k; }
  });

  return { tool: best, score: bestScore, breakdown: typeScores };
};

// ========== 交叉查询（跨域关联分析） ==========

CognitionEngineV2.prototype.crossDomainQuery = function(query) {
  var results = this.search(query, { limit: 20, minScore: 3 });
  if (!Array.isArray(results) || results.length === 0) return { found: false, message: '未找到关联' };

  var agents = [], tasks = [], activities = [], memories = [], tags = [];

  results.forEach(function(r) {
    switch(r.type) {
      case 'agent': agents.push(r.entity); break;
      case 'task': tasks.push(r.entity); break;
      case 'activity': activities.push(r.entity); break;
      case 'memory': memories.push(r.entity); break;
      case 'tag': tags.push(r.entity); break;
    }
  });

  // 提取跨域关联（如：某位 Agent 的任务和活动）
  var report = '## 跨域关联分析\n\n';
  if (agents.length > 0) {
    report += '### 👤 关联人员\n';
    report += '| 名称 | 角色 | 状态 |\n|------|------|------|\n';
    agents.forEach(function(a) { report += '| ' + a.label + ' | ' + (a.role || '-') + ' | ' + (a.status || '-') + ' |\n'; });
    report += '\n';
  }
  if (tasks.length > 0) {
    report += '### 📋 关联任务\n';
    report += '| 任务 | 状态 | 优先级 |\n|------|------|--------|\n';
    tasks.forEach(function(t) { report += '| ' + t.label + ' | ' + t.status + ' | ' + t.priority + ' |\n'; });
    report += '\n';
  }
  if (activities.length > 0) {
    report += '### 🔄 关联活动\n';
    report += '| 活动 | 时间 |\n|------|------|\n';
    activities.forEach(function(a) { report += '| ' + a.label + ' | ' + (a.ts || '-').substring(0, 16) + ' |\n'; });
    report += '\n';
  }
  if (memories.length > 0) {
    report += '### 💾 关联记忆\n';
    report += '| key | 内容 |\n|-----|------|\n';
    memories.forEach(function(m) { report += '| ' + m.label + ' | ' + (m.value || '').substring(0, 50) + ' |\n'; });
    report += '\n';
  }

  return { found: true, domains: Object.keys({agents: agents, tasks: tasks, activities: activities, memories: memories}).filter(function(k){ return eval(k).length > 0; }), report: report };
};

// ========== 热搜统计 ==========

CognitionEngineV2.prototype.getHotTerms = function(limit) {
  limit = limit || 10;
  var sorted = Object.keys(this._hotTerms).sort(function(a, b) { return (this._hotTerms[b] || 0) - (this._hotTerms[a] || 0); }.bind(this));
  return sorted.slice(0, limit).map(function(k) { return { term: k, count: this._hotTerms[k] }; }.bind(this));
};

// ========== 导出单例工厂 ==========

var _instance = null;
module.exports = function() {
  if (!_instance) _instance = new CognitionEngineV2();
  return _instance;
};
module.exports.CognitionEngineV2 = CognitionEngineV2;
