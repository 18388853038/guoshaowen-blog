/**
 * memory-graph.js — 记忆图谱系统（实体-关系-语义搜索）
 *
 * 在 core-memory.js 基础上叠加：
 * 1. 实体提取：从记忆文本中抽取命名实体（人、项目、决策、标签）
 * 2. 关系图谱：实体之间的关联关系，形成知识图谱
 * 3. 语义搜索：基于关键词权重（TF-IDF 简化版）的语义匹配
 *
 * 数据存储：F:/eCompanyClaw/backend/data/memory-graph.json
 */

const fs = require('fs');
const path = require('path');

const GRAPH_FILE = path.join(__dirname, '..', 'data', 'memory-graph.json');

// ========== 实体类型 ==========
const ENTITY_TYPES = {
  person: '人员',
  project: '项目',
  decision: '决策',
  task: '任务',
  skill: '技能',
  technology: '技术',
  concept: '概念',
  tool: '工具',
  event: '事件',
};

// ========== 关系类型 ==========
const RELATION_TYPES = {
  responsible: { label: '负责', reverse: '由...负责' },
  participates: { label: '参与', reverse: '参与了' },
  uses: { label: '使用', reverse: '被用于' },
  depends: { label: '依赖', reverse: '被依赖' },
  leads_to: { label: '导致', reverse: '源于' },
  part_of: { label: '属于', reverse: '包含' },
  related: { label: '关联', reverse: '关联' },
  created: { label: '创建了', reverse: '由...创建' },
  assigned: { label: '分配了', reverse: '分配给' },
  referenced: { label: '引用', reverse: '被引用' },
};

// ========== 数据存储 ==========
class MemoryGraph {
  constructor() {
    this.entities = new Map();   // id → Entity
    this.relations = [];         // [{ from, type, to, metadata }]
    this.termIndex = new Map();  // term → Set<entityId> (全文索引)
    this._dirty = false;
    this._load();
  }

  // ========== 持久化 ==========
  _load() {
    try {
      if (!fs.existsSync(GRAPH_FILE)) return;
      var data = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf-8'));
      if (data.entities) {
        for (var e of data.entities) {
          this.entities.set(e.id, e);
          // 重建全文索引
          this._indexEntity(e);
        }
      }
      if (data.relations) this.relations = data.relations;
    } catch(e) {
      console.log('[MemGraph] 加载失败:', e.message);
    }
  }

  _save() {
    try {
      var dir = path.dirname(GRAPH_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(GRAPH_FILE, JSON.stringify({
        entities: Array.from(this.entities.values()),
        relations: this.relations,
        updatedAt: new Date().toISOString(),
      }, null, 2), 'utf-8');
      this._dirty = false;
    } catch(e) {
      console.log('[MemGraph] 保存失败:', e.message);
    }
  }

  _markDirty() {
    this._dirty = true;
    // 延迟保存（100ms 内多次修改合并为一次写）
    if (!this._saveTimer) {
      this._saveTimer = setTimeout(function(self) {
        self._save();
        self._saveTimer = null;
      }, 100, this);
    }
  }

  // ========== 全文索引 ==========
  _extractTerms(text) {
    if (!text) return [];
    var terms = [];
    // 提取英文单词
    var enWords = text.match(/[a-zA-Z_][a-zA-Z0-9_-]{1,}/g) || [];
    for (var w of enWords) terms.push(w.toLowerCase());
    // 提取中文词语（2-6字）
    var cnChars = text.match(/[\u4e00-\u9fff]{2,6}/g) || [];
    for (var c of cnChars) terms.push(c);
    // 提取标签
    var tags = text.match(/#[\u4e00-\u9fff\w-]+/g) || [];
    for (var t of tags) terms.push(t.toLowerCase());
    return [...new Set(terms)];
  }

  _indexEntity(entity) {
    var texts = [entity.name, entity.description || '', entity.tags ? entity.tags.join(' ') : ''].filter(Boolean);
    var terms = [];
    for (var t of texts) terms = terms.concat(this._extractTerms(t));
    for (var term of new Set(terms)) {
      if (!this.termIndex.has(term)) this.termIndex.set(term, new Set());
      this.termIndex.get(term).add(entity.id);
    }
  }

  // ========== 实体操作 ==========
  addEntity(type, name, options = {}) {
    var id = options.id || (type + ':' + name.toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff]/g, '_'));
    if (this.entities.has(id)) {
      // 更新
      var existing = this.entities.get(id);
      if (options.description) existing.description = options.description;
      if (options.tags) existing.tags = [...new Set([...(existing.tags || []), ...options.tags])];
      if (options.metadata) existing.metadata = { ...existing.metadata, ...options.metadata };
      existing.updatedAt = new Date().toISOString();
      this._markDirty();
      return existing;
    }

    var entity = {
      id,
      type,
      name,
      description: options.description || '',
      tags: options.tags || [],
      metadata: options.metadata || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.entities.set(id, entity);
    this._indexEntity(entity);
    this._markDirty();
    return entity;
  }

  getEntity(id) {
    return this.entities.get(id) || null;
  }

  searchEntities(query) {
    var terms = this._extractTerms(query);
    if (terms.length === 0) return [];

    // 计算每个实体匹配的 term 数
    var scores = new Map();
    for (var term of terms) {
      var matched = this.termIndex.get(term);
      if (matched) {
        for (var eid of matched) {
          scores.set(eid, (scores.get(eid) || 0) + 1);
        }
      }
    }

    // 按匹配度排序
    return Array.from(scores.entries())
      .sort(function(a, b) { return b[1] - a[1]; })
      .map(function(e) {
        var entity = this.entities.get(e[0]);
        return entity ? { ...entity, _score: e[1] / terms.length } : null;
      }.bind(this))
      .filter(Boolean);
  }

  getAllEntities(options = {}) {
    var type = options.type;
    var result = [];
    for (var entity of this.entities.values()) {
      if (type && entity.type !== type) continue;
      result.push(entity);
    }
    return result;
  }

  getStats() {
    var typeCounts = {};
    for (var entity of this.entities.values()) {
      typeCounts[entity.type] = (typeCounts[entity.type] || 0) + 1;
    }
    return {
      totalEntities: this.entities.size,
      totalRelations: this.relations.length,
      typeCounts,
      indexedTerms: this.termIndex.size,
    };
  }

  // ========== 关系操作 ==========
  addRelation(fromId, type, toId, metadata = {}) {
    if (!this.entities.has(fromId)) throw new Error('源实体不存在: ' + fromId);
    if (!this.entities.has(toId)) throw new Error('目标实体不存在: ' + toId);

    var rel = {
      id: 'rel:' + fromId + ':' + type + ':' + toId + ':' + Date.now(),
      from: fromId,
      type,
      to: toId,
      metadata,
      createdAt: new Date().toISOString(),
    };
    this.relations.push(rel);
    this._markDirty();
    return rel;
  }

  getRelations(entityId) {
    return this.relations.filter(function(r) {
      return r.from === entityId || r.to === entityId;
    });
  }

  // ========== 自动从记忆文本中抽取实体和关系 ==========
  /**
   * 从文本中提取实体和关系
   * 简单规则：查找常见的实体模式
   */
  extractFromText(text, source = 'auto') {
    if (!text) return { entities: [], relations: [] };
    var results = { entities: [], relations: [] };

    // 提取 #标签 作为概念实体
    var tagMatches = text.match(/#([\u4e00-\u9fff\w-]+)/g);
    if (tagMatches) {
      for (var t of tagMatches) {
        var tagName = t.substring(1);
        var entity = this.addEntity('concept', tagName, {
          tags: ['auto-extracted'],
          metadata: { source, extractedFrom: text.substring(0, 100) },
        });
        results.entities.push(entity);
      }
    }

    // 提取“某人”模式（如 "张三说"、"老板要求"）
    var personPats = text.match(/([^\s，。！？]{2,4})(?:说|要求|提出|决定|建议|负责|汇报)/g);
    if (personPats) {
      for (var p of personPats) {
        var pName = p.substring(0, p.length - 1);
        if (pName.length < 2) continue;
        var entity = this.addEntity('person', pName, {
          tags: ['auto-extracted'],
          metadata: { source },
        });
        results.entities.push(entity);
      }
    }

    // 提取项目/功能名称（引号内的中文词）
    var quotePats = text.match(/[「『""]([\u4e00-\u9fff\w-]{2,20})[」』""]/g);
    if (quotePats) {
      for (var q of quotePats) {
        var qName = q.replace(/[「『""」』""]/g, '');
        var entity = this.addEntity('project', qName, {
          tags: ['auto-extracted'],
          metadata: { source },
        });
        results.entities.push(entity);
      }
    }

    return results;
  }

  /**
   * 从记忆库批量导入
   */
  importFromCoreMemory(coreMemItems) {
    if (!coreMemItems || !Array.isArray(coreMemItems)) return { imported: 0 };
    var count = 0;
    for (var item of coreMemItems) {
      var texts = [];
      if (item.content) texts.push(item.content);
      if (item.decision) texts.push(item.decision);
      if (item.reason) texts.push(item.reason);
      var fullText = texts.join(' ');
      if (fullText) {
        var result = this.extractFromText(fullText, 'core-memory');
        count += result.entities.length;
      }
    }
    return { imported: count };
  }

  /** 语义搜索（升级版） */
  semanticSearch(query, options = {}) {
    var results = this.searchEntities(query);
    
    // 如果找到实体，也返回关联关系
    if (results.length > 0 && options.includeRelations) {
      var top = results.slice(0, 5);
      for (var r of top) {
        r.relations = this.getRelations(r.id);
      }
    }

    return results.slice(0, options.limit || 20);
  }

  /** 获取实体图谱子图（以某个实体为中心的关联网络） */
  getSubgraph(entityId, depth = 1) {
    if (!this.entities.has(entityId)) return null;
    var visited = new Set();
    var nodes = [];
    var edges = [];

    function traverse(id, d) {
      if (visited.has(id) || d > depth) return;
      visited.add(id);
      var entity = this.entities.get(id);
      if (entity) nodes.push(entity);

      var rels = this.relations.filter(function(r) { return r.from === id || r.to === id; });
      for (var rel of rels) {
        edges.push(rel);
        var other = rel.from === id ? rel.to : rel.from;
        traverse.call(this, other, d + 1);
      }
    }

    traverse.call(this, entityId, 0);
    return { nodes, edges };
  }
}

// ========== 单例 ==========
var instance = new MemoryGraph();

// 每 5 分钟持久化一次（兜底）
setInterval(function() {
  if (instance._dirty) instance._save();
}, 5 * 60 * 1000).unref();

module.exports = {
  instance,
  MemoryGraph,
  ENTITY_TYPES,
  RELATION_TYPES,
};
