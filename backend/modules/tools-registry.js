/**
 * eCompany 统一工具注册表 v1.0
 * 
 * 所有 OpenClaw 风格工具 + eCompany 原生工具的统一入口
 * 
 * 工具来源：
 * - openclaw-bridge.js 的 BRIDGE_TOOLS（5个）
 * - tools-executor.js 的 FILE_TOOLS（文件操作）
 * - CEO execCEOTool 的内置工具（24个管理工具）
 * - OpenClaw Gateway 可用时从 Gateway 获取
 * 
 * 每个工具格式：
 * {
 *   id: 'tool-id',           // 唯一标识
 *   name: 'tool_name',       // API调用名
 *   description: '...',      // AI看了知道何时调用
 *   parameters: {...},       // JSON Schema
 *   handler: async (args) => {}, // 实际执行函数
 *   skills: [...],           // 映射到哪些技能
 *   permission: 'basic|advanced|admin', // 权限要求
 * }
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
var skillProxy = require('./skill-proxy');
const BASE = path.join(__dirname, '..');

// ========== 1. CEO 内置工具 ==========
// 复用 server-dev.js 中 execCEOTool 的所有工具
// 注意：这里只定义 schema，实际执行通过 execCEOTool

const CEO_TOOLS = [
  {
    id: 'task_management',
    name: 'task_management',
    description: '创建、查询、更新、删除任务。action: list|create|update|delete|assign',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'update', 'delete', 'assign'] },
        taskId: { type: 'string' },
        title: { type: 'string' },
        assigneeId: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }
      },
      required: ['action']
    },
    handler: async (args) => {
      return { success: true, message: 'task_management: ' + args.action };
    },
    skills: ['战略决策', '团队管理', '资源调配'],
    permission: 'admin'
  },
  {
    id: 'system_health',
    name: 'system_health',
    description: '获取 eCompany 系统健康状态（服务、数据库、API提供商）',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const r = await fetch('http://127.0.0.1:8002/api/health');
        return r.ok ? await r.json() : { error: 'health check failed' };
      } catch (e) { return { error: e.message }; }
    },
    skills: ['战略决策'],
    permission: 'admin'
  },
  {
    id: 'channel_config',
    name: 'channel_config',
    description: '配置和管理多渠道接入（飞书、钉钉、企业微信等）',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'install', 'test', 'remove'] },
        channel: { type: 'string' }
      },
      required: ['action']
    },
    handler: async (args) => {
      return { success: true, message: 'channel_config: ' + args.action };
    },
    skills: ['战略决策'],
    permission: 'admin'
  },
  {
    id: 'file_manager',
    name: 'file_manager',
    description: '文件管理：浏览目录、解压压缩包、读取文件内容',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'unzip'] },
        path: { type: 'string' },
        source: { type: 'string' },
        dest: { type: 'string' }
      },
      required: ['action']
    },
    handler: async (args) => {
      return { success: true, message: 'file_manager: ' + args.action };
    },
    skills: ['战略决策', '团队管理', '资源调配'],
    permission: 'advanced'
  }
];

// ========== 2. eCompany Bridge 工具（5个） ==========
const BRIDGE_TOOLS = [
  {
    id: 'ecompany_query_agents',
    name: 'ecompany_query_agents',
    description: '查询 eCompany AI 团队成员信息，支持按部门/角色筛选',
    parameters: {
      type: 'object',
      properties: {
        department: { type: 'string' },
        role: { type: 'string' },
        category: { type: 'string' }
      }
    },
    handler: async (args) => {
      try {
        const res = await fetch('http://127.0.0.1:8002/api/agents?' + new URLSearchParams(args));
        return res.ok ? await res.json() : { error: 'failed' };
      } catch (e) { return { error: e.message }; }
    },
    skills: ['战略决策', '团队管理'],
    permission: 'basic'
  },
  {
    id: 'ecompany_create_task',
    name: 'ecompany_create_task',
    description: '在 eCompany 中创建并分配任务给指定的 AI 员工',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        assigneeId: { type: 'string' },
        priority: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['title', 'assigneeId']
    },
    handler: async (args) => {
      try {
        const res = await fetch('http://127.0.0.1:8002/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args)
        });
        return res.ok ? await res.json() : { error: 'failed' };
      } catch (e) { return { error: e.message }; }
    },
    skills: ['战略决策', '团队管理', '资源调配'],
    permission: 'basic'
  },
  {
    id: 'ecompany_chat',
    name: 'ecompany_chat',
    description: '与 eCompany 中指定的 AI 员工对话（调用指定 Agent 执行任务）',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        message: { type: 'string' }
      },
      required: ['agentId', 'message']
    },
    handler: async (args) => {
      try {
        const res = await fetch('http://127.0.0.1:8002/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args)
        });
        return res.ok ? await res.json() : { error: 'failed' };
      } catch (e) { return { error: e.message }; }
    },
    skills: ['战略决策', '团队管理'],
    permission: 'basic'
  },
  {
    id: 'ecompany_get_report',
    name: 'ecompany_get_report',
    description: '生成指定 AI 员工的工作报告（日报/周报/月报）',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        period: { type: 'string', enum: ['daily', 'weekly', 'monthly'] }
      },
      required: ['agentId']
    },
    handler: async (args) => {
      try {
        const res = await fetch('http://127.0.0.1:8002/api/report?agentId=' + (args.agentId || '') + '&period=' + (args.period || 'daily'));
        return res.ok ? await res.json() : { error: 'failed' };
      } catch (e) { return { error: e.message }; }
    },
    skills: ['战略决策', '团队管理'],
    permission: 'basic'
  },
  {
    id: 'ecompany_system_status',
    name: 'ecompany_system_status',
    description: '获取 eCompany 系统运行状态概览（健康检查、模型可用性）',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const r = await fetch('http://127.0.0.1:8002/api/health');
        return r.ok ? await r.json() : { error: 'failed' };
      } catch (e) { return { error: e.message }; }
    },
    skills: ['战略决策'],
    permission: 'admin'
  }
];

// ========== 3. 文件操作工具（来自 tools-executor.js） ==========
const FILE_TOOLS = [
  {
    id: 'file_read',
    name: 'file_read',
    description: '读取指定路径的文件内容（UTF-8文本）',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' }
      },
      required: ['path']
    },
    handler: async (args) => {
      try {
        if (!fs.existsSync(args.path)) return { error: 'file not found: ' + args.path };
        const content = fs.readFileSync(args.path, 'utf8');
        return { success: true, content: content.substring(0, 5000), size: content.length };
      } catch (e) { return { error: e.message }; }
    },
    skills: [],
    permission: 'basic'
  },
  {
    id: 'file_write',
    name: 'file_write',
    description: '写入内容到指定文件（覆盖模式，UTF-8）',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
        content: { type: 'string', description: '文件内容' }
      },
      required: ['path', 'content']
    },
    handler: async (args) => {
      try {
        // 自动保存版本
        try { var fv = require('./file-versions'); fv.createVersion(args.path, 'file_write'); } catch(e) {}
        fs.writeFileSync(args.path, args.content, 'utf8');
        return { success: true, bytes: Buffer.byteLength(args.content, 'utf8') };
      } catch (e) { return { error: e.message }; }
    },
    skills: [],
    permission: 'advanced'
  },
  {
    id: 'file_list',
    name: 'file_list',
    description: '列出指定目录中的文件列表',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录绝对路径' }
      },
      required: ['path']
    },
    handler: async (args) => {
      try {
        if (!fs.existsSync(args.path)) return { error: 'directory not found' };
        const items = fs.readdirSync(args.path);
        return { success: true, items: items.slice(0, 100), total: items.length };
      } catch (e) { return { error: e.message }; }
    },
    skills: [],
    permission: 'basic'
  }
];

// ========== 4. 汇总所有工具 ==========

// OpenClaw 技能工具（自动发现）
var SKILL_TOOLS = [];
function refreshSkillTools() { SKILL_TOOLS = skillProxy.getAllSkillTools().map(function(t) {
  return {
    id: t.function.name,
    name: t.function.name,
    description: t.function.description,
    skills: [],
    permission: 'user',
    handler: async function(args) {
      return await skillProxy.executeSkill(t.function.name, args);
    }
  };
}); }
refreshSkillTools();
// Refresh every 5 minutes
setInterval(refreshSkillTools, 300000);

// MCP 工具（来自 MCP 协议服务器）
var mcpBridge = require("./mcp-tools-bridge");
var MCP_TOOLS = [];
var lastMCPCount = 0;
function refreshMCPTools() {
  MCP_TOOLS = mcpBridge.getMCPTools();
  if (MCP_TOOLS.length !== lastMCPCount) {
    console.log("[MCP] Tools updated: " + MCP_TOOLS.length + " (was " + lastMCPCount + ")");
    lastMCPCount = MCP_TOOLS.length;
  }
}
refreshMCPTools();
setInterval(refreshMCPTools, 60000);

// 编码 Agent 工具
var codingAgent = require("./coding-agent");
var CODING_TOOLS = codingAgent.CODING_TOOLS || [];

// ========== 5. 角色基础工具（来自 agent-engine.js 的 ROLE_TOOLS）==========
// 每个非CEO Agent 都获得其角色对应的基础工具

const ROLE_TOOLS = [
  {
    id: 'query_team',
    name: 'query_team',
    description: '查询团队成员信息，支持按角色/技能/名称筛选',
    parameters: { type: 'object', properties: {
      role: { type: 'string', description: '按角色筛选' },
      skill: { type: 'string', description: '按技能筛选' },
      name: { type: 'string', description: '按名称搜索' }
    } },
    handler: async (args) => {
      try {
        var params = new URLSearchParams(args);
        var r = await fetch('http://127.0.0.1:8002/api/agents?' + params.toString());
        return r.ok ? await r.json() : { error: '查询失败' };
      } catch(e) { return { error: e.message }; }
    },
    skills: ['团队管理', '资源调配'],
    permission: 'basic'
  },
  {
    id: 'list_tasks',
    name: 'list_tasks',
    description: '列出当前任务，可按负责人/状态/数量筛选',
    parameters: { type: 'object', properties: {
      assigneeId: { type: 'string', description: '按负责人筛选' },
      status: { type: 'string', description: '按状态筛选: todo/in_progress/done' },
      limit: { type: 'number', description: '限制数量' }
    } },
    handler: async (args) => {
      try {
        var params = new URLSearchParams(args);
        var r = await fetch('http://127.0.0.1:8002/api/tasks?' + params.toString());
        return r.ok ? await r.json() : { error: '查询失败' };
      } catch(e) { return { error: e.message }; }
    },
    skills: ['团队管理', '战略决策'],
    permission: 'basic'
  },
  {
    id: 'read_file',
    name: 'read_file',
    description: '读取指定路径文件的内容',
    parameters: { type: 'object', properties: {
      filepath: { type: 'string', description: '文件绝对路径' }
    }, required: ['filepath'] },
    handler: async (args) => {
      try {
        var p = args.filepath;
        if (!p) return { error: '缺少filepath' };
        if (!fs.existsSync(p)) return { error: '文件不存在: ' + p };
        var content = fs.readFileSync(p, 'utf8');
        return { success: true, content: content.substring(0, 10000), size: content.length };
      } catch(e) { return { error: e.message }; }
    },
    skills: [],
    permission: 'basic'
  },
  {
    id: 'write_file',
    name: 'write_file',
    description: '写入内容到指定路径的文件（覆盖模式）',
    parameters: { type: 'object', properties: {
      filepath: { type: 'string', description: '文件绝对路径' },
      content: { type: 'string', description: '写入内容' }
    }, required: ['filepath', 'content'] },
    handler: async (args) => {
      try {
        if (!args.filepath || args.content === undefined) return { error: '缺少参数' };
        fs.writeFileSync(args.filepath, args.content, 'utf8');
        return { success: true, bytes: Buffer.byteLength(args.content, 'utf8') };
      } catch(e) { return { error: e.message }; }
    },
    skills: [],
    permission: 'advanced'
  },
  {
    id: 'search_web',
    name: 'search_web',
    description: '搜索网络获取最新信息',
    parameters: { type: 'object', properties: {
      query: { type: 'string', description: '搜索关键词' }
    }, required: ['query'] },
    handler: async (args) => {
      try {
        var searchUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(args.query || '') + '&mkt=zh-CN';
        var r = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) });
        var html = await r.text();
        var results = [];
        var reAlgo = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
        var m;
        while ((m = reAlgo.exec(html)) !== null && results.length < 5) {
          var titleMatch = m[1].match(/<h2[^>]*>(.*?)<\/h2>/i);
          var linkMatch = m[1].match(/href="(https?:[^"]+)"/i);
          var descMatch = m[1].match(/<p[^>]*>(.*?)<\/p>/i);
          results.push({
            title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '',
            link: linkMatch ? linkMatch[1] : '',
            snippet: descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : ''
          });
        }
        return { success: true, query: args.query, results: results };
      } catch(e) { return { error: e.message }; }
    },
    skills: ['研究分析'],
    permission: 'basic'
  },
  {
    id: 'get_weather',
    name: 'get_weather',
    description: '获取指定城市的天气信息',
    parameters: { type: 'object', properties: {
      city: { type: 'string', description: '城市名称' }
    }, required: ['city'] },
    handler: async (args) => {
      try {
        var r = await fetch('http://127.0.0.1:8002/api/weather?city=' + encodeURIComponent(args.city || ''));
        return r.ok ? await r.json() : { error: '天气查询失败' };
      } catch(e) { return { error: e.message }; }
    },
    skills: [],
    permission: 'basic'
  }
];

const ALL_TOOLS = [...BRIDGE_TOOLS, ...FILE_TOOLS, ...ROLE_TOOLS, ...SKILL_TOOLS, ...MCP_TOOLS, ...CODING_TOOLS];

// ========== 工具查找 ==========
function findToolByName(name) {
  for (const tool of ALL_TOOLS) {
    if (tool.name === name || tool.id === name) return tool;
  }
  return null;
}

function findToolsBySkills(skills) {
  if (!skills || !skills.length) return [];
  const matched = {};
  skills.forEach(skill => {
    const toolIds = getSkillMapperTools(skill);
    toolIds.forEach(id => { matched[id] = true; });
  });
  return ALL_TOOLS.filter(t => matched[t.id]);
}

function getSkillMapperTools(skill) {
  try {
    const mapper = JSON.parse(fs.readFileSync(path.join(BASE, 'skill-mapper.json'), 'utf8'));
    const map = mapper.mapping || {};
    return map[skill] || [];
  } catch (e) { return []; }
}

// ========== 构建支持工具调用的 messages ==========
/**
 * 为 Agent 构建带工具调用的 messages
 * @param {string} systemPrompt 基础系统提示词
 * @param {string[]} agentSkills Agent的技能列表
 * @param {Array} conversationHistory 对话历史
 * @param {string} userMessage 当前用户消息
 * @returns {Array} messages (用于 DeepSeek function calling)
 */
function buildToolMessages(systemPrompt, agentSkills, conversationHistory, userMessage) {
  const messages = [{ role: 'system', content: systemPrompt }];
  
  // 对话历史
  for (const c of (conversationHistory || []).slice(-20)) {
    if (c.role && c.content) messages.push({ role: c.role, content: c.content });
  }
  
  // 当前消息
  messages.push({ role: 'user', content: userMessage });
  
  return messages;
}

/**
 * 获取 Agent 可用的工具列表（基于 skill-mapper 映射）
 */
function getAgentTools(agentSkills) {
  const tools = [];
  const seen = {};
  
  for (const skill of (agentSkills || [])) {
    const toolIds = getSkillMapperTools(skill);
    for (const id of toolIds) {
      if (!seen[id]) {
        seen[id] = true;
        const tool = ALL_TOOLS.find(t => t.id === id);
        if (tool) tools.push(tool);
      }
    }
  }
  
  // 如果没有技能匹配，回退到角色基础工具
  if (!tools.length) {
    tools.push(...ROLE_TOOLS);
  }
  
  return tools;
}

/**
 * 构建 DeepSeek API 格式的 tools 参数
 */
function buildDeepSeekTools(tools) {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: 'object', properties: {} }
    }
  }));
}

/**
 * 执行工具调用
 */
async function executeTool(name, args) {
  const tool = findToolByName(name);
  if (!tool) return { error: 'unknown tool: ' + name };
  try {
    return await tool.handler(args);
  } catch (e) {
    return { error: 'tool execution failed: ' + e.message };
  }
}

/**
 * 获取工具注册表统计
 */
function getToolStats() {
  return {
    total: ALL_TOOLS.length,
    bridge: BRIDGE_TOOLS.length,
    file: FILE_TOOLS.length,
    ceo: CEO_TOOLS.length,
    tools: ALL_TOOLS.map(t => ({ id: t.id, name: t.name, permission: t.permission }))
  };
}

module.exports = {
  ALL_TOOLS,
  BRIDGE_TOOLS,
  FILE_TOOLS,
  ROLE_TOOLS,
  CEO_TOOLS,
  findToolByName,
  findToolsBySkills,
  getAgentTools,
  getSkillMapperTools,
  buildToolMessages,
  buildDeepSeekTools,
  executeTool,
  getToolStats
};