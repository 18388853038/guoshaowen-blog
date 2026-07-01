/**
 * harness-pipeline-context.js — 渐进上下文宪章
 * 宪章: const_progressive_context
 * 原则: 只提供最小定向信息，避免信息过载
 *
 * 功能:
 *   1. 分析 context 总 token 数，超过窗口 40% 时触发分层摘要
 *   2. 提供 context-info 摘要工具（替代直接灌日志）
 *   3. 记录每次 context 大小到 traces
 */

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');

// token 估算：中英文混合按 1.5 char/token，纯英文按 4 char/token
function estimateTokens(str) {
  if (!str) return 0;
  var ascii = 0, nonAscii = 0;
  for (var i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) < 128) ascii++;
    else nonAscii++;
  }
  return Math.ceil(ascii / 4) + Math.ceil(nonAscii * 1.5);
}

/**
 * 分析 context 是否超出阈值
 * @param {string} contextStr - 要传递给模型的 context 文本
 * @param {number} contextWindow - 模型上下文窗口大小（默认 8192）
 * @param {number} threshold - 触发摘要的百分比阈值（默认 0.4 = 40%）
 * @returns {Object} { safe, tokenCount, windowSize, ratio, summary, layers }
 */
function analyzeContext(contextStr, contextWindow, threshold) {
  contextWindow = contextWindow || 8192;
  threshold = threshold || 0.4;
  var tokenCount = estimateTokens(contextStr);
  var ratio = tokenCount / contextWindow;

  var result = {
    safe: ratio <= threshold,
    tokenCount: tokenCount,
    windowSize: contextWindow,
    ratio: Math.round(ratio * 1000) / 1000,
    threshold: threshold,
    summary: null,
    layers: null
  };

  if (!result.safe) {
    result.summary = generateLayeredSummary(contextStr, 3);
    result.layers = {
      total: result.summary ? result.summary.length : 0,
      recommended: 3
    };
  }

  return result;
}

/**
 * 生成分层摘要
 * layer 1: 核心意图（1-2句）
 * layer 2: 关键数据点
 * layer 3: 完整上下文指针
 */
function generateLayeredSummary(text, maxLayers) {
  maxLayers = maxLayers || 3;
  var layers = [];
  var lines = text.split('\n').filter(Boolean);

  // Layer 1: 前 5 行或 200 字符的内容
  var layer1 = lines.slice(0, 5).join('\n');
  if (layer1.length > 200) layer1 = layer1.substring(0, 200) + '...';
  layers.push({ layer: 1, label: '核心意图', content: layer1 || '(空)' });

  if (maxLayers >= 2) {
    // Layer 2: 识别关键行（包含数字/重要关键词的行）
    var keyLines = lines.filter(function(l) {
      return /\d+|[重|关键|强制|必须|禁止|项目|任务|配置]/g.test(l);
    });
    var layer2 = keyLines.slice(0, 10).join('\n');
    if (layer2.length > 500) layer2 = layer2.substring(0, 500) + '...';
    layers.push({ layer: 2, label: '关键数据点', content: layer2 || '(无关键数据点)' });
  }

  if (maxLayers >= 3) {
    // Layer 3: 总长度统计 + 指针
    layers.push({
      layer: 3,
      label: '上下文指针',
      content: '原始上下文共 ' + text.length + ' 字符（约 ' + estimateTokens(text) + ' tokens），'
        + lines.length + ' 行。参考文件位置：如上所示。'
    });
  }

  return layers;
}

/**
 * 记录 context 使用情况到 traces
 */
function recordContextTrace(agentId, result) {
  try {
    var tracesPath = path.join(BASE, 'agent-traces.jsonl');
    var entry = {
      ts: Date.now(),
      type: 'context_check',
      agentId: agentId || 'unknown',
      safe: result.safe,
      tokenCount: result.tokenCount,
      windowSize: result.windowSize,
      ratio: result.ratio
    };
    fs.appendFileSync(tracesPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {}
}

module.exports = {
  estimateTokens,
  analyzeContext,
  generateLayeredSummary,
  recordContextTrace
};
