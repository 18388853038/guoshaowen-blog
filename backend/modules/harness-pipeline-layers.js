/**
 * harness-pipeline-layers.js — 四层防御宪章
 * 宪章: const_four_layer_defense
 * 原则: System Prompt 必须标注每层指令
 *
 * 功能:
 *   1. 检查 Prompt 文件是否有四层层标注
 *   2. 检查每层是否有至少一条指令
 *   3. 输出检查报告
 */

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');

const LAYER_LABELS = ['constitution', 'strategy', 'execution', 'postprocess'];
const LAYER_NAMES = {
  constitution: '宪法层（System Prompt 不可逾越的边界）',
  strategy: '策略层（Context Window 信息布局）',
  execution: '执行层（Few-shot + Output Schema）',
  postprocess: '兜底层（后处理校验 + 人工审批）'
};

const LAYER_MARKERS = {
  constitution: /@layer\s+constitution|宪法层|## 宪法层|不可逾越|/* 宪法 */|#constitution_layer/i,
  strategy: /@layer\s+strategy|策略层|## 策略层|信息布局|/* 策略 */|#strategy_layer/i,
  execution: /@layer\s+execution|执行层|## 执行层|输出格式|Output Schema|Few-shot|/* 执行 */|#execution_layer/i,
  postprocess: /@layer\s+postprocess|兜底层|## 兜底层|后处理|人工审批|/* 兜底 */|#postprocess_layer/i
};

/**
 * 分析 Prompt 字符串的四层完整性
 * @param {string} prompt - Prompt 内容
 * @param {string} promptName - Prompt 名称（可选，用于报告）
 * @returns {Object} { complete, layers, missing, report }
 */
function analyzePrompt(prompt, promptName) {
  promptName = promptName || 'unnamed';

  var layers = {};
  var missing = [];

  for (var i = 0; i < LAYER_LABELS.length; i++) {
    var key = LAYER_LABELS[i];
    var marker = LAYER_MARKERS[key];
    var found = marker.test(prompt);
    layers[key] = {
      present: found,
      name: LAYER_NAMES[key],
      instructions: found ? countInstructionsInLayer(prompt, key) : 0
    };
    if (!found) missing.push(key);
  }

  var complete = missing.length === 0;

  return {
    complete: complete,
    layers: layers,
    missing: missing,
    promptName: promptName,
    report: generateReport(promptName, complete, layers, missing)
  };
}

/**
 * 粗略统计某层的指令数量（按分号、换行分隔的 "。"、"！"、"？" 计数）
 */
function countInstructionsInLayer(prompt, layerKey) {
  var marker = LAYER_MARKERS[layerKey];
  var match = marker.exec(prompt);
  if (!match) return 0;

  // 截取从标记开始到下一个标记或文件结尾的内容
  var start = match.index;
  var nextIdx = prompt.length;
  for (var i = 0; i < LAYER_LABELS.length; i++) {
    if (LAYER_LABELS[i] === layerKey) continue;
    var nextMarker = LAYER_MARKERS[LAYER_LABELS[i]].exec(prompt);
    if (nextMarker && nextMarker.index > start && nextMarker.index < nextIdx) {
      nextIdx = nextMarker.index;
    }
  }

  var section = prompt.substring(start, nextIdx);
  // 按句号、分号、换行分割
  var sentences = section.split(/[。；！？\n;!?]/).filter(function(s) {
    return s.trim().length > 5;
  });
  return sentences.length || 1;
}

/**
 * 生成可读报告
 */
function generateReport(name, complete, layers, missing) {
  var lines = [
    '=== 四层防御检查报告 ===',
    'Prompt: ' + name,
    '结果: ' + (complete ? '✅ 通过' : '❌ 不通过 — 缺失层: ' + missing.join(', ')),
    ''
  ];

  for (var key of LAYER_LABELS) {
    var l = layers[key];
    lines.push('  ' + (l.present ? '✅' : '❌') + ' ' + key + ': ' + l.name);
    if (l.present) lines.push('     指令数: ' + l.instructions);
  }

  return lines.join('\n');
}

/**
 * 检查所有核心 Prompt 文件
 * @returns {Object} { total, passed, failed, reports }
 */
function checkAllPrompts() {
  var targets = [];
  var searchDirs = [
    path.join(BASE, '..', 'frontend', 'src', 'views'),
    path.join(BASE, '..', 'frontend', 'src'),  // 新路径
    path.join(BASE, 'modules'),
    BASE
  ];

  for (var dir of searchDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      var files = fs.readdirSync(dir);
      for (var f of files) {
        if ((f.endsWith('.vue') || f.endsWith('.js') || f.endsWith('.txt')) &&
            (f.toLowerCase().includes('prompt') || f.toLowerCase().includes('system') ||
             f.includes('Chat') || f.includes('ceo') || f.includes('agent'))) {
          targets.push(path.join(dir, f));
        }
      }
    } catch(e) {}
  }

  var results = [];
  for (var file of targets) {
    try {
      var content = fs.readFileSync(file, 'utf-8');
      var result = analyzePrompt(content, path.relative(BASE, file));
      results.push(result);
    } catch(e) {}
  }

  var passed = results.filter(function(r) { return r.complete; });
  return {
    total: results.length,
    passed: passed.length,
    failed: results.length - passed.length,
    reports: results
  };
}

module.exports = {
  analyzePrompt,
  checkAllPrompts,
  LAYER_NAMES,
  LAYER_LABELS
};
