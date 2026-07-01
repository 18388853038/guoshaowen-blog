// core-memory.js - 核心记忆库系统
// 为 CEO 提供结构化记忆写入、检索和版本管理
// 独立于 agent-memory（每个 Agent 的对话记忆），专门存储：
//   - 对话摘要（压缩后的）
//   - 关键决策和理由
//   - 任务记录与员工表现
//   - 系统性知识

const fs = require('fs');
const path = require('path');

// 存储路径
const MEMORY_DIR = path.join(__dirname, '..', 'memory');
const CORE_FILE = path.join(MEMORY_DIR, 'core-memory.json');
const VERSIONS_DIR = path.join(MEMORY_DIR, 'versions');

let _coreMemories = null; // 缓存

// 确保目录存在
function ensureDirs() {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
    if (!fs.existsSync(VERSIONS_DIR)) fs.mkdirSync(VERSIONS_DIR, { recursive: true });
}

// 加载核心记忆库（每次从文件读取，确保 CLI 写入实时可见）
function loadCore() {
    ensureDirs();
    try {
        var data = JSON.parse(fs.readFileSync(CORE_FILE, 'utf-8'));
        if (!Array.isArray(data)) data = [];
        _coreMemories = data;
        return data;
    } catch (e) {
        _coreMemories = [];
        return [];
    }
}

// 保存前备份版本
function backupVersion() {
    if (!fs.existsSync(CORE_FILE)) return;
    try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(VERSIONS_DIR, `core-memory-${ts}.json`);
        fs.copyFileSync(CORE_FILE, backupPath);
        // 清理旧版本（保留最近 50 个）
        const versions = fs.readdirSync(VERSIONS_DIR)
            .filter(f => f.startsWith('core-memory-'))
            .sort()
            .reverse();
        if (versions.length > 50) {
            versions.slice(50).forEach(f => {
                try { fs.unlinkSync(path.join(VERSIONS_DIR, f)); } catch(e) {}
            });
        }
    } catch(e) { /* 备份失败不影响主操作 */ }
}

// 保存核心记忆库
function saveCore() {
    backupVersion();
    fs.writeFileSync(CORE_FILE, JSON.stringify(_coreMemories, null, 2), 'utf-8');
}

function now() {
    return new Date().toISOString();
}

// ========== 工具 1：核心记忆库写入器 ==========
// 自动写入结构化记忆，无需手动确认
// 按规则：优先级高的、带标签的、结构化内容直接入核心库
async function writeMemory(params) {
    const { content, tags, timestamp, priority, type } = params;
    if (!content || typeof content !== 'string' || content.trim().length < 10) {
        return { ok: false, error: '内容太短，至少10个字符' };
    }

    const memories = loadCore();
    const entry = {
        id: 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
        content: content.trim(),
        tags: Array.isArray(tags) ? tags : (tags ? tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : []),
        timestamp: timestamp || now(),
        priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
        type: type || 'general',
        createdAt: now(),
        updatedAt: now()
    };

    // 智能去重：检查是否与已有记录相似
    var dedupResult = semanticDedup(memories, entry.content);
    if (dedupResult.isDuplicate) {
      dedupResult.existing.content += "\n---\n[" + entry.timestamp + "] " + entry.content.substring(0, 200);
      dedupResult.existing.tags = dedupResult.existing.tags.concat(entry.tags).filter(function(t,i,a){return a.indexOf(t)===i;});
      dedupResult.existing.updatedAt = entry.timestamp;
      dedupResult.existing.accessCount = (dedupResult.existing.accessCount || 0) + 1;
      // 更新后保存版本
      saveCore();
      _coreMemories = memories;
      var pct = Math.round(dedupResult.score * 100);
      return {
        ok: true,
        id: dedupResult.existing.id,
        deduplicated: true,
        similarity: pct + "%",
        message: "已合并到相似记忆(相似度" + pct + "%)",
        mergedInto: dedupResult.existing.id
      };
    }
    memories.push(entry);
    // 智能版本控制：每5次写入才创建一个版本快照
    if (memories.length % 5 === 0) {
      saveCore();
    } else {
      fs.writeFileSync(CORE_FILE, JSON.stringify(memories, null, 2), "utf-8");
    }
    _coreMemories = memories;
    // 定期压缩：每20条记录触发一次
    if (memories.length % 20 === 0 && memories.length > 50) {
      var compResult = compressMemories(memories, { maxAgeDays: 14, minCount: 3 });
      if (compResult.compressed > 0) {
        saveCore();
        _coreMemories = memories;
      }
    }

    return {
        ok: true,
        id: entry.id,
        message: `✅ 已记录【${entry.type}】记忆，优先级: ${entry.priority}`,
        entry: {
            id: entry.id,
            content: entry.content.substring(0, 80) + (entry.content.length > 80 ? '...' : ''),
            tags: entry.tags,
            priority: entry.priority,
            type: entry.type
        }
    };
}

// ========== 工具 2：核心记忆库检索器 ==========
// 支持关键词、标签、时间范围、优先级过滤和模糊搜索
async function searchMemory(params) {
    const { query, tags, type, priority, dateFrom, dateTo, limit, fuzzy } = params;
    let memories = loadCore();

    // 按关键词/语义搜索
    if (query && query.trim()) {
        const q = query.toLowerCase().trim();
        memories = memories.filter(m => {
            // 全文匹配
            const contentMatch = m.content.toLowerCase().includes(q);
            const tagMatch = m.tags.some(t => t.toLowerCase().includes(q));
            const typeMatch = m.type && m.type.toLowerCase().includes(q);
            return contentMatch || tagMatch || typeMatch;
        });
    }

    // 按标签过滤
    if (tags) {
        const tagList = Array.isArray(tags) ? tags : tags.split(/[,，]/).map(t => t.trim().toLowerCase()).filter(Boolean);
        if (tagList.length > 0) {
            memories = memories.filter(m =>
                m.tags.some(t => tagList.includes(t.toLowerCase()))
            );
        }
    }

    // 按类型过滤
    if (type) {
        const types = Array.isArray(type) ? type : [type];
        memories = memories.filter(m => types.includes(m.type));
    }

    // 按优先级过滤
    if (priority) {
        const prios = Array.isArray(priority) ? priority : [priority];
        memories = memories.filter(m => prios.includes(m.priority));
    }

    // 按时间范围过滤
    if (dateFrom) {
        const from = new Date(dateFrom).getTime();
        if (!isNaN(from)) memories = memories.filter(m => new Date(m.timestamp).getTime() >= from);
    }
    if (dateTo) {
        const to = new Date(dateTo).getTime();
        if (!isNaN(to)) memories = memories.filter(m => new Date(m.timestamp).getTime() <= to);
    }

    // 按优先级排序（high 优先），同优先级按时间降序
    const prioOrder = { high: 0, medium: 1, low: 2 };
    memories.sort((a, b) => {
        const pDiff = (prioOrder[a.priority] || 1) - (prioOrder[b.priority] || 1);
        if (pDiff !== 0) return pDiff;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    const maxResults = Math.min(limit || 20, 100);
    const results = memories.slice(0, maxResults);

    return {
        ok: true,
        total: memories.length,
        returned: results.length,
        results: results.map(e => ({
            id: e.id,
            content: e.content,
            tags: e.tags,
            type: e.type,
            priority: e.priority,
            timestamp: e.timestamp,
            createdAt: e.createdAt
        }))
    };
}

// ========== 工具 3：记忆版本管理器 ==========
// 查看版本历史、回滚到指定版本
async function manageVersions(params) {
    const { action, versionId, recordId } = params;

    ensureDirs();

    if (action === 'list') {
        // 列出所有版本
        const versions = fs.readdirSync(VERSIONS_DIR)
            .filter(f => f.startsWith('core-memory-'))
            .sort()
            .reverse()
            .map(f => {
                const stat = fs.statSync(path.join(VERSIONS_DIR, f));
                return {
                    id: f.replace('core-memory-', '').replace('.json', ''),
                    filename: f,
                    size: stat.size,
                    date: stat.mtime.toISOString()
                };
            });

        // 当前状态
        let currentCount = 0;
        try {
            const cur = JSON.parse(fs.readFileSync(CORE_FILE, 'utf-8'));
            currentCount = Array.isArray(cur) ? cur.length : 0;
        } catch(e) {}

        return {
            ok: true,
            currentVersion: {
                records: currentCount,
                lastModified: fs.existsSync(CORE_FILE) ? fs.statSync(CORE_FILE).mtime.toISOString() : null
            },
            versions: versions.slice(0, 30),
            totalVersions: versions.length
        };
    }

    if (action === 'rollback') {
        if (!versionId) return { ok: false, error: '需要 versionId 参数' };
        const verFile = path.join(VERSIONS_DIR, `core-memory-${versionId}.json`);
        if (!fs.existsSync(verFile)) {
            return { ok: false, error: `版本 ${versionId} 不存在` };
        }

        // 备份当前状态再回滚
        backupVersion();
        const data = JSON.parse(fs.readFileSync(verFile, 'utf-8'));
        fs.writeFileSync(CORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
        _coreMemories = null; // 刷新缓存

        return {
            ok: true,
            message: `✅ 已回滚到版本 ${versionId}`,
            recordsCount: Array.isArray(data) ? data.length : 0
        };
    }

    if (action === 'record_detail') {
        // 查看某条记忆的版本历史
        if (!recordId) return { ok: false, error: '需要 recordId 参数' };
        const versions = [];
        const files = fs.readdirSync(VERSIONS_DIR)
            .filter(f => f.startsWith('core-memory-'))
            .sort();
        for (const f of files) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(VERSIONS_DIR, f), 'utf-8'));
                const record = (Array.isArray(data) ? data : []).find(e => e.id === recordId);
                if (record) {
                    versions.push({
                        versionId: f.replace('core-memory-', '').replace('.json', ''),
                        record: record
                    });
                }
            } catch(e) {}
        }
        return { ok: true, recordId, versionsInHistory: versions.length, versions: versions.slice(0, 20) };
    }

    return { ok: false, error: '未知操作: ' + action + '，可用: list, rollback, record_detail' };
}

// ========== 初始化统计 ==========
function getStats() {
    const memories = loadCore();
    const stats = {
        totalRecords: memories.length,
        byType: {},
        byPriority: { high: 0, medium: 0, low: 0 },
        byTag: {}
    };
    memories.forEach(m => {
        stats.byType[m.type] = (stats.byType[m.type] || 0) + 1;
        if (m.priority) stats.byPriority[m.priority] = (stats.byPriority[m.priority] || 0) + 1;
        (m.tags || []).forEach(t => {
            stats.byTag[t] = (stats.byTag[t] || 0) + 1;
        });
    });
    return stats;
}



// ========== 语义搜索（BM25关键词相似度）========== 
// 重叠式二元分词：每个中文字作为单字token，保留英文/数字token
// 重叠式二元分词（优化版）：中文字二元+单字，英文保留词
function tokenize(text) {
    var result = [];
    var s = (text || '').toLowerCase();
    s.split(/[\s\-_.,!?，。、！？]+/).forEach(function(seg) {
        if (!seg) return;
        var engParts = seg.match(/[a-z0-9]+/g) || [];
        var zhParts = seg.match(/[\u4e00-\u9fff]+/g) || [];
        engParts.forEach(function(e) { if (e.length >= 1) result.push(e); });
        zhParts.forEach(function(z) {
            for (var i = 0; i < z.length; i++) {
                if (i + 1 < z.length) result.push(z[i] + z[i + 1]); // 二元
            }
        });
    });
    return result.filter(function(t) { return t.length > 0; });
}

function bm25Score(docTokens, queryTokens, avgdl, N, docLens, docFreqs, k1, b) {
    k1 = k1 || 1.5; b = b || 0.75;
    var score = 0;
    queryTokens.forEach(function(qt) {
        var df = docFreqs[qt] || 0;
        if (df === 0) return;
        var idf = Math.log((N - df + 0.5) / (df + 0.5));
        idf = Math.max(0, idf);
        var tf = docTokens.filter(function(t){ return t === qt; }).length;
        var docLen = docTokens.length;
        var numer = tf * (k1 + 1);
        var denom = tf + k1 * (1 - b + b * docLen / avgdl);
        score += idf * numer / denom;
    });
    return score;
}

function semanticSearch(query, options) {
    options = options || {};
    var k = Math.min(options.k || 5, 20);
    var memories = loadCore();
    if (!memories || memories.length === 0) return { ok: true, results: [], total: 0 };
    var qt = tokenize(query);
    if (qt.length === 0) return { ok: true, results: [], total: 0 };
    var N = memories.length;
    var docFreqs = {};
    var docLens = [];
    memories.forEach(function(m) {
        var toks = tokenize(m.content);
        m._toks = toks;
        docLens.push(toks.length || 1);
        toks.forEach(function(t){ docFreqs[t] = (docFreqs[t] || 0) + 1; });
    });
    var avgdl = docLens.reduce(function(a,b){ return a+b; }, 0) / N;
    var scores = memories.map(function(m, i) {
        return { idx: i, score: bm25Score(m._toks, qt, avgdl, N, docLens, docFreqs) };
    });
    scores.sort(function(a,b){ return b.score - a.score; });
    var top = scores.slice(0, k).filter(function(s){ return s.score >= 0.01; });
    var results = top.map(function(s) {
        var m = memories[s.idx];
        return { id: m.id, content: m.content, tags: m.tags, type: m.type, priority: m.priority, timestamp: m.timestamp, score: Math.round(s.score*1000)/1000 };
    });
    memories.forEach(function(m){ delete m._toks; });
    return { ok: true, query: query, results: results, total: N, returned: results.length };
}



// ========== 智能压缩 ==========

/**
 * 语义去重：检查新内容是否与已有记录相似
 * 如果相似度超过阈值，合并到已有记录而非新建
 */
function semanticDedup(memories, newContent) {
  var threshold = 0.6;
  var maxSimilar = null;
  var maxScore = 0;
  memories.forEach(function(m) {
    var score = similarity(m.content, newContent);
    if (score > maxScore) { maxScore = score; maxSimilar = m; }
  });
  if (maxSimilar && maxScore >= threshold) {
    return { isDuplicate: true, existing: maxSimilar, score: maxScore };
  }
  return { isDuplicate: false };
}

/**
 * 相似度计算：基于共有词比例（Jaccard 相似度）
 */
function similarity(a, b) {
  var toksA = tokenize(a || '');
  var toksB = tokenize(b || '');
  if (toksA.length === 0 || toksB.length === 0) return 0;
  var setA = {}; toksA.forEach(function(t) { setA[t] = true; });
  var setB = {}; toksB.forEach(function(t) { setB[t] = true; });
  var intersect = 0; var union = 0;
  Object.keys(setA).forEach(function(k) {
    if (setB[k]) intersect++;
    union++;
  });
  Object.keys(setB).forEach(function(k) {
    if (!setA[k]) union++;
  });
  return union > 0 ? intersect / union : 0;
}

/**
 * 摘要压缩：将多条低优先级/旧的相关记忆压缩成一条摘要
 * 按时间窗口和类型分组
 */
function compressMemories(memories, options) {
  options = options || {};
  var maxAgeDays = options.maxAgeDays || 7;
  var minCount = options.minCount || 3;
  var now = Date.now();
  var cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
  var oldEntries = memories.filter(function(m) {
    return new Date(m.timestamp || m.createdAt || now).getTime() < cutoff && m.priority !== 'high';
  });
  if (oldEntries.length < minCount) return { compressed: 0 };
  var groups = {};
  oldEntries.forEach(function(m) {
    var key = m.type || 'general';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });
  var compressed = 0;
  Object.keys(groups).forEach(function(key) {
    var entries = groups[key];
    if (entries.length < minCount) return;
    var summaries = entries.map(function(e) { return '[' + e.priority + '] ' + (e.content || '').substring(0, 100); }).join('\n');
    var summaryEntry = {
      id: 'sum_' + Date.now().toString(36),
      content: '【压缩摘要 - ' + key + '】共' + entries.length + '条记忆\n' + summaries,
      tags: [key, 'compressed', 'summary'],
      type: 'compressed_' + key,
      priority: 'low',
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      compressedFrom: entries.length
    };
    entries.forEach(function(e) {
      var idx = memories.indexOf(e);
      if (idx >= 0) memories.splice(idx, 1);
    });
    memories.push(summaryEntry);
    compressed += entries.length;
  });
  return { compressed: compressed, remaining: memories.length };
}


module.exports = {
    writeMemory,
    searchMemory,
    manageVersions,
    getStats,
    semanticDedup,
    similarity,
    compressMemories,
    // 内部使用
    loadCore,
    CORE_FILE,
    semanticSearch,
    tokenize
};
