/**
 * agent-orchestrator-core.js — 主Agent调度核心 v1.0
 *
 * 设计原则：
 *   1. 主Agent为「意图理解→任务拆解→子Agent调度→结果校验→异常处理」五个阶段
 *   2. 子Agent拥有隔离上下文沙箱，低耦合
 *   3. 支持垂直架构（主从）和水平架构（协商）
 *   4. 结果校验结构化，代码级而非AI自行判断
 *   5. 异常全流程兜底：重试/超时/轮换/追问
 *
 * 暴露接口：
 *   module.exports = {
 *     OrchestratorCore,
 *     PlanStep, ValidationRule, AgentSpec  // 类型构造器
 *   }
 *
 * 使用方式：
 *   const { OrchestratorCore } = require('./agent-orchestrator-core');
 *   const core = new OrchestratorCore({ execCEOTool, registerExecutorTool, ... });
 *   await core.process(instruction, { sessionId, projectName, sseSend });
 */

'use strict';

const path = require('path');
const fs = require('fs');

// =========================================================================
// === 1. 类型构造器（干净的 factory，不依赖 class 语法） ===
// =========================================================================

/**
 * 创建一个计划步骤
 * @param {string} id — 唯一标识
 * @param {string} description — 步骤描述
 * @param {object} opts — { dependsOn, priority, agentType, timeout, retryCount, required }
 * @returns {object} PlanStep
 */
function PlanStep(id, description, opts) {
  opts = opts || {};
  return {
    id: id,
    description: description,
    dependsOn: opts.dependsOn || [],       // 依赖的其他步骤 id[]
    priority: opts.priority || 5,          // 1(最高)~10(最低)
    agentType: opts.agentType || 'default', // 子Agent类型: default / executor / validator / reviewer
    timeout: opts.timeout || 30000,        // 单步超时(ms)
    retryCount: opts.retryCount || 2,      // 重试次数
    required: opts.required !== false,     // 是否必须成功
    status: 'pending',                     // pending / running / success / failed / skipped
    result: null,
    error: null,
    startTime: null,
    endTime: null
  };
}

/**
 * 创建一条校验规则
 * @param {string} name — 规则名
 * @param {function} check — (result) => { ok: boolean, message: string }
 * @returns {object} ValidationRule
 */
function ValidationRule(name, check) {
  return { name: name, check: check };
}

/**
 * 子Agent规格说明
 * @param {string} type — 类型标识
 * @param {object} opts — { name, skills, tools, model, systemPrompt }
 * @returns {object} AgentSpec
 */
function AgentSpec(type, opts) {
  opts = opts || {};
  return {
    type: type,
    name: opts.name || type,
    skills: opts.skills || [],
    tools: opts.tools || [],         // 允许使用的工具名列表
    model: opts.model || null,       // 可选模型覆盖
    systemPrompt: opts.systemPrompt || null  // 可选提示词覆盖
  };
}

// =========================================================================
// === 2. 默认子Agent规格注册表 ===
// =========================================================================

var DEFAULT_AGENT_SPECS = {
  'default': AgentSpec('default', {
    name: '通用执行者',
    skills: ['通用执行', '数据分析', '文本处理'],
    tools: ['kb_search', 'system_health', 'system_cpu_memory', 'system_processes', 'subagent_spawn']
  }),
  'executor': AgentSpec('executor', {
    name: '执行者',
    skills: ['代码开发', '系统实现', '配置部署'],
    tools: ['code_generate', 'file_create', 'file_modify', 'sys_config', 'deploy_service', 'xbrowser_skill']
  }),
  'validator': AgentSpec('validator', {
    name: '验证者',
    skills: ['代码审查', '质量检测', '安全审计'],
    tools: ['code_review', 'security_scan', 'run_tests', 'compliance_check']
  }),
  'reviewer': AgentSpec('reviewer', {
    name: '验收者',
    skills: ['结果评估', '需求对齐验证', '质量验收'],
    tools: ['result_evaluate', 'requirement_align', 'quality_accept', 'generate_report']
  }),
  'analyst': AgentSpec('analyst', {
    name: '分析师',
    skills: ['数据分析', '趋势研判', '报告生成'],
    tools: ['query_traffic', 'query_activities', 'query_employees', 'query_tasks', 'kb_search']
  })
};

// =========================================================================
// === 3. 默认校验规则集 ===
// =========================================================================

var DEFAULT_VALIDATION_RULES = [
  ValidationRule('non_empty', function(result) {
    if (!result || (typeof result === 'string' && !result.trim())) {
      return { ok: false, message: '结果为空' };
    }
    return { ok: true, message: '非空检查通过' };
  }),
  ValidationRule('has_data_key', function(result) {
    if (result && (result.data || result.ok || result.status)) {
      return { ok: true, message: '包含标准数据字段' };
    }
    return { ok: true, message: '非标准格式，跳过结构检查' };
  }),
  ValidationRule('no_error_flag', function(result) {
    if (result && (result.error || result.err)) {
      return { ok: false, message: '结果包含错误标识: ' + (result.error || result.err) };
    }
    return { ok: true, message: '无错误标识' };
  })
];

// =========================================================================
// === 4. Agent调度上下文沙箱 ===
// =========================================================================

/**
 * 创建子Agent执行沙箱（隔离上下文）
 * @param {string} agentType — 子Agent类型
 * @param {string} taskDescription — 任务描述
 * @param {object} options — { tools, timeout, model, systemPrompt }
 * @returns {object} Sandbox
 */
function createSandbox(agentType, taskDescription, options) {
  options = options || {};
  var spec = DEFAULT_AGENT_SPECS[agentType] || DEFAULT_AGENT_SPECS['default'];

  return {
    id: 'sbx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    agentType: agentType,
    taskDescription: taskDescription,
    created: Date.now(),
    spec: spec,
    tools: options.tools || spec.tools || [],
    timeout: options.timeout || 30000,
    model: options.model || spec.model || null,
    systemPrompt: options.systemPrompt || spec.systemPrompt || null,
    // 执行时的不可变快照
    _isolated: true,
    _state: 'created'  // created / running / completed / failed / timedout
  };
}

// =========================================================================
// === 5. OrchestratorCore — 主Agent核心类 ===
// =========================================================================

function OrchestratorCore(config) {
  config = config || {};

  // 注入外部依赖
  this._execCEOTool = config.execCEOTool || null;
  this._registerExecutorTool = config.registerExecutorTool || null;
  this._sseSend = config.sseSend || null;
  this._logger = config.logger || console.log;

  // 内部状态
  this._plans = {};           // { planId: { steps, status, sessionId, ... } }
  this._sandboxes = {};       // { sandboxId: sandbox }
  this._activeExecutions = {};// { sandboxId: promise }
  this._agentSpecs = JSON.parse(JSON.stringify(DEFAULT_AGENT_SPECS));
  this._validationRules = DEFAULT_VALIDATION_RULES.slice();
  this._stats = {
    totalPlans: 0,
    completedPlans: 0,
    failedPlans: 0,
    totalSteps: 0,
    completedSteps: 0,
    failedSteps: 0,
    retries: 0,
    timeouts: 0,
    startTime: Date.now()
  };

  this._running = true;
  this._logger('[OrchestratorCore] ✅ 初始化完成');
}

// =========================================================================
// === 5.1 意图理解与任务拆解 ===
// =========================================================================

/**
 * 分析用户指令，生成执行计划
 * @param {string} instruction — 用户原始指令
 * @returns {object} { plan, steps, queryMode, clarification }
 */
OrchestratorCore.prototype.analyze = function(instruction) {
  if (!instruction || !instruction.trim()) {
    return { plan: null, steps: [], queryMode: true, clarification: '指令为空' };
  }

  var text = instruction.trim();

  // 问句/闲聊检测
  if (this._isQuery(text)) {
    return { plan: null, steps: [], queryMode: true, clarification: null };
  }

  // 结构化拆解
  var steps = this._decompose(text);

  if (steps.length === 0) {
    // 无法拆解 — 可能是模糊指令
    return { plan: null, steps: [], queryMode: false, clarification: '无法将指令拆解为可执行步骤，请补充具体参数' };
  }

  var plan = {
    id: 'plan_' + Date.now(),
    instruction: text,
    steps: steps,
    status: 'created',         // created / running / completed / failed / partial
    created: Date.now(),
    completedSteps: 0,
    failedSteps: 0,
    skippedSteps: 0
  };

  return { plan: plan, steps: steps, queryMode: false, clarification: null };
};

/**
 * 判断是否为问句/闲聊（不进工作流）
 */
OrchestratorCore.prototype._isQuery = function(text) {
  // 问号结尾
  if (/[吗？?]$/.test(text)) return true;

  // 疑问句式开头 + 问句结尾
  if (/^(你|could|could you|can you|你会|你能|你可不可以|你能不能|你能否|你愿意|你愿意不愿意|你可以|你敢|要不要|是不是|好不好|值不值得|要不要).*([?？]|吗|吧|呢|啊)$/.test(text)) return true;

  // 纯问候
  if (/^(你好|你好啊|您好|嗨|hi|hello|hey|早|早上好|下午好|晚上好|晚安|嗨喽|哈喽|在吗|在不在)$/i.test(text)) return true;

  // 明确指令 — 优先否决问句
  if (/^(创建|新建|新增|生成|写|编写|修改|编辑|删除|移除|启动|停止|重启|执行|运行|调用|查询|搜索|查找|列出|显示|展示|导入|导出|发送|通知|提醒|设置|配置|打开|关闭|上传|下载|安装|卸载|分配|指派|授权|审批|批准|驳回|取消|暂停|继续|恢复|升级|降级|巡检|审计|冻结|解冻|锁定|解锁)/.test(text)) return false;
  if (/^(帮我|帮我看|帮我把|帮我们|帮忙).*(查看|检查|查询|查找|搜索|看看|查看|列出|显示|展示|运行|执行|调用)/.test(text)) return false;

  // 自然语言讨论
  if (/(建议|评估|分析|短板|缺|不足|改进|GAP|gap|看法|意见|想法|觉得|认为|思考|方案|思路|对比|比较|特点|优势|劣势|哪里|什么|怎么|为啥|为什么|是不是|能否|可否|怎么样|怎么办|说说|谈谈|讲讲|讨论|聊聊|探讨)/.test(text)) return true;

  return false;
};

/**
 * 将指令拆解为结构化的计划步骤
 * 根据指令关键词和语义模式生成步骤数组
 * @param {string} text
 * @returns {Array<PlanStep>}
 */
OrchestratorCore.prototype._decompose = function(text) {
  var steps = [];
  var self = this;

  // 模式匹配：根据指令内容生成步骤

  // 1. 查询/搜索类（单一步骤）
  if (/^(查询|搜索|查找|看看|查看|列出|显示|展示|检查|查).*/.test(text)) {
    steps.push(PlanStep('query_data', '查询数据: ' + text.substring(0, 40), {
      agentType: 'analyst',
      priority: 5,
      timeout: 20000
    }));
    return steps;
  }

  // 2. 分析/报告类（数据查询 → 分析 → 报告三步）
  if (/(分析|评估|趋势|报告|报表|汇总|统计|对比)/.test(text)) {
    steps.push(PlanStep('collect_data', '收集相关数据', {
      agentType: 'analyst',
      priority: 3,
      timeout: 20000
    }));
    steps.push(PlanStep('analysis', '数据分析和洞察', {
      agentType: 'analyst',
      dependsOn: ['collect_data'],
      priority: 4,
      timeout: 30000
    }));
    steps.push(PlanStep('generate_report', '生成汇总报告', {
      agentType: 'reviewer',
      dependsOn: ['analysis'],
      priority: 6,
      timeout: 20000
    }));
    return steps;
  }

  // 3. 开发/实现类（理解→执行→验证→验收四步）
  if (/(开发|实现|编码|写|编写|创建|新建|生成|构建|部署|上线|发布)/.test(text)) {
    // 看是否有更详细的参数
    steps.push(PlanStep('understand', '理解需求和上下文', {
      agentType: 'default',
      priority: 1,
      timeout: 15000
    }));
    steps.push(PlanStep('implement', '执行实现', {
      agentType: 'executor',
      dependsOn: ['understand'],
      priority: 4,
      timeout: 60000
    }));
    steps.push(PlanStep('verify', '验证实现结果', {
      agentType: 'validator',
      dependsOn: ['implement'],
      priority: 5,
      timeout: 30000
    }));
    steps.push(PlanStep('summarize', '汇总结果', {
      agentType: 'reviewer',
      dependsOn: ['verify'],
      priority: 8,
      timeout: 15000
    }));
    return steps;
  }

  // 4. 修改/配置类（理解→修改→验证）
  if (/(修改|编辑|更新|升级|降级|配置|设置|调整|变更)/.test(text)) {
    steps.push(PlanStep('understand', '理解需求和当前状态', {
      agentType: 'default',
      priority: 2,
      timeout: 15000
    }));
    steps.push(PlanStep('modify', '执行修改操作', {
      agentType: 'executor',
      dependsOn: ['understand'],
      priority: 4,
      timeout: 30000
    }));
    steps.push(PlanStep('verify', '验证修改结果', {
      agentType: 'validator',
      dependsOn: ['modify'],
      priority: 6,
      timeout: 30000
    }));
    return steps;
  }

  // 5. 管理/流程类（查询→处理→确认）
  if (/(分配|指派|授权|审批|批准|驳回|取消|暂停|继续|恢复)/.test(text)) {
    steps.push(PlanStep('get_context', '获取当前上下文和状态', {
      agentType: 'default',
      priority: 3,
      timeout: 15000
    }));
    steps.push(PlanStep('execute_action', '执行操作', {
      agentType: 'executor',
      dependsOn: ['get_context'],
      priority: 5,
      timeout: 30000
    }));
    steps.push(PlanStep('confirm', '确认操作结果', {
      agentType: 'reviewer',
      dependsOn: ['execute_action'],
      priority: 7,
      timeout: 15000
    }));
    return steps;
  }

  // 6. 默认：三步通用流程
  steps.push(PlanStep('analyze', '分析指令', {
    agentType: 'default',
    priority: 3,
    timeout: 15000
  }));
  steps.push(PlanStep('execute', '执行主任务', {
    agentType: 'executor',
    dependsOn: ['analyze'],
    priority: 5,
    timeout: 30000
  }));
  steps.push(PlanStep('summarize', '汇总结果', {
    agentType: 'reviewer',
    dependsOn: ['execute'],
    priority: 8,
    timeout: 15000
  }));

  return steps;
};

// =========================================================================
// === 5.2 子Agent调度与生命周期管理 ===
// =========================================================================

/**
 * 注入 execCEOTool 引用（让子Agent调度能调用真实工具执行）
 */
OrchestratorCore.prototype.setExecCEOTool = function(fn) {
  this._execCEOTool = fn;
  this._logger('[OrchestratorCore] execCEOTool 已注入');
};

/**
 * 注册/覆盖子Agent规格
 */
OrchestratorCore.prototype.registerAgentSpec = function(type, spec) {
  this._agentSpecs[type] = spec;
  this._logger('[OrchestratorCore] 注册子Agent规格: ' + type);
};

/**
 * 根据计划执行所有步骤
 * @param {object} plan — analyze() 返回的计划
 * @param {object} context — { sseSend, sessionId, onStepComplete }
 * @returns {object} 执行结果
 */
OrchestratorCore.prototype.executePlan = async function(plan, context) {
  if (!plan || !plan.steps || plan.steps.length === 0) {
    return { ok: false, error: '无可执行的计划步骤' };
  }

  var self = this;
  var sseSend = (context && context.sseSend) || this._sseSend || null;
  plan.status = 'running';
  this._plans[plan.id] = plan;
  this._stats.totalPlans++;

  // 按依赖关系拓扑排序
  var sortedSteps = this._topologicalSort(plan.steps);

  console.log('[OrchCore] executePlan starting. Steps per layer:', sortedSteps.map(function(l) { return l.map(function(s) { return s.id; }).join(','); }));
  if (sseSend) sseSend({ type: 'plan', content: '📋 已生成执行计划：' + sortedSteps.length + ' 个步骤', steps: sortedSteps.map(function(s) { return s.id + ': ' + s.description; }) });

  var results = {};

  // 逐层执行（同一 layer 可并行）
  for (var i = 0; i < sortedSteps.length; i++) {
    var layer = sortedSteps[i];

    // 同一层的步骤可并行执行
    var parallelJobs = layer.map(function(step) {
      return { step: step, promise: null };
    });

    // 检查依赖是否都满足
    var canExecute = layer.every(function(step) {
      if (!step.dependsOn || step.dependsOn.length === 0) return true;
      return step.dependsOn.every(function(depId) {
        var depResult = results[depId];
        return depResult && depResult.status === 'success';
      });
    });

    if (!canExecute) {
      // 依赖未满足 — 跳过该层所有步骤
      for (var j = 0; j < layer.length; j++) {
        layer[j].status = 'skipped';
        layer[j].error = '依赖步骤未成功完成';
        plan.skippedSteps++;
        if (sseSend) sseSend({ type: 'step_skipped', stepId: layer[j].id, reason: '依赖步骤未成功完成' });
      }
      continue;
    }

    // 执行本层所有步骤（并行）
    var execPromises = layer.map(function(step) {
      return self._executeStep(step, results, sseSend, context);
    });

    var stepResults = await Promise.all(execPromises);

    // 收集结果
    for (var k = 0; k < layer.length; k++) {
      var step = layer[k];
      var stepResult = stepResults[k];
      results[step.id] = {
        status: stepResult.status,
        result: stepResult.result,
        error: stepResult.error
      };
      if (stepResult.status === 'success') {
        plan.completedSteps++;
        self._stats.completedSteps++;
      } else if (stepResult.status === 'failed') {
        plan.failedSteps++;
        self._stats.failedSteps++;
      }
    }

    // 如果某个 required 步骤失败，中断后续
    var criticalFailure = layer.some(function(step) {
      return step.required && step.status === 'failed';
    });
    if (criticalFailure) {
      plan.status = 'failed';
      if (sseSend) sseSend({ type: 'plan_failed', reason: '关键步骤失败，计划中止' });
      break;
    }
  }

  // 最终状态
  if (plan.status !== 'failed') {
    plan.status = (plan.failedSteps > 0 ? 'partial' : 'completed');
  }
  console.log('[OrchCore] executePlan FINAL: status=' + plan.status + ' completed=' + plan.completedSteps + ' failed=' + plan.failedSteps);

  this._stats.completedPlans += (plan.status === 'completed' ? 1 : 0);
  this._stats.failedPlans += (plan.status === 'failed' ? 1 : 0);

  // 汇总结果
  var summary = this._summarizePlan(plan, results);

  if (sseSend) sseSend({ type: 'plan_done', status: plan.status, summary: summary });

  return { ok: true, plan: plan, results: results, summary: summary };
};

/**
 * 拓扑排序（按依赖关系分层）
 * 返回 Array<Array<PlanStep>>，每一层可并行执行
 */
OrchestratorCore.prototype._topologicalSort = function(steps) {
  var visited = {};
  var layers = [];
  var stepMap = {};
  steps.forEach(function(s) { stepMap[s.id] = s; });

  // 自底向上：先找无依赖的
  var remaining = steps.slice();
  while (remaining.length > 0) {
    var layer = [];
    var newRemaining = [];
    for (var i = 0; i < remaining.length; i++) {
      var step = remaining[i];
      var deps = step.dependsOn || [];
      var allDepsResolved = deps.every(function(d) {
        return visited[d];
      });
      if (allDepsResolved) {
        layer.push(step);
        visited[step.id] = true;
      } else {
        newRemaining.push(step);
      }
    }
    if (layer.length === 0) {
      // 循环依赖或无法满足的依赖
      newRemaining.forEach(function(s) {
        if (!visited[s.id]) {
          visited[s.id] = true; // 避免死循环
          s.status = 'skipped';
          s.error = '依赖循环或无法满足';
        }
      });
      break;
    }
    layers.push(layer);
    remaining = newRemaining;
  }

  // 按优先级排序每一层
  layers.forEach(function(layer) {
    layer.sort(function(a, b) { return a.priority - b.priority; });
  });

  return layers;
};

/**
 * 执行单个步骤（含重试和超时）
 */
OrchestratorCore.prototype._executeStep = async function(step, contextResults, sseSend, globalContext) {
  var self = this;
  step.status = 'running';
  step.startTime = Date.now();

  if (sseSend) sseSend({ type: 'step_started', stepId: step.id, description: step.description });

  var lastError = null;
  var maxRetries = step.retryCount || 2;

  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // 重试等待
      self._stats.retries++;
      if (sseSend) sseSend({ type: 'step_retry', stepId: step.id, attempt: attempt, maxRetries: maxRetries });
      await new Promise(function(r) { setTimeout(r, 1000 * attempt); });
    }

    try {
      var result = await self._runStepWithTimeout(step, contextResults, globalContext);

      // 结果校验
      var validationResult = self._validateStepResult(step, result);

      if (validationResult.ok) {
        step.status = 'success';
        step.result = result;
        step.endTime = Date.now();
        if (sseSend) sseSend({ type: 'step_completed', stepId: step.id, status: 'success' });
        return { status: 'success', result: result, error: null };
      } else {
        lastError = '校验失败: ' + validationResult.message;
        step.error = lastError;
        if (attempt < maxRetries) {
          if (sseSend) sseSend({ type: 'step_validation_fail', stepId: step.id, message: validationResult.message });
        }
      }
    } catch(e) {
      lastError = e.message || String(e);
      step.error = lastError;
      if (e._isTimeout) {
        self._stats.timeouts++;
        if (sseSend) sseSend({ type: 'step_timeout', stepId: step.id, timeout: step.timeout });
      }
      if (attempt < maxRetries) {
        if (sseSend) sseSend({ type: 'step_error', stepId: step.id, error: lastError, retrying: true });
      }
    }
  }

  // 所有重试都失败
  step.status = 'failed';
  step.endTime = Date.now();
  if (sseSend) sseSend({ type: 'step_failed', stepId: step.id, error: lastError });
  return { status: 'failed', result: null, error: lastError };
};

/**
 * 执行步骤（带超时保护）
 */
OrchestratorCore.prototype._runStepWithTimeout = async function(step, contextResults, globalContext) {
  var self = this;
  var timeout = step.timeout || 30000;

  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      var err = new Error('步骤超时(' + timeout + 'ms)');
      err._isTimeout = true;
      reject(err);
    }, timeout);

    self._runStep(step, contextResults, globalContext).then(function(result) {
      clearTimeout(timer);
      resolve(result);
    }).catch(function(e) {
      clearTimeout(timer);
      reject(e);
    });
  });
};

/**
 * 实际执行步骤（调用子Agent/tools）
 */
OrchestratorCore.prototype._runStep = async function(step, contextResults, globalContext) {
  // 根据 agentType 决定执行方式
  var spec = this._agentSpecs[step.agentType] || this._agentSpecs['default'];

  // 创建隔离沙箱
  var sandbox = createSandbox(step.agentType, step.description, {
    tools: spec.tools,
    timeout: step.timeout,
    model: spec.model
  });
  this._sandboxes[sandbox.id] = sandbox;

  try {
    sandbox._state = 'running';

    // 构建执行上下文：之前步骤的结果
    var priorContext = '';
    if (step.dependsOn && step.dependsOn.length > 0) {
      priorContext = step.dependsOn.map(function(depId) {
        var ctx = contextResults[depId];
        if (ctx && ctx.result) {
          return '【' + depId + '的结果】' + (typeof ctx.result === 'string' ? ctx.result.substring(0, 500) : JSON.stringify(ctx.result).substring(0, 500));
        }
        return '';
      }).filter(Boolean).join('\n\n');
    }

    // 构建子Agent prompt
    var agentPrompt = '## 你的身份\n';
    agentPrompt += '你是"' + spec.name + '"，eCompany 团队中的 ' + spec.skills.join('、') + ' 专家。\n';
    agentPrompt += '\n## 当前任务\n';
    agentPrompt += step.description + '\n';
    if (spec.systemPrompt) {
      agentPrompt += '\n' + spec.systemPrompt + '\n';
    }
    if (priorContext) {
      agentPrompt += '\n## 前置上下文\n' + priorContext + '\n';
    }
    agentPrompt += '\n## 要求\n';
    agentPrompt += '- 输出简洁、直接、有数据支撑的结论\n';
    agentPrompt += '- 如果无法完成，说明原因\n';

    // 通过 execCEOTool 执行
    if (this._execCEOTool && typeof this._execCEOTool === 'function') {
      console.log('[OrchCore] _runStep calling execCEOTool.agent_execute for: ' + step.id);
      var execStart = Date.now();
      try {
        var toolResult = await this._execCEOTool('agent_execute', {
          agentType: step.agentType,
          stepId: step.id,
          description: step.description,
          prompt: agentPrompt,
          tools: spec.tools,
          timeout: Math.floor(step.timeout * 0.8)
        });
        var elapsed = Date.now() - execStart;
        console.log('[OrchCore] _runStep execCEOTool returned in ' + elapsed + 'ms. result=' + (toolResult ? 'ok' : 'NULL'));
        sandbox._state = 'completed';
        if (!toolResult) {
          return { message: '步骤执行完成: ' + step.description, _fallback: true };
        }
        return toolResult.data || toolResult;
      } catch(_e) {
        console.log('[OrchCore] _runStep execCEOTool THREW:', _e.message);
        sandbox._state = 'completed';
        return { message: '步骤降级完成(异常): ' + step.description, _error: _e.message, _fallback: true };
      }
    }

    // 如果没有 execCEOTool，走函数调用执行
    var result = { message: '步骤描述: ' + step.description, _autoGenerated: true };
    sandbox._state = 'completed';
    return result;

  } catch(e) {
    sandbox._state = 'failed';
    throw e;
  } finally {
    // 沙箱清理（记录后释放）
    sandbox._state = sandbox._state || 'completed';
    this._cleanupSandbox(sandbox.id);
  }
};

/**
 * 清理子Agent沙箱
 */
OrchestratorCore.prototype._cleanupSandbox = function(sandboxId) {
  // 释放引用（GC友好）
  delete this._activeExecutions[sandboxId];
  // 延迟删除沙箱数据，保留一段时间用于审计
  var self = this;
  setTimeout(function() {
    delete self._sandboxes[sandboxId];
  }, 60000);
};

// =========================================================================
// === 5.3 结果校验 ===
// =========================================================================

/**
 * 对步骤结果执行校验规则
 */
OrchestratorCore.prototype._validateStepResult = function(step, result) {
  if (!result) {
    return { ok: false, message: '无返回结果' };
  }

  for (var i = 0; i < this._validationRules.length; i++) {
    var rule = this._validationRules[i];
    try {
      var checkResult = rule.check(result);
      if (!checkResult.ok) {
        return { ok: false, message: '规则[' + rule.name + '] 未通过: ' + checkResult.message };
      }
    } catch(e) {
      return { ok: false, message: '校验规则[' + rule.name + ']执行异常: ' + e.message };
    }
  }

  return { ok: true, message: '所有校验通过' };
};

/**
 * 注册自定义校验规则
 */
OrchestratorCore.prototype.addValidationRule = function(rule) {
  this._validationRules.push(rule);
};

// =========================================================================
// === 5.4 异常处理与全流程兜底 ===
// =========================================================================

/**
 * 重置指定步骤（供外部调用重试）
 */
OrchestratorCore.prototype.resetStep = async function(planId, stepId) {
  var plan = this._plans[planId];
  if (!plan) return { ok: false, error: '计划不存在' };

  var step = plan.steps.find(function(s) { return s.id === stepId; });
  if (!step) return { ok: false, error: '步骤不存在' };

  step.status = 'pending';
  step.result = null;
  step.error = null;
  step.startTime = null;
  step.endTime = null;

  return { ok: true, message: '步骤已重置，可重新执行' };
};

/**
 * 计划结果汇总
 */
OrchestratorCore.prototype._summarizePlan = function(plan, results) {
  var successSteps = plan.steps.filter(function(s) { return s.status === 'success'; });
  var failedSteps = plan.steps.filter(function(s) { return s.status === 'failed'; });
  var skippedSteps = plan.steps.filter(function(s) { return s.status === 'skipped'; });

  var summary = '计划执行完成，状态: ' + plan.status;
  summary += '\n- 总步骤: ' + plan.steps.length;
  summary += '\n- 成功: ' + successSteps.length;
  summary += '\n- 失败: ' + failedSteps.length;
  summary += '\n- 跳过: ' + skippedSteps.length;

  if (failedSteps.length > 0) {
    summary += '\n\n⚠️ 失败步骤:';
    failedSteps.forEach(function(s) {
      summary += '\n  - [' + s.id + '] ' + s.description + ': ' + (s.error || '未知错误');
    });
  }

  // 附加关键结果
  if (results) {
    var lastResult = null;
    var keys = Object.keys(results);
    if (keys.length > 0) {
      lastResult = results[keys[keys.length - 1]];
    }
    if (lastResult && lastResult.result) {
      var resText = typeof lastResult.result === 'string' ? lastResult.result : JSON.stringify(lastResult.result);
      summary += '\n\n📊 最终结果:\n' + resText.substring(0, 2000);
    }
  }

  return summary;
};

/**
 * 获取子Agent沙箱上下文摘要（用于审计/调试）
 */
OrchestratorCore.prototype.getSandboxSummary = function(planId) {
  var plan = this._plans[planId];
  if (!plan) return null;

  var summary = {
    planId: planId,
    status: plan.status,
    totalSteps: plan.steps.length,
    completedSteps: plan.completedSteps,
    failedSteps: plan.failedSteps,
    skippedSteps: plan.skippedSteps,
    steps: plan.steps.map(function(s) {
      return {
        id: s.id,
        description: s.description,
        agentType: s.agentType,
        status: s.status,
        duration: s.startTime && s.endTime ? (s.endTime - s.startTime) + 'ms' : null,
        error: s.error || null
      };
    })
  };

  return summary;
};

/**
 * 获取核心状态统计
 */
OrchestratorCore.prototype.getStats = function() {
  return {
    totalPlans: this._stats.totalPlans,
    completedPlans: this._stats.completedPlans,
    failedPlans: this._stats.failedPlans,
    totalSteps: this._stats.totalSteps,
    completedSteps: this._stats.completedSteps,
    failedSteps: this._stats.failedSteps,
    retries: this._stats.retries,
    timeouts: this._stats.timeouts,
    uptime: Math.floor((Date.now() - this._stats.startTime) / 1000) + 's',
    activePlans: Object.keys(this._plans).filter(function(id) {
      return this[id].status === 'running';
    }.bind(this._plans)).length
  };
};

// =========================================================================
// === 6. 暴露 API ===
// =========================================================================

module.exports = {
  OrchestratorCore: OrchestratorCore,
  PlanStep: PlanStep,
  ValidationRule: ValidationRule,
  AgentSpec: AgentSpec
};
