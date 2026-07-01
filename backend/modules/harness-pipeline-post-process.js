/**
 * harness-pipeline-post-process.js — 容忍阈值宪章
 * 宪章: const_tolerance_threshold
 * 原则: 微小偏差不值得 Re-prompt，直接在后处理纠正
 *
 * 功能:
 *   1. 注册后处理函数
 *   2. postProcess() 管道纠正常见输出偏差
 *   3. 记录后处理命中次数（超过 3 次提示 Prompt 可能过宽）
 */

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');
const POST_PROCESS_HISTORY_FILE = path.join(BASE, 'post-process-history.json');

// 内置后处理器
var builtinProcessors = [];

// 注册函数
function registerProcessor(name, fn, description) {
  if (typeof fn !== 'function') return false;
  builtinProcessors.push({
    name: name,
    fn: fn,
    description: description || '',
    registeredAt: Date.now(),
    hits: 0
  });
  return true;
}

// 统计跟踪
var processorHits = {};

/**
 * 加载历史
 */
function loadHistory() {
  try {
    if (fs.existsSync(POST_PROCESS_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(POST_PROCESS_HISTORY_FILE, 'utf-8'));
    }
  } catch(e) {}
  return {};
}

/**
 * 保存历史
 */
function saveHistory(history) {
  try {
    fs.mkdirSync(path.dirname(POST_PROCESS_HISTORY_FILE), { recursive: true });
    fs.writeFileSync(POST_PROCESS_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch(e) {}
}

/**
 * 注册内置后处理器
 */
function initBuiltinProcessors() {
  // 1. 修复 AI 输出中常见的多余空行
  registerProcessor('fix_excessive_blank_lines', function(text) {
    if (!text) return text;
    return text.replace(/\n{3,}/g, '\n\n');
  }, '将连续 3 个以上空行压缩为 1 个空行');

  // 2. 修复标点符号（中英文混用）
  registerProcessor('fix_punctuation', function(text) {
    if (!text) return text;
    return text
      .replace(/，/g, '，').replace(/。/g, '。').replace(/；/g, '；')
      .replace(/：/g, '：').replace(/？/g, '？').replace(/！/g, '！')
      .replace(/……{2,}/g, '……')
      .replace(/(\d+)\.(\d+)/g, '$1.$2'); // 保留数字间的小数点
  }, '统一中英文标点符号（确保中文标点正确）');

  // 3. 修复 Markdown 列表格式
  registerProcessor('fix_markdown_lists', function(text) {
    if (!text) return text;
    return text
      .replace(/^(\s*)[*•]\s/gm, '$1- ')
      .replace(/^(\s*)\d\)\s/gm, '$11. ');
  }, '统一 Markdown 列表格式（* → -，数字) → 数字.）');

  // 4. 修复 JSON 在 Markdown 中的格式
  registerProcessor('fix_inline_json', function(text) {
    if (!text) return text;
    // 如果代码块中的 JSON 前有多余文字，保留代码块
    return text;
  }, '确保 JSON 代码块格式正确（预留）');

  // 5. 去除多余的引用标记
  registerProcessor('remove_excessive_quotes', function(text) {
    if (!text) return text;
    return text.replace(/^>\s{3,}/gm, '> ');
  }, '修复 Markdown 引用格式中多余空格');
}

// 初始化
initBuiltinProcessors();

/**
 * 运行后处理管道
 * @param {string} text - AI 原始输出
 * @param {string} promptId - 原始 Prompt 标识（用于频率跟踪）
 * @returns {Object} { text, hits, processors }
 */
function postProcess(text, promptId) {
  if (!text) return { text: text, hits: [], processors: [] };

  promptId = promptId || '__default__';
  var history = loadHistory();
  if (!history[promptId]) history[promptId] = { hits: 0, processorDetails: {} };

  var hits = [];
  var processors = [];
  var currentText = text;

  for (var proc of builtinProcessors) {
    var before = currentText;
    currentText = proc.fn(currentText);
    if (currentText !== before) {
      proc.hits = (proc.hits || 0) + 1;
      processors.push({
        name: proc.name,
        description: proc.description,
        hitCount: proc.hits
      });
      hits.push(proc.name);

      // 记录历史
      history[promptId].hits++;
      if (!history[promptId].processorDetails[proc.name]) {
        history[promptId].processorDetails[proc.name] = 0;
      }
      history[promptId].processorDetails[proc.name]++;
    }
  }

  // 检查同一个 prompt 上是否触发超过 3 次（提示可能需要调整 Prompt）
  var warning = null;
  if (history[promptId].processorDetails) {
    var totalHits = Object.values(history[promptId].processorDetails).reduce(function(a, b) { return a + b; }, 0);
    if (totalHits > 3) {
      warning = '同一个 Prompt "' + promptId + '" 上后处理已触发 ' + totalHits + ' 次。建议检查 Prompt 是否过于宽泛。';
    }
  }

  saveHistory(history);

  return {
    text: currentText,
    hits: hits,
    processors: processors,
    changed: hits.length > 0,
    warning: warning
  };
}

/**
 * 获取后处理统计
 */
function getStats() {
  var history = loadHistory();
  var totalPrompts = Object.keys(history).length;
  var totalHits = 0;
  var topPrompts = [];

  for (var pid of Object.keys(history)) {
    var h = history[pid];
    totalHits += h.hits || 0;
    topPrompts.push({ promptId: pid, hits: h.hits || 0 });
  }

  topPrompts.sort(function(a, b) { return b.hits - a.hits; });

  return {
    registeredProcessors: builtinProcessors.length,
    totalPrompts: totalPrompts,
    totalHits: totalHits,
    topPrompts: topPrompts.slice(0, 10),
    processorStats: builtinProcessors.map(function(p) {
      return { name: p.name, description: p.description, hits: p.hits || 0 };
    })
  };
}

module.exports = {
  registerProcessor,
  postProcess,
  getStats,
  builtinProcessors: builtinProcessors
};
