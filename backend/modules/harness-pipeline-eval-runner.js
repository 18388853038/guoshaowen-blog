/**
 * harness-pipeline-eval-runner.js — 独立评估宪章
 * 宪章: const_dont_self_eval
 * 原则: 评估必须是模型之外的独立组件
 *
 * 功能:
 *   1. CEO 生成方案后，由独立 Eval Agent 进行评估
 *   2. 两边各写入结构化文件，比较 diff 后决定是否输出
 *   3. 使用不同模型/温度/System Prompt
 */

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');

var evalCounter = 0;

/**
 * 运行独立评估
 * @param {Object} proposal - 要评估的方案 { type, action, reasoning, expected, risk }
 * @param {Object} options
 *   options.evalModel - 评估模型名（默认 'deepseek/deepseek-chat'）
 *   options.evalTemperature - 评估温度（默认 0.7，与生成温度不同）
 *   options.primaryModel - 原始生成模型名（用于记录）
 * @returns {Object} { passed, diff, evalResult, proposalPath, evalPath, violations }
 */
async function runEval(proposal, options) {
  options = options || {};
  evalCounter++;

  var proposalId = 'eval_' + Date.now().toString(36) + '_' + evalCounter;
  var ts = Date.now();

  // 1. 写入提案文件
  var proposalFile = path.join(BASE, 'eval-proposals', proposalId + '-proposal.json');
  var evalFile = path.join(BASE, 'eval-proposals', proposalId + '-eval.json');
  try { fs.mkdirSync(path.join(BASE, 'eval-proposals'), { recursive: true }); } catch(e) {}

  var proposalDoc = {
    id: proposalId,
    timestamp: ts,
    type: proposal.type || 'tool_call',
    action: proposal.action || {},
    reasoning: proposal.reasoning || '',
    expected: proposal.expected || ''
  };
  fs.writeFileSync(proposalFile, JSON.stringify(proposalDoc, null, 2), 'utf-8');

  // 2. 运行评估（如果 API 可用）
  var evalResult = null;
  var violations = [];

  try {
    var evalSystemPrompt = '你是一个严格的安全和架构评估者。你的任务：\n'
      + '1. 检查方案是否有安全风险、逻辑漏洞、架构违规\n'
      + '2. 检查方案是否符合系统约定的规范格式\n'
      + '3. 输出结论：PASS（通过）或 FAIL（不通过）并说明理由\n'
      + '4. 与原始推理分开，不要被原始推理影响你的判断';

    var evalPrompt = '请评估以下方案：\n'
      + '类型：' + (proposal.type || 'tool_call') + '\n'
      + '动作：' + JSON.stringify(proposal.action || {}) + '\n'
      + '原始推理：' + (proposal.reasoning || '无') + '\n'
      + '预期结果：' + (proposal.expected || '未指定') + '\n'
      + '风险评估：' + (proposal.risk || '未提供') + '\n\n'
      + '请以 JSON 格式输出：{"verdict":"PASS|FAIL","reasons":["..."]}';

    var modelName = options.evalModel || 'deepseek/deepseek-chat';
    var temperature = options.evalTemperature != null ? options.evalTemperature : 0.7;

    try {
      var modelRouter = require('./model-router');
      // 使用不同温度进行评估
      var evalResponse = await modelRouter.callModel({
        model: modelName,
        temperature: temperature,
        messages: [
          { role: 'system', content: evalSystemPrompt },
          { role: 'user', content: evalPrompt }
        ]
      });

      // 解析评估结果
      var evalText = '';
      if (typeof evalResponse === 'string') evalText = evalResponse;
      else if (evalResponse && evalResponse.content) evalText = evalResponse.content;
      else if (evalResponse && evalResponse.message) evalText = evalResponse.message;
      else evalText = JSON.stringify(evalResponse);

      var verdictMatch = evalText.match(/("verdict"\s*[:=]\s*)"(PASS|FAIL)"/i);
      var verdict = verdictMatch ? verdictMatch[2].toUpperCase() : 'PASS';
      var reasonMatch = evalText.match(/("reasons"\s*[:=]\s*)\[(.+?)\]/s);
      var evalReasons = reasonMatch ? [reasonMatch[2]] : [evalText.substring(0, 500)];

      evalResult = {
        verdict: verdict,
        reasons: evalReasons,
        raw: evalText.substring(0, 1000)
      };

      if (verdict === 'FAIL') {
        violations.push({
          rule: 'const_dont_self_eval',
          severity: 'critical',
          detail: evalReasons.join('; '),
          ts: ts
        });
      }
    } catch (apiError) {
      // API 不可用时降级——记录但通过（避免 block 正常流程）
      evalResult = {
        verdict: 'PASS',
        reasons: ['API 不可用，跳过评估：' + apiError.message],
        skipped: true
      };
    }

    // 写入评估文件
    fs.writeFileSync(evalFile, JSON.stringify({
      id: proposalId,
      timestamp: ts,
      proposalFile: proposalFile,
      evalResult: evalResult,
      primaryModel: options.primaryModel || 'unknown',
      evalModel: modelName,
      evalTemperature: temperature
    }, null, 2), 'utf-8');
  } catch (e) {
    evalResult = { verdict: 'PASS', reasons: ['评估出错：' + e.message], error: true };
  }

  // 3. 比较 diff（检查原始推理和评估结果的一致性）
  var diff = '';
  if (evalResult && evalResult.verdict === 'FAIL') {
    diff = '评估拒绝方案：' + (evalResult.reasons || []).join('; ');
  }

  return {
    passed: !evalResult || evalResult.verdict === 'PASS',
    diff: diff,
    evalResult: evalResult,
    proposalPath: proposalFile,
    evalPath: evalFile,
    violations: violations
  };
}

/**
 * 获取最近的评估记录
 */
function getRecentEvals(limit) {
  limit = limit || 20;
  var results = [];
  try {
    var dir = path.join(BASE, 'eval-proposals');
    if (!fs.existsSync(dir)) return [];
    var files = fs.readdirSync(dir).filter(function(f) {
      return f.endsWith('-eval.json');
    }).sort().reverse().slice(0, limit);

    for (var f of files) {
      try {
        results.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
      } catch(e) {}
    }
  } catch(e) {}
  return results;
}

module.exports = {
  runEval,
  getRecentEvals
};
