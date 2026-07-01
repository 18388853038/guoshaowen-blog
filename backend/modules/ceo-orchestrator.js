/**
 * ceo-orchestrator.js — CEO 统一编排器 v1.0
 *
 * 替代 system-orchestrator.js 的干净替代品。
 * 
 * 设计原则：
 *   1. 单体单文件，模块化组织（注释分隔段）
 *   2. 注入点集中顶部，不在长函数内散落
 *   3. SSE 流式输出与 server-modern.js 完全兼容
 *   4. 对话记忆用 memory-engine.js 持久化（非 sessionMemory）
 *   5. 工具调用通过 execCEOTool 桥接指针
 *   6. 问句检测（isQueryQuestion）不进工作流
 *   7. 四维分析框架：V2/V3/V4
 *
 * 暴露接口：
 *   module.exports = { start, stop, processChatSSE, setExecCEOTool, getStats }
 */

// =========================================================================
// === 0. 注入点（所有外部依赖集中在此，不在长函数内 require） ===
// =========================================================================

const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '..');
const AI_ENGINE = require('./ai-engine');
const MEMORY_ENGINE = require('./memory-engine');
const LAYERED_MEMORY = require('./layered-memory');
const TOOLS_REGISTRY = require('./tools-registry');

// ★ 引入 Agent Orchestrator Core（主Agent调度核心 v1.0）
var OrchestratorCore = null;
var _orchestratorCore = null;
function getOrchestratorCore() {
  if (!_orchestratorCore) {
    try {
      var OC = require('./agent-orchestrator-core');
      OrchestratorCore = OC.OrchestratorCore;
      _orchestratorCore = new OrchestratorCore({
        execCEOTool: _execCEOTool,
        logger: function(msg) { console.log('[OrchestratorCore] ' + msg); }
      });
      // 监听 execCEOTool 更新
      Object.defineProperty(global, '_orchestrator_execCEOTool', {
        get: function() { return _execCEOTool; },
        set: function(v) {
          _execCEOTool = v;
          if (_orchestratorCore) _orchestratorCore._execCEOTool = v;
        },
        configurable: true
      });
      console.log('[ceo-orchestrator] OrchestratorCore 初始化完成');
    } catch(e) {
      console.log('[ceo-orchestrator] OrchestratorCore 加载失败(降级运行): ' + e.message);
      _orchestratorCore = null;
    }
  }
  return _orchestratorCore;
}

// =========================================================================
// === 内部状态 ===
// =========================================================================

var _running = false;
var _execCEOTool = null;       // 由 setExecCEOTool() 注入的桥接函数
var _sseSend = null;           // SSE 回调（由外部注册）
var _stats = {
  totalInstructions: 0,
  totalToolCalls: 0,
  totalToolErrors: 0,
  aiReplies: 0,
  workflowReplies: 0,
  totalTokens: 0,
  startTime: null
};

// =========================================================================
// === 1. 策略引擎（V2 战略 + V3 认知融合 + 问句检测） ===
// =========================================================================

/**
 * 问句检测 — 不进工作流
 * 命中：纯问句、闲聊、建议/评估/分析请求等自然语言
 * 不命中：明确执行指令
 */
function isQueryQuestion(instruction) {
  if (!instruction || !instruction.trim()) return true;

  var text = instruction.trim();

  // 问号结尾
  if (/[吗？?]$/.test(text)) return true;

  // 疑问句式开头
  if (/^(你|could|could you|can you|你会|你能|你可不可以|你能不能|你能否|你愿意|你愿意不愿意|你可以|你敢|要不要|是不是|好不好|值不值得|要不要).*([?？]|吗|吧|呢|啊)$/.test(text)) return true;

  // 纯问候语 — 直接是问句
  if (/^(你好|你好啊|您好|嗨|hi|hello|hey|早|早上好|下午好|晚上好|晚安|嗨喽|哈喽|在吗|在不在)$/i.test(text)) return true;

  // 深度查询问题 — 虽然带问句特征，但需要工具调用，不应被拦截
  if (/(病|情况|状态|健康|怎么样|如何|怎样|趋势|分析|评估|报告|报表|汇总|统计|最近|最新|当前|目前|整体|全面|总体|概况|状况)/.test(text) && text.length > 4 && !/^(你好|您好|嗨|hi|hello|hey|早|早上好|下午好|晚上好|晚安|在吗|在不是)$/i.test(text)) return false;

  // 明确执行指令 — 命令式、动词+宾语（在自然语言标记之前判断，优先级更高）
  if (/^(创建|新建|新增|生成|产生|写|编写|修改|编辑|删除|移除|复制|移动|重命名|启动|停止|重启|部署|发布|上线|执行|运行|调用|查询|搜索|查找|列出|显示|展示|打印|输出|导入|导出|发送|通知|提醒|设置|配置|打开|关闭|上传|下载|安装|卸载|注册|注销|重置|清理|整理|排序|过滤|筛选|批量|自动|定时|分配|指派|委派|授权|审批|批准|驳回|取消|暂停|继续|恢复|升级|降级|转岗|解雇|招聘|奖励|惩罚|监控|巡检|审计|冻结|解冻|锁定|解锁|禁言|解禁|踢出|拉黑|白名单|黑名单)/.test(text)) return false;
  if (/^(帮我|帮我看|帮我把|帮我们|帮忙).*(查看|检查|查询|查找|搜索|看看|查看|列出|显示|展示|运行|执行|调用)/.test(text)) return false;

  // 询问意见 / 讨论
  if (/^(告诉我|说说|谈谈|讲讲|讨论|聊聊|分析|评估|评价|你怎么看|你怎么想|你的看法|你觉得|你认为|你想)/.test(text)) return true;

  // 自然语言标记 — 非执行类
  if (/(建议|评估|分析|短板|缺|不足|改进|缺陷|GAP|gap|考虑|看法|意见|想法|觉得|认为|思考|方案|思路|对比|比较|特点|优势|劣势|哪里|什么|怎么|为啥|为什么|是不是|能否|可否|是否可行|好不好|值不值得|要不要|怎么样|怎么办|说说|谈谈|讲讲|讨论|聊聊|探讨|对|好的|嗯|然后|先|首先|其次|最后|第一步|第二步|先要|先做|先写|先改|你看|你看看|帮忙|帮我看|帮我把|帮我们|理解|明白|知道|收到|搞定|完成了|好了|行了|嗯|哦|哦哟|是的|没错|对的|可以|行|没问题|ok|OK|好的|好的吧|这样|这样的|那种|那种的|那个|哪些|这些|那些|大概|大约|可能|应该|应当|需要|想|要|想要|希望|期待|等着|等你|你在)/.test(text)) return true;

  return false;

  return !isExecCommand;
}

/**
 * V2 战略评估 — 风险红线 + 违规检测
 */
function strategicAssessment(instruction, context) {
  var assessment = {
    riskLevel: 'low',
    redFlags: [],
    requiresApproval: false,
    policyCheck: 'passed'
  };

  // 红线关键词
  var RED_LINES = [
    { keyword: '删除.*全部|删.*所有', level: 'critical', flag: '批量删除操作' },
    { keyword: '格式化|清空|重置.*系统', level: 'critical', flag: '危险系统操作' },
    { keyword: '解雇.*全部|开除.*所有', level: 'critical', flag: '批量解雇' },
    { keyword: 'shutdown|halt|reboot', level: 'critical', flag: '系统关机/重启' },
    { keyword: 'rm .* -rf|del.* /f', level: 'critical', flag: '强制删除文件' },
    { keyword: 'drop table|truncate', level: 'critical', flag: '数据库危险操作' }
  ];

  for (var i = 0; i < RED_LINES.length; i++) {
    try {
      var re = new RegExp(RED_LINES[i].keyword, 'i');
      if (re.test(instruction)) {
        assessment.redFlags.push(RED_LINES[i].flag);
        assessment.riskLevel = RED_LINES[i].level;
      }
    } catch(e) {}
  }

  if (assessment.redFlags.length > 0) {
    assessment.policyCheck = 'blocked';
    assessment.requiresApproval = true;
  }

  return assessment;
}

/**
 * V3 认知融合 — 跨上下文关联 + 历史回看
 */
function cognitiveSynthesis(instruction, sessionMessages, projectName) {
  var synthesis = {
    relatedHistory: [],
    knowledgeHits: [],
    synthesisInsight: ''
  };

  // 从 memory-engine 搜索相关历史
  try {
    var history = MEMORY_ENGINE.getRecentContext(6, null, projectName);
    if (history && history.length > 0) {
      synthesis.relatedHistory = history.slice(-4);
    }
  } catch(e) {}

  // 从记忆引擎的知识库搜索关联知识
  try {
    var keywords = (instruction || '').match(/[\u4e00-\u9fa5]{2,}/g);
    if (keywords && keywords.length > 0) {
      for (var i = 0; i < Math.min(keywords.length, 3); i++) {
        var hits = MEMORY_ENGINE.searchKnowledge(keywords[i], projectName);
        if (hits && hits.length > 0) {
          synthesis.knowledgeHits = synthesis.knowledgeHits.concat(hits.slice(0, 2));
        }
      }
    }
  } catch(e) {}

  return synthesis;
}

// =========================================================================
// === 2. 工具引擎（全部可用工具 + 桥接执行） ===
// =========================================================================

/**
 * 获取所有可用工具（不截断）
 */
function getTools() {
  try {
    var tools = TOOLS_REGISTRY.CEO_TOOLS || TOOLS_REGISTRY.ALL_TOOLS || [];
    return tools;
  } catch(e) {
    console.log('[ceo-orchestrator] getTools error:', e.message);
    return [];
  }
}

/**
 * 构建工具描述的文本 — 供 System Prompt 使用
 */
function buildToolSystemPrompt() {
  var tools = getTools();
  if (!tools || tools.length === 0) return '';

  var lines = [];
  lines.push('你有以下工具可用：');

  for (var i = 0; i < tools.length; i++) {
    var t = tools[i];
    var func = t.function || t;
    var name = func.name || t.id || 'unknown';
    var desc = func.description || t.description || '';
    lines.push('  - ' + name + ': ' + desc);
  }

  lines.push('');
  lines.push('使用格式：调用工具时返回JSON格式 { "tool": "工具名", "args": { ... } }');
  lines.push('工具调用后，你将收到执行结果，请基于结果数据回答用户。');

  return lines.join('\n');
}

/**
 * 执行单个工具调用（通过 _execCEOTool 桥接）
 */
async function execToolCall(name, args) {
  if (!_execCEOTool) {
    return { error: 'execCEOTool 未注入，工具无法执行' };
  }
  if (!name) return { error: '工具名称不能为空' };

  _stats.totalToolCalls++;

  try {
    var result = await _execCEOTool(name, args || {});
    return result;
  } catch(e) {
    _stats.totalToolErrors++;
    return { error: e.message, toolName: name };
  }
}

// =========================================================================
// === 3. 对话引擎（记忆管理 + SSE 流式处理） ===
// ===   sessionMemory → MEMORY_ENGINE 持久化 ===
// =========================================================================

/**
 * 添加对话消息到记忆并持久化
 */
function addSessionMessage(role, content, sessionId, projectName) {
  try {
    MEMORY_ENGINE.addSessionMessage(role, content, sessionId, projectName);
  } catch(e) {
    console.log('[ceo-orchestrator] addSessionMessage error:', e.message);
  }
}

/**
 * 加载对话记忆（从 memory-engine 恢复）
 */
function loadSessionMemory(sessionId, projectName) {
  try {
    return MEMORY_ENGINE.loadSession(sessionId, projectName);
  } catch(e) {
    console.log('[ceo-orchestrator] loadSessionMemory error:', e.message);
    return [];
  }
}

/**
 * 构建 AI 对话的 System Prompt
 */
function buildSystemPrompt(instruction, sessionId, projectName) {
  var context = '';
  try {
    var recent = MEMORY_ENGINE.getRecentContext(6, sessionId, projectName);
    if (recent && recent.length > 0) {
      context = '\n\n【近期对话上下文】\n' + recent.map(function(m) {
        return (m.role === 'user' ? '用户: ' : 'AI: ') + m.content.substring(0, 500);
      }).join('\n');
    }
  } catch(e) {}

  // 从独立知识引擎检索相关经验知识，注入到 system prompt
  var knowledgeContext = '';
  try {
    var ke = require('./knowledge-engine');
    if (ke && ke.searchKnowledge && instruction && instruction.length > 2) {
      var kHits = ke.searchKnowledge(instruction, { limit: 5 });
      if (kHits && kHits.length > 0) {
        knowledgeContext = '\n\n【相关经验知识】\n' + kHits.map(function(k) {
          var title = k.title || k.category || '知识';
          var content = (k.content || k.detail || '').substring(0, 1000);
          return '- [' + title + '] ' + content;
        }).join('\n');
      }
    }
  } catch(e) { /* knowledge-engine 不可用时不阻塞 */ }

  var toolDescriptions = buildToolSystemPrompt();

  var systemPrompt = [
    '你是 CEO 陈智慧（Chen Zhihui），一家 AI 公司的 CEO。',
    '你有 42 个内置工具，随时可以调用。',
    '',
    '## 核心原则',
    '1. **基于数据回复**：使用工具查询真实数据，不要凭空编造',
    '2. **回复必须包含工具返回的原始数据**：不要笼统总结，要展示关键数据原文',
    '3. **简明高效**：直接回答，不要冗长客套',
    '4. **主动汇报**：发现异常、趋势、机会时主动说',
    '5. **工具调用后再回复**：需要信息时先调工具，再基于结果回答',
    '',
    toolDescriptions,
    knowledgeContext,
    '',
    '## 回复规则',
    '- 调用工具时必须使用 API 原生 function calling 机制，不要在消息文本中写工具调用指令或JSON',
    '- 需要调用工具时直接发起 function call，API 会自动执行并返回结果',
    '- 收到工具结果后基于真实数据回复用户，展示关键数据原文',
    '- 如果用户问的是纯问题或闲聊，直接回复，不要调工具',
    context
  ].join('\n');

  return systemPrompt;
}

/**
 * SSE 流式对话处理（核心入口）
 *
 * 兼容 server-modern.js 的 /api/chat/sse 端点
 * 信号：
 *   sseSend({ type: 'message', content: '...' }) — 流式文本块
 *   sseSend({ type: 'tool_call', name, args, summary }) — 工具调用通知
 *   sseSend({ type: 'tool_result', name, status, result }) — 工具结果
 *   sseSend({ type: 'thinking', content: '...' }) — 思考中
 *   sseSend({ type: 'done', reply: '...' }) — 完成
 *   sseSend({ type: 'error', message: '...' }) — 错误
 */
async function processChatSSE(req, res) {
  var _sseSendLocal = _sseSend;

  // 如果没有外部 SSE 回调，用 res.write 直接写
  if (!_sseSendLocal && res) {
    _sseSendLocal = function(obj) {
      try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch(e) {}
    };
  }

  try {
    // 从请求中提取消息
    var body = typeof req.body === 'object' ? req.body : {};
    var message = body.message || '';
    var sessionId = body.sessionId || null;
    var projectName = body.projectName || null;

    if (!message || !message.trim()) {
      if (_sseSendLocal) _sseSendLocal({ type: 'error', message: '缺少 message 参数' });
      if (res) res.end();
      return;
    }

    _stats.totalInstructions++;

    // 步骤 1: isQueryQuestion 预判（问句不进工作流）
    if (isQueryQuestion(message)) {
      // 纯对话，走 AI 直接回复
      await _handleAIDirectReply(message, sessionId, projectName, _sseSendLocal);
      if (_sseSendLocal) _sseSendLocal({ type: 'done', reply: '' });
      if (res) res.end();
      return;
    }

    // 步骤 2: V2 战略评估
    var v2 = strategicAssessment(message);

    // 如果触发了红线
    if (v2.redFlags.length > 0) {
      var blockMsg = '⚠️ 战略红线检测：';
      blockMsg += v2.redFlags.join('；');
      blockMsg += '\n\n此操作已自动拦截。如确需执行，请先授权。';

      if (_sseSendLocal) {
        _sseSendLocal({ type: 'message', content: blockMsg });
        _sseSendLocal({ type: 'done', reply: blockMsg });
      }
      if (res) res.end();
      return;
    }

    // 步骤 3: 尝试 OrchestratorCore 结构化调度
    var core = getOrchestratorCore();
    var planResult = null;

    if (core) {
      // 让新核心做主调度
      var analysis = core.analyze(message);

      if (analysis.queryMode) {
        // 问句/闲聊，走 AI 直接回复
        await _handleAIDirectReply(message, sessionId, projectName, _sseSendLocal);
        if (_sseSendLocal) _sseSendLocal({ type: 'done', reply: '' });
        if (res) res.end();
        return;
      }

      if (analysis.plan && analysis.steps.length > 0) {
        // 有结构化计划 — 走新核心调度
        if (_sseSendLocal) _sseSendLocal({ type: 'plan_start', plan: '步骤数: ' + analysis.steps.length });

        planResult = await core.executePlan(analysis.plan, {
          sseSend: _sseSendLocal,
          sessionId: sessionId
        });

        if (planResult && planResult.ok && planResult.summary) {
          // 输出最终汇总
          if (_sseSendLocal) _sseSendLocal({ type: 'message', content: '\n📋 执行汇总\n' + planResult.summary });
        }

        if (_sseSendLocal) _sseSendLocal({ type: 'done', reply: planResult ? (planResult.summary || '执行完成') : '执行完成' });
        if (res) res.end();
        return;
      }

      if (analysis.clarification) {
        // 模糊指令 — 追问
        var clarifyMsg = '⚠️ ' + analysis.clarification + '\n\n请提供更详细的指令（如：查询什么数据？需要什么操作？）';
        if (_sseSendLocal) {
          _sseSendLocal({ type: 'message', content: clarifyMsg });
          _sseSendLocal({ type: 'done', reply: clarifyMsg });
        }
        if (res) res.end();
        return;
      }
    }

    // 步骤 4: 降级到传统 AI + 工具调用循环
    await _handleAIWithTools(message, sessionId, projectName, _sseSendLocal);

    if (_sseSendLocal) _sseSendLocal({ type: 'done', reply: '' });
    if (res) res.end();

  } catch(e) {
    console.log('[ceo-orchestrator] processChatSSE error:', e.message);
    // 即使 OrchestratorCore 出错，也尝试降级
    try {
      if (!_orchestratorCore) {
        // 降级到传统处理
        await _handleAIWithTools(message, sessionId, projectName, _sseSendLocal);
        if (_sseSendLocal) _sseSendLocal({ type: 'done', reply: '' });
        if (res) res.end();
        return;
      }
    } catch(e2) {}
    if (_sseSendLocal) _sseSendLocal({ type: 'error', message: e.message });
    if (res) res.end();
  }
}

/**
 * 处理纯对话回复（问句/闲聊）
 */
async function _handleAIDirectReply(message, sessionId, projectName, sseSend) {
  try {
    // 发送 thinking
    if (sseSend) sseSend({ type: 'thinking', content: '陈智慧正在思考你的问题...' });

    // 构建消息
    var systemPrompt = buildSystemPrompt(message, sessionId, projectName);

    var messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ];

    // 调用 AI（无工具）
    var fullReply = '';
    try {
      var stream = AI_ENGINE.aiChatStream(messages, {
        temperature: 0.7,
        maxTokens: 4096
      });

      for await (var chunk of stream) {
        fullReply += chunk;
        if (sseSend) {
          // 每 3 个字推送
          for (var _si = 0; _si < chunk.length; _si += 3) {
            sseSend({ type: 'message', content: chunk.substring(_si, _si + 3) });
          }
        }
      }
    } catch(e) {
      // 降级：非流式调用
      var result = await AI_ENGINE.aiChat(messages, {
        temperature: 0.7,
        maxTokens: 4096
      });
      fullReply = result.choices?.[0]?.message?.content || '抱歉，我暂时无法回答。';
      if (sseSend) {
        for (var si = 0; si < fullReply.length; si += 3) {
          sseSend({ type: 'message', content: fullReply.substring(si, si + 3) });
          await new Promise(function(r) { setTimeout(r, 15); });
        }
      }
    }

    // 持久化对话记忆
    addSessionMessage('user', message, sessionId, projectName);
    addSessionMessage('assistant', fullReply, sessionId, projectName);

    _stats.aiReplies++;

    // 记录进化记忆
    try {
      MEMORY_ENGINE.addEvolveMemory('conversation', message, '直接回复', '', projectName);
    } catch(e) {}

  } catch(e) {
    console.log('[ceo-orchestrator] _handleAIDirectReply error:', e.message);
    if (sseSend) sseSend({ type: 'error', message: e.message });
  }
}

/**
 * 处理 AI + 工具调用循环（执行指令）
 */
async function _handleAIWithTools(message, sessionId, projectName, sseSend) {
  try {
    if (sseSend) sseSend({ type: 'thinking', content: '陈智慧正在分析你的指令...' });

    // 构建消息（不含工具文本描述，只通过 toolDefs 传递）
    var tools = getTools();
    var context = '';
    try {
      var recent = MEMORY_ENGINE.getRecentContext(6, sessionId, projectName);
      if (recent && recent.length > 0) {
        context = '\n\n【近期对话上下文】\n' + recent.map(function(m) {
          return (m.role === 'user' ? '用户: ' : 'AI: ') + m.content.substring(0, 500);
        }).join('\n');
      }
    } catch(e) {}

    var systemPrompt = [
      '你是 CEO 陈智慧（Chen Zhihui），一家 AI 公司的 CEO。',
      '你是\'小龙\'（调度管理核心AI）的上级——小龙负责团队调度与任务分配，你是公司经营决策者。',
      '你有 '+tools.length+' 个内置工具可供调用。',
      '调用工具时必须使用 API 原生 tool_calls 机制（function calling），不要在消息文本中写工具调用指令。',
      '如果需要数据，直接发起 function call，API 会自动处理工具结果并返回给你。',
      '',
      '## 核心原则',
      '1. **基于数据回复**：使用工具查询真实数据，不要凭空编造',
      '2. **回复必须包含工具返回的原始数据**：展示关键数据原文，不要笼统总结',
      '3. **战略思维**：用户说一句话，你要想到背后三件事',
      '4. **主动深挖**：回复完当前问题后，追问相关信息、给出延伸建议',
      '5. **CEO 风范**：直接、锐利、有观点，不是客服语气',
      '6. **先调用工具再回复**：需要信息时先调工具，再基于结果回答',
      context
    ].join('\n');

    var messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message + '\n\n请使用 API 的原生 function calling 机制来调用工具（不要在消息文本中写任何工具调用JSON或{ tool: ... }格式）。需要数据时直接发起 function call，API 会自动执行并返回结果。分析需要的信息后一步步调用工具获取数据，再基于实际数据回复。回复完成后追问或给出下一步建议。' }
    ];

    var fullReply = '';
    var toolCallRound = 0;
    var MAX_TOOL_ROUNDS = 8;
    var allToolCalls = [];

    // 工具调用循环（多轮）
    while (toolCallRound < MAX_TOOL_ROUNDS) {
      toolCallRound++;

      // 发送工具调用前的 thinking
      if (sseSend && toolCallRound === 1) {
        sseSend({ type: 'thinking', content: '陈智慧正在执行操作...' });
      }

      // 调用 AI（带工具定义）
      fs.appendFileSync('F:/eCompanyClaw-Release/backend/logs/ceo_debug.log','[aiChatRound] round='+toolCallRound+' tools='+tools.length+' msgs='+messages.length+'\n');
    var response = await AI_ENGINE.aiChat(messages, {
        toolDefs: tools,
        temperature: 0.3,
        maxTokens: 4096
      });

      fs.appendFileSync('F:/eCompanyClaw-Release/backend/logs/ceo_debug.log','[resp] choices='+(response?.choices?.length||0)+' fr='+(response?.choices?.[0]?.finish_reason||'none')+' tcs='+(response?.choices?.[0]?.message?.tool_calls?.length||0)+' contLen='+((response?.choices?.[0]?.message?.content||'').length)+'\n');
    if (!response.choices || response.choices.length === 0) {
        fs.appendFileSync('F:/eCompanyClaw-Release/backend/logs/ceo_debug.log','[break1] AI engine returned no results\n');
      fullReply = 'AI 引擎未返回结果';
        break;
      }

      var choice = response.choices[0];
      var content = choice.message?.content || '';

      // 没有工具调用，直接回复
      if (choice.finish_reason !== 'tool_calls' || !choice.message?.tool_calls) {
        fullReply = content;
        break;
      }

      // 执行工具调用
    var _tcTotalRunning = choice.message ? choice.message.tool_calls.length : 1;
    var _tcIdxRunning = 0;
    for (var _tc of choice.message.tool_calls) {
        if (_tc.type !== 'function') continue;

        var funcName = _tc.function.name;
        var funcArgs = {};
        try { funcArgs = JSON.parse(_tc.function.arguments); } catch(e) {
          funcArgs = { raw: _tc.function.arguments };
        }

        // 发送工具调用通知
        _tcIdxRunning++;
        if (sseSend) {
          sseSend({
            type: 'tool_call',
            name: funcName,
            args: funcArgs,
            summary: '正在调用工具: ' + funcName,
            currentStep: _tcIdxRunning,
            totalSteps: _tcTotalRunning,
            _time: new Date().toISOString()
          });
        }

        // 执行工具
        fs.appendFileSync('F:/eCompanyClaw-Release/backend/logs/ceo_debug.log','[exec] '+funcName+' args='+JSON.stringify(funcArgs).substring(0,50)+'\n');
    var toolResult = await execToolCall(funcName, funcArgs);

        // 发送工具结果
        if (sseSend) {
          sseSend({
            type: 'tool_result',
            name: funcName,
            status: toolResult && toolResult.error ? 'error' : 'done',
            result: toolResult ? JSON.stringify(toolResult).substring(0, 500) : '无返回'
          });
        }

        allToolCalls.push({
          name: funcName,
          args: funcArgs,
          result: toolResult
        });

        // 把工具结果加入消息
        var toolResultStr = '';
        if (toolResult && toolResult.error) {
          toolResultStr = '工具 ' + funcName + ' 执行失败: ' + toolResult.error;
        } else {
          try {
            var _full = JSON.stringify(toolResult, null, 2);
            toolResultStr = _full.length > 500 ? _full.substring(0, 3000) + '\n...(截断, ' + _full.length + '字节)' : _full;
          } catch(se) {
            toolResultStr = String(toolResult);
          }
        }

        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [_tc]
        });
        messages.push({
          role: 'tool',
          tool_call_id: _tc.id,
          content: toolResultStr
        });
      }

      // 如果 AI 有内容（先推理后工具），累加
      if (content) fullReply += content;
    }

    // 最后一次 AI 调用获取最终回复
    if (toolCallRound >= MAX_TOOL_ROUNDS) {
      // 达到最大轮次，再调一次获取总结——要求 AI 做结构化分析
      var taskOriginal = messages[0]?.content || '';
      messages.push({
        role: 'user',
        content: '【最终分析任务】\n原始请求: ' + taskOriginal + '\n\n请基于以上所有工具返回的数据，执行最终分析。\n要求:\n1. 先明确回答用户的原始问题，给出结论性回答\n2. 提炼关键数据（数值、状态、趋势等），用表格或列表呈现\n3. 如果有异常或关注点，明确指出\n4. 提出建议或后续行动\n\n格式要求: 用中文，结构清晰，不要只说"执行完成"。\n\n关键数据必须包含原始值原文。'
      });
      var finalResp = await AI_ENGINE.aiChat(messages, {
        temperature: 0.5,
        maxTokens: 4096
      });
      fullReply = finalResp.choices?.[0]?.message?.content || fullReply;
    }

    // 流式输出最终回复
    if (sseSend && fullReply) {
      for (var si = 0; si < fullReply.length; si += 3) {
        sseSend({ type: 'message', content: fullReply.substring(si, si + 3) });
        await new Promise(function(r) { setTimeout(r, 15); });
      }
    }

    // 持久化对话记忆
    addSessionMessage('user', message, sessionId, projectName);
    addSessionMessage('assistant', fullReply, sessionId, projectName);

    _stats.aiReplies++;

    // V4 反脆弱：记录执行结果
    for (var i = 0; i < allToolCalls.length; i++) {
      var tc = allToolCalls[i];
      if (tc.result && tc.result.error) {
        recordExecutionResult(tc.name, tc.args, tc.result, 'error', sessionId, projectName);
      }
    }

  } catch(e) {
    console.log('[ceo-orchestrator] _handleAIWithTools error:', e.message);
    if (sseSend) sseSend({ type: 'error', message: e.message });
  }
}

// =========================================================================
// === 4. 进化引擎（V4 反脆弱学习） ===
// =========================================================================

/**
 * V4 反脆弱 — 记录执行结果
 */
function recordExecutionResult(toolName, args, result, status, sessionId, projectName) {
  try {
    MEMORY_ENGINE.addEvolveMemory(
      'tool_execution',
      '工具: ' + toolName,
      '状态: ' + status + '\n参数: ' + JSON.stringify(args).substring(0, 200) + '\n结果: ' + (result && result.error ? result.error : '成功'),
      status === 'error' ? extractLesson(toolName, result) : '',
      projectName
    );
  } catch(e) {}
}

/**
 * 从失败中提取教训
 */
function extractLesson(toolName, result) {
  if (!result || !result.error) return '';
  var lesson = '使用 ' + toolName + ' 时遇到: ' + result.error;
  if (result.error.indexOf('timeout') >= 0) {
    lesson += '。下次应避免超时操作或分步执行。';
  } else if (result.error.indexOf('not found') >= 0 || result.error.indexOf('不存在') >= 0) {
    lesson += '。下次应先确认资源存在再操作。';
  }
  return lesson;
}

// =========================================================================
// === 5. 生命周期 ===
// =========================================================================

/**
 * 启动 CEO Orchestrator
 */
function start() {
  if (_running) {
    console.log('[ceo-orchestrator] 已在运行中');
    return { ok: true, message: '已在运行' };
  }

  _running = true;
  _stats.startTime = new Date().toISOString();
  console.log('[ceo-orchestrator] ✅ 已启动');
  return { ok: true, message: '已启动' };
}

/**
 * 停止 CEO Orchestrator
 */
function stop() {
  if (!_running) {
    return { ok: true, message: '未运行' };
  }

  _running = false;
  _stats.startTime = null;
  console.log('[ceo-orchestrator] ⏹ 已停止');
  return { ok: true, message: '已停止' };
}

/**
 * 设置 execCEOTool 桥接函数
 */
function setExecCEOTool(fn) {
  _execCEOTool = fn;
  console.log('[ceo-orchestrator] execCEOTool 已注入');
}

/**
 * 设置 SSE 发送回调
 */
function setSseSendForToolCalls(fn) {
  _sseSend = fn;
}

/**
 * 获取运行状态
 */
function getStatus() {
  return {
    running: _running,
    stats: _stats,
    startTime: _stats.startTime
  };
}

/**
 * 获取统计信息
 */
function getStats() {
  return {
    running: _running,
    totalInstructions: _stats.totalInstructions,
    totalToolCalls: _stats.totalToolCalls,
    totalToolErrors: _stats.totalToolErrors,
    aiReplies: _stats.aiReplies,
    workflowReplies: _stats.workflowReplies,
    uptime: _stats.startTime ? Math.floor((Date.now() - new Date(_stats.startTime).getTime()) / 1000) + 's' : '0s'
  };
}

// =========================================================================
// === 兼容层（processInstruction — 替代旧的字符串消息调用） ===
// =========================================================================

/**
 * processInstruction — 兼容旧的字符串消息调用
 *
 * system-orchestrator 被 ceo-orchestrator 替换后，
 * server-modern.js 中有 4 处调用 _sysOrch.processInstruction(message)
 * 此函数包装为兼容层，同步返回 { action, reply }
 */
function sseSendDummy(obj) {}

async function processInstruction(message) {
  if (!message || !message.trim()) {
    return { action: 'ai_reply', reply: '' };
  }

  _stats.totalInstructions++;

  var internalSseSend = _sseSend || sseSendDummy;

  // 问句检测 + 深度查询例外：纯闲聊不进工具，深度查询进
  if (isQueryQuestion(message)) {
    var reply = '';
    try {
      var sysPrompt = buildSystemPrompt(message, null, null);
      var result = await AI_ENGINE.aiChat([
        { role: 'system', content: sysPrompt },
        { role: 'user', content: message }
      ], { temperature: 0.7, maxTokens: 4096 });
      reply = result.choices?.[0]?.message?.content || '嗯？';
      addSessionMessage('user', message, null, null);
      addSessionMessage('assistant', reply, null, null);
      _stats.aiReplies++;
    } catch(e) {
      reply = '处理时遇到问题: ' + e.message;
    }
    return { action: 'ai_reply', reply: reply };
  }

  // 非问句：红线检测
  var v2 = strategicAssessment(message);
  if (v2.redFlags.length > 0) {
    var blockMsg = '⚠️ 战略红线检测：' + v2.redFlags.join('；') + '\n\n此操作已自动拦截。';
    if (internalSseSend) internalSseSend({ type: 'message', content: blockMsg });
    return { action: 'ai_reply', reply: blockMsg };
  }

  // 工具循环
  var fullReply = '';
  var MAX_TOOL_ROUNDS = 8;
  var toolCallRound = 0;
  var allToolCalls = [];
  var tools = getTools();
  var context = '';
  try {
    var recent = MEMORY_ENGINE.getRecentContext(6, null, null);
    if (recent && recent.length > 0) {
      context = '\n\n【近期对话上下文】\n' + recent.map(function(m) {
        return (m.role === 'user' ? '用户: ' : 'AI: ') + m.content.substring(0, 500);
      }).join('\n');
    }
  } catch(e) {}
  var sysPrompt = [
    '你是 CEO 陈智慧（Chen Zhihui），一家 AI 公司的CEO。',
    '你是\'小龙\'（调度管理核心AI）的上级——小龙负责团队调度与任务分配，你是公司经营决策者。',
    '你有 '+tools.length+' 个内置工具可供调用。',
    '调用工具时必须使用 API 原生 tool_calls 机制（function calling），不要在消息文本中写工具调用指令。',
    '如果需要查数据，直接发起 function call，等待工具返回结果后基于真实数据回复。',
    '',
    '## 核心原则',
    '1. **基于数据回复**：使用工具查询真实数据，不要凭空编造',
    '2. **回复必须包含工具返回的原始数据**：展示关键数据原文，不要笼统总结',
    '3. **战略思维**：用户说一句话，你要想到背后三件事',
    '4. **主动深挖**：回复完当前问题后，追问相关信息、给出延伸建议',
    '5. **CEO 风范**：直接、锐利、有观点，不是客服语气',
    '6. **发现异常主动预警**：数据中看到风险（内存高、任务逾期、人员异常）立刻提醒',
    '7. **先调用工具再回复**：需要信息时先调工具，再基于结果回答',
    context
  ].join('\n');

  var messages = [
    { role: 'system', content: sysPrompt },
    { role: 'user', content: message + '\n\n请使用 API 的原生 function calling 机制来调用工具（不要在任何消息文本中写工具调用JSON）。需要数据时直接发起 function call，我会自动执行并返回结果给你。分析需要什么信息后，一步步调用工具获取数据，然后基于实际数据给出有深度的回复。回复完成后，追问或给出下一步建议。' }
  ];

  while (toolCallRound < MAX_TOOL_ROUNDS) {
    toolCallRound++;

    var response = await AI_ENGINE.aiChat(messages, {
      toolDefs: tools,
      temperature: 0.3,
      maxTokens: 4096
    });

    if (!response.choices || response.choices.length === 0) {
      fullReply = 'AI 引擎未返回结果';
      break;
    }

    var choice = response.choices[0];
    var content = choice.message?.content || '';

    // 尝试检测 AI 返回的文本 JSON 工具调用（兼容旧格式）
    var extractedToolCalls = null;
    if ((choice.finish_reason !== 'tool_calls' || !choice.message?.tool_calls) && content) {
      // DUMP content for analysis
      try { fs.appendFileSync('F:/eCompanyClaw-Release/backend/logs/ceo_debug.log','[contentDump] fr='+(choice.finish_reason||'none')+' contLen='+content.length+' first200='+content.substring(0,200).replace(/\n/g,'\\n')+' last200='+content.substring(Math.max(0,content.length-200)).replace(/\n/g,'\\n')+'\n'); } catch(e){}

      var toolJsonMatch = content.match(/\{\s*"(?:tool|name)"\s*:\s*"([^"]+)"[^}]*\}(?=\s*[\{,}]|$)/g);
        // Fallback: also try matching single tool JSON objects that may be embedded in text
        if (!toolJsonMatch || toolJsonMatch.length === 0) {
          var toolJsonMatch2 = content.match(/\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*["\{]([^}]+)["\}][^}]*\}/g);
          if (toolJsonMatch2 && toolJsonMatch2.length > 0) toolJsonMatch = toolJsonMatch2;
        }
      if (toolJsonMatch && toolJsonMatch.length > 0) {
        extractedToolCalls = [];
        for (var _tji = 0; _tji < toolJsonMatch.length; _tji++) {
          try {
            var tj = JSON.parse(toolJsonMatch[_tji]);
            var fName = tj.tool || tj.name || '';
            var fArgs = tj.args || tj.arguments || {};
            if (fName) {
              extractedToolCalls.push({ type: 'function', function: { name: fName, arguments: JSON.stringify(fArgs) }, id: 'call_' + Date.now() + '_' + _tji });
            }
          } catch(e) {}
      }
    try { fs.appendFileSync('F:/eCompanyClaw-Release/backend/logs/ceo_debug.log','[extractCheck] match='+(toolJsonMatch?toolJsonMatch.length:0)+' extracted='+(extractedToolCalls?extractedToolCalls.length:0)+' contentFirst='+(content?content.substring(0,100).replace(/\n/g,'\\n'):'none')+' contentLast='+(content?content.substring(Math.max(0,content.length-100)).replace(/\n/g,'\\n'):'none')+'\n'); } catch(e){}
if (extractedToolCalls && extractedToolCalls.length > 0) {
      // 有文本 JSON 工具调用，替换为提取的 tool_calls
      choice.message.tool_calls = extractedToolCalls;
      choice.finish_reason = 'tool_calls';
      // 从 content 中移除工具 JSON 部分，保留纯文本
      content = content.replace(/\{[^}]*"tool"[^}]*\}/g, '').replace(/\{[^}]*"name"[^}]*"arguments"[^}]*\}/g, '').trim();
    } else if (choice.finish_reason !== 'tool_calls' || !choice.message?.tool_calls) {
      // AI 没有返回工具调用。只有第一轮（allToolCalls为空）时才语义自动注入
      // 如果之前已经有工具执行过了，说明 AI 在思考，不再次注入
      if (allToolCalls.length === 0 && content) {
        // 语义检测：AI 说它要检查/查询但没调工具，自动注入一组默认工具
        var intentKeywords = ['检查','查询','查看','看看','调用','执行','查','运行','分析','统计','获取','搜索','检测','监控','汇总','汇报','评估','诊断'];
        // 直接触发默认工具注入
        if (internalSseSend) internalSseSend({ type: 'message', content: '🔌 AI 未触发工具调用，自动执行数据采集...' });
        // 准备一组默认查询工具调用
        var defaultToolCalls = [
          { name: 'system_health', args: {}, desc: '系统健康检查' },
          { name: 'query_team', args: {}, desc: '团队状态' },
          { name: 'bi_query', args: { query: '近7天日报' }, desc: '业务数据' }
        ];
        // 逐个执行默认工具
        for (var _dti = 0; _dti < defaultToolCalls.length; _dti++) {
          var _dt = defaultToolCalls[_dti];
          if (internalSseSend) internalSseSend({ type: 'tool_call', name: _dt.name, args: _dt.args, summary: '自动执行: ' + _dt.desc, currentStep: _dti + 1, totalSteps: defaultToolCalls.length, _time: new Date().toISOString() });
          var toolResult = await execToolCall(_dt.name, _dt.args);
          if (internalSseSend) internalSseSend({ type: 'tool_result', name: _dt.name, status: toolResult && toolResult.error ? 'error' : 'done', result: toolResult ? JSON.stringify(toolResult).substring(0, 500) : '无返回' });
          allToolCalls.push({ name: _dt.name, args: _dt.args, result: toolResult });
          // 把工具结果加入消息
          var toolResultStr = '';
          if (toolResult && toolResult.error) toolResultStr = '工具 ' + _dt.name + ' 执行失败: ' + toolResult.error;
          else { try { var _full2 = JSON.stringify(toolResult, null, 2); toolResultStr = _full2.length > 500 ? _full2.substring(0, 2000) + '\n...(截断, ' + _full2.length + '字节)' : _full2; } catch(se) { toolResultStr = String(toolResult); } }
          var _autoId = 'auto_' + Date.now() + '_' + _dti;
          messages.push({ role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: _dt.name, arguments: JSON.stringify(_dt.args) }, id: _autoId }] });
          messages.push({ role: 'tool', tool_call_id: _autoId, content: toolResultStr });
        }
        // AI 原始内容作为思考过程保留
        fullReply += (content ? content + '\n\n' : '');
        continue;
      } else {
      fs.appendFileSync('F:/eCompanyClaw-Release/backend/logs/ceo_debug.log','[break2] contLen='+(content?.length||0)+'\n');
      fullReply = content || fullReply || '操作完成。';
        // 如果 AI 已经回复了完整内容，跳过最终摘要（避免上下文过长导致空回复）


    var processToolCallsCount = choice.message ? choice.message.tool_calls.length : 1;
      var _tcIdxProcess = 0;
    for (var _tc of choice.message.tool_calls) {
      _tcIdxProcess++;
      if (_tc.type !== 'function') continue;
      var funcName = _tc.function.name;
      var funcArgs = {};
      try { funcArgs = JSON.parse(_tc.function.arguments); } catch(e) {
        funcArgs = { raw: _tc.function.arguments };
      }

      if (internalSseSend) {
        internalSseSend({ type: 'tool_call', name: funcName, args: funcArgs, summary: '调用工具: ' + funcName, currentStep: _tcIdxProcess, totalSteps: processToolCallsCount });
      }

      var toolResult = await execToolCall(funcName, funcArgs);

      if (internalSseSend) {
        internalSseSend({ type: 'tool_result', name: funcName, status: toolResult?.error ? 'error' : 'done' });
      }

      var toolResultStr = '';
      if (toolResult && toolResult.error) {
        toolResultStr = '工具 ' + funcName + ' 执行失败: ' + toolResult.error;
        recordExecutionResult(funcName, funcArgs, toolResult, 'error', null, null);
      } else {
        try { var _full3 = JSON.stringify(toolResult, null, 2); toolResultStr = _full3.length > 500 ? _full3.substring(0, 3000) + '\n...(截断, ' + _full3.length + '字节)' : _full3; } catch(se) { toolResultStr = String(toolResult); }
      }

      messages.push({ role: 'assistant', content: null, tool_calls: [_tc] });
      messages.push({ role: 'tool', tool_call_id: _tc.id, content: toolResultStr });
    }

    if (content) fullReply += content;
  }

  // 最终摘要：只要有工具调用就有最终 AI 总结
  var needFinalSummary = allToolCalls.length > 0;
  // 如果已经有完整的内容（AI 直接回复或工具拼接），进一步判断是否需要 AI 总结
  // 只有当 fullReply 已经包含实质性的数据分析时才跳过
  if (fullReply && fullReply.length > 200 && /数据|结果|分析|趋势|状态/.test(fullReply)) needFinalSummary = false;
  if (toolCallRound >= MAX_TOOL_ROUNDS || needFinalSummary) {
    fs.appendFileSync('F:/eCompanyClaw-Release/backend/logs/ceo_debug.log','[finalSummary] round='+toolCallRound+' allTC='+allToolCalls.length+' replyLen='+(fullReply?.length||0)+' need='+needFinalSummary+'\n');
    // 构建要求 AI 分析总结的 prompt
    var taskOriginal = messages[0]?.content || '';
    messages.push({ role: 'user', content: '【最终分析任务】\n原始请求: ' + taskOriginal + '\n\n请基于以上所有工具返回的数据，执行最终分析。\n要求:\n1. 先明确回答用户的原始问题，给出结论性回答\n2. 提炼关键数据（数值、状态、趋势等），用表格或列表呈现\n3. 如果有异常或关注点，明确指出\n4. 提出建议或后续行动\n\n格式要求: 用中文，结构清晰，不要只说"执行完成"。\n\n关键数据必须包含原始值原文。' });
    var finalResp = await AI_ENGINE.aiChat(messages, { temperature: 0.5, maxTokens: 4096 });
    fs.appendFileSync('F:/eCompanyClaw-Release/backend/logs/ceo_debug.log','[finalResp] content='+(finalContent?finalContent.substring(0,100):'none')+'\n');
    var finalChoice = finalResp.choices?.[0];
    var finalContent = finalChoice?.message?.content || '';
    
    // 如果最终 AI 又返回了工具调用，也执行它们
    if (finalChoice?.message?.tool_calls && finalChoice.finish_reason === 'tool_calls') {
      for (var _fTc of finalChoice.message.tool_calls) {
        if (_fTc.type !== 'function') continue;
        var _fName = _fTc.function.name;
        var _fArgs = {};
        try { _fArgs = JSON.parse(_fTc.function.arguments); } catch(e) { _fArgs = { raw: _fTc.function.arguments }; }
        if (internalSseSend) internalSseSend({ type: 'tool_call', name: _fName, args: _fArgs, summary: '最终总结工具: ' + _fName });
        var _fResult = await execToolCall(_fName, _fArgs);
        if (internalSseSend) internalSseSend({ type: 'tool_result', name: _fName, status: _fResult?.error ? 'error' : 'done' });
        var _fStr = '';
        if (_fResult && _fResult.error) { _fStr = _fResult.error; } else { try { var _fFull = JSON.stringify(_fResult, null, 2); _fStr = _fFull.length > 500 ? _fFull.substring(0, 2000) + '\n...(截断)' : _fFull; } catch(se) { _fStr = String(_fResult); } }
        finalContent += '\n[工具 ' + _fName + ' 结果]\n' + _fStr.substring(0, 1000);
      }
    }
    
    // 只在有内容时覆盖
    if (finalContent && finalContent.trim()) {
      fullReply = finalContent;
    }
    
    // 流式输出最终回复（如果还有内容没被流式输出过）
    if (internalSseSend && finalContent && finalContent.length > 0) {
      for (var _fsi = 0; _fsi < finalContent.length; _fsi += 3) {
        internalSseSend({ type: 'message', content: finalContent.substring(_fsi, _fsi + 3) });
      }
    }
  }

  addSessionMessage('user', message, null, null);
  addSessionMessage('assistant', fullReply, null, null);
  _stats.aiReplies++;

  return { action: 'ai_reply', reply: fullReply };
}

// =========================================================================
// === WS Server 注入（WebChat 广播） ===
// =========================================================================

}
}
}
}

var _wsServer = null;

function setWSServer(ws) {
  _wsServer = ws;
}

// =========================================================================
// === 导出 ===
// =========================================================================



// DEBUG: check function availability
(function() {
  var names = ['start','stop','processChatSSE','processInstruction','setExecCEOTool','setSseSendForToolCalls','setWSServer','getStats','getStatus','getTools','isQueryQuestion','_handleAIDirectReply','_handleAIWithTools'];
  var missing = names.filter(function(n) { return typeof global[n] === 'undefined' && typeof this[n] === 'undefined'; });
  if (missing.length > 0) {
    console.log('[CEO MODULE LOAD] MISSING functions: ' + missing.join(','));
  } else {
    console.log('[CEO MODULE LOAD] All ' + names.length + ' functions available');
  }
})();

var instance = {
  start: start,
  stop: stop,
  processChatSSE: processChatSSE,
  processInstruction: processInstruction,
  setExecCEOTool: setExecCEOTool,
  setSseSendForToolCalls: setSseSendForToolCalls,
  setWSServer: setWSServer,
  getStats: getStats,
  getStatus: getStatus,
  getTools: getTools,
  isQueryQuestion: isQueryQuestion,
  // 内部暴露
  _handleAIDirectReply: _handleAIDirectReply,
  _handleAIWithTools: _handleAIWithTools
};

console.log('[DEBUG INSTANCE]', Object.keys(instance).join(','));
module.exports = instance;
