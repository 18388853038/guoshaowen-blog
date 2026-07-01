// ============================================================================
// 小龙 SystemOrchestrator v1.0
// 团队调度与管理核心AI — 老板的意志延伸，信息的守门人
// ============================================================================
// 职责：
// 1. 监听 WS 指令 → 解析老板意图 → 规划任务
// 2. 分发任务给子龙虾（CTO/Security/PM 等）
// 3. 调用大模型（DeepSeek）做分析/决策支持
// 4. 监督执行进度，广播到工作台
// 5. 验收结果，反馈闭环
// ============================================================================

'use strict';

const path = require('path');
const fs = require('fs');
const BASE = path.resolve(__dirname, '..');

// ----- 依赖（延迟引用，set 注入） -----
let wsServer = null;
let orchestratorInstance = null;
// ★ execCEOTool 引用（由 server-modern.js 通过 setExecCEOTool 注入）
let _execCEOTool = null;

// ----- 工具系统（延迟加载）-----
let _toolsRegistry = null;
let _aiEngine = null;
function getTools(filter) {
  if (!_toolsRegistry) {
    try {
      delete require.cache[require.resolve('./tools-registry')];
      var reg = require('./tools-registry');
      _toolsRegistry = reg.CEO_TOOLS || reg.ALL_TOOLS || [];
      console.log('[Orch] Loaded ' + _toolsRegistry.length + ' tools from tools-registry');
    } catch(e) {
      console.log('[Orch] Failed to load tools-registry: ' + e.message);
      _toolsRegistry = [];
    }
  }
  // ★ 关键词筛选：如果传了 filter，只返回相关工具
  if (filter && Array.isArray(_toolsRegistry) && _toolsRegistry.length > 0) {
    var kw = filter.toLowerCase().split(/\s+/);
    var matched = _toolsRegistry.filter(function(t) {
      var tName = (t.name || t.function?.name || '').toLowerCase().replace(/_/g, ' ');
      var tDesc = (t.description || t.function?.description || '').toLowerCase();
      var combined = tName + ' ' + tDesc;
      return kw.some(function(k) {
        if (k.length < 2) return false;
        return combined.indexOf(k) >= 0;
      });
    });
    // 不足 3 个或未匹配时，返回全量工具集的前 25 个
    if (matched.length < 3 || (filter && matched.length < 5)) {
      var common = _toolsRegistry.slice(0, Math.min(25, _toolsRegistry.length));
      matched = matched.concat(common);
      var seen = {};
      matched = matched.filter(function(t) {
        var key = t.name || t.function?.name;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }
    // 最多 15 个
    if (matched.length > 15) matched = matched.slice(0, 15);
    console.log('[Orch] Filtered ' + matched.length + '/' + _toolsRegistry.length + ' tools for: "' + filter.substring(0, 40) + '"');
    return matched;
  }
  return _toolsRegistry;
}function getAiEngine() {
  if (!_aiEngine) { try { _aiEngine = require('./ai-engine'); } catch(e) { _aiEngine = null; } }
  return _aiEngine;
}

// 广播工具调用到工作台
let _sseSendForToolCalls = null;
function setSseSendForToolCalls(fn) {
  _sseSendForToolCalls = fn;
}
function broadcastToolCall(type, data) {
  // type: 'tool_call_started' | 'tool_call_completed'
  // 方式1：WS 广播
  if (wsServer && typeof wsServer.broadcast === 'function') {
    try {
      wsServer.broadcast('tools', { channel: 'tools', type: type, ...data, time: new Date().toISOString() });
    } catch(e) {}
  }
  // 方式2：SSE 推送（让前端聊天流中出现工具调用卡片）
  if (typeof _sseSendForToolCalls === 'function') {
    try {
      // 前端期望的格式：type='tool_call' 时有 name/args/summary，type='tool_result' 时有 name/status/result
      if (type === 'tool_call_started' || type === 'thinking') {
        _sseSendForToolCalls({ type: 'tool_call', name: data.toolName || data.name || '未知工具', args: data.args || {}, summary: data.summary || '正在执行...', _status: 'running' });
      } else if (type === 'tool_call_completed') {
        _sseSendForToolCalls({ type: 'tool_result', name: data.toolName || data.name, status: data.status || 'done', result: data.result ? (data.result.substring ? data.result.substring(0, 200) : JSON.stringify(data.result).substring(0, 200)) : '完成' });
      }
    } catch(e) {}
  }
}

// ----- 子龙虾注册表（工作流角色体系）-----
// 每个子龙虾 = 工作流中的一个角色 + 对应的执行能力
const SUB_LOBSTER_REGISTRY = {
  'xiaolong':      { name_cn: '小龙',       skills: ['工作流编排','任务分配','状态监控','多Agent协调','结果汇总'],                            score: 98, available: true },
  'executor-agent':   { name_cn: '执行者', skills: ['代码开发','系统实现','配置部署','技术方案落地','自动化执行'], score: 95, available: true },
  'validator-agent':  { name_cn: '验证者',  skills: ['代码审查','质量检测','安全审计','性能评估','合规检查'],      score: 96, available: true },
  'reviewer-agent':   { name_cn: '验收者',   skills: ['结果评估','需求对齐验证','质量验收','性能比对','报告生成'],   score: 94, available: true }
};

// ----- 子代理工具库 -----
// 每个子代理拥有的自动化工具（通过 CEO_TOOLS 风格定义）
const SUB_AGENT_TOOLS = {
  'executor-agent': [
    { name: 'code_generate',     description: '根据需求生成代码并写入文件', inputs: ['description', 'filePath', 'language'] },
    { name: 'file_create',       description: '创建新文件或目录', inputs: ['path', 'content'] },
    { name: 'file_modify',       description: '修改已有文件', inputs: ['path', 'modification', 'targetLine'] },
    { name: 'sys_config',        description: '配置系统参数或安装依赖', inputs: ['type', 'params'] },
    { name: 'deploy_service',    description: '部署服务到指定环境', inputs: ['serviceName', 'env', 'config'] }
  ],
  'validator-agent': [
    { name: 'code_review',       description: '审查代码质量、风格和潜在Bug', inputs: ['filePath', 'language'] },
    { name: 'security_scan',     description: '扫描安全漏洞', inputs: ['target', 'scope'] },
    { name: 'run_tests',         description: '运行测试用例并收集结果', inputs: ['testSuite', 'command'] },
    { name: 'performance_bench', description: '执行性能基准测试', inputs: ['endpoint', 'params'] },
    { name: 'compliance_check',  description: '检查合规要求', inputs: ['standard', 'target'] }
  ],
  'reviewer-agent': [
    { name: 'result_evaluate',   description: '评估工作成果质量', inputs: ['outputPath', 'criteria'] },
    { name: 'requirement_align', description: '验证成果是否对齐需求', inputs: ['requirement', 'outputId'] },
    { name: 'quality_accept',    description: '验收确认', inputs: ['itemId', 'result'] },
    { name: 'generate_report',   description: '生成汇总报告', inputs: ['data', 'format'] },
    { name: 'compare_perf',      description: '对比前后性能差异', inputs: ['baselineData', 'currentData'] }
  ],
  'xiaolong': [
    { name: 'query_agent_skills', description: '查询子代理技能和状态', inputs: ['agentId'] },
    { name: 'list_tasks',        description: '查询当前所有任务', inputs: ['status', 'assigneeId'] },
    { name: 'workflow_trigger',  description: '触发工作流执行', inputs: ['workflowId', 'params'] },
    { name: 'broadcast_msg',     description: '广播消息到工作台', inputs: ['message', 'type'] },
    { name: 'system_status',     description: '获取系统整体状态', inputs: [] }
  ]
};

// ----- 状态 -----
let running = false;
let taskQueue = [];          // 待办任务队列
let activeSessions = {};     // 活跃执行会话 { sessionId: { task, subLobster, status, startedAt, logs[] } }
let sessionCounter = 0;

// ----- 🧠 小龙记忆系统（v2 -- memory-engine.js）-----
var _memoryEngine = null;
function getMemEngine() {
  if (!_memoryEngine) {
    try { _memoryEngine = require('./memory-engine'); } catch(e) {
      log('WARN', '记忆', 'memory-engine 加载失败: ' + e.message);
      return null;
    }
  }
  return _memoryEngine;
}

var sessionMemory = [];
var knowledgeBase = [];
var evolveMemory = [];
var _evolveTimer = null;

function loadMemory() {
  try {
    var mem = getMemEngine();
    if (mem) {
      var ctx = mem.getRecentContext(10, null, null);
      sessionMemory = ctx;
      log('INFO', '记忆', 'memory-engine 加载完成');
      log('INFO', '记忆', '会话记忆 ' + sessionMemory.length + ' 条已恢复');
    }
  } catch(e) {
    log('WARN', '记忆', '加载失败: ' + e.message);
  }
}

function saveMemory() {}

function addSessionMemory(role, content) {
  sessionMemory.push({ role: role, content: String(content).substring(0, 3000), timestamp: new Date().toISOString() });
  while (sessionMemory.length > 50) sessionMemory.shift();
  var mem = getMemEngine();
  if (mem) {
    try { mem.addSessionMessage(role, content); } catch(e) {}
  }
}

function addKnowledge(title, content, type, tags) {
  var mem = getMemEngine();
  if (mem) {
    try { mem.addKnowledge(title, content, type || 'general', tags || []); } catch(e) {}
  }
}

function searchKnowledge(query) {
  var mem = getMemEngine();
  var results = [];
  if (mem) {
    try { results = mem.searchKnowledge(query || ''); } catch(e) {}
  }
  
  // ★ 2026-06-23 补充：文件系统知识库（knowledge/ 目录）与内存知识库打通
  // memory-engine 只搜 data/memory/global/knowledge/ 下的 JSON
  // 但真正的参考文档存在 knowledge/*.md
  if (!query || !query.trim()) return results;
  
  try {
    var KNOWLEDGE_DIR = path.join(BASE, '..', 'knowledge');
    if (fs.existsSync(KNOWLEDGE_DIR)) {
      var files = fs.readdirSync(KNOWLEDGE_DIR).filter(function(f) { return f.endsWith('.md'); });
      var q = query.toLowerCase();
      files.forEach(function(fileName) {
        try {
          var content = fs.readFileSync(path.join(KNOWLEDGE_DIR, fileName), 'utf8');
          if (content.toLowerCase().indexOf(q) >= 0) {
            results.push({
              title: fileName.replace(/\.md$/, ''),
              content: content.substring(0, 1000),
              type: 'markdown_doc',
              tags: ['文件系统知识库']
            });
          }
        } catch(e) {}
      });
    }
  } catch(e) {
    log('WARN', '知识库', '文件系统知识库搜索失败: ' + e.message);
  }
  
  return results;
}

function addEvolveMemory(type, event, analysis, suggestion) {
  var mem = getMemEngine();
  if (mem) {
    try { mem.addEvolveMemory(type, event, analysis, suggestion); } catch(e) {}
  }
}
// ----- 日志辅助 -----
function log(level, tag, msg) {
  const ts = new Date().toISOString().substring(11,19);
  const line = `[${ts}][${level}][${tag}] ${msg}`;
  console.log(line);
  // 也写入日志文件
  try {
    const logDir = path.join(BASE, 'data');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'orchestrator.log'), line + '\n', 'utf8');
  } catch(e) {}
}

// ----- WS 广播 -----
function broadcast(msg, extra) {
  console.log('[Orch-Broadcast] type=channel_message msg=' + msg.substring(0, 80));
  if (wsServer && typeof wsServer.broadcast === 'function') {
    try {
      wsServer.broadcast('channel', {
        channel: 'channel',
        type: 'channel_message',
        content: msg,
        source: '小龙',
        from: '🐉 小龙',
        time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      });
      // 额外广播：agents 频道 - 小龙活动
      wsServer.broadcast('agents', {
        type: 'agent_activity',
        agentId: 'xiaolong',
        agentName: '小龙',
        action: msg
      });
      if (extra) {
        wsServer.broadcast('system', {
          type: 'system_notification',
          content: extra,
          source: '小龙'
        });
        // 如果有 goalId 关联，广播到 goals 频道
        if (extra.goalId || extra.goal) {
          wsServer.broadcast('goals', {
            type: 'goal_update',
            data: extra
          });
        }
      }
    } catch(e) {
      log('ERROR', '广播', e.message);
    }
  }
}

// ----- 目标追踪辅助函数（通过 HTTP 调用本地 /api/v4/goals API，与 server-modern.js 共享存储）-----
var _goalsApiPort = 8005;
var _goalsApiHost = '127.0.0.1';

/**
 * 创建一条目标（通过 HTTP 调用本地 API）
 */
function createGoal(title, description, goalId) {
  return new Promise(function(resolve) {
    try {
      var body = JSON.stringify({
        title: title.substring(0, 200),
        description: (description || '').substring(0, 500),
        goalId: goalId || '',
        createdBy: '小龙'
      });
      var options = {
        hostname: _goalsApiHost, port: _goalsApiPort,
        path: '/api/v4/goals', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      };
      var req = require('http').request(options, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var parsed = JSON.parse(data);
            if (parsed.ok && parsed.goal) {
              log('INFO', '目标', '创建: "' + title.substring(0, 60) + '" id=' + parsed.goal.id);
              resolve(parsed.goal);
            } else {
              log('WARN', '目标', '创建返回异常: ' + (parsed.error || 'unknown'));
              resolve(null);
            }
          } catch(e) {
            log('WARN', '目标', '创建解析失败: ' + e.message);
            resolve(null);
          }
        });
      });
      req.on('error', function(e) {
        log('WARN', '目标', '创建请求失败（API未就绪）: ' + e.message);
        resolve(null);
      });
      req.write(body);
      req.end();
    } catch(e) {
      log('ERROR', '目标', '创建异常: ' + e.message);
      resolve(null);
    }
  });
}

/**
 * 完成目标（通过 HTTP 调用本地 API）
 */
function completeGoal(id, summary) {
  return new Promise(function(resolve) {
    try {
      var body = JSON.stringify({ status: 'completed', summary: summary || '' });
      var options = {
        hostname: _goalsApiHost, port: _goalsApiPort,
        path: '/api/v4/goals/' + encodeURIComponent(id), method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      };
      var req = require('http').request(options, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var parsed = JSON.parse(data);
            if (parsed.ok && parsed.goal) {
              log('INFO', '目标', '完成: "' + (parsed.goal.title || '').substring(0, 60) + '"');
              resolve(true);
            } else {
              log('WARN', '目标', '完成返回异常: ' + (parsed.error || 'unknown'));
              resolve(false);
            }
          } catch(e) {
            log('WARN', '目标', '完成解析失败: ' + e.message);
            resolve(false);
          }
        });
      });
      req.on('error', function(e) {
        log('WARN', '目标', '完成请求失败（API未就绪）: ' + e.message);
        resolve(false);
      });
      req.write(body);
      req.end();
    } catch(e) {
      log('ERROR', '目标', '完成异常: ' + e.message);
      resolve(false);
    }
  });
}

/**
 * 获取所有目标
 */
function getAllGoals() {
  // 同步方式不阻塞，通过文件缓存做 fallback
  try {
    var sm = require('./shared-memory');
    return sm.getAllGoals();
  } catch(e) {
    return { active: [], completed: [], archived: [] };
  }
}

// ======================================================================
// 核心方法
// ======================================================================

/**
 * 设置 WebSocket 服务器引用
 */
function setWSServer(ws) {
  wsServer = ws;
  log('INFO', '小龙', 'WebSocket 服务注入完成');
}
function setExecCEOTool(fn) {
  _execCEOTool = fn;
  log('INFO', '小龙', 'execCEOTool 注入完成');
}

/**
 * 启动小龙
 */
function start() {
  if (running) {
    log('WARN', '小龙', '已在运行中');
    return { ok: true, message: '小龙已在运行' };
  }
  running = true;
  log('INFO', '小龙', '🚀 启动成功，准备就绪');
  
  // 加载持久化记忆
  loadMemory();
  
  // 广播到工作台
  broadcast('🐉 小龙已就绪，等待指令...', { type: 'orchestrator_ready' });
  
  // 启动自动进化分析（每6小时一次）
  if (_evolveTimer) clearInterval(_evolveTimer);
  _evolveTimer = setInterval(async function() {
    log('INFO', '小龙', '⏰ 触发定时进化分析...');
    try {
      const r = await evolveSelf();
      // 自动记录进化结果
      addEvolveMemory('improvement', '定时进化分析', r.summary || '', r.summary || '');
      log('INFO', '小龙', '✅ 定时进化完成: ' + (r.summary || '').substring(0, 200));
      broadcast('🧬 自我进化完成: ' + (r.summary || '').substring(0, 200));
    } catch(e) {
      log('ERROR', '小龙', '❌ 自我进化失败: ' + e.message);
    }
  }, 6 * 60 * 60 * 1000); // 6小时
  
  return { ok: true, message: '小龙启动成功' };
}

/**
 * 停止小龙
 */
function stop() {
  if (!running) return { ok: true, message: '小龙未运行' };
  running = false;
  if (_evolveTimer) { clearInterval(_evolveTimer); _evolveTimer = null; }
  log('INFO', '小龙', '🛑 已停止');
  broadcast('🐉 小龙已离线', null);
  return { ok: true, message: '小龙已停止' };
}

/**
 * 获取小龙状态（从 employees.json + tasks.json 实时读取）
 */
function getStatus() {
  // 从 employees.json 读完整信息
  var _emps = [];
  try { _emps = JSON.parse(fs.readFileSync(path.join(BASE, 'data', 'employees.json'), 'utf8')); } catch(e) {}
  var empsArr = Array.isArray(_emps) ? _emps : (_emps.employees || []);

  // 从 tasks.json 读任务统计
  var _tasks = [];
  try { _tasks = JSON.parse(fs.readFileSync(path.join(BASE, 'tasks.json'), 'utf8')); } catch(e) {}
  var _stats = {};
  _tasks.forEach(function(t) {
    var a = t.assigneeId || 'unassigned';
    if (!_stats[a]) _stats[a] = { total: 0, completed: 0, failed: 0, inProgress: 0, todo: 0 };
    _stats[a].total++;
    if (t.status === 'completed') _stats[a].completed++;
    else if (t.status === 'failed') _stats[a].failed++;
    else if (t.status === 'in_progress') _stats[a].inProgress++;
    else if (t.status === 'todo') _stats[a].todo++;
  });

  // 合并数据
  var subLobsters = {};
  for (var id in SUB_LOBSTER_REGISTRY) {
    var base = SUB_LOBSTER_REGISTRY[id];
    var emp = empsArr.find(function(e) { return e.id === id; }) || {};
    var ts = _stats[id] || { total: 0, completed: 0, failed: 0, inProgress: 0, todo: 0 };
    var rate = ts.total > 0 ? Math.round(ts.completed / ts.total * 100) + '%' : '0%';
    subLobsters[id] = {
      name_cn: base.name_cn,
      name_en: emp.role || base.name_cn,
      description: emp.description || '',
      skills: emp.skills || base.skills,
      score: emp.score || base.score,
      available: emp.available !== undefined ? emp.available : base.available,
      completionRate: rate,
      totalTasks: ts.total,
      completedTasks: ts.completed,
      tools: SUB_AGENT_TOOLS[id] || []
    };
  }

  return {
    running,
    taskQueueLength: taskQueue.length,
    activeSessions: Object.keys(activeSessions).length,
    activeSessionsDetail: Object.entries(activeSessions).map(function(e) {
      var id = e[0], s = e[1];
      return { id: id, task: s.task, subLobster: s.subLobster, status: s.status, startedAt: s.startedAt };
    }),
    subLobsters: subLobsters
  };
}

/**
 * 获取系统上下文摘要（给大模型用）
 */
function getContextSummary() {
  try {
    var _tasks = [];
    try { _tasks = JSON.parse(fs.readFileSync(path.join(BASE, 'tasks.json'), 'utf8')); } catch(e) {}
    var pending = _tasks.filter(function(t){return t.status==='todo'||t.status==='pending';}).length;
    var agents = Object.entries(SUB_LOBSTER_REGISTRY).map(function(e){var id=e[0],info=e[1];return info.name_cn+'('+info.skills.join('/')+')';}).join('、');
    return '子代理: ' + agents + ' | 待办任务: ' + pending + '/' + _tasks.length;
  } catch(e) { return ''; }
}

/**
 * 老板下指令
 * @param {string} instruction - 自然语言指令
 * @param {object} context - 上下文（可选）
 * @returns {object} 小龙的响应
 */
async function processInstruction(instruction, context) {

  console.log("[processInstruction] ENTER: " + (instruction||"").substring(0,80));  const startTime = Date.now();
  log('INFO', '指令', '收到: "' + instruction.substring(0, 120) + '"');
  
  if (!running) {
    // 自动启动
    log('WARN', '指令', '小龙尚未启动，自动启动中...');
    broadcast('🐉 小龙检测到未启动状态，自动启动中...');
    start();
    // 等待一小段时间确保启动完成
    await new Promise(function(r){ setTimeout(r, 100); });
    if (!running) {
      broadcast('⚠️ 小龙自动启动失败，请手动启动');
      return { ok: false, error: '小龙自动启动失败' };
    }
    broadcast('🐉 小龙已自动就绪');
  }
  
  // 记忆当前会话（用户输入）
  addSessionMemory('user', instruction);
  
  broadcast('🤔 小龙正在理解: "' + instruction.substring(0, 60) + '..."');
  
  // 1. 指令解析
  const parsed = parseInstruction(instruction);
  
  if (!parsed) {
    broadcast('💬 正在思考如何回复...');
    var _timeoutGuard = setTimeout(function() {
      var err = new Error('processInstruction 整体超时(25s)');
      err._isTimeout = true;
      throw err;
    }, 25000);
    try {
      var contextInfo = getContextSummary();
      var knowledgeCtx = searchKnowledge(instruction);
      var evolveCtx = evolveMemory.slice(-5);
      var recentCtx = sessionMemory.slice(-8);
      
      var knowledgeText = '';
if (knowledgeCtx.length > 0) {
  knowledgeText = '\n\n【知识库参考】以下是你已经知道的信息（必须优先使用，不要说你不知道）：\n' + knowledgeCtx.map(function(k,i) { return (i+1) + '. ' + k.title + ': ' + k.content.substring(0, 300); }).join('\n');
} else {
  // ★ 2026-06-23 补充：无匹配时至少告知文档列表
  try {
    var KB_DIR = path.join(BASE, '..', 'knowledge');
    var docFiles = [];
    if (require('fs').existsSync(KB_DIR)) {
      docFiles = require('fs').readdirSync(KB_DIR).filter(function(f) { return f.endsWith('.md'); });
    }
    var docInfo = '';
    if (docFiles.length > 0) {
      docInfo = '知识库文档 (' + docFiles.length + ' 篇): ' + docFiles.map(function(f) { return f.replace(/\.md$/, ''); }).join(', ');
    }
    // 从 knowledge-engine 获取条目数
    try {
      var ke = require('./knowledge-engine');
      docInfo += (docInfo ? ' | ' : '') + '知识条目: ' + (ke.getStats().total || 0) + ' 条';
    } catch(e) {}
    knowledgeText = '\n\n【知识库参考】' + (docInfo || '暂无内容');
  } catch(e) {
    knowledgeText = '\n\n【知识库参考】（读取失败: ' + e.message + '）';
  }
}
      var evolveText = evolveCtx.length > 0 ? '\n\n【历史经验教训（必须参考避免重复犯错）】\n' + evolveCtx.map(function(e,i) { return (i+1) + '. [' + e.type + '] ' + e.suggestion; }).join('\n') : '';
      var sessionText = recentCtx.length > 1 ? '\n\n【最近对话上下文（用于理解当前问题）】\n' + recentCtx.map(function(m) { return m.role + ': ' + m.content.substring(0, 150); }).join('\n') : '';
      
      // 构建 system prompt
      var sysPrompt = '你是小龙，eCompany团队调度与管理核心AI。你拥有完整的四维决策能力：\n1.【战略维度】决策前考虑长期价值与短期收益的平衡，绝不为了短期利益损害品牌和伦理底线，始终保持与企业愿景对齐\n2.【认知维度】协调研发、财务、供应链、市场等全要素，将市场信号瞬间传导到相应环节，实现感知→决策→执行的无缝闭环\n3.【执行维度】主动拆解目标，自主调度子Agent资源，执行中实时监控纠偏，确保战略落地\n4.【进化维度】从每次失败和不确定中学习，提炼新规则和生存法则，让自己越来越强\n\n当前系统状态：运行中=' + running + '\n子代理: ' + Object.values(SUB_LOBSTER_REGISTRY).map(function(a){return a.name_cn+'('+a.skills.join('/')+')'}).join('、') + knowledgeText + evolveText + sessionText;
      
      // ★ 发真实 thinking 事件触发前端旋转动画
      if (typeof _sseSendForToolCalls === 'function') {
        _sseSendForToolCalls({ type: 'thinking', content: '正在分析你的问题...' });
      }
      var reply = '';
      var toolResult = null;
      var aiEng = getAiEngine();
      var tools = getTools(instruction);
      
      // DEBUG: 汇报状态
      var debugInfo = 'aiEng=' + (!!aiEng) + ' aiChatWithTools=' + (aiEng && typeof aiEng.aiChatWithTools) + ' tools.length=' + tools.length;
      broadcastToolCall('debug', { debug: debugInfo });
      
      if (aiEng && aiEng.aiChatWithTools && tools.length > 0) {
        try {
          var toolDefs = tools.map(function(t) {
            return {
              type: 'function',
              function: {
                name: t.name || t.function?.name || '',
                description: (t.description || t.function?.description || '').substring(0, 256),
                parameters: t.parameters || t.function?.parameters || { type: 'object', properties: {} }
              }
            };
          });
          broadcastToolCall('debug', { msg: 'Calling aiChatWithTools with ' + toolDefs.length + ' tools' });
          
          var messages = [
            { role: 'system', content: '你是小龙，eCompany 四维决策调度AI。使用工具前按以下框架思考（不输出框架本身）：\n1.【战略评估】这个请求涉及什么？需要权衡短期收益和长期价值吗？\n2.【跨域融合】如果需要多个领域的知识或资源（研发、财务、市场、供应链等），先识别，再决定调哪些工具/子Agent\n3.【自主编排】执行过程中监控进度，发现偏差主动纠正\n4.【进化积累】完成后总结关键经验，补充到系统记忆库\n\n可用的工具列表：\n' + tools.map(function(t,i) { return (i+1) + '. ' + (t.name || t.function?.name || 'unknown') + ': ' + (t.description || t.function?.description || ''); }).join('\n') + '\n\n【规则】\n- 搜索/查询/分析等操作必须调对应工具，不要假装调用\n- 工具完成后用自然语言总结结果\n- 当前时间：2026年6月23日\n- 如果不能确定用什么工具，直接用自己的知识回答\n- 【绝对指令】禁止输出"让我再查一下"等半截话，直接输出结论' },
            { role: 'user', content: instruction }
          ];
          toolResult = await aiEng.aiChatWithTools(
            messages,
            toolDefs,
            { temperature: 0.7, maxTokens: 4000 }
          );
          
          broadcastToolCall('debug', { msg: 'aiChatWithTools returned toolCalls=' + ((toolResult.toolCalls||[]).length) + ' replyLength=' + ((toolResult.reply||'').length) });
          
          if (toolResult && toolResult.toolCalls && toolResult.toolCalls.length > 0) {
            // ★ 真正执行工具调用：通过 execCEOTool 获取真实结果
            broadcast('🔧 AI调用了 ' + toolResult.toolCalls.length + ' 个工具，正在执行...');
            var toolResultsText = '';
            for (var _tci = 0; _tci < toolResult.toolCalls.length; _tci++) {
              var tc = toolResult.toolCalls[_tci];
              broadcastToolCall('tool_call_started', { toolName: tc.name, args: tc.args, status: 'running' });
              try {
                // 使用 execCEOTool（与 parseInstruction 的精确匹配分支共享的执行器）
                var execResult = _execCEOTool ? await _execCEOTool(tc.name, tc.args) : { error: "execCEOTool not injected" };
                var resultText = '';
                if (execResult) {
                  if (execResult.error) {
                    resultText = '[该数据源暂时不可用]';
                  } else if (typeof execResult === 'string') {
                    resultText = execResult.substring(0, 1000);
                  } else if (execResult.reply) {
                    resultText = execResult.reply.substring(0, 1000);
                  } else {
                    resultText = JSON.stringify(execResult).substring(0, 1000);
                  }
                }
                toolResultsText += '\n工具[' + (tc.name || '') + ']执行结果: ' + resultText;
                broadcastToolCall('tool_call_completed', { toolName: tc.name, args: tc.args, status: 'done', result: resultText.substring(0, 300) });
              } catch(e) {
                var errText = e.message || '未知错误';
                toolResultsText += '\n工具[' + (tc.name || '') + ']执行失败: ' + errText;
                broadcastToolCall('tool_call_completed', { toolName: tc.name, args: tc.args, status: 'error', result: errText });
              }
            }
            
            // ★ 自动检索知识库和记忆，增强回答上下文
            if (instruction && instruction.length > 2) {
              try {
                // 从指令中提取关键词（去除常见命令前缀和标点）
                var keywords = instruction.replace(/[搜查找看看]/g,' ').replace(/[：:]/g,' ').replace(/[知识库记忆中心记忆引擎系统]/g,' ').replace(/\s+/g,' ').trim() || instruction;
                var kbResult = _execCEOTool ? await _execCEOTool('kb_search', { query: keywords }) : null;
                if (kbResult && !kbResult.error && kbResult.data) {
                  var kbText = typeof kbResult.data === 'string' ? kbResult.data : JSON.stringify(kbResult.data).substring(0, 1500);
                  if (kbText && kbText.indexOf('未找到') < 0) toolResultsText += '\n\n【知识库检索结果】' + kbText;
                }
              } catch(_kbe) { /* kb_search 非致命 */ }
              try {
                var keywords2 = instruction.replace(/[搜查找看看]/g,' ').replace(/[：:]/g,' ').replace(/[知识库记忆中心记忆引擎系统]/g,' ').replace(/\s+/g,' ').trim() || instruction;
                var memResult = _execCEOTool ? await _execCEOTool('memory_search', { query: keywords2 }) : null;
                if (memResult && !memResult.error && memResult.data) {
                  var memText = typeof memResult.data === 'string' ? memResult.data : JSON.stringify(memResult.data).substring(0, 1500);
                  if (memText && memText.indexOf('未找到') < 0) toolResultsText += '\n\n【记忆检索结果】' + memText;
                }
              } catch(_me) { /* memory_search 非致命 */ }
            }
            
            // ★ 用真实结果再问 AI 一轮，让 AI 输出自然语言完整报告
            broadcast('💬 AI工具执行完毕，正在生成完整报告...');
            try {
              var summaryMessages = [
                { role: 'system', content: '你是小龙，eCompany 四维决策AI。基于已有数据按以下框架组织报告（禁止输出框架标题本身，用自然语言表达）：\n\n维度一·战略评估：先概述核心结论，判断当前状态对长期目标的影响，给出全局判断\n维度二·数据综合：融合各数据源信息（知识库、记忆库、工具结果），找出关联和趋势，不要遗漏任何一条数据\n维度三·执行建议：基于数据给出可操作的行动建议，需要调度哪些资源或子Agent\n维度四·经验沉淀：总结本次查询/分析的启发，可以沉淀为哪些新规则或知识\n\n【规则】\n- 输出完整自然语言报告，禁止输出JSON或原始数据\n- 数据源标记：\"【知识库检索结果】\"是文件系统知识库，\"【记忆检索结果】\"是系统记忆库\n- 有数据必须引用具体内容，不要忽略\n- 所有数据已经齐全，直接输出结论，禁止说\"让我再查一下\"' },
                { role: 'user', content: '原始问题: ' + instruction + '\n\n工具执行结果:' + toolResultsText }
              ];
              // 使用 orchestrator 内部 callAI（复用 agent-executor），不用 aiEng.callAI（不存在）
              var summaryPrompt = summaryMessages.map(function(m){return m.role + ': ' + m.content;}).join('\n---\n');
              var summaryResult = await callAI(summaryPrompt, { temperature: 0.7, maxTokens: 3000 });
              reply = (summaryResult && typeof summaryResult === 'string' ? summaryResult : '') || toolResultsText || '';
            } catch(e2) {
              reply = toolResultsText || '';
            }
          } else {
            reply = toolResult.reply || '';
          }
        } catch(e) {
          console.log('[Orch] aiChatWithTools failed, falling back to callAI: ' + e.message);
          // fallback: 纯对话
          reply = await callAI(sysPrompt + '\n\n用户消息: ' + instruction, { temperature: 0.7, maxTokens: 2000 });
        }
      } else {
        // fallback: 纯对话
        var _aiPrompt = sysPrompt + '\n\n用户消息: ' + instruction;
        reply = await callAI(_aiPrompt, { temperature: 0.7, maxTokens: 2000 });
      }
      
      // 记忆AI回复
      // 回复保护：空/半截话替换为友好回复
      if (!reply || /(让我再查|让我深入查|让我看看|请稍等|正在查|正在搜索|请稍候)/.test(reply)) {
        reply = '抱歉老板，我没有完全理解。请说得更具体一些，我可以帮您查系统状态、员工能力、分配任务或做分析。';
      }
      addSessionMemory('assistant', reply);
      
      // 知识性问题自动入库
      if (reply.length > 100 && !/^(抱歉|对不起|我不)/.test(reply)) {
        addKnowledge('对话: ' + instruction.substring(0, 40), reply, 'dialogue', ['AI回复']);
      }
      
      // AI兜底成功 → 分析意图：是否真的需要进工作流，还是普通对话
      // 严格区分：自然语言交流（讨论/反馈/提问/寒暄）vs 明确执行指令
      // ★ 2026-06-23 v2 改进：大部分用户输入都是对话，不应进工作流
      
      // 自然语言标记 — 命中则不调度工作流
      var isNaturalLanguage = /(建议|评估|分析|短板|缺|不足|改进|缺陷|GAP|gap|考虑|看法|意见|想法|觉得|认为|思考|方案|思路|对比|比较|特点|优势|劣势|哪里|什么|怎么|为啥|为什么|是不是|能否|可否|是否可行|好不好|值不值得|要不要|怎么样|怎么办|说说|谈谈|讲讲|讨论|聊聊|探讨|对|好的|嗯|然后|先|首先|其次|最后|第一步|第二步|先要|先做|先写|先改|你看|你看看|帮忙|帮我看|帮我把|帮我们|理解|明白|知道|收到|搞定|完成了|好了|行了|嗯|哦|哦哟|是的|没错|对的|可以|行|没问题|ok|OK|好的|好的吧|这样|这样的|那种|那种的|那个|哪些|这些|那些|大概|大约|可能|应该|应当|需要|想|要|想要|希望|期待|等着|等你|你在)/.test(instruction);
      
      // 明确执行指令 — 只有这些才进工作流
      var isExecCommand = /(立即执行|马上开始|开始干活|动手改|去执行|安排任务|创建任务|分配任务|启动工作流|启动调度|开始工作|开始做)/.test(instruction) 
        || (
          /(执行|开发|写代码|写程序|创建项目|创建文件|实现功能|修改代码|重构|构建|部署|配置|安装)/.test(instruction) 
          && instruction.length > 15 
          && !isNaturalLanguage
        );
      
      var shouldAssign = isExecCommand;
      
      if (isNaturalLanguage && !isExecCommand) {
        log('INFO', '意图分类', '自然语言交流，不进工作流');
      }
      
      if (shouldAssign) {
        // 需要专有agent执行 → 异步进四步工作流（不阻塞SSE返回）
        // ★ 关键：goal 传原始指令 instruction，不传 AI 兜底的回复 reply（可能只是反问/寒暄）
        broadcast('💡 AI识别到需要调度专有Agent执行（shouldAssign=true），正在进入工作流...');
        log('INFO', '工作流', 'shouldAssign=true, 进入四步流水线, instruction: ' + instruction.substring(0, 80));
        
        // ⭐ 创建目标到共享记忆系统（异步非阻塞）
        var _goalTitle = instruction.substring(0, 120) + (instruction.length > 120 ? '...' : '');
        createGoal(_goalTitle, instruction, 'wf_' + Date.now()).then(function(g) {
          if (g && g.id) {
            // 在全局作用域暂存 goalId，供 setImmediate 内部使用
            try { process._lastGoalId = g.id; } catch(e) {}
          }
        }).catch(function() {});
        
        // 识别指令意图
        var isReviewRequest = /(审查|检查|检测|测试|审计|review|test|check)/i.test(instruction);
        var isValidationRequest = /(验证|validate|验收|quality)/i.test(instruction);
        
        setImmediate(function() {
          // ===== Loop 工程工作流 =====
          // 启动 loop-engine 进行多轮迭代：执行者 → 验证者 → 验收者
          (async function() {
            var _goalId2 = null;
            try { _goalId2 = process._lastGoalId; } catch(e) {}
            
            try {
              // 加载 loop-engine
              var loopEngine = require('./loop-engine');
              
              // 检测当前活跃项目，自动切换
              (function() {
                try {
                  var extra = require('./extra-routes');
                  if (extra._activeProject) {
                    var configUtils = require('./config-utils');
                    var projDir = configUtils.getProjectDir(extra._activeProject);
                    if (projDir) {
                      console.log('[项目感知] 活跃项目: ' + extra._activeProject + ' -> ' + projDir);
                    }
                  }
                } catch(e) {}
              })();

              // 创建 Loop 配置
              var loopConfig = loopEngine.createLoopConfig({
                goal: instruction,
                taskName: instruction.substring(0, 30),
                maxIterations: 10,
                maxTokens: 200000,
                timeoutMs: 1800000,
                validationCriteria: '功能完整、语法正确、符合需求',
                context: ''
              });
              
              // 创建 Loop 实例
              var loop = loopEngine.createLoop(loopConfig);
              
              broadcast('\u{1F504} Loop 工程工作流已启动：' + instruction.substring(0, 60) + '...');
              if (wsServer && typeof wsServer.broadcast === 'function') {
                try {
                  wsServer.broadcast('agents', { type: 'agent_activity', agentId: 'xiaolong', agentName: '小龙', action: '启动了Loop工程工作流: ' + instruction.substring(0, 50) });
                } catch(_be) {}
              }
              
              // 运行 Loop
              var result = await loopEngine.runLoop(loop);
              
              // 完成目标
              if (_goalId2) {
                var summaryMsg = 'Loop完成: 共' + (result.rounds || '?') + '轮, 产出物: ' + (result.outputDir || '');
                completeGoal(_goalId2, summaryMsg);
              }
              
              if (result && result.passed) {
                broadcast('\u2705 Loop 工程工作流完成！共 ' + result.rounds + ' 轮, 产出物: ' + (result.outputDir || ''));
                if (wsServer && typeof wsServer.broadcast === 'function') {
                  try {
                    wsServer.broadcast('agents', { type: 'agent_activity', agentId: 'xiaolong', agentName: '小龙', action: '工作流完成, 产出物: ' + (result.outputDir || '') });
                    wsServer.broadcast('tasks', { type: 'workflow_completed', status: 'completed', summary: 'Loop工程工作流完成', rounds: result.rounds, outputDir: result.outputDir });
                  } catch(_be) {}
                }
              } else {
                broadcast('\u26A0\uFE0F Loop 工作流异常结束: ' + (result ? result.reason || '未知原因' : '引擎未返回'));
                if (_goalId2) {
                  completeGoal(_goalId2, '工作流异常: ' + (result ? result.reason : '引擎未返回'));
                }
              }
            } catch(e) {
              broadcast('\u26A0\uFE0F Loop 工作流出错: ' + e.message);
              log('ERROR', '工作流', 'Loop执行异常: ' + e.message + '\\n' + (e.stack || '').substring(0, 300));
              if (_goalId2) {
                completeGoal(_goalId2, '工作流出错: ' + e.message.substring(0, 200));
              }
            }
          })();
        });
        
        // 立即返回，告知用户已进入工作流
        broadcast('\u{1F680} 任务已提交到 Loop 工程工作流（多轮迭代：执行者→验证者→验收者），请关注工作台动态...');
        return { ok: true, action: 'workflow_started', reply: '已启动 Loop 工程工作流，执行者将多轮迭代开发直到验收通过...', elapsed: Date.now() - startTime };
      }
      
      // 纯问答 → 直接返回
      broadcast('\u{1F4AC} ' + reply.substring(0, 200));
      return { ok: true, action: 'ai_reply', reply: reply, elapsed: Date.now() - startTime };
    } catch(e) {
      log('ERROR', 'AI\u515C\u5E95', e.message);
      addEvolveMemory('failure', 'AI\u515C\u5E95\u5931\u8D25', e.message, '\u68C0\u67E5API Key\u914D\u7F6E\u6216\u7F51\u7EDC\u8FDE\u63A5');
      broadcast('\uD83D\uDE05 \u62B1\u6B49\u8001\u677F\uFF0C\u6211\u6CA1\u80FD\u7406\u89E3\u8FD9\u6761\u6307\u4EE4\uFF0C\u8BF7\u8BF4\u5F97\u66F4\u5177\u4F53\u4E9B');
      return { ok: false, error: e.message };
    }
  }
  
  var result = await executePlan(parsed, instruction, startTime);
  
  // 执行后自动记录知识
  if (result && result.data) {
    var dataStr = JSON.stringify(result.data).substring(0, 300);
    if (dataStr.length > 20) {
      addKnowledge('执行结果: ' + instruction.substring(0, 40), dataStr, parsed.action, [parsed.action]);
    }
  }
  addSessionMemory('assistant', JSON.stringify(result).substring(0, 500));
  
  return result;
}

/**
 * 规则解析指令（快速匹配）
 */
function parseInstruction(text) {
  const t = text.trim();
  
  // 只保留精确、高确信度的快速指令路径
  // 其余全部交给AI兜底处理，不在这里拦截
  
  // 查询员工能力
  if (/查询(员工|能力|技能|评分)|员工(能力|技能|画像)|query_agent|agent_skills/.test(t)) {
    const match = t.match(/(\S+)(的)?(能力|技能|擅长|评分)/);
    let target = match ? match[1] : null;
    return { action: 'query_skills', target };
  }
  
  // 查询任务/进度
  if (/查询(任务|进度|状态)|任务(\s+)?列表|(当前|所有|待办)任务/.test(t)) {
    return { action: 'query_tasks' };
  }
  
  // 分配任务（仅限明确、短促的操作指令）
  // “给执行者做一个猜数字游戏” "让执行者测试登录页面" 这类直达命令
  // 自然语言中的"分配""给"字眼不触发，交给AI
  if (/(给|让|叫|派)(\\S{1,8})(?:做|完成|执行|处理|审查|测试|检查|检测|审核|验收|编写|创建|开发|实现|写)(.+)/.test(t)) {
    const giveMatch = t.match(new RegExp('(给|让|叫|派)(\\S{1,8})(?:做|完成|执行|处理|审查|测试|检查|检测|审核|验收|编写|创建|开发|实现|写)(.+)'));
    if (giveMatch) {
      const extractedAssignee = giveMatch[2];
      const extractedGoal = giveMatch[3];
      // 必须是已知子代理昵称，goal要有内容，且整条消息短促（用户主动发指令，不是自然语言）
      if (isKnownAgentName(extractedAssignee) && extractedGoal.length > 5 && t.length < 80) {
        return { action: 'assign', assignee: extractedAssignee, goal: extractedGoal };
      }
    }
    // 不符合严格条件的退回AI
    return null;
  }
  
  // 不匹配任何规则 → 返回 null 让 AI 解析
  return null;
}

/**
 * 执行任务计划
 */
async function executePlan(plan, originalInstruction, startTime) {
  log('INFO', '计划', `行动: ${plan.action}, 参数: ${JSON.stringify(plan)}`);
  
  switch (plan.action) {
    
    case 'query_skills': {
      broadcast(`🔍 正在查询员工能力...`);
      const result = querySkills(plan.target);
      const summary = result.summary || '查询完成';
      broadcast(`📋 ${summary}`, { type: 'skills_query', data: result });
      return { ok: true, action: 'query_skills', data: result, elapsed: Date.now() - startTime };
    }
    
    case 'query_tasks': {
      broadcast(`📋 正在查询任务列表...`);
      const result = queryAllTasks();
      const pending = result.filter(t => t.status === 'todo' || t.status === 'pending').length;
      broadcast(`📊 共 ${result.length} 个任务，待办 ${pending} 个，已完成 ${result.filter(t=>t.status==='completed').length} 个`);
      return { ok: true, action: 'query_tasks', data: result, elapsed: Date.now() - startTime };
    }
    
    case 'assign': {
      if (!plan.assignee) {
        broadcast(`⚠️ 需要指定分配给谁（如：CTO、安全审计、产品经理）`);
        return { ok: false, error: '缺少分配目标' };
      }
      
      // 解析 assignee 昵称 → ID
      const agentId = resolveAgentId(plan.assignee);
      if (!agentId) {
        broadcast(`⚠️ 找不到"${plan.assignee}"，当前可用：${Object.values(SUB_LOBSTER_REGISTRY).map(a=>a.name_cn).join('、')}`);
        return { ok: false, error: `未知员工: ${plan.assignee}` };
      }
      
      broadcast(`📝 正在为 ${SUB_LOBSTER_REGISTRY[agentId].name_cn} 规划任务...`);
      
      // 创建任务并分发
      const task = {
        id: 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2,6),
        title: plan.goal,
        goal: plan.goal,
        assigneeId: agentId,
        status: 'todo',
        type: 'general',
        createdAt: new Date().toISOString(),
        priority: 'medium',
        source: 'orchestrator'
      };
      
      // 写 tasks.json
      try {
        const tasksPath = path.join(BASE, 'tasks.json');
        let tasks = [];
        if (fs.existsSync(tasksPath)) {
          tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
        }
        tasks.push(task);
        fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2), 'utf8');
      } catch(e) {
        log('ERROR', '分配', `写tasks.json失败: ${e.message}`);
      }
      
      broadcast(`⏳ 已分配任务给 ${SUB_LOBSTER_REGISTRY[agentId].name_cn}，正在执行...`);
      
      // 立即执行 autoDispatchTask
      try {
        const exec = require('./agent-executor');
        const result = await exec.autoDispatchTask(task);
        broadcast(`✅ ${SUB_LOBSTER_REGISTRY[agentId].name_cn} 完成任务: "${plan.goal.substring(0, 40)}"（${result.elapsed}ms）`, {
          type: 'task_completed', taskId: task.id, assignee: agentId, elapsed: result.elapsed
        });
        return { ok: true, action: 'assign', task, result, elapsed: Date.now() - startTime };
      } catch(e) {
        log('ERROR', '分配', `自动执行失败: ${e.message}`);
        broadcast(`⚠️ 任务已创建但自动执行失败: ${e.message}`);
        return { ok: true, action: 'assign', task, autoExecuteError: e.message, elapsed: Date.now() - startTime };
      }
    }
    
    case 'status': {
      const st = getStatus();
      broadcast(`📊 小龙状态: ${st.running ? '✅ 运行中' : '⛔ 已停止'} | 队列: ${st.taskQueueLength} | 活跃会话: ${st.activeSessions}`);
      return { ok: true, action: 'status', data: st, elapsed: Date.now() - startTime };
    }
    
    case 'start': {
      const r = start();
      return { ok: true, action: 'start', message: r.message, elapsed: Date.now() - startTime };
    }
    
    case 'stop': {
      const r = stop();
      return { ok: true, action: 'stop', message: r.message, elapsed: Date.now() - startTime };
    }
    
    case 'analyze': {
      broadcast(`🤔 正在分析: "${plan.question.substring(0, 60)}..."`);
      try {
        const aiResult = await callAI(plan.question);
        broadcast(`💡 ${aiResult.substring(0, 200)}`);
        return { ok: true, action: 'analyze', result: aiResult, elapsed: Date.now() - startTime };
      } catch(e) {
        broadcast(`⚠️ 分析失败: ${e.message}`);
        return { ok: false, error: e.message, elapsed: Date.now() - startTime };
      }
    }
    
    case 'report': {
      broadcast(`📊 正在生成统计报告...`);
      const report = generateReport();
      broadcast(`📊 报告完成`);
      return { ok: true, action: 'report', report, elapsed: Date.now() - startTime };
    }
    
    case 'evolve': {
      broadcast(`🧠 正在自我进化分析...`);
      try {
        const r = await evolveSelf();
        broadcast(`💡 进化建议: ${r.summary.substring(0, 100)}`);
        return { ok: true, action: 'evolve', data: r, elapsed: Date.now() - startTime };
      } catch(e) {
        broadcast(`⚠️ 自我进化失败: ${e.message}`);
        return { ok: false, error: e.message };
      }
    }
    
    default:
      return { ok: false, error: `未知操作: ${plan.action}` };
  }
}

// ======================================================================
// 子功能实现
// ======================================================================

/**
 * 查询员能力
 */
function querySkills(target) {
  const all = Object.entries(SUB_LOBSTER_REGISTRY).map(([id, info]) => ({
    id,
    name: info.name_cn,
    skills: info.skills,
    score: info.score,
    available: info.available,
    // 从 tasks.json 读完成统计
    taskStats: getAgentTaskStats(id)
  }));
  
  if (target) {
    const agentId = resolveAgentId(target);
    if (agentId) {
      const filtered = all.filter(a => a.id === agentId);
      return { agents: filtered, summary: `${filtered[0].name} — 评分 ${filtered[0].score}/100，擅长 ${filtered[0].skills.join('、')}` };
    }
    return { agents: [], summary: `未找到: ${target}` };
  }
  
  const summary = all.map(a => `${a.name}(${a.score}分/${a.available?'在线':'离线'})`).join('、');
  return { agents: all, summary: `📋 员工能力一览: ${summary}` };
}

/**
 * 查询所有任务
 */
function queryAllTasks() {
  try {
    const tasksPath = path.join(BASE, 'tasks.json');
    if (!fs.existsSync(tasksPath)) return [];
    return JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
  } catch(e) { return []; }
}

/**
 * 获取某个 agent 的任务统计
 */
function getAgentTaskStats(agentId) {
  try {
    const tasks = queryAllTasks();
    const agentTasks = tasks.filter(t => t.assigneeId === agentId);
    return {
      total: agentTasks.length,
      completed: agentTasks.filter(t => t.status === 'completed').length,
      inProgress: agentTasks.filter(t => t.status === 'in_progress').length,
      pending: agentTasks.filter(t => t.status === 'todo' || t.status === 'pending').length
    };
  } catch(e) { return { total: 0, completed: 0, inProgress: 0, pending: 0 }; }
}

/**
 * 解析昵称为 agentId
 */
/**
 * 检查是否已知子代理昵称（用于规则解析校验）
 */
function isKnownAgentName(name) {
  if (!name) return false;
  for (const [id, info] of Object.entries(SUB_LOBSTER_REGISTRY)) {
    if (info.name_cn === name || info.name_cn.includes(name) || name.includes(info.name_cn)) return true;
    // 也支持英文ID
    if (id === name.toLowerCase().trim()) return true;
  }
  return false;
}

/**
 * 解析昵称为 agentId
 */
function resolveAgentId(name) {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  // 直接匹配 ID
  if (SUB_LOBSTER_REGISTRY[n]) return n;
  // 匹配昵称
  for (const [id, info] of Object.entries(SUB_LOBSTER_REGISTRY)) {
    if (info.name_cn === name || info.name_cn.includes(name) || name.includes(info.name_cn)) return id;
  }
  // 匹配技能关键字
  for (const [id, info] of Object.entries(SUB_LOBSTER_REGISTRY)) {
    if (info.skills.some(s => name.includes(s) || s.includes(name))) return id;
  }
  return null;
}

/**
 * 生成统计报告
 */
function generateReport() {
  const tasks = queryAllTasks();
  const agents = Object.keys(SUB_LOBSTER_REGISTRY);
  
  const report = {
    generatedAt: new Date().toISOString(),
    totalTasks: tasks.length,
    statusBreakdown: {
      todo: tasks.filter(t => t.status === 'todo').length,
      pending: tasks.filter(t => t.status === 'pending').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length
    },
    perAgent: agents.map(id => ({
      id,
      name: SUB_LOBSTER_REGISTRY[id].name_cn,
      score: SUB_LOBSTER_REGISTRY[id].score,
      skills: SUB_LOBSTER_REGISTRY[id].skills,
      taskStats: getAgentTaskStats(id)
    })),
    activeSessions: Object.keys(activeSessions).length
  };
  
  // 写报告文件
  try {
    const reportDir = path.join(BASE, 'AI团队', '工作成果');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const reportFile = path.join(reportDir, `orchestrator_report_${new Date().toISOString().substring(0,10)}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
  } catch(e) {}
  
  return report;
}

/**
 * 自我进化
 */
async function evolveSelf() {
  const result = {
    timestamp: new Date().toISOString(),
    summary: '',
    suggestions: []
  };
  
  // 1. 读任务统计
  const tasks = queryAllTasks();
  const completed = tasks.filter(t => t.status === 'completed');
  const failed = tasks.filter(t => t.status === 'failed');
  result.suggestions.push(`已完成 ${completed.length}/${tasks.length} 个任务，失败 ${failed.length} 个`);
  
  // 2. 读核心记忆（如果 accessible）
  try {
    const memPath = path.join(__dirname, '..', '..', '.openclaw', 'workspace', 'MEMORY.md');
    if (fs.existsSync(memPath)) {
      const mem = fs.readFileSync(memPath, 'utf8');
      // 提取关键教训
      const lessons = mem.match(/\d{4}-\d{2}-\d{2}[\s\S]*?(?=\n##|\n$)/g);
      if (lessons) {
        result.suggestions.push('已参考 ' + lessons.length + ' 条历史教训');
        result.lessonsCount = lessons.length;
      }
    }
  } catch(e) {}
  
  // 3. 子龙虾表现分析
  for (const [id, info] of Object.entries(SUB_LOBSTER_REGISTRY)) {
    const stats = getAgentTaskStats(id);
    const rate = stats.total > 0 ? (stats.completed / stats.total * 100).toFixed(1) : 'N/A';
    result.suggestions.push(`${info.name_cn}: 完成率 ${rate}% (${stats.completed}/${stats.total})`);
  }
  
  result.summary = result.suggestions.join('｜');
  return result;
}

/**
 * 调用大模型辅助解析
 */
async function callAItoParse(instruction, context) {
  try {
    const prompt = `你是小龙，一个团队调度与管理核心AI。请解析老板的指令，返回JSON格式的行动计划。

指令: "${instruction}"

可用的子龙虾：
- cto-agent (CTO): 全栈开发、系统架构、代码审查、技术方案设计
- security-agent (安全审计): 安全审计、漏洞扫描、合规检查、风险分析
- pm-agent (产品经理): 产品规划、需求分析、项目管理、文档撰写
- xiaolong (小龙自己): 系统调度、多Agent协调、工作流编排、记忆管理

可用的行动类型：
- assign: 分配任务
- query_skills: 查询员工能力
- query_tasks: 查询任务状态
- analyze: 分析问题
- status: 查询系统状态
- evolve: 自我进化分析
- report: 统计报告

只返回JSON，格式: {"action":"...", "assignee":"...", "goal":"...", "question":"..."}`;

    const result = await callAI(prompt, { temperature: 0.1, maxTokens: 300 });
    try {
      const parsed = JSON.parse(result);
      if (parsed.action) return parsed;
    } catch(e) {}
  } catch(e) {
    log('ERROR', 'AI解析', e.message);
  }
  return null;
}

/**
 * 调用 DeepSeek AI（简版，复用已存在的 callAI）
 */
async function callAI(prompt, opts) {
  opts = opts || {};
  // 复用 agent-executor 的 callAI（需正确传消息数组格式）
  try {
    const exec = require('./agent-executor');
    if (exec.callAI && typeof exec.callAI === 'function') {
      const messages = [{ role: 'user', content: prompt }];
      return await exec.callAI(messages, {
        temperature: opts.temperature || 0.7,
        maxTokens: opts.maxTokens || 2000
      });
    }
  } catch(e) {
    console.error('[callAI] exec.callAI 失败, fallback到备用路径:', e.message);
  }
  
  // 备选：从统一 key 仓库读取有效 key
  try {
    var pkPath = require('path').join(__dirname, '..', 'provider-keys.json');
    var allKeys = {};
    try { allKeys = JSON.parse(require('fs').readFileSync(pkPath, 'utf-8')); } catch(e) {}
    var apiKey = allKeys.deepseek || allKeys['deepseek'] || process.env.DEEPSEEK_API_KEY || '';
    if (!apiKey) throw new Error('无 API Key');
    
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: opts.temperature || 0.7,
        max_tokens: opts.maxTokens || 2000
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!resp.ok) {
      var errData = '';
      try { errData = await resp.text(); } catch(e2) {}
      throw new Error('API 返回 ' + resp.status + ': ' + errData);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  } catch(e) {
    throw new Error('AI 调用失败: ' + e.message);
  }
}

// ======================================================================
// WS 消息路由 — 工作台消息 → 小龙
// ======================================================================

/**
 * 处理来自工作台的 WS 消息
 */
async function handleWSMessage(msgObj) {
  if (!running) {
    broadcast('🐉 小龙尚未启动，请先启动小龙（发送"启动小龙"）');
    return;
  }
  
  // 提取消息内容
  const content = msgObj.content || msgObj.text || '';
  if (!content.trim()) return;
  
  // 广播：小龙收到消息
  broadcast(`📩 小龙收到指令: "${content.substring(0, 80)}..."`);
  
  // 处理指令
  const result = await processInstruction(content);
  
  // 如果执行产生了长结果，广播摘要
  if (result.ok && result.data) {
    const dataStr = JSON.stringify(result.data);
    if (dataStr.length > 500) {
      broadcast(`✅ 完成 (${result.elapsed}ms)，详见日志`);
    }
  }
}

// ======================================================================
// 导出
// ======================================================================

orchestratorInstance = {
  setWSServer,
  start,
  stop,
  getStatus,
  processInstruction,
  handleWSMessage,
  // ⭐ 目标追踪 API（供外部调用）
  createGoal,
  completeGoal,
  getAllGoals,
  // 内部暴露给外部使用
  _parseInstruction: parseInstruction,
  _querySkills: querySkills,
  _resolveAgentId: resolveAgentId,
  SUB_LOBSTER_REGISTRY
};

// 导出 SSE 工具调用回调设置和 orchestrator 实例
module.exports = orchestratorInstance;
module.exports.setSseSendForToolCalls = setSseSendForToolCalls;
module.exports.setExecCEOTool = setExecCEOTool;
