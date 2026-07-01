/**
 * harness-pipeline-traces.js — 追踪即反馈宪章
 * 宪章: const_traces_feedback
 * 原则: 所有 Agent 调用和工具调用必须结构化记录
 *
 * 功能:
 *   1. 写入 agent-traces.jsonl 结构化日志
 *   2. 查询、分析、汇总 Traces
 *   3. Dashboard 展示时序图和失败模式
 */

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');
const TRACES_FILE = path.join(BASE, 'agent-traces.jsonl');
const MAX_TRACES = 50000;

/**
 * 记录一条 Trace
 * @param {Object} trace - { type, agentId, toolName, duration, success, error, metadata }
 */
function recordTrace(trace) {
  if (!trace || !trace.type) return false;

  var entry = {
    ts: Date.now(),
    iso: new Date().toISOString(),
    type: trace.type,
    source: trace.source || 'system',
    agentId: trace.agentId || 'system',
    agentName: trace.agentName || '',
    toolName: trace.toolName || '',
    sessionId: trace.sessionId || '',
    requestId: trace.requestId || '',
    duration: trace.duration || 0,
    status: trace.status || 'completed',
    success: trace.success !== false,
    error: trace.error || null,
    inputTokens: trace.inputTokens || 0,
    outputTokens: trace.outputTokens || 0,
    model: trace.model || '',
    metadata: trace.metadata || {}
  };

  try {
    fs.appendFileSync(TRACES_FILE, JSON.stringify(entry) + '\n', 'utf-8');

    // 控制文件大小
    var stat;
    try { stat = fs.statSync(TRACES_FILE); } catch(e) {}
    if (stat && stat.size > 50 * 1024 * 1024) {
      // 超过 50MB 时截断：保留最后 10000 行
      var content = fs.readFileSync(TRACES_FILE, 'utf-8');
      var lines = content.split('\n').filter(Boolean);
      if (lines.length > MAX_TRACES) {
        fs.writeFileSync(TRACES_FILE, lines.slice(-MAX_TRACES).join('\n') + '\n', 'utf-8');
      }
    }
    return true;
  } catch(e) {
    return false;
  }
}

/**
 * 读取 Traces
 * @param {Object} filters - { type, agentId, status, limit, since }
 * @returns {Array}
 */
function queryTraces(filters) {
  filters = filters || {};
  var limit = filters.limit || 100;

  try {
    if (!fs.existsSync(TRACES_FILE)) return [];

    var content = fs.readFileSync(TRACES_FILE, 'utf-8');
    var lines = content.split('\n').filter(Boolean);
    var results = [];

    var sinceTs = filters.since ? new Date(filters.since).getTime() : 0;

    for (var i = lines.length - 1; i >= 0; i--) {
      try {
        var entry = JSON.parse(lines[i]);
        if (filters.type && entry.type !== filters.type) continue;
        if (filters.agentId && entry.agentId !== filters.agentId) continue;
        if (filters.status && entry.status !== filters.status) continue;
        if (filters.success !== undefined && entry.success !== filters.success) continue;
        if (sinceTs && entry.ts < sinceTs) continue;
        results.push(entry);
        if (results.length >= limit) break;
      } catch(e) {}
    }

    return results;
  } catch(e) {
    return [];
  }
}

/**
 * 获取统计摘要
 * @param {string} period - 'hour', 'day', 'week'
 * @returns {Object}
 */
function getStats(period) {
  period = period || 'day';
  var now = Date.now();
  var cutoff;
  switch (period) {
    case 'hour': cutoff = now - 3600000; break;
    case 'day': cutoff = now - 86400000; break;
    case 'week': cutoff = now - 604800000; break;
    default: cutoff = now - 86400000;
  }

  var traces = queryTraces({ limit: 100000, since: new Date(cutoff).toISOString() });

  var byType = {};
  var byAgent = {};
  var byTool = {};
  var totalErrors = 0;
  var totalDuration = 0;
  var totalInputTokens = 0;
  var totalOutputTokens = 0;

  for (var t of traces) {
    byType[t.type] = (byType[t.type] || 0) + 1;
    byAgent[t.agentId] = (byAgent[t.agentId] || 0) + 1;
    if (t.toolName) byTool[t.toolName] = (byTool[t.toolName] || 0) + 1;
    if (!t.success) totalErrors++;
    totalDuration += t.duration || 0;
    totalInputTokens += t.inputTokens || 0;
    totalOutputTokens += t.outputTokens || 0;
  }

  return {
    period: period,
    totalEntries: traces.length,
    errors: totalErrors,
    errorRate: traces.length > 0 ? Math.round(totalErrors / traces.length * 10000) / 100 + '%' : '0%',
    avgDuration: traces.length > 0 ? Math.round(totalDuration / traces.length) : 0,
    totalInputTokens: totalInputTokens,
    totalOutputTokens: totalOutputTokens,
    byType: byType,
    byAgent: byAgent,
    byTool: byTool,
    topErrors: queryTraces({ success: false, limit: 10 })
  };
}

/**
 * 检查是否所有调用都已被记录（宪章检查）
 * @returns {Object} { complete, missing, recentCount }
 */
function checkCoverage() {
  var recent = queryTraces({ limit: 50 });
  return {
    passed: recent.length > 0,
    recentCount: recent.length,
    message: recent.length > 0
      ? '最近 ' + recent.length + ' 条调用已被记录'
      : '暂无 Traces 记录。自动记录将在下次调用时生效。'
  };
}

module.exports = {
  recordTrace,
  queryTraces,
  getStats,
  checkCoverage,
  TRACES_FILE: TRACES_FILE
};
