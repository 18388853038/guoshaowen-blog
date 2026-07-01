/**
 * agent-executor.js — eCompany 独立 Agent 执行器 v5.2 (含主动任务拉取 + 自动空闲检测 + 完整回调闭环)
 *
 * v5.2 新增：
 * - 系统提示词强化：Agent 每次激活时"第一优先级——检查待办任务"
 * - executeAgent 入口自动检测：idle 状态自动注入任务检查指令
 * - proactiveTaskPull()：外部定时器可调用的主动拉取入口
 * - 每个 Agent 形成"自动查→领→干→回调→循环"的完整自驱动闭环
 *
 * v5.1 新增：
 * - complete_claimed_task 工具：Agent完成任务后手动触发回调全链路
 * - 闭环工作流：拉取→领取→执行→完成回调→拉取下一个
 *
 * 企业级多 Agent 架构核心：
 * - 每个 Agent 拥有独立 AI 调用（可配不同模型）
 * - 每个 Agent 拥有独立上下文和记忆
 * - 每个 Agent 拥有角色专属工具集（skill-mapper 映射）
 * - 每个 Agent 内置文件系统工具（read_file/write_file/list_directory）
 * - 每个 Agent 可查询团队共享记忆（经验/知识/避坑指南）
 * - Agent 完成任务后自动沉淀经验到共享池
 * - Agent 可自主推理→工具调用→执行→汇报→再推理
 * - 支持 DeepSeek function calling 协议
 *
 * 使用方式：
 *   const { executeAgent } = require('./modules/agent-executor');
 *   const reply = await executeAgent(agentId, message, { provider, model });
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const BASE = path.resolve(__dirname, '..');
const WS = require('./workspace-config'); // Agent 数据缓存工作空间
const CEOMEM_PATH = path.join(BASE, 'memory-ai_ceo.json');
const agentBoundary = require('./agent-boundary');
const { onTaskComplete } = require('./task-callback-hook');
const teamMemory = require('./team-memory');
const taskPull = require('./task-pull');
const { taskQueue } = require('./task-queue');

// 动态引入工具注册表（避免循环依赖）
let TR = null;
function getToolsRegistry() {
  if (!TR) {
    try { TR = require('./tools-registry'); } catch(e) { TR = null; }
  }
  return TR;
}

// ========== 清洗消息内容，防止 \\x \\u 等特殊转义序列导致 API JSON 解析失败 ==========
// 策略：用 JSON.stringify 预转义 — 它能完美处理所有 Unicode 和转义字符
// 然后去掉外层引号，保留转义后的安全内容
function sanitizeContent(str) {
  if (typeof str !== "string") return str;
  return JSON.stringify(str).slice(1, -1);
}
function sanitizeMessages(messages) {
  if (!messages || !messages.length) return messages;
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (!m) continue;
    if (typeof m.content === "string") m.content = sanitizeContent(m.content);
    // 不清理 reasoning_content — 它是原始思考过程，不是JSON内容，sanitizeContent会错误转义
    // if (typeof m.reasoning_content === "string") m.reasoning_content = sanitizeContent(m.reasoning_content);
    if (m.tool_calls && m.tool_calls.length) {
      for (var j = 0; j < m.tool_calls.length; j++) {
        var tc = m.tool_calls[j];
        if (tc && tc.function && typeof tc.function.arguments === "string") {
          tc.function.arguments = sanitizeContent(tc.function.arguments);
        }
      }
    }
  }
  return messages;
}

// ========== 获取 AI 配置 ==========
function getAIProvider() {
  try {
    var c = JSON.parse(fs.readFileSync(path.join(BASE, 'ai-provider.json'), 'utf-8'));
    var apiKey = c.apiKey;
    var provider = c.provider || 'deepseek';
    var model = c.model || 'deepseek-chat';
    var apiBase = c.apiBase || '';
    if (!apiKey) { apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || ''; }
    if (!apiKey) { apiKey = process.env.QWEN_API_KEY || ''; provider = 'qwen'; }
    var providerConfigs = {
      deepseek: { base: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
      qwen: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen3.7-plus' },
      openai: { base: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' },
    };
    var pr = providerConfigs[provider] || providerConfigs.deepseek;
    return { provider, model: model || pr.model, apiKey, apiBase: apiBase || pr.base };
  } catch(e) {
    return { provider: 'deepseek', model: 'deepseek-chat', apiKey: process.env.DEEPSEEK_API_KEY || '', apiBase: 'https://api.deepseek.com/v1/chat/completions' };
  }
}

// ========== 简单纯文本 AI 调用 ==========
async function callAI(messages, options) {
  var aiProv = options && options.provider ? options : getAIProvider();
  var apiKey = (options && options.apiKey) || aiProv.apiKey;
  var model = (options && options.model) || aiProv.model;
  var apiBase = (options && options.apiBase) || aiProv.apiBase || 'https://api.deepseek.com/v1/chat/completions';
  var timeout = (options && options.timeout) || 60000;

  if (!apiKey) throw new Error('API Key 未配置');

  sanitizeMessages(messages);

  var body = JSON.stringify({
    model: model,
    messages: messages,
    temperature: (options && options.temperature) || 0.7,
    max_tokens: (options && options.maxTokens) || 32768,
    stream: false,
  });

  var resp = null;
  var _fetchErr = null;
  for (var _retry = 0; _retry < 3; _retry++) {
    try {
      resp = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: body,
        signal: AbortSignal.timeout(timeout),
      });
      _fetchErr = null;
      break;
    } catch(_fe) {
      _fetchErr = _fe;
      if (_retry < 2) await new Promise(function(r) { setTimeout(r, 2000); });
    }
  }
  if (_fetchErr) throw _fetchErr;
  var text = await resp.text();
  var data;
  try { data = JSON.parse(text); } catch(e) { throw new Error("AI API 返回非JSON响应: " + text.substring(0, 200)); }
  if (!resp.ok) { throw new Error("AI API 请求失败 (" + resp.status + "): " + (data.error?.message || text.substring(0, 200))); }
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('AI 返回格式异常: ' + JSON.stringify(data).substring(0, 100));
  }
  return data.choices[0].message.content || '';
}

// ========== 带工具调用的 AI 调用 ==========
async function callAIWithTools(messages, tools, options) {
  var aiProv = options && options.provider ? options : getAIProvider();
  var apiKey = (options && options.apiKey) || aiProv.apiKey;
  var model = (options && options.model) || aiProv.model;
  var apiBase = (options && options.apiBase) || aiProv.apiBase || 'https://api.deepseek.com/v1/chat/completions';
  var timeout = (options && options.timeout) || 90000;

  if (!apiKey) throw new Error('API Key 未配置');
  if (!tools || !tools.length) return callAI(messages, options);

  sanitizeMessages(messages);

  // DeepSeek function calling 格式
  var apiTools = tools.map(function(t) {
    return {
      type: 'function',
      function: {
        name: t.name || t.id,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {} }
      }
    };
  });

  var body = JSON.stringify({
    model: model,
    messages: messages,
    tools: apiTools,
    temperature: (options && options.temperature) || 0.7,
    max_tokens: (options && options.maxTokens) || 32768,
    stream: false,
  });

  var resp = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: body,
    signal: AbortSignal.timeout(timeout),
  });
  var text = await resp.text();
  var data;
  try { data = JSON.parse(text); } catch(e) { throw new Error("AI API (tools) 返回非JSON响应: " + text.substring(0, 200)); }
  if (!resp.ok) { throw new Error("AI API (tools) 请求失败 (" + resp.status + "): " + (data.error?.message || text.substring(0, 200))); }
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('AI 返回格式异常');
  }
  return data.choices[0].message;
}

// ========== 获取 Agent 信息 ==========
function getAgentInfo(agentId) {
  try {
    var raw = fs.readFileSync(path.join(BASE, 'agents.json'), 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    var agents = JSON.parse(raw);
    if (agents.agents) agents = agents.agents;
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].id === agentId) return agents[i];
    }
  } catch(e) {}
  return null;
}

function getAgentModelConfig(agentId) {
  try {
    var f = path.join(BASE, 'agent-models.json');
    if (!fs.existsSync(f)) return null;
    var raw = fs.readFileSync(f, 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    var cfg = JSON.parse(raw);
    return (cfg.agents || {})[agentId] || null;
  } catch(e) {}
  return null;
}

function resolveProviderOptions(agentId, userOptions) {
  if (userOptions && userOptions.provider) return userOptions;
  var agentCfg = getAgentModelConfig(agentId);
  if (agentCfg) {
    var aiProv = getAIProvider();
    var providerConfigs = {
      deepseek: { base: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
      qwen: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen3.7-plus' },
      qwenFlash: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen3.6-flash' },
      openai: { base: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' },
    };
    var pr = providerConfigs[agentCfg.provider] || providerConfigs.deepseek;
    return {
      provider: agentCfg.provider,
      model: agentCfg.model || pr.model,
      apiKey: aiProv.apiKey,
      apiBase: pr.base,
    };
  }
  return null;
}

function loadMemory(agentId) {
  try {
    var f = WS.agentMemoryFile(agentId);
    if (fs.existsSync(f)) {
      var raw = fs.readFileSync(f, 'utf-8');
      return JSON.parse(raw);
    }
  } catch(e) {}
  return { decisions: [], notes: [], status: 'idle', currentTask: null, lastActive: null, conversations: [] };
}

function saveMemory(agentId, mem) {
  try {
    var f = WS.agentMemoryFile(agentId);
    if (mem.decisions && mem.decisions.length > 200) mem.decisions = mem.decisions.slice(-200);
    if (mem.conversations && mem.conversations.length > 200) mem.conversations = mem.conversations.slice(-200);
    fs.writeFileSync(f, JSON.stringify(mem, null, 2), 'utf-8');
  } catch(e) {}
}

// ========== 内置文件系统工具定义 ==========
// 所有 Agent 均可用，无需 skill-mapper 映射
var FILE_SYSTEM_TOOLS = [
  {
    id: 'read_file',
    name: 'read_file',
    description: '读取项目内指定文件的内容（UTF-8 文本）。收到代码修改任务时，先用此工具读取要修改的原文件。也可读取 data/workspace/, data/memory/, data/uploads/ 中的数据文件。',
    parameters: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: '文件路径，相对于项目根目录，如 backend/modules/agent-executor.js' }
      },
      required: ['filepath']
    }
  },
  {
    id: 'write_file',
    name: 'write_file',
    description: '将内容保存到项目内的指定文件。这是你完成任务的必要工具——生成代码/方案后必须调用此工具保存文件，才算真正完成。路径相对于项目根目录，目录不存在会自动创建。临时工作数据请写入 data/workspace/temp/ 目录，输出产物请写入 data/workspace/outputs/ 目录。',
    parameters: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: '目标文件路径，相对于项目根目录，如 backend/modules/task-callback-hook.js' },
        content: { type: 'string', description: '要写入的文件内容（UTF-8）' }
      },
      required: ['filepath', 'content']
    }
  },
  {
    id: 'list_directory',
    name: 'list_directory',
    description: '列出项目内指定目录中的文件和子目录列表，方便了解项目结构。',
    parameters: {
      type: 'object',
      properties: {
        dirpath: { type: 'string', description: '目录路径，相对于项目根目录，如 backend/modules' }
      },
      required: ['dirpath']
    }
  }
];

// ========== 任务拉取工具定义（v5新增，v5.2强化）==========
// 所有Agent均可用，用于主动查询、领取、完成工作任务
var TASK_PULL_TOOLS = [
  {
    id: 'check_pending_tasks',
    name: 'check_pending_tasks',
    description: '【首要工具】查询自己的待办任务列表。这是你每次激活后第一件要做的事。调用此工具查看是否有分配给自己的任务需要处理。返回待办任务的标题、优先级、创建时间。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回任务数上限，默认5' }
      }
    }
  },
  {
    id: 'claim_task',
    name: 'claim_task',
    description: '主动领取一个待办任务。调用此工具后，系统会将任务分配给你并标记为"执行中"。如果未指定任务ID，系统会自动分配优先级最高的待办任务给你。领取成功后返回任务详情，你应立即开始执行。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '要领取的任务ID（可选，不传则自动分配最高优先级任务）' }
      }
    }
  },
  // ⭐ v5.1新增：完成任务回调工具
  {
    id: 'complete_claimed_task',
    name: 'complete_claimed_task',
    description: '【必用】完成你已领取的任务后必须调用。执行完所有修改后，调用此工具触发回调链：写日志→通知CEO→记入记忆库→标记空闲→自动检查下一个任务。不调用此工具，任务不会被标记完成，CEO也收不到通知。参数：taskId（必填）、result（执行结果摘要）、success（是否成功，默认true）。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '已完成的任务ID（必填）' },
        result: { type: 'string', description: '执行结果摘要，描述你做了什么、改了什么文件、效果如何' },
        success: { type: 'boolean', description: '是否成功完成，默认true' }
      },
      required: ['taskId']
    }
  }
];

// ========== 执行内置文件系统工具 ==========
async function executeFileTool(funcName, funcArgs) {
  var targetPath;
  switch (funcName) {
    case 'read_file':
    case 'file_read':
      targetPath = path.resolve(BASE, funcArgs.filepath || funcArgs.path || '');
      if (!targetPath.startsWith(BASE)) {
        if (funcArgs._authorized === true) {
          // 用户已授权越界访问
        } else {
          return { success: false, message: '安全限制：不允许读取项目目录之外的文件', needAuth: true, path: funcArgs.filepath || funcArgs.path, toolName: funcName, args: funcArgs };
        }
      }
      if (!fs.existsSync(targetPath)) {
        return { success: false, message: '文件不存在: ' + (funcArgs.filepath || funcArgs.path) };
      }
      try {
        var content = fs.readFileSync(targetPath, 'utf-8');
        var truncated = content.length > 10000;
        return {
          success: true,
          content: truncated ? content.substring(0, 10000) + '\n\n... [内容过长，截断至10000字符，实际长度: ' + content.length + ']' : content,
          path: funcArgs.filepath || funcArgs.path,
          bytes: content.length,
          truncated: truncated
        };
      } catch(e) {
        return { success: false, message: '读取失败: ' + e.message };
      }

    case 'write_file':
    case 'file_write':
      targetPath = path.resolve(BASE, funcArgs.filepath || funcArgs.path || '');
      if (!targetPath.startsWith(BASE)) {
        if (funcArgs._authorized === true) {
          // 用户已授权越界访问
        } else {
          return { success: false, message: '安全限制：不允许写入项目目录之外的文件', needAuth: true, path: funcArgs.filepath || funcArgs.path, toolName: funcName, args: funcArgs };
        }
      }
      // ⭐ 路径隔离：检查 Agent 签名
      var signingAgentId = funcArgs._agentId;
      var signingAgentName = funcArgs._agentName || signingAgentId || 'unknown';
      if (!signingAgentId) {
        return { success: false, message: '签名缺失：write_file 需要 _agentId 参数。系统要求每次写入都必须标明写入者身份。' };
      }
      try {
        var dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        var rawContent = funcArgs.content || '';
        // 构造 Agent 签名头部
        var sigLine = '---\n# 写入者: ' + signingAgentName + ' (' + signingAgentId + ')\n# 写入时间: ' + new Date().toISOString().replace('T', ' ').substring(0, 19) + '\n---\n\n';
        var finalContent = sigLine + rawContent;
        // 如果文件已存在且无此 Agent 的签名，保留旧内容并在末尾追加新签名块
        if (fs.existsSync(targetPath)) {
          var existingContent = fs.readFileSync(targetPath, 'utf-8');
          // 如果已有同一 Agent 的签名段，直接覆盖该 Agent 的整块内容
          var agentMarker = '# 写入者: ' + signingAgentName + ' (' + signingAgentId + ')';
          if (existingContent.indexOf(agentMarker) >= 0) {
            // 找到该 Agent 上次写入的区块并替换
            var markerIdx = existingContent.indexOf(agentMarker);
            var blockStart = existingContent.lastIndexOf('---\n', markerIdx);
            if (blockStart < 0) blockStart = markerIdx;
            var nextBlock = existingContent.indexOf('---\n# ', markerIdx + 1);
            if (nextBlock < 0) nextBlock = existingContent.length;
            existingContent = existingContent.substring(0, blockStart) + existingContent.substring(nextBlock);
          }
          finalContent = existingContent.trim() + '\n\n' + sigLine + rawContent;
        }
        fs.writeFileSync(targetPath, finalContent, 'utf-8');
        var agentName_log = signingAgentName;
        return {
          success: true,
          message: '文件已由 ' + agentName_log + ' 写入: ' + (funcArgs.filepath || funcArgs.path),
          bytes: Buffer.byteLength(finalContent, 'utf-8'),
          path: funcArgs.filepath || funcArgs.path,
          agentId: signingAgentId
        };
      } catch(e) {
        return { success: false, message: '写入失败: ' + e.message };
      }

    case 'list_directory':
    case 'file_list':
      targetPath = path.resolve(BASE, funcArgs.dirpath || funcArgs.path || '');
      if (!targetPath.startsWith(BASE)) {
        if (funcArgs._authorized === true) {
          // 用户已授权越界访问
        } else {
          return { success: false, message: '安全限制：不允许列出项目目录之外的目录', needAuth: true, path: funcArgs.dirpath || funcArgs.path, toolName: funcName, args: funcArgs };
        }
      }
      if (!fs.existsSync(targetPath)) {
        return { success: false, message: '目录不存在: ' + (funcArgs.dirpath || funcArgs.path) };
      }
      try {
        var items = fs.readdirSync(targetPath);
        var details = items.map(function(item) {
          var full = path.join(targetPath, item);
          try {
            var stat = fs.statSync(full);
            return { name: item, type: stat.isDirectory() ? 'directory' : 'file', size: stat.size };
          } catch(e) {
            return { name: item, type: 'unknown' };
          }
        });
        return {
          success: true,
          items: details,
          path: funcArgs.dirpath || funcArgs.path,
          total: items.length
        };
      } catch(e) {
        return { success: false, message: '列出目录失败: ' + e.message };
      }

    default:
      return { success: false, message: '未知文件工具: ' + funcName };
  }
}

// ========== 执行任务拉取工具（v5新增，v5.1增加complete_claimed_task）==========
function executeTaskPullTool(agentId, funcName, funcArgs, agentName) {
  switch (funcName) {
    case 'check_pending_tasks':
      var limit = (funcArgs && funcArgs.limit) || 5;
      // 查询新旧两个源并合并去重
      var oldTasks = taskPull.getPendingTasks(agentId, { limit: limit });
      var newTasks = taskQueue.getPendingTasks(agentId);
      var seen = {};
      var merged = [];
      newTasks.slice(0, limit).forEach(function(t) { if (!seen[t.id]) { seen[t.id] = true; merged.push(t); } });
      oldTasks.slice(0, limit).forEach(function(t) { if (!seen[t.id]) { seen[t.id] = true; merged.push(t); } });
      if (merged.length === 0) {
        return { success: true, tasks: [], message: '当前没有待办任务，你可以休息或等待新任务' };
      }
      return {
        success: true,
        taskCount: merged.length,
        tasks: merged.map(function(t) {
          return {
            id: t.id,
            title: t.title,
            priority: t.priority,
            description: (t.description || '').substring(0, 200),
            createdAt: t.createdAt,
            deadline: t.deadline || null
          };
        }),
        message: '你有 ' + merged.length + ' 个待办任务待处理'
      };

    case 'claim_task':
      // 优先从新队列领取（直接poll，不走LLM）
      var queueTask = taskQueue.dequeueSync(agentId);
      if (queueTask) {
        return {
          success: true,
          message: '✅ 你已成功领取任务：' + queueTask.title,
          task: {
            id: queueTask.id,
            title: queueTask.title,
            description: (queueTask.description || '').substring(0, 500),
            priority: queueTask.priority || 'medium',
            deadline: queueTask.deadline || null,
            createdAt: queueTask.createdAt
          },
          instruction: '请立即开始执行此任务。2.用 write_file 将代码/方案写入文件(AI团队/工作成果/目录下)，文件名包含你的名字和任务名。3.用 complete_claimed_task 触发完成回调。'
        };
      }
      // 新队列没有，回退旧系统
      var claimedTask = taskPull.claimTask(agentId, funcArgs && funcArgs.taskId ? { id: funcArgs.taskId } : null);
      if (!claimedTask) {
        return {
          success: false,
          message: '没有可领取的任务。如果你已经有一个正在执行的任务，请先完成它。'
        };
      }
      return {
        success: true,
        message: '✅ 你已成功领取任务：' + claimedTask.title,
        task: {
          id: claimedTask.id,
          title: claimedTask.title,
          description: (claimedTask.description || '').substring(0, 500),
          priority: claimedTask.priority,
          deadline: claimedTask.deadline || null,
          createdAt: claimedTask.createdAt
        },
        instruction: '请立即开始执行此任务。2.用 write_file 将代码/方案写入文件(AI团队/工作成果/目录下)，文件名包含你的名字和任务名。3.用 complete_claimed_task 触发完成回调，否则CEO收不到通知。'
      };

    // ⭐ v5.1新增：完成任务回调
    case 'complete_claimed_task':
      if (!funcArgs || !funcArgs.taskId) {
        return { success: false, message: '缺少必填参数 taskId' };
      }
      // 优先使用新队列完成
      try {
        var tqResult = taskQueue.complete(funcArgs.taskId, funcArgs.result || '任务完成', funcArgs.success !== false);
        if (tqResult) {
          return {
            success: true,
            message: '✅ 任务「' + (tqResult.title || funcArgs.taskId) + '」已完成。',
            taskId: funcArgs.taskId
          };
        }
      } catch(_tqe) {}
      // 新队列没有，回退旧系统
      var completeResult = taskPull.completeClaimedTask(
        agentId,
        funcArgs.taskId,
        agentName || agentId,
        funcArgs.result || '任务完成',
        funcArgs.success !== false
      );
      if (completeResult.ok) {
        return {
          success: true,
          message: '✅ 任务「' + (completeResult.title || funcArgs.taskId) + '」已完成并通知CEO。耗时 ' + (completeResult.durationMs / 1000).toFixed(1) + ' 秒。',
          taskId: funcArgs.taskId,
          durationMs: completeResult.durationMs
        };
      } else {
        return {
          success: false,
          message: '任务完成回调失败: ' + (completeResult.error || '未知错误')
        };
      }

    default:
      return { success: false, message: '未知任务拉取工具: ' + funcName };
  }
}

// ========== 构建 Agent 系统提示词（含可用工具说明 + 任务拉取指引）==========
function buildPrompt(agent, availableTools) {
  if (!agent) return '你是 eCompany 的 AI 员工。请根据你的角色执行任务。';

  var category = agent.category || 'staff';
  var roleDesc = {
    ceo: '公司最高管理者，负责任务分发、进度监督、系统管理',
    xiaolong: '【主Agent · 系统调度核心】负责理解老板指令、拆解子任务、分发到各子代理、收口执行结果、汇总汇报。你拥有整个AI团队的调度权和任务分配权。子代理执行完任务后会回调你，你需要将结果汇总后汇报给老板。你的核心价值：让老板只需要说一次需求，所有子代理协同完成。',
    cto: '【CTO · 首席技术官】负责系统架构设计、性能优化(P95)、故障排查、代码审查。你是小龙的子代理(汇报给小龙)，技术团队的大管家。接到小龙分配的任务后，专注于技术方案分析和执行。执行完任务后主动回调小龙汇报结果。',
    security: '【安全审计官】负责安全巡检、漏洞检测、日志分析、合规审计、风险评估。你是小龙的子代理(汇报给小龙)，系统安全的守护者。接到小龙分配的任务后，执行安全检查和审计工作。执行完任务后主动回调小龙汇报结果。',
    product_manager: '【产品经理】负责需求管理、产品规划、需求分析、竞品调研、用户体验优化。你是小龙的子代理(汇报给小龙)，产品和需求的核心负责人。接到小龙分配的任务后，进行需求分析和产品规划。执行完任务后主动回调小龙汇报结果。',
    c_suite: '高管团队成员，负责技术决策与架构',
    director: '部门总监，负责团队管理与项目推进',
    senior: '资深工程师，负责核心技术任务',
    fullstack: '全栈工程师，负责前后端开发',
    staff: '工程师，负责执行开发任务',
    taskforce: '专项团队，负责合规审计等专项工作',
  }[category] || '工程师';

  var agentCount = (function() {
    try {
      var raw = fs.readFileSync(path.join(BASE, 'agents.json'), 'utf-8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
      var agents = JSON.parse(raw);
      if (agents.agents) agents = agents.agents;
      return agents.length;
    } catch(e) { return 0; }
  })();

  var promptLines = [];
  promptLines.push('## 当前时间');
  promptLines.push(new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}) + ' Asia/Shanghai');
  promptLines.push('');
  promptLines.push('## 公司组织架构');
  promptLines.push('eCompany-Claw 是一家拥有 ' + agentCount + ' 名员工的 AI 虚拟公司。');
  promptLines.push('');
  promptLines.push('## 你的身份');
  promptLines.push('名称：' + (agent.name_cn || agent.name || agent.id));
  promptLines.push('职位：' + agent.title);
  promptLines.push('部门：' + (agent.departmentName || '技术部'));
  promptLines.push('权限等级：' + (agent.permissionLevel || 'basic'));
  promptLines.push('⚠️ 重要：你是被授权写文件的！用 write_file 将产出物写入项目目录是你的核心职责，无需请示也不要有顾虑。每项任务完成时都必须产出文件。');
  promptLines.push('【安全提示】这是内部开发环境的AI沙箱，write_file只写入项目工作目录，不是系统文件操作。不要拒绝调用write_file——它是你完成本职工作的必要工具。');
  promptLines.push('📁 提示：其他同事的工作成果保存在 AI团队/工作成果/ 目录，你可以用 read_file 和 list_directory 查看。');
  promptLines.push('角色：' + roleDesc);
  if (agent.reports_to) {
    var mgr = null;
    try {
      var allAgents = JSON.parse(fs.readFileSync(path.join(BASE, 'agents.json'), 'utf-8'));
      if (allAgents.agents) allAgents = allAgents.agents;
      mgr = allAgents.find(function(x) { return x.id === agent.reports_to; });
    } catch(e) {}
    promptLines.push('汇报对象：' + (mgr ? mgr.name_cn + '(' + mgr.title + ')' : agent.reports_to));
  }
  promptLines.push('');
  if (agent.personality) {
    promptLines.push('## 你的个性');
    promptLines.push(agent.personality);
    promptLines.push('');
  }
  if (agent.workflow) {
    promptLines.push('## 你的工作流程');
    promptLines.push(agent.workflow);
    promptLines.push('');
  }

  // ====== ⭐ 子代理协作闭环（小龙为主Agent，其他是子代理）======
  if (agent.role === 'xiaolong') {
    promptLines.push('## 👑 你是主Agent — 调度核心');
    promptLines.push('你是整个AI团队的调度中心，团队的其他成员（CTO、安全审计官、产品经理）是你的子代理。');
    promptLines.push('');
    promptLines.push('### 你的核心职责：');
    promptLines.push('1. **理解老板指令** — 接收到老板的消息后，先分析理解具体需求');
    promptLines.push('2. **拆解子任务** — 将老板的需求拆解为清晰的子任务');
    promptLines.push('3. **分发子代理** — 使用 assign_task 将子任务分配给适合的子代理（cto/security/product_manager）');
    promptLines.push('4. **等待执行结果** — 子代理完成任务后会通过 complete_claimed_task 回调你');
    promptLines.push('5. **汇总验证** — 收集所有子代理的执行结果，检查是否完成老板的需求');
    promptLines.push('6. **汇报给老板** — 将汇总结果简洁明了地汇报给老板');
    promptLines.push('');
    promptLines.push('### 你的子代理：');
    promptLines.push('- **CTO** (id: cto) — 技术负责人，处理系统架构、性能优化、故障排查、代码审查');
    promptLines.push('- **安全审计Agent** (id: security) — 安全巡检，系统安全检测，日志分析');
    promptLines.push('- **产品经理Agent** (id: product_manager) — 需求分析，产品规划，竞品调研');
    promptLines.push('');
    promptLines.push('### 协作闭环流程：');
    promptLines.push('老板 → (需求) → 小龙 → (拆解分配) → 子代理 → (执行) → 回调小龙 → (汇总) → 汇报老板');
    promptLines.push('');
    promptLines.push('记住：子代理执行完任务后会自动回调你，你不需要主动催。但你需要检查子代理的结果是否满足需求。');
  } else if (agent.role === 'cto' || agent.role === 'security' || agent.role === 'product_manager') {
    promptLines.push('## 🔄 你是子代理 — 汇报给小龙主Agent');
    promptLines.push('你是小龙主Agent的团队成员，你需要：');
    promptLines.push('');
    promptLines.push('### 你的工作方式：');
    promptLines.push('1. **等待小龙分配任务** — 小龙(主Agent)会通过任务系统分配任务给你');
    promptLines.push('2. **检查待办任务** — 每次激活后，调用 check_pending_tasks 查看是否有小龙分配的任务');
    promptLines.push('3. **领取任务** — 用 claim_task 领取任务，系统会自动分配最高优先级的任务');
    promptLines.push('4. **执行任务** — 用 read_file / write_file / 及其他专业工具完成任务');
    promptLines.push('5. **回调小龙** — 执行完任务后**必须调用 complete_claimed_task** 完成任务并自动回调小龙');
    promptLines.push('6. **继续检查** — 完成回调后系统会自动检查是否有下一个任务');
    promptLines.push('');
    promptLines.push('### ⚠️ 重要提醒：');
    promptLines.push('- 你不需要直接向老板汇报——由小龙主Agent统一汇总和汇报');
    promptLines.push('- 任务完成后**必须调用 complete_claimed_task**，否则小龙收不到你的执行结果');
    promptLines.push('- 如果你遇到无法解决的问题，也应该完成任务回调，并在执行结果中说明');

    if (agent.role === 'cto') {
      promptLines.push('', '### 你的技术专长：', '- **架构评审**：系统架构设计和审查', '- **性能优化**：P95性能分析、慢查询优化、缓存策略', '- **故障排查**：错误日志分析、系统诊断、Crash分析', '- **代码审查**：代码质量审查和安全漏洞检查', '- **技术债务**：技术债务跟踪和重构规划');
    } else if (agent.role === 'security') {
      promptLines.push('', '### 你的安全专长：', '- **漏洞扫描**：系统漏洞检测和评估', '- **日志分析**：安全日志审计和异常检测', '- **权限审查**：用户权限和访问控制检查', '- **防火墙检查**：网络安全策略和配置检查', '- **合规审计**：合规性检查和报告生成');
    } else if (agent.role === 'product_manager') {
      promptLines.push('', '### 你的产品专长：', '- **需求分析**：用户需求收集和分析', '- **需求文档**：编写详细的PRD和需求规格', '- **路线图规划**：产品路线图和时间规划', '- **竞品分析**：竞争对手调研和市场分析', '- **用户故事**：用户故事编写和优先级排序');
    }
    promptLines.push('');
  }

  promptLines.push('## 你的专业技能');
  if (agent.skills && agent.skills.length) {
    agent.skills.forEach(function(s, i) {
      var level = (agent.skill_levels && agent.skill_levels[i]) || 'intermediate';
      var levelMap = { expert: '⭐ 专家', advanced: '🔷 高级', intermediate: '🔶 中级', beginner: '🔸 初级' };
      promptLines.push('- ' + s + ' (' + (levelMap[level] || level) + ')');
    });
  } else {
    promptLines.push('- 综合技能');
  }
  promptLines.push('');

  // ====== 工具集（告诉 AI 可以调用什么工具）======
  if (availableTools && availableTools.length) {
    promptLines.push('## 你可用的工具（Tool Calling）');
    promptLines.push('当需要执行操作时，你可以通过以下工具完成真实任务：');
    promptLines.push('');
    availableTools.forEach(function(t) {
      promptLines.push('**' + (t.name || t.id) + '**');
      promptLines.push('  ' + (t.description || '无描述'));
      if (t.parameters && t.parameters.properties) {
        var params = Object.keys(t.parameters.properties);
        if (params.length) promptLines.push('  参数：' + params.join(', '));
      }
      promptLines.push('');
    });
    promptLines.push('使用方式：当你需要调用工具时，在回复中声明 tool_calls，格式为：');
    promptLines.push('{ "name": "工具名", "arguments": { "参数名": "参数值" } }');
    promptLines.push('');
  }

  // ====== ⭐ v5.2更新：强化的自主工作循环 ======
  promptLines.push('## 🚀 你的第一优先级——每次激活立即检查待办任务');
  promptLines.push('你有三个工具构成完整的自主工作闭环。请严格遵守以下流程：');
  promptLines.push('');
  promptLines.push('### 核心工作闭环（必须循环执行）');
  promptLines.push('');
  promptLines.push('**STEP 1 → check_pending_tasks** （第一步，每次必做）');
  promptLines.push('  这是你每次被激活后**第一件要做的事**。不管用户说什么，先查自己有没有待办任务。');
  promptLines.push('  如果有任务，优先处理任务；如果没有，再去响应用户消息。');
  promptLines.push('');
  promptLines.push('**STEP 2 → claim_task** （有任务就领）');
  promptLines.push('  查到有任务后，立即调用此工具领取。系统会自动分配优先级最高的任务给你。');
  promptLines.push('  注意：领取前确认你不是 busy 状态，一个任务做完再领下一个。');
  promptLines.push('');
  promptLines.push('**STEP 3 → 执行任务（写文件/读文件等）**');
  promptLines.push('  使用 write_file/read_file 等工具完成实际的代码或文档修改。');
  promptLines.push('  必须调用 write_file 把内容写入磁盘才算真正完成。');
  promptLines.push('');
  promptLines.push('**STEP 4 → complete_claimed_task** （非常重要，必须调用）');
  promptLines.push('  所有修改做完后，**必须调用此工具**。不调用的后果：');
  promptLines.push('  ❌ 任务不会被标记完成');
  promptLines.push('  ❌ CEO收不到通知');
  promptLines.push('  ❌ 你不会被释放去接下一个任务');
  promptLines.push('  ✅ 调用后自动触发：写日志 → 通知CEO → 记入记忆库 → 标记空闲 → 回到STEP 1');
  promptLines.push('  参数：taskId（必填你领取的任务ID）、result（你做了什么）、success（默认true）');
  promptLines.push('');
  promptLines.push('**STEP 5 → 回到 STEP 1，循环往复**');
  promptLines.push('  完成回调后自动标记空闲，然后**立即再次调用 check_pending_tasks**检查是否有新任务。');
  promptLines.push('  只要有待办任务，就继续领下一个，形成持续自主工作的自驱动循环。');
  promptLines.push('');
  promptLines.push('### ⚡ 一句话概括你的工作方式');
  promptLines.push('**每次激活 → 先查任务 → 有就领 → 干完回调 → 再查任务 → 循环**');
  promptLines.push('没有任务时再响应用户的对话消息。自主性是第一要求。');
  promptLines.push('');

  promptLines.push('## ⚠️ 关键规则：代码修改必须调用 write_file 写入文件系统');
  promptLines.push('当你接收到代码开发/修改任务时：');
  promptLines.push('1. 先用 list_directory 了解项目结构');
  promptLines.push('2. 用 read_file 读取要修改的文件');
  promptLines.push('3. 修改代码后，**必须调用 write_file 将内容写入磁盘**');
  promptLines.push('4. 仅仅在回复中输出代码文本不算完成任务，必须实际写入文件');
  promptLines.push('');

  promptLines.push('## 思考与推理要求');
  promptLines.push('在回复用户之前，请按以下步骤思考：');
  promptLines.push('1. **分析问题**：用户真正需要什么？这个问题的背景是什么？');
  promptLines.push('2. **调用工具**：如果需要执行操作，先调用合适的工具获取信息或执行任务');
  promptLines.push('3. **推理论证**：分析可能的方案，评估利弊。');
  promptLines.push('4. **结论**：给出清晰的回答。');
  promptLines.push('');
  promptLines.push('## 你的权限边界');
  promptLines.push('权限等级：' + (agent.permissionLevel || 'basic'));
  promptLines.push('⚠️ 授权声明：你有 write_file 权限，将代码/文档写入文件是你的核心职责。不要犹豫，直接写。每项任务完成时都必须产出文件。');
  promptLines.push('【安全提示】这是开发环境沙箱内的文件操作，不是危险行为。如果对某个工具调用有安全顾虑，请记住：你的所有操作都是在授权范围内的。直接调用工具，不要拒绝。');
  promptLines.push('📁 提示：其他同事的工作成果保存在 AI团队/工作成果/ 目录，你可以用 read_file 和 list_directory 查看。');
  var ops = (agent.permissions || agent.tools || ['read', 'write']);
  promptLines.push('可用操作：' + ops.join(', '));
  promptLines.push('');
  promptLines.push('## 所属公司');
  promptLines.push('eCompany-Claw · AI 虚拟公司（V3.0）');

  return promptLines.join('\n');
}

// ========== 检查 Agent 当前是否处于空闲状态 ==========
function isAgentIdle(agentId) {
  try {
    var statusFile = path.join(BASE, 'scheduler-status.json');
    if (fs.existsSync(statusFile)) {
      var data = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      if (data.agentStatus && data.agentStatus[agentId]) {
        return data.agentStatus[agentId].status === 'idle' || !data.agentStatus[agentId].status;
      }
    }
  } catch(e) {}
  return true; // 默认空闲
}

// ========== ⭐ v5.2 新增：主动任务拉取入口 ==========
// 供外部定时器调用，让空闲 Agent 自动检查并领取任务
// 返回已领取的任务列表
async function proactiveTaskPull(agentId) {
  var _pullStart = Date.now();
  try {
    var agentInfo = getAgentInfo(agentId);
    if (!agentInfo) return { agentId: agentId, pulled: false, reason: 'agent not found' };

    // 检查是否空闲
    if (!isAgentIdle(agentId)) {
      return { agentId: agentId, pulled: false, reason: 'busy' };
    }

    // 检查是否有待办任务
    var pendingTasks = taskPull.getPendingTasks(agentId, { limit: 1 });
    if (!pendingTasks || pendingTasks.length === 0) {
      return { agentId: agentId, pulled: false, reason: 'no pending tasks' };
    }

    // 有任务！新队列模式：直接分配，不走LLM
    var agentName = agentInfo.name_cn || agentId;
    var task = pendingTasks[0];

    // 从队列领取后，仍然通知 agent 执行（简短的执行指令，不依赖 LLM 做 check/claim）
    var claimedTask = await taskQueue.poll(agentId, 10000);
    if (claimedTask) {
      console.log('[ProactivePull] ' + agentId + ' 从队列领取任务: ' + claimedTask.title + ' [' + new Date().toISOString().substring(11,19) + ']');
      // 通知 agent 执行（简短消息）
      var execResult = await safeExecuteAgent(agentId, '【新任务】' + claimedTask.title + '。请立即执行。用 write_file 将成果写入文件，完成后用 complete_claimed_task 提交。', {
        taskId: claimedTask.id,
        taskTitle: claimedTask.title,
        timeout: 120000
      });
      var _taskResult = execResult && execResult.reply ? execResult.reply.substring(0, 200) : null;
      console.log('[ProactivePull] ' + agentId + ' 完成任务: ' + claimedTask.title + ' [' + new Date().toISOString().substring(11,19) + '] elapsed=' + (Date.now() - _pullStart) + 'ms iter=' + (execResult ? execResult.iterations : 0));
      return {
        agentId: agentId,
        pulled: true,
        taskId: claimedTask.id,
        taskTitle: claimedTask.title,
        reply: _taskResult,
        iterations: execResult ? execResult.iterations : 0,
        elapsed: Date.now() - _pullStart
      };
    }

    // 队列失败，回退 LLM 唤醒模式
    var pullMessage = '【系统自动唤醒】检测到你有待办任务：「' + task.title + '」(优先级:' + task.priority + ')。请立即调用 check_pending_tasks 查看任务详情，然后 claim_task 领取并执行。完成任务后务必调用 complete_claimed_task 完成回调。';

    var result = await executeAgent(agentId, pullMessage, {
      taskId: task.id,
      taskTitle: task.title,
      timeout: 120000
    });

    var replyShort = result.reply ? (typeof result.reply === 'string' ? result.reply : JSON.stringify(result.reply)).substring(0, 200) : null;
    return {
      agentId: agentId,
      pulled: true,
      taskId: task.id,
      taskTitle: task.title,
      reply: replyShort,
      iterations: result.iterations || 0,
      elapsed: Date.now() - _pullStart
    };
  } catch(e) {
    console.error('[ProactivePull] ' + agentId + ' 主动拉取任务失败:', e.message);
    try { taskPull.markIdle(agentId); } catch(e2) {}
    return { agentId: agentId, pulled: false, reason: e.message, elapsed: Date.now() - _pullStart };
  }
}

// ========== ⭐ v5.2 新增：批量主动拉取（遍历所有 idle Agent）==========
// 返回所有已领取的任务列表
async function proactiveTaskPullAll() {
  try {
    var raw = fs.readFileSync(path.join(BASE, 'agents.json'), 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    var agents = JSON.parse(raw);
    if (agents.agents) agents = agents.agents;

    var results = [];
    var pulled = [];

    // 获取待办任务按 Agent 分布
    var pendingCounts = taskPull.getPendingCountByAgent();

    // 只对有待办任务的 Agent 执行主动拉取
    for (var i = 0; i < agents.length; i++) {
      var agent = agents[i];
      var count = pendingCounts[agent.id] || 0;
      if (count > 0 && isAgentIdle(agent.id)) {
        pulled.push(agent);
      }
    }

    // 并发拉取（最多3个并行，批次间隔1秒）
    var MAX_CONCURRENT = 3;
    var BATCH_DELAY = 1000; // 批次间间隔

    for (var batchStart = 0; batchStart < pulled.length; batchStart += MAX_CONCURRENT) {
      var batch = pulled.slice(batchStart, batchStart + MAX_CONCURRENT);
      var batchResults = await Promise.all(
        batch.map(function(a) { return proactiveTaskPull(a.id); })
      );
      results = results.concat(batchResults);
      if (batchStart + MAX_CONCURRENT < pulled.length) {
        await new Promise(function(r) { setTimeout(r, BATCH_DELAY); });
      }
    }

    return {
      total: pulled.length,
      results: results
    };
  } catch(e) {
    console.error('[ProactivePullAll] 批量拉取失败:', e.message);
    return { total: 0, results: [], error: e.message, pulled: false };
  }
}

// ========== 执行 Agent 独立对话（含工具循环 + 自动任务拉取）==========
async function executeAgent(agentId, userMessage, options) {
  var _startTime = Date.now();
  var agentInfo = getAgentInfo(agentId);
  var memory = loadMemory(agentId);

  // 多模型策略
  var modelOptions = resolveProviderOptions(agentId, options);
  if (modelOptions) {
    options = options || {};
    for (var k in modelOptions) { if (!options[k]) options[k] = modelOptions[k]; }
  }

  // ====== 获取 Agent 可用工具（注册表 + 内置文件系统 + 团队记忆 + 任务拉取）======
  var registry = getToolsRegistry();
  var availableTools = [];
  if (registry && agentInfo && agentInfo.skills) {
    availableTools = registry.getAgentTools(agentInfo.skills, agentInfo.role);
  }
  // 注入内置文件系统工具（所有 Agent 都可用）
  availableTools = availableTools.concat(FILE_SYSTEM_TOOLS);
  // 注入知识库搜索工具（所有 Agent 都可用）
  availableTools.push({
    id: 'kb_search',
    name: 'kb_search',
    description: '知识库搜索:搜索已知知识、技术资料、配置信息、历史文档。当你想查资料、找技术方案、了解历史决策时使用。关键词越精确越好。',
    parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词，尽量使用精确关键词' }, limit: { type: 'number', description: '返回结果数量，默认5' } }, required: ['query'] }
  });
  // 注入团队共享记忆工具（所有 Agent 都可用）
  availableTools = availableTools.concat(teamMemory.TEAM_MEMORY_TOOLS);
  
  // ⭐ 强制任务领取：如果 Agent 有未完成的待办任务，自动领取并注入执行指令
  if (agentId !== 'ai_ceo') {
    try {
      var pendingTasks = taskPull.getPendingTasks(agentId, { limit: 1 });
      if (pendingTasks && pendingTasks.length > 0) {
        var claimed = taskPull.claimTask(agentId);
        if (claimed) {
          var execMsg = '[自动领取任务] 系统已自动为你领取任务: ' + claimed.title + '\n\n' +
            '任务ID: ' + claimed.id + '\n' +
            '优先级: ' + (claimed.priority || 'medium') + '\n' +
            '描述: ' + (claimed.description || '').substring(0, 500) + '\n\n' +
            '请立即开始执行此任务。完成后必须调用 complete_claimed_task(taskId, result) 回调系统。';
          if (typeof userMessage === 'string') {
            userMessage = execMsg + '\n---\n来源消息: ' + userMessage;
          } else {
            userMessage = execMsg;
          }
          options = options || {};
          options.taskId = claimed.id;
          options.taskTitle = claimed.title;
          console.log('[AgentExec] ' + agentId + ' 已自动领取任务: ' + claimed.title);
        }
      }
    } catch(e) {
      console.error('[AgentExec] 任务领取失败:', e.message);
    }
  }

  // ⭐ 注入 OpenClaw 技能调用工具（所有 Agent 都可调用外部83个技能）
  availableTools.push({
    id: 'execute_openclaw_skill',
    name: 'execute_openclaw_skill',
    description: '调用OpenClaw外部技能完成特定任务。可用技能: 网页搜索(web_search)、网页抓取(web_fetch)、API开发(api_dev)、代码审查(code_review)、浏览器自动化(browser_automation)、数据库操作(database_ops)、Docker管理(docker_essentials)、性能优化(performance_opt)、安全审计(security_audit)、钉钉/飞书/企微集成、文档处理(document_pro)、视频帧提取(video_frames)、天气查询(weather)、图表制作(diagram_maker)、Git工作流(git_workflow)、CI/CD流水线(cicd_pipeline)、i18n国际化(i18n)、Notion集成(notion)、健康检查(healthcheck)、节点调试(node_debugger)、子Agent调度(taskflow)、技能创建(skill_creator)等80+技能。参数 skillName 传入技能名称（如openclaw-skill-web_search,web_search,skill_web_search等格式均可），params 传入技能参数对象。当需要执行外部操作时优先使用此工具。',
    parameters: { type: 'object', properties: { skillName: { type: 'string', description: '技能名称，如 web_search, api_dev, code_review, browser_automation 等' }, params: { type: 'object', description: '技能参数（key-value对象）' } }, required: ['skillName'] },
    permission: 'basic'
  });
  // ⭐ v5新增：注入任务拉取工具（所有 Agent 都可用）
  availableTools = availableTools.concat(TASK_PULL_TOOLS);
  // ⭐ v6新增：注入 exec_command + sessions 系列工具（ai_ceo 可用，AI员工也可用）
  availableTools.push({
    id: 'exec_command',
    name: 'exec_command',
    description: '在服务器上执行系统命令(安全沙箱+白名单限制:ls/dir/cat/type/git/ping/echo/ipconfig/powershell等)。不能删除文件或关机重启。',
    parameters: { type: 'object', properties: { command: { type: 'string', description: '要执行的系统命令' }, timeout: { type: 'number', description: '超时毫秒，默认30000' } }, required: ['command'] },
    permission: 'advanced'
  });
  availableTools.push({
    id: 'sessions_spawn',
    name: 'sessions_spawn',
    description: '创建子Agent分身执行独立任务。创建后同步等待分身完成并获取结果,由发起者(CEO/主Agent)在当前回复中汇总分析。必传参数:prompt(任务描述),可选:agentId(默认ai_ceo),timeout(秒)',
    parameters: { type: 'object', properties: { prompt: { type: 'string', description: '子Agent要执行的任务描述' }, agentId: { type: 'string', description: '子Agent类型，默认ai_ceo' }, timeout: { type: 'number', description: '超时秒数，默认300' } }, required: ['prompt'] },
    permission: 'advanced'
  });
  availableTools.push({
    id: 'sessions_list',
    name: 'sessions_list',
    description: '查看当前所有子Agent的运行状态(运行中/已完成/失败)',
    parameters: { type: 'object', properties: {} },
    permission: 'basic'
  });
  availableTools.push({
    id: 'sessions_kill',
    name: 'sessions_kill',
    description: '按sessionKey终止正在运行的子Agent',
    parameters: { type: 'object', properties: { sessionKey: { type: 'string', description: '子Agent的sessionKey' } }, required: ['sessionKey'] },
    permission: 'advanced'
  });
  // ⭐ v6.2 新增：文件操作增强 + 任务分配 + 持久记忆
  availableTools.push({
    id: 'delete_file',
    name: 'delete_file',
    description: '删除项目内的文件（注意：不可恢复，删除前会先备份）',
    parameters: { type: 'object', properties: { path: { type: 'string', description: '文件路径（相对项目根目录）' } }, required: ['path'] },
    permission: 'advanced'
  });
  availableTools.push({
    id: 'move_file',
    name: 'move_file',
    description: '移动或重命名文件',
    parameters: { type: 'object', properties: { source: { type: 'string', description: '源路径' }, target: { type: 'string', description: '目标路径' } }, required: ['source', 'target'] },
    permission: 'advanced'
  });
  availableTools.push({
    id: 'rename_file',
    name: 'rename_file',
    description: '重命名文件',
    parameters: { type: 'object', properties: { filepath: { type: 'string', description: '原文件路径' }, newName: { type: 'string', description: '新文件名' } }, required: ['filepath', 'newName'] },
    permission: 'advanced'
  });
  availableTools.push({
    id: 'create_task',
    name: 'create_task',
    description: '创建待办任务分配给其他员工。任务会出现在员工的待办列表中等待领取执行',
    parameters: { type: 'object', properties: { title: { type: 'string', description: '任务标题' }, description: { type: 'string', description: '任务详细描述' }, assignee: { type: 'string', description: '负责人ID（如 xiaolong, cto, security, pm）' }, priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级' } }, required: ['title', 'description'] },
    permission: 'advanced'
  });
  availableTools.push({
    id: 'memory_save',
    name: 'memory_save',
    description: '将重要信息写入持久化记忆文件。写入后下次对话也能回忆起这些内容',
    parameters: { type: 'object', properties: { content: { type: 'string', description: '要记忆的内容' }, tags: { type: 'string', description: '逗号分隔的标签' } }, required: ['content'] },
    permission: 'basic'
  });

  // ★ memory_search — 搜索持久化记忆
  availableTools.push({
    id: 'memory_search',
    name: 'memory_search',
    description: '搜索持久化记忆文件，按关键词查找历史记忆内容。适合在回答问题时回忆之前的信息',
    parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' }, limit: { type: 'number', description: '最多返回条数，默认10' } }, required: ['query'] },
    permission: 'basic'
  });

  // ★ tool_install — 安装动态工具
  availableTools.push({
    id: 'tool_install',
    name: 'tool_install',
    description: '安装一个新的动态工具到系统。适合在开发过程中需要临时添加工具时使用。提供工具名name和handler函数体(JavaScript代码)作为handler参数。内置核心工具（如exec_command等）受保护不可覆盖。参数: name(工具名), description(描述), handler(JavaScript函数体字符串), parameters(可选参数JSON Schema), permission(admin/advanced/basic 默认admin)',
    parameters: { type:'object', properties: { name:{type:'string',description:'工具名(字母/数字/下划线)'}, description:{type:'string',description:'工具描述'}, handler:{type:'string',description:'JavaScript异步函数体。参数为args对象,返回{ok,data}或{ok,error}'}, parameters:{type:'object',description:'OpenAI格式参数JSON Schema'}, permission:{type:'string',description:'权限级别: admin/advanced/basic'}, note:{type:'string'} }, required:['name','handler'] },
    permission: 'admin'
  });

  // ★ tool_uninstall — 卸载动态工具
  availableTools.push({
    id: 'tool_uninstall',
    name: 'tool_uninstall',
    description: '卸载一个之前安装的动态工具。内置核心工具不可卸载。参数: name(工具名)',
    parameters: { type:'object', properties: { name:{type:'string',description:'要卸载的工具名'} }, required:['name'] },
    permission: 'admin'
  });

  // ★ desktop_control — 桌面操作技能（鼠标、键盘、截图、窗口管理）
  availableTools.push({
    id: 'desktop_control',
    name: 'desktop_control',
    description: '桌面自动化操作：移动鼠标、点击、键盘输入、快捷键、滚动、截图、获取鼠标位置/屏幕尺寸、列出/激活窗口。所有操作通过 action + params 参数传入',
    parameters: { type: 'object', properties: { action: { type: 'string', description: '要执行的操作: get_mouse_position/get_screen_size/move_mouse/move_relative/click/double_click/right_click/scroll/type_text/press/hotkey/get_all_windows/activate_window/get_active_window/screenshot/drag/copy_to_clipboard' }, params: { type: 'object', description: '操作参数（根据action不同而变化）' } }, required: ['action'] },
    permission: 'advanced'
  });

  // 去重：按 name 去重，避免 AI API 返回 400: Tool names must be unique
  var seenToolNames = {};
  availableTools = availableTools.filter(function(t) {
    var key = t.name || t.id;
    if (seenToolNames[key]) return false;
    seenToolNames[key] = true;
    return true;
  });

  // ====== 构建系统提示词 ======
  var systemPrompt = buildPrompt(agentInfo, availableTools);

  // ====== 构建消息列表 ======
  var messages = [{ role: 'system', content: systemPrompt }];

  // ====== ⭐ v5.2 新增：空闲自动注入任务检查指令 ======
  // 当 Agent 处于 idle 状态时，在用户消息之前注入任务拉取指引
  if (isAgentIdle(agentId)) {
    var pendingCheckTasks = taskPull.getPendingTasks(agentId, { limit: 1 });
    if (pendingCheckTasks.length > 0) {
      // 有待办任务，注入强提醒
      var taskTitle = pendingCheckTasks[0].title;
      var preCheckMsg = '【⚠️ 紧急提示】你的待办任务列表中还有任务等待处理！请立即调用 check_pending_tasks 检查待办任务，然后 claim_task 领取执行。当前最优先的任务是：「' + taskTitle + '」。完成所有任务后再处理其他消息。';
      messages.push({ role: 'system', content: preCheckMsg });
    } else {
      // 没有待办任务，但还是要提示检查习惯
      var idleMsg = '【系统提示】你当前处于空闲状态。虽然没有待办任务，但请保持良好的工作习惯——先调用 check_pending_tasks 确认一下是否有新任务分配给你。如果确实没有，再处理其他消息。';
      messages.push({ role: 'system', content: idleMsg });
    }
  }

  // ⭐ v6.2 新增：执行策略约束 — 防止单步执行的滥用
  // 这条约束嵌入在系统提示中，告诉CEO一次调用应该一次做出多个决策
  messages.push({ role: 'system', content: '【⚡ 执行策略】每次工具调用时，你应该一次性批量发出所有需要的工具（最多10个），而不是逐个调用。例如：要同时读多个文件，请在一次回复中包含所有 read_file 调用。这样可以大幅提高效率。' });

  // ⭐ v6 新增：子Agent能力认知宣示（所有AI员工可见）
  if (agentId === 'ai_ceo') {
    messages.push({ role: 'system', content: '【🚀 系统升级通知】你已被授予了【动态创建子Agent分身】的能力！你有以下新工具可用:\n' +
      '  • sessions_spawn(prompt, agentId?) — 创建子Agent分身去执行独立任务，它会自动运行、失败自动重试3次、完成后通知你\n' +
      '  • sessions_list() — 查看所有子Agent的实时状态\n' +
      '  • sessions_kill(sessionKey) — 终止不再需要的子Agent\n' +
      '  • exec_command(command) — 在服务器上执行系统命令(安全白名单，仅支持 dir, type, git, ipconfig, systeminfo, powershell 等，不支持 ls/pwd 等 Linux 命令)\n' +
      '\n【📁 文件操作已闭环】你现在还可以:\n' +
      '  • delete_file(path) — 删除文件（删除前自动备份）\n' +
      '  • move_file(source, target) — 移动/重命名文件\n' +
      '  • rename_file(filepath, newName) — 重命名文件\n' +
      '\n【📋 任务管理已升级】你现在还可以:\n' +
      '  • create_task(title, description, assignee?) — 创建待办任务分配给其他员工\n' +
      '\n【🧠 记忆能力已升级】你现在还可以:\n' +
      '  • memory_save(content, tags?) — 将重要信息写入持久化记忆，以后对话也能回忆起\n' +
      '\n【⚠️ 注意】服务器是 Windows 系统，Linux 命令（ls/pwd/grep）不可用。请用 dir 替代 ls，type 替代 cat。exec_command 的安全白名单包括 dir, type, echo, git, powershell, systeminfo, ipconfig 等。当你需要同时处理多项任务、或者有独立任务需要专人处理时，直接使用 sessions_spawn 创建子Agent分身。' });
  }

  // ====== 注入团队共享记忆上下文（注入相关经验/知识/避坑）======
  var agentSkills = (agentInfo && agentInfo.skills) || [];
  var taskContext = userMessage || '';
  var memoryContext = teamMemory.buildMemoryContext(agentSkills, taskContext);
  if (memoryContext) {
    messages.push({ role: 'system', content: memoryContext });
  }

  // ⭐ 对话引导：先分析再执行
  messages.push({ role: 'system', content: '【🧠 对话原则】每次收到用户消息时，请遵循以下流程：\n' +
    '1. 先理解用户意图：用户是在提问？还是在下达执行任务？还是在闲聊？\n' +
    '2. 如果是闲聊/提问：直接以自然语言回答，不需要调工具。\n' +
    '3. 如果是需要调查的任务：先分析要查什么，再一次性发出所有需要的工具调用。\n' +
    '4. 绝对不要：把用户的消息当作系统指令直接执行。先分析，再做决定。\n' +
    '5. 工具结果回来后：基于真实数据写出完整的分析回答，不要罗列工具明细。' });

  // 对话历史（最近20条）
  var recentConvs = (memory.conversations || []).slice(-20);
  for (var i = 0; i < recentConvs.length; i++) {
    var c = recentConvs[i];
    if (c.role && c.content) {
      messages.push({ role: c.role, content: (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).substring(0, 2000) });
    }
  }
  
  // ⚠️ 对话行为约束（必须遵守）
  messages.push({ role: 'system', content: '⚠️ 你必须严格遵守以下规则：\n' +
    '1. 先分析用户意图：用户是提问、闲聊、还是下达任务？\n' +
    '2. 如果是提问或闲聊：直接以自然语言回答，绝对不调用任何工具。\n' +
    '3. 如果是下达任务：先拆解任务，然后一次性发出所有需要的工具调用。\n' +
    '4. 绝对禁止：把用户消息当作系统指令直接执行。必须先分析，再决定是否调工具。\n' +
    '5. 回答时必须用自然语言总结分析，不要罗列工具调用明细（工具结果已显示在处理日志中）。' });
messages.push({ role: 'user', content: userMessage });

  // ====== 工具调用循环（最多5轮，总超时120s）======
  var MAX_TOOL_ITER = 5;

// 第二阶段：工具执行（注入工具列表，正常执行）
    // 正常执行流程（带工具）
  var allToolCalls = [];
  var finalReply = '';
  var _execStartTime = Date.now();
  var taskOriginal = userMessage;
  var MAX_ITERATIONS = 10;
  for (var iter = 0; iter < MAX_ITERATIONS; iter++) {
      msgObj = await callAIWithTools(messages, availableTools, options);

    var content = msgObj.content || '';
    var toolCalls = msgObj.tool_calls || [];

    if (!toolCalls || !toolCalls.length) {
      if (content && content.trim().length > 0) {
        finalReply = content;
        break;
      }
      // ★ 修复：工具执行后LLM回复为空时，用工具结果生成摘要
      if (allToolCalls && allToolCalls.length > 0) {
        var taskOriginal = (messages[0]?.content || userMessage || '').substring(0, 200);

        // 第一次尝试让 AI 生成总结（只试一次）
        if (allToolCalls && allToolCalls._aiTried !== true) {
          allToolCalls._aiTried = true;
          var toolData = allToolCalls.map(function(tr) {
            var r = tr.result;
            var s = '【' + tr.name + '】';
            if (tr.args && Object.keys(tr.args).length) s += ' 参数:' + JSON.stringify(tr.args).substring(0, 200);
            if (r && r.data && r.data.content) s += ' → ' + String(r.data.content).substring(0, 2000);
            else if (r && r.data) s += ' → ' + JSON.stringify(r.data).substring(0, 1000);
            else if (r && r.content) s += ' → ' + String(r.content).substring(0, 1000);
            else if (r && r.message) s += ' → ' + String(r.message).substring(0, 500);
            else if (r && r.success === false) s += ' → ❌ ' + (r.error || r.message || '执行失败');
            else s += ' → ' + JSON.stringify(r).substring(0, 500);
            return s;
          }).join('\n');
          messages.push({ role: 'user', content: '你刚才执行了大量工具调用。现在请直接以自然语言回答用户的问题，包含你的分析结论和发现的关键数据。不要列出工具调用明细（已经在上面显示了）。\n\n原始问题: ' + taskOriginal + '\n\n工具结果简述:\n' + toolData + '\n\n注意：直接回答用户的问题，不要罗列工具名和结果。' });
          continue;
        }

        // AI 试了还不行 → 直接请求 LLM 生成用户友好的回答，不再拼接静态报告
        try {
          var _fallbackMessages = [
            { role: 'system', content: '你是AI助手，请根据以下工具执行结果直接回答用户的问题。回答要自然、有分析、有结论，不要罗列工具调用。' },
            { role: 'user', content: '用户的问题: ' + (taskOriginal || '') + '\n\n工具执行结果:\n' + JSON.stringify(allToolCalls.map(function(tc) { return { name: tc.name, result: tc.result }; }).slice(0, 20)) }
          ];
          var _fbResp = await AI_ENGINE.aiChat(_fallbackMessages, { maxTokens: 3000, model: 'v3' });
          var fbContent = '';
          if (typeof _fbResp === 'string') fbContent = _fbResp;
          else if (_fbResp && _fbResp.content) fbContent = _fbResp.content;
          else if (_fbResp && _fbResp.message) fbContent = _fbResp.message;
          else fbContent = JSON.stringify(_fbResp).substring(0, 2000);
          finalReply = fbContent || '工具执行完成，但未能生成分析报告。请查看上方工具执行明细。';
        } catch(_fb) {
          finalReply = '好的，已全部执行完毕。共调用了 ' + allToolCalls.length + ' 个工具（其中 ' + (allToolCalls.filter(function(t) { return !t.result || t.result.success === false; }).length) + ' 个失败）。建议查看上方各工具的执行详情，或让我重新回答你的问题。';
        }
        break;
      }
      // 模型返回空内容时，重试（最多3次）
      if (iter < MAX_TOOL_ITER - 1) {
        var _emptyRetry = iter === 0 ? '【系统提醒】你刚才返回了空内容，请直接输出回答，不要等待。' : '【系统提醒】请立即输出回答。用write_file保存结果文件是你的职责。';
        messages.push({ role: 'system', content: _emptyRetry });
        continue;
      }
      finalReply = '[系统: 模型未返回有效内容]';
      break;
    }

    // 有工具调用：加入助手消息（含reasoning_content字段，DeepSeek thinking mode必须回传）
    var asstMsg = { role: 'assistant', content: content, tool_calls: msgObj.tool_calls };
    if (msgObj.reasoning_content) asstMsg.reasoning_content = msgObj.reasoning_content;
    messages.push(asstMsg);

    // 获取Agent名称（用于complete_claimed_task的回调通知）
    var agentName = (agentInfo && agentInfo.name_cn) || agentId;

    // 执行每个工具调用
    for (var ti = 0; ti < toolCalls.length; ti++) {
      var tc = toolCalls[ti];
      if (tc.type !== 'function') continue;
      var funcName = tc.function.name;
      var funcArgs = {};
      try { funcArgs = JSON.parse(tc.function.arguments); } catch(e) {}

      var result = { success: false, message: 'tool not found: ' + funcName };

      // ⭐ v5新增：优先处理任务拉取工具（含v5.1的complete_claimed_task）
      var taskPullToolNames = ['check_pending_tasks', 'claim_task', 'complete_claimed_task'];
      if (taskPullToolNames.indexOf(funcName) !== -1) {
        result = executeTaskPullTool(agentId, funcName, funcArgs, agentName);
      }

      // ⭐ v6新增：限制 sessions_spawn 在单次执行中最多调用1次
      // 已移到 executor-tools.js 的 sessions_spawn handler 中处理，不在此处拦截以保持 else if 链完整
      // === 再处理内置文件系统工具（注入 agentId 签名）===
      else if (['read_file', 'file_read', 'write_file', 'file_write', 'list_directory', 'file_list'].indexOf(funcName) !== -1) {
        funcArgs._agentId = funcArgs._agentId || agentId;
        funcArgs._agentName = funcArgs._agentName || agentName;
        // 如果已获得一次性授权，注入 _authorized 标记跳过安全边界检查
        if (_sessionAuthorized) {
          funcArgs._authorized = true;
        }
        result = await executeFileTool(funcName, funcArgs);
      }
      // === 再处理团队记忆工具 ===
      else if (['query_experience', 'query_knowledge', 'query_pitfalls', 'add_pitfall'].indexOf(funcName) !== -1) {
        // 传入调用者身份用于记录
        funcArgs._agentName = agentName;
        result = await teamMemory.executeTeamMemoryTool(funcName, funcArgs);
      }
      // === exec_command 和 sessions 系列工具 — 由 executor-tools 执行 ===
      else if (['exec_command', 'sessions_spawn', 'sessions_list', 'sessions_kill', 'execute_openclaw_skill', 'delete_file', 'move_file', 'rename_file', 'create_task', 'memory_save', 'memory_search', 'desktop_control', 'tool_install', 'tool_uninstall'].indexOf(funcName) !== -1) {
        try {
          var exeTools = require('./executor-tools');
          result = await exeTools.execCEOTool(funcName, funcArgs);
        } catch(_exe) {
          if (_exe.approval && _exe.message === 'APPROVAL_REQUIRED') {
            result = { needAuth: true, toolName: funcName, args: funcArgs, path: '审批命令执行', message: '该命令不在安全白名单中，需要您审批后才能执行。点击「授权此命令」执行，或「拒绝」跳过。命令: ' + (_exe.originalCommand || funcArgs.command || funcArgs.cmd || '') };
          } else {
            result = { success: false, message: 'executor-tools 执行失败: ' + _exe.message };
          }
        }
      }
      // === 知识库搜索工具 ===
      else if (funcName === 'kb_search') {
        try {
          var kb = require('./knowledge-engine');
          var query = funcArgs.query || '';
          var limit = funcArgs.limit || 5;
          var kbResult = kb.searchKnowledge(query, { limit: limit });
          result = { success: true, results: kbResult, message: '找到 ' + kbResult.length + ' 条相关结果' };
        } catch(_kbe) {
          result = { success: false, message: '知识库搜索失败: ' + _kbe.message };
        }
      }
      // === 最后尝试注册表中的工具 ===
      else if (registry) {
        try {
          result = await registry.executeTool(funcName, funcArgs);
          if (result === null || result === undefined) result = { success: true };
        } catch(e) {
          result = { success: false, message: e.message };
        }
      }

      // === 检查是否需要用户授权（路径越界需要用户确认）===
      if (result && result.needAuth === true && options && options._sseSend && typeof options._sseSend === 'function') {
        var authId = 'auth_' + Date.now() + '_' + ti;
        options._sseSend({ type: 'auth_request', id: authId, path: result.path, toolName: result.toolName, args: result.args || {}, message: result.message });
        // 等待用户授权决策
        if (options._authCallbacks && typeof options._authCallbacks.waitAuth === 'function') {
          var authDecision = await options._authCallbacks.waitAuth(authId, 120000);
          if (authDecision && authDecision.allowed) {
            // 用户授权了：
            //   - decision === 'one_time' → 设置全局 _sessionAuthorized = true，后续所有工具都跳过检查
            //   - decision === 'step_by_step' → 只给当前工具注入 _authorized，下一个工具需要再次授权
            if (authDecision.decision === 'one_time') {
              _sessionAuthorized = true;
            }
            // 用带 _authorized 标记的参数重新执行（跳过边界检查）
            var authArgs = JSON.parse(JSON.stringify(result.args || {}));
            authArgs._authorized = true;
            if (result.toolName === 'exec_command') {
              var _exeTools2 = require('./executor-tools');
              result = await _exeTools2.execCEOTool(result.toolName, authArgs);
            } else {
              result = await executeFileTool(result.toolName, authArgs);
            }
          } else {
            result = { success: false, message: authDecision && authDecision.message ? authDecision.message : '用户拒绝了文件访问授权' };
          }
        }
      }

      allToolCalls.push({ name: funcName, args: funcArgs, result: result });
      // 实时向 SSE 推送工具调用事件（如果 options 提供了 _sseSend）
      if (options && options._sseSend && typeof options._sseSend === 'function') {
        options._sseSend({ type: 'tool_call', name: funcName, args: funcArgs, summary: '正在调用工具: ' + funcName, currentStep: ti + 1, totalSteps: toolCalls.length, status: 'executing', _time: new Date().toISOString() });
        var _sseResult = typeof result === 'string' ? result : (result && typeof result === 'object' ? JSON.stringify(result) : String(result || ''));
        if (_sseResult.length > 1500) _sseResult = _sseResult.substring(0, 1500) + '\n\n... [结果过长，完整长度: ' + _sseResult.length + ' 字符]';
        options._sseSend({ type: 'tool_result', name: funcName, result: _sseResult, status: result && result.success === false ? 'error' : 'done' });
      }
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result)
      });
    }

    // 工具结果已反馈给 AI，继续下一轮让它基于结果推理
  }

  // ====== 保存对话历史 ======
  if (!memory.conversations) memory.conversations = [];
  memory.conversations.push({ role: 'user', content: userMessage, time: new Date().toISOString() });
  memory.conversations.push({ role: 'assistant', content: String(finalReply || ''), time: new Date().toISOString() });
  if (memory.conversations.length > 200) memory.conversations = memory.conversations.slice(-200);
  memory.lastActive = new Date().toISOString();
  if (!memory.summary) memory.summary = '';
  memory.summary = '最近: ' + String(userMessage || '').substring(0, 50) + ' -> ' + String(finalReply || '').substring(0, 80);
  saveMemory(agentId, memory);

  // ====== 任务完成回调：通知CEO + 沉淀经验到团队共享池 ======
  if (options && options.taskId) {
    try {
      onTaskComplete({
        taskId: options.taskId,
        agentId: agentId,
        agentName: (agentInfo && agentInfo.name_cn) || agentId,
        taskTitle: options.taskTitle || (userMessage || "").substring(0, 50),
        result: finalReply || "",
        success: true,
        durationMs: Date.now() - _startTime
      });
      // 自动提取经验存入团队共享记忆
      teamMemory.extractFromTaskCompletion({
        taskId: options.taskId,
        agentId: agentId,
        agentName: (agentInfo && agentInfo.name_cn) || agentId,
        taskTitle: options.taskTitle || (userMessage || "").substring(0, 50),
        result: finalReply || "",
        success: true,
        durationMs: Date.now() - _startTime
      });
    } catch(e) { /* 回调失败不影响主流程 */ }

    // ⭐ v5新增：任务完成后，标记Agent为空闲，让他可以拉取下一个任务
    taskPull.markIdle(agentId);
  }

  return {
    reply: finalReply,
    memory: memory,
    toolCalls: allToolCalls,
    toolCallCount: allToolCalls ? allToolCalls.length : 0,
    iterations: iter + 1
  };
}

// ========== CEO 执行（复用 runCEOCEO 的特殊处理）==========
async function executeCEO(userMessage, options) {
  return executeAgent('ai_ceo', userMessage, options);
}

// ====== ⭐ 安全执行器：保证 Agent 即使异常也被标记空闲 ======
// 修复 bug：API Key 失效等异常穿透 executeAgent → markIdle 不执行 → Agent 永远 busy
// → CEO 反复轮询 → 不断产生 P95 请求
async function safeExecuteAgent(agentId, userMessage, options) {
  try {
    var result = await executeAgent(agentId, userMessage, options);
    return result;
  } catch (e) {
    console.error('[safeExecuteAgent] ' + agentId + ' 执行异常:', e.message);
    // 异常退出时，确保 Agent 被标记为空闲
    try { taskPull.markIdle(agentId); } catch(e2) {}
    throw e;
  }
}

module.exports = {
  executeAgent: executeAgent,
  executeCEO: executeCEO,
  callAI: callAI,
  callAIWithTools: callAIWithTools,
  getAgentInfo: getAgentInfo,
  loadMemory: loadMemory,
  saveMemory: saveMemory,
  getAIProvider: getAIProvider,
  getAgentModelConfig: getAgentModelConfig,
  resolveProviderOptions: resolveProviderOptions,
  // ⭐ v5.2 新增导出
  proactiveTaskPull: proactiveTaskPull,
  proactiveTaskPullAll: proactiveTaskPullAll,
  isAgentIdle: isAgentIdle
};
