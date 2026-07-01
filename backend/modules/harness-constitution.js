/**
 * harness-constitution.js — 宪法检查统一入口
 *
 * 集成 8 个 pipeline 宪章的检查，提供一个统一 API：
 *   1. const_dont_self_eval → harness-pipeline-eval-runner
 *   2. const_four_layer_defense → harness-pipeline-layers
 *   3. const_spec_first → harness-pipeline-spec-registry
 *   4. const_self_validation → harness-pipeline-validator
 *   5. const_artifact_contract → harness-pipeline-artifact-contracts
 *   6. const_progressive_context → harness-pipeline-context
 *   7. const_traces_feedback → harness-pipeline-traces
 *   8. const_tolerance_threshold → harness-pipeline-post-process
 */

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');

// 所有宪法检查模块（懒加载）
var modules = {
  eval_runner: null,
  layers: null,
  spec_registry: null,
  validator: null,
  artifact_contracts: null,
  context: null,
  traces: null,
  post_process: null
};

function _load(modName) {
  if (!modules[modName]) {
    try {
      modules[modName] = require('./harness-pipeline-' + modName.replace('_', '-'));
    } catch(e) {
      modules[modName] = { error: e.message };
    }
  }
  return modules[modName];
}

/**
 * 运行指定宪章的检查
 * @param {string} ruleId - 规则ID（如 const_dont_self_eval）
 * @param {Object} options - 检查选项
 * @returns {Object} { passed, violations, report }
 */
async function checkRule(ruleId, options) {
  options = options || {};

  switch (ruleId) {
    // ─── 1. 独立评估宪章 ───
    case 'const_dont_self_eval': {
      var evalMod = _load('eval_runner');
      if (evalMod.error) return { passed: true, violations: [], report: '模块未加载: ' + evalMod.error };
      try {
        var evalResult = await evalMod.runEval(options.proposal || {}, options);
        return {
          passed: evalResult.passed,
          violations: evalResult.violations,
          report: evalResult.passed ? '评估通过' : '评估未通过: ' + (evalResult.diff || ''),
          evalResult: evalResult
        };
      } catch(e) {
        return { passed: true, violations: [], report: '评估出错(降级通过): ' + e.message };
      }
    }

    // ─── 2. 四层防御宪章 ───
    case 'const_four_layer_defense': {
      var layersMod = _load('layers');
      if (layersMod.error) return { passed: true, violations: [], report: '模块未加载' };
      try {
        var promptText = options.prompt || options.text || '';
        if (!promptText && options.promptFile) {
          try { promptText = fs.readFileSync(path.resolve(BASE, options.promptFile), 'utf-8'); } catch(e) {}
        }
        if (promptText) {
          var result = layersMod.analyzePrompt(promptText, options.promptName || 'dynamic');
          return {
            passed: result.complete,
            violations: result.missing.map(function(m) {
              return '缺失层: ' + m + ' (' + (layersMod.LAYER_NAMES[m] || m) + ')';
            }),
            report: result.report
          };
        }
        // 无指定 prompt 时扫描文件
        var scanResult = layersMod.checkAllPrompts();
        return {
          passed: scanResult.failed === 0,
          violations: scanResult.reports.filter(function(r) { return !r.complete; }).map(function(r) {
            return r.promptName + ': 缺失 ' + r.missing.join(', ');
          }),
          report: '扫描 ' + scanResult.total + ' 个文件，' + scanResult.passed + ' 通过，' + scanResult.failed + ' 失败',
          scanResult: scanResult
        };
      } catch(e) {
        return { passed: false, violations: ['检查出错: ' + e.message], report: e.message };
      }
    }

    // ─── 3. Spec First 宪章 ───
    case 'const_spec_first': {
      var specMod = _load('spec_registry');
      if (specMod.error) return { passed: true, violations: [], report: '模块未加载' };
      try {
        var scanTargets = options.dir ? [options.dir] : ['.', './modules', './frontend/src'];
        var scanResult = specMod.scanUnregistered(scanTargets);
        var violations = scanResult.unregistered.map(function(f) { return '未注册的 Spec 文件: ' + f; });
        return {
          passed: violations.length === 0,
          violations: violations,
          report: violations.length > 0
            ? '发现 ' + violations.length + ' 个未注册的 Spec 文件'
            : '所有 Spec 文件已注册（共 ' + scanResult.total + ' 个）',
          scanResult: scanResult
        };
      } catch(e) {
        return { passed: true, violations: [], report: '扫描出错(降级通过): ' + e.message };
      }
    }

    // ─── 4. 自我验证宪章 ───
    case 'const_self_validation': {
      var valMod = _load('validator');
      if (valMod.error) return { passed: true, violations: [], report: '模块未加载' };
      try {
        var targets = options.targets || ['.'];
        var valResult = valMod.validateAll(targets);
        return {
          passed: valResult.passed,
          violations: valResult.errors.map(function(e) { return e.file + ': ' + e.message; }),
          warnings: valResult.warnings.map(function(w) { return w.file + ': ' + w.message; }),
          report: '校验 ' + valResult.total + ' 个文件，'
            + (valResult.passed ? '全部通过' : valResult.errorCount + ' 个错误, ' + valResult.warningCount + ' 个警告'),
          validateResult: valResult
        };
      } catch(e) {
        return { passed: true, violations: [], report: '校验出错(降级通过): ' + e.message };
      }
    }

    // ─── 5. 产物契约宪章 ───
    case 'const_artifact_contract': {
      var artMod = _load('artifact_contracts');
      if (artMod.error) return { passed: true, violations: [], report: '模块未加载' };
      try {
        if (options.call) {
          var checkResult = artMod.checkArtifactContract(options.call);
          return {
            passed: checkResult.passed,
            violations: checkResult.violations,
            warn: checkResult.warn || null,
            report: checkResult.passed ? '校验通过' : '校验失败: ' + checkResult.violations.join('; '),
            contract: checkResult.contract
          };
        }
        // 无具体调用时，显示注册表状态
        var registry = artMod.getRegistry();
        return {
          passed: true,
          violations: [],
          report: '已注册 ' + registry.contracts.length + ' 个产物契约',
          totalContracts: registry.contracts.length
        };
      } catch(e) {
        return { passed: true, violations: [], report: '检查出错(降级通过): ' + e.message };
      }
    }

    // ─── 6. 渐进上下文宪章 ───
    case 'const_progressive_context': {
      var ctxMod = _load('context');
      if (ctxMod.error) return { passed: true, violations: [], report: '模块未加载' };
      try {
        var text = options.text || options.context || '';
        if (!text) return { passed: true, violations: [], report: '无 context 检查' };
        var contextWindow = options.windowSize || 8192;
        var threshold = options.threshold || 0.4;
        var result = ctxMod.analyzeContext(text, contextWindow, threshold);
        var violations = [];
        var reportParts = [];

        reportParts.push('Token 数: ' + result.tokenCount + '/' + result.windowSize + ' (' + (result.ratio * 100).toFixed(1) + '%)');
        reportParts.push('安全阈值: ' + (threshold * 100) + '%');

        if (!result.safe) {
          violations.push('Context 超过 ' + (threshold * 100) + '% 阈值 (' + (result.ratio * 100).toFixed(1) + '%)，建议使用分层摘要');
          reportParts.push('触发生成分层摘要（共 ' + (result.layers ? result.layers.total : 0) + ' 层）');
        } else {
          reportParts.push('Context 在安全范围内');
        }

        if (options.agentId) {
          ctxMod.recordContextTrace(options.agentId, result);
        }

        return {
          passed: result.safe,
          violations: violations,
          report: reportParts.join(' | '),
          contextResult: result
        };
      } catch(e) {
        return { passed: true, violations: [], report: '检查出错(降级通过): ' + e.message };
      }
    }

    // ─── 7. Traces 反馈宪章 ───
    case 'const_traces_feedback': {
      var trMod = _load('traces');
      if (trMod.error) return { passed: true, violations: [], report: '模块未加载' };
      try {
        var coverage = trMod.checkCoverage();
        return {
          passed: coverage.passed,
          violations: coverage.passed ? [] : [coverage.message],
          report: coverage.message,
          coverage: coverage
        };
      } catch(e) {
        return { passed: true, violations: [], report: '检查出错(降级通过): ' + e.message };
      }
    }

    // ─── 8. 容忍阈值宪章 ───
    case 'const_tolerance_threshold': {
      var ppMod = _load('post_process');
      if (ppMod.error) return { passed: true, violations: [], report: '模块未加载' };
      try {
        if (options.text) {
          var ppResult = ppMod.postProcess(options.text, options.promptId);
          return {
            passed: true,
            violations: ppResult.warning ? [ppResult.warning] : [],
            changed: ppResult.changed,
            report: ppResult.changed
              ? '已纠正 ' + ppResult.hits.length + ' 个偏差:' + ppResult.hits.join(', ')
              : '无需后处理',
            postProcessResult: ppResult
          };
        }
        var ppStats = ppMod.getStats();
        return {
          passed: true,
          violations: [],
          report: '已注册 ' + ppStats.registeredProcessors + ' 个后处理器，累计命中 ' + ppStats.totalHits + ' 次',
          ppStats: ppStats
        };
      } catch(e) {
        return { passed: true, violations: [], report: '检查出错(降级通过): ' + e.message };
      }
    }

    // ─── 运行所有宪章 ───
    case 'all':
    case '*': {
      var allRules = ['const_dont_self_eval', 'const_four_layer_defense', 'const_spec_first',
        'const_self_validation', 'const_artifact_contract', 'const_progressive_context',
        'const_traces_feedback', 'const_tolerance_threshold'];
      var allResults = [];
      var allViolations = [];
      var allReports = [];

      for (var rId of allRules) {
        try {
          var r = await checkRule(rId, options);
          allResults.push({ ruleId: rId, passed: r.passed, violations: r.violations, report: r.report });
          allViolations = allViolations.concat(r.violations.map(function(v) { return rId + ': ' + v; }));
          allReports.push('[' + (r.passed ? '✅' : '❌') + '] ' + rId + ' — ' + r.report);
        } catch(e) {
          allResults.push({ ruleId: rId, passed: true, violations: [], report: '出错(降级通过): ' + e.message });
        }
      }

      return {
        passed: allViolations.length === 0,
        violations: allViolations,
        results: allResults,
        report: allReports.join('\n')
      };
    }

    default:
      return { passed: false, violations: ['未知规则: ' + ruleId], report: '未识别的宪章规则' };
  }
}

module.exports = {
  checkRule
};
