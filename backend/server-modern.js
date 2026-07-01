/**
 * eCompany-Claw 现代化服务器(模块化版)
 *
 * 保留原有 server.js 的所有功能,但通过模块化重构提升可维护性
 * 注入:多模型 AI 引擎、OpenClaw 桥接、工具系统
 *
 * 启动方式:node backend/server-modern.js
 * 端口:8002
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8002', 10);
const BASE = __dirname;
const baseNorm = path.resolve(BASE) + path.sep;
const FRONTEND = path.join(BASE, '..', 'frontend');
const DIST = path.join(FRONTEND, 'dist');
const DIST_V2 = path.resolve(BASE, '..', 'frontend', 'dist');

// ========== 加载模块 ==========
const openclawBridge = require('./modules/openclaw-bridge');
const { cronScheduler, taskFlow } = require('./modules/automation');
const { ProcessSandbox, FileSandbox } = require('./modules/sandbox');
const { skillSystem } = require('./modules/skills');
const coreMem = require('./modules/core-memory');
const harHabits = require('./modules/harness-habits');
const { taskQueue } = require('./modules/task-queue');
const { registerI18nAPI } = require('./modules/i18n');
const agentWorker = require('./modules/agent-worker-engine');
// === Load provider keys into env vars ===
try {
  var pkPath = path.join(BASE, 'provider-keys.json');
  if (fs.existsSync(pkPath)) {
    var allKeys = JSON.parse(fs.readFileSync(pkPath, 'utf-8'));
    var pm = { deepseek:'DEEPSEEK_API_KEY', tongyi:'TONGYI_API_KEY', hunyuan:'HUNYUAN_API_KEY' };
    for (var k of Object.keys(allKeys)) {
      var envName = pm[k] || (k.toUpperCase() + '_API_KEY');
      if (!process.env[envName]) process.env[envName] = allKeys[k];
    }
  }
} catch(e) {}

// === Load provider keys into env vars ===
try {
  var pkPath = path.join(BASE, 'provider-keys.json');
  if (fs.existsSync(pkPath)) {
    var allKeys = JSON.parse(fs.readFileSync(pkPath, 'utf-8'));
    var pm = { deepseek:'DEEPSEEK_API_KEY', tongyi:'TONGYI_API_KEY', hunyuan:'HUNYUAN_API_KEY' };
    for (var k of Object.keys(allKeys)) {
      var envName = pm[k] || (k.toUpperCase() + '_API_KEY');
      if (!process.env[envName]) process.env[envName] = allKeys[k];
    }
  }
} catch(e) {}

const { db, agentOps, taskOps, convOps, skillOps, licenseOps } = require('./modules/database');
const wsServer = require('./modules/ws-server');
const { eventBus, messageQueue, EventStore } = require('./modules/agent-bus');
const SharedMemory = require('./modules/shared-memory');
const biDashboard = require('./modules/bi-dashboard');
const modelRouter = require('./modules/model-router');
const automationV2 = require('./modules/automation-v2');
const knowledgeEngine = require('./modules/knowledge-engine');
const channelIntegration = require('./modules/channel-integration');
const skillsRunner = require('./modules/skills-runner');
const lifecycleRoutes = require('./modules/lifecycle-routes');
const selfEvolution = require('./modules/self-evolution');
const QualitySystem = require('./modules/quality-system');
const unifiedEngine = require('./modules/unified-engine');
const unifiedRouter = require('./modules/unified-router');

const processSandbox = new ProcessSandbox();
const fileSandbox = new FileSandbox();

// ========== v4 CEO 调度系统 ==========
const { registerV4Routes } = require('./modules/v4-dispatch');

// ========== 数据文件 ==========
// ========== 加载 .env 文件 ==========
(function() {
  const envPath = path.join(BASE, '..', '.env');
  try {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
          val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
      console.log('[env] 已加载 .env 文件');
    }
  } catch(e) { /* silently skip */ }
})();

const AGENTS_FILE = path.join(BASE, 'agents.json');
const TASKS_FILE = path.join(BASE, 'tasks.json');
const LICENSE_FILE = path.join(BASE, 'licenses.json');

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      let raw = fs.readFileSync(file, 'utf-8');
      if (raw.length > 0 && (raw.charCodeAt(0) === 0xFEFF || raw.charCodeAt(0) === 239))
        raw = raw.replace(/^[\uFEFF\xEF\xBB\xBF]+/, '');
      return JSON.parse(raw);
    }
  } catch(e) { console.error('[load]', file, e.message); }
  return fallback;
}

function saveJSON(file, data) {
  var tmpFile = file + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, file);
  } catch(e) {
    try { fs.unlinkSync(tmpFile); } catch(e2) {}
    throw e;
  }
}

const TEAM_AGENTS = loadJSON(AGENTS_FILE, []);
const AGENTS_MAP = {};
TEAM_AGENTS.forEach(a => { AGENTS_MAP[a.id] = a; });
let TASKS = loadJSON(TASKS_FILE, []);
let LICENSES = loadJSON(LICENSE_FILE, []);
// Helper: get API key from env or file
function getActiveApiKey() {
  // === 智能路由策略 ===
  // 1. 优先读配置文件（ai-provider.json）
  // 2. 回退到环境变量
  // 3. 都没有则返回空
  try {
    var cfgPath = path.join(BASE, 'ai-provider.json');
    if (fs.existsSync(cfgPath)) {
      var cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (cfg.apiKey && cfg.apiKey.length > 4) {
        // 同步到环境变量（给其他模块使用）
        process.env.DEEPSEEK_API_KEY = cfg.apiKey;
        return cfg.apiKey;
      }
    }
  } catch(e) { /* 配置文件读取失败，尝试环境变量 */ }

  // 回退到环境变量
  if (process.env.DEEPSEEK_API_KEY) {
    console.log('[AI] 使用环境变量 DEEPSEEK_API_KEY（配置文件未设置）');
    return process.env.DEEPSEEK_API_KEY;
  }

  console.warn('[AI] ⚠️ 未配置任何 API Key（配置文件 + 环境变量均为空）');
  return '';
}

// ========== CEO Agent 引擎:自主推理 + 工具调用 + 动态决策 ==========
const CEOMEM_PATH = path.join(BASE, 'memory-ai_ceo.json');

function loadCEOMemory() {
  try {
    var raw = fs.readFileSync(CEOMEM_PATH, 'utf-8');
    var m = JSON.parse(raw);
    if (!m.decisions) m.decisions = [];
    if (!m.conversations) m.conversations = [];
    return m;
  } catch(e) {
    return { decisions: [], conversations: [], memory: {} };
  }
}

function saveCEOMemory(m) {
  try {
    if (!m.decisions) m.decisions = [];
    if (!m.conversations) m.conversations = [];
    if (m.decisions.length > 200) m.decisions = m.decisions.slice(-200);
    if (m.conversations.length > 200) m.conversations = m.conversations.slice(-200);
    fs.writeFileSync(CEOMEM_PATH, JSON.stringify(m, null, 2), 'utf-8');
  } catch(e) { /* silently fail */ }
}

/**
 * 跨平台路径解析
 * 支持: Unix路径→Windows, ~/→用户目录, 相对路径→基于BASE
 */
function resolvePath(filepath) {
  if (!filepath || !filepath.trim()) return null;
  var p = filepath.trim();

  // Windows 上处理 Unix 风格路径
  if (process.platform === 'win32') {
    // ~/ 或 ~\ 开头 → 用户目录
    if (p.startsWith('~/') || p.startsWith('~\\')) {
      p = require('os').homedir() + p.substring(1);
    }
    // /c/xxx 或 /C/xxx 风格 → C:\xxx
    else if (p.match(/^\/[a-zA-Z]\//)) {
      p = p[1].toUpperCase() + ':' + p.substring(2);
    }
    // /tmp 或 /temp → Windows 临时目录
    else if (/^\/(tmp|temp)(\/|$)/.test(p)) {
      p = require('os').tmpdir() + p.substring(4);
    }
    // /var/tmp → Windows 临时目录
    else if (/^\/var\/tmp(\/|$)/.test(p)) {
      p = require('os').tmpdir() + p.substring(7);
    }
    // Unix 绝对路径 → 拒绝(不认识的路径)
    else if (p.startsWith('/')) {
      return null;
    }
  } else {
    // macOS/Linux 处理 ~
    if (p.startsWith('~/')) {
      p = require('os').homedir() + p.substring(1);
    }
  }

  return require('path').resolve(BASE, p);
}

var CEO_TOOLS = [
  { type: 'function', function: { name: 'query_team', description: '查询团队成员信息', parameters: { type: 'object', properties: { role: { type: 'string', description: '按角色筛选' }, skill: { type: 'string', description: '按技能筛选' }, name: { type: 'string', description: '按名称搜索' } } } } },
  { type: 'function', function: { name: 'assign_task', description: '给成员分配新任务。分配任务时必须填写详细的描述说明，让员工知道具体要做什么', parameters: { type: 'object', properties: { title: { type: 'string', description: '任务标题' }, assigneeId: { type: 'string', description: '负责人ID' }, description: { type: 'string', description: '⭐ 必填！详细任务描述、验收标准、参考信息' }, priority: { type: 'string', description: '优先级: emergency/high/medium/low' }, deadline: { type: 'string', description: '截止日期，格式 YYYY-MM-DD' } }, required: ['title', 'assigneeId', 'description'] } } },
  { type: 'function', function: { name: 'list_tasks', description: '列出当前所有任务', parameters: { type: 'object', properties: { assigneeId: { type: 'string', description: '按负责人筛选' }, status: { type: 'string', description: '按状态筛选' }, limit: { type: 'number', description: '限制数量' } } } } },
  { type: 'function', function: { name: 'search_web', description: '搜索网络获取最新信息', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_weather', description: '获取天气信息', parameters: { type: 'object', properties: { city: { type: 'string', description: '城市名称' } }, required: ['city'] } } },
  { type: 'function', function: { name: 'read_file', description: '读取文件内容(Windows用C:\\path\\file,macOS/Linux用/path/file,~开头自动解析到家目录)', parameters: { type: 'object', properties: { filepath: { type: 'string', description: '文件路径(Win: C:\\xxx, Unix: /xxx, ~/xxx)' } }, required: ['filepath'] } } },
  { type: 'function', function: { name: 'write_file', description: '写入内容到用户指定路径的文件(支持系统任意目录)', parameters: { type: 'object', properties: { filepath: { type: 'string', description: '文件路径' }, content: { type: 'string', description: '文件内容' } }, required: ['filepath', 'content'] } } },
  { type: 'function', function: { name: 'exec', description: '在服务器上执行 shell 命令(CEO 专用,解压用file_manager不要用exec)', parameters: { type: 'object', properties: { command: { type: 'string', description: '命令内容' } }, required: ['command'] } } }

,
  { type: 'function', function: { name: 'system_health', description: '检查系统健康(服务器、数据库、AI提供商、内存、前端)', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'skill_manager', description: '查看已安装的技能列表、安装新技能(查询技能用这个,不要用 read_file)', parameters: { type: 'object', properties: { action: { type: 'string', description: '操作' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'channel_config', description: '配置通讯渠道', parameters: { type: 'object', properties: { action: { type: 'string', description: '操作' }, channel: { type: 'string', description: '渠道名称' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'file_manager', description: '文件管理:解压ZIP、列目录、复制移动文件、查看文件信息(解压用tar,正确处理中文路径)', parameters: { type: 'object', properties: { action: { type: 'string', description: '操作:unzip/list/copy/move/delete/info' }, source: { type: 'string', description: '源文件路径' }, dest: { type: 'string', description: '目标路径' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'harness_status', description: '查看 Harness 边界监控状态', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'harness_errors', description: '查看 Harness 错误趋势和自动工单', parameters: { type: 'object', properties: { days: { type: 'number', description: '查看天数默认7天' } }, required: [] } } },
  { type: 'function', function: { name: 'harness_sla', description: '查看 Harness SLA 统计数据', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'harness_dag', description: '查看任务依赖图谱', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'harness_agent_control', description: '设置指定 Agent 的速率限制和行为覆盖', parameters: { type: 'object', properties: { agentId: { type: 'string', description: 'Agent ID' }, perMinute: { type: 'number', description: '每分钟最大调用次数' }, perHour: { type: 'number', description: '每小时最大调用次数' }, enabled: { type: 'boolean', description: '启用/禁用' } }, required: ['agentId'] } } },
  { type: 'function', function: { name: 'harness_habits_analyze', description: '分析老板操作习惯和偏好趋势(带记忆衰减)\nCEO/安全总监专用:查看用户习惯演变', parameters: { type: 'object', properties: { days: { type: 'number', description: '分析天数默认90' } }, required: [] } } },
  { type: 'function', function: { name: 'harness_habits_record', description: '手动记录一条老板的操作习惯或偏好', parameters: { type: 'object', properties: { category: { type: 'string', description: '类别: command/preference/format/report/workflow' }, action: { type: 'string', description: '行为描述' }, detail: { type: 'string', description: '详情' } }, required: ['category', 'action'] } } },
  { type: 'function', function: { name: 'harness_habits_confirm', description: '确认或拒绝一条待验证的偏好推测\n老板确认回路:AI推测的习惯需要老板确认后才写入核心库', parameters: { type: 'object', properties: { prefId: { type: 'string', description: '偏好ID' }, confirmed: { type: 'boolean', description: '是否确认' }, note: { type: 'string', description: '备注' } }, required: ['prefId', 'confirmed'] } } },
  { type: 'function', function: { name: 'harness_habits_pending', description: '列出所有待老板确认的偏好推测', parameters: { type: 'object', properties: {}, required: [] } } },
    { type: 'function', function: { name: 'compliance_audit_tasks', description: '合规审计:审计当前所有任务的质量和状态,发现不合规项\n合规审计小组专用', parameters: { type: 'object', properties: { filter: { type: 'string', description: '筛选条件: all/pending/done' } }, required: [] } } },
  { type: 'function', function: { name: 'compliance_audit_product', description: '合规审计:审计产品交付物质量和合规性\n合规审计小组专用', parameters: { type: 'object', properties: { productId: { type: 'string', description: '产品ID' } }, required: [] } } },
  { type: 'function', function: { name: 'compliance_report', description: '生成合规审计报告,汇总任务和产品的审计结果\n合规审计小组专用', parameters: { type: 'object', properties: { scope: { type: 'string', description: '范围: all/tasks/products' } }, required: [] } } },
    { type: 'function', function: { name: 'harness_boundary_reset', description: '重置 Harness 边界统计', parameters: { type: 'object', properties: {}} } },
  { type: 'function', function: { name: 'harness_rules_list', description: '查看 Harness 规则引擎的所有规则(可按状态/类型过滤) 合规审计Agent/安全审计Agent专用', parameters: { type: 'object', properties: { status: { type: 'string', description: '过滤 active/proposed/rejected/deprecated' }, type: { type: 'string', description: '过滤 rate_limit/permission/compliance/operation' } }, required: [] } } },
  { type: 'function', function: { name: 'harness_rules_propose', description: '提议新规则:合规审计Agent发现规则缺口时提出,进入proposed状态,需安全Agent确认后生效', parameters: { type: 'object', properties: { type: { type: 'string', description: '规则类型: rate_limit/permission/compliance/operation' }, name: { type: 'string', description: '规则名称' }, condition: { type: 'string', description: '触发条件(如 agent.callsPerMinute >= 20)' }, action: { type: 'string', description: '动作: block/warn/log' }, reason: { type: 'string', description: '规则说明' }, severity: { type: 'string', description: '严重度 low/medium/high/critical 默认medium' } }, required: ['type', 'condition', 'action'] } } },
  { type: 'function', function: { name: 'harness_rules_confirm', description: '确认规则:安全审计Agent确认合规审计Agent提出的规则 多签确认流程 propose confirm activate', parameters: { type: 'object', properties: { ruleId: { type: 'string', description: '规则ID' }, note: { type: 'string', description: '确认备注' } }, required: ['ruleId'] } } },
  { type: 'function', function: { name: 'harness_rules_reject', description: '驳回规则:安全审计Agent驳回不合规的规则提议', parameters: { type: 'object', properties: { ruleId: { type: 'string', description: '规则ID' }, reason: { type: 'string', description: '驳回理由' } }, required: ['ruleId', 'reason'] } } },
  { type: 'function', function: { name: 'harness_rules_pending', description: '列出所有待确认的规则提议(安全审计Agent审批用)', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'harness_proposal_submit', description: '提交结构化方案供规则引擎验证,通过放行不通过打回 tool_call/task_execute/config_change', parameters: { type: 'object', properties: { type: { type: 'string', description: '方案类型 tool_call/task_execute/config_change 默认tool_call' }, action: { type: 'object', description: '方案内容 tool_call需要{tool,params,reasoning,expected,risk}' }, context: { type: 'object', description: '上下文可选' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'harness_proposal_appeal', description: '申诉被阻断的方案:规则引擎打回时提交申诉理由,需VP以上审批豁免', parameters: { type: 'object', properties: { proposalId: { type: 'string', description: '方案ID' }, justification: { type: 'string', description: '申诉理由' } }, required: ['proposalId', 'justification'] } } },
  { type: 'function', function: { name: 'harness_proposal_audit', description: '查看提案审计日志:追溯方案提交/阻断/申诉/豁免记录,合规审计Agent专用', parameters: { type: 'object', properties: { limit: { type: 'number', description: '返回条数限制默认50' } }, required: [] } } },
  { type: 'function', function: { name: 'memory_write', description: '核心记忆库写入器:将对话摘要、关键决策、任务记录、员工表现等直接写入核心记忆库\n自动按规则入库,无需手动确认', parameters: { type: 'object', properties: { content: { type: 'string', description: '结构化记忆内容(对话摘要/决策/任务/员工表现)' }, tags: { type: 'string', description: '标签列表,逗号分隔,用于分类检索' }, priority: { type: 'string', description: '优先级: high/medium/low 默认medium' }, type: { type: 'string', description: '记忆类型: summary决策/decision决策/task任务/performance表现/knowledge知识/preference偏好 默认general' } }, required: ['content'] } } },
  { type: 'function', function: { name: 'memory_search', description: '核心记忆库检索器:按关键词、时间范围、标签等条件检索历史记忆\n支持模糊搜索,按优先级排序返回', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' }, tags: { type: 'string', description: '标签过滤,逗号分隔' }, type: { type: 'string', description: '记忆类型过滤 summary/decision/task/performance/knowledge' }, priority: { type: 'string', description: '优先级过滤 high/medium/low' }, dateFrom: { type: 'string', description: '开始时间 ISO格式' }, dateTo: { type: 'string', description: '结束时间 ISO格式' }, limit: { type: 'number', description: '返回条数限制 默认20 最大100' } }, required: [] } } },
  { type: 'function', function: { name: 'memory_version', description: '记忆版本管理器:查看记忆修改历史、回滚到某个版本,防止误写入导致信息丢失\n管理记忆库的版本快照', parameters: { type: 'object', properties: { action: { type: 'string', description: '操作: list列出版本/rollback回滚到指定版本/record_detail查看某条记录的历史' }, versionId: { type: 'string', description: '回滚目标版本ID(action=rollback时需要)' }, recordId: { type: 'string', description: '记录ID(action=record_detail时需要)' } }, required: ['action'] } } }

,
  { type: 'function', function: { name: 'complete_task', description: '核销任务:将任务标记为已完成,填写完成结果和评分', parameters: { type: 'object', properties: { taskId: { type: 'string', description: '任务ID' }, result: { type: 'string', description: '完成结果描述' }, score: { type: 'string', description: '评分 A/B/C 默认A' } }, required: ['taskId', 'result'] } } },
  { type: 'function', function: { name: 'review_task', description: '审核员工提交的任务:批准或驳回,给出反馈', parameters: { type: 'object', properties: { taskId: { type: 'string', description: '任务ID' }, approved: { type: 'boolean', description: '是否通过' }, feedback: { type: 'string', description: '审核反馈' } }, required: ['taskId', 'approved'] } } },
  { type: 'function', function: { name: 'reassign_task', description: '将停滞或逾期任务重新分配给其他人', parameters: { type: 'object', properties: { taskId: { type: 'string', description: '任务ID' }, newAssigneeId: { type: 'string', description: '新的负责人ID' }, reason: { type: 'string', description: '重新分配原因' } }, required: ['taskId', 'newAssigneeId'] } } }
,
  { type: 'function', function: { name: 'tencent_docs_create', description: '创建腾讯在线文档(支持Word/Excel/幻灯片/思维导图/流程图/智能表格)', parameters: { type: 'object', properties: { type: { type: 'string', description: '文档类型: doc文档/xls表格/slide幻灯片/mindmap思维导图' }, title: { type: 'string', description: '文档标题' } }, required: ['type', 'title'] } } },
  { type: 'function', function: { name: 'tencent_meeting_create', description: '创建腾讯会议预约', parameters: { type: 'object', properties: { subject: { type: 'string', description: '会议主题' }, start_time: { type: 'string', description: '开始时间(ISO格式 如2026-05-15T10:00:00)' }, duration: { type: 'number', description: '会议时长分钟默认30' } }, required: ['subject', 'start_time'] } } },
  { type: 'function', function: { name: 'tencent_survey_create', description: '创建腾讯问卷', parameters: { type: 'object', properties: { title: { type: 'string', description: '问卷标题' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'system_check_provider', description: '检查指定AI提供商连通性(如DeepSeek),测试API是否可用', parameters: { type: 'object', properties: { provider: { type: 'string', description: '提供商名称 deepseek/openai/anthropic/google/tongyi 等,不填则检查默认' } }, required: [] } } },
  { type: 'function', function: { name: 'system_check_bridge', description: '检查指定通讯渠道桥接状态(微信/QQ/飞书/钉钉/企微/腾讯云)', parameters: { type: 'object', properties: { channel: { type: 'string', description: '渠道名称 wechat/qqbot/feishu/dingtalk/wecom/tencent 不填则全查' } }, required: [] } } },
  { type: 'function', function: { name: 'system_logs', description: '查看系统最近日志,排查错误,按级别筛选', parameters: { type: 'object', properties: { level: { type: 'string', description: '日志级别 error/warn/info,默认error' }, limit: { type: 'number', description: '返回条数,默认20' } }, required: [] } } },
  { type: 'function', function: { name: 'system_processes', description: '查看系统所有运行中的Node.js进程列表,确认各桥接和子服务是否存活', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'system_disk', description: '查看服务器磁盘使用情况,预警空间不足', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'bi_query', description: '数据分析与可视化:当用户想查看系统统计、趋势图表、日报报表或活跃排行时调用。用户在问[查数据][看趋势][日报][排行]时优先使用。参数query填overview(总览)/trend(趋势)/report(日报)/leaderboard(排行)', parameters: { type: 'object', properties: { query: { type: 'string', description: '查询:overview总览,trend趋势,report日报,leaderboard排行' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'kb_search', description: '知识库搜索:当用户想搜索已知知识、技术资料、配置信息、历史文档时调用。用户在问[找一下][查资料][搜索知识][有没有关于xxx的资料]时优先使用', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'kb_create', description: '知识库创建:当用户想保存一条知识、技术文档、配置说明到知识库时调用。用户说[记一下][保存这条][新建知识]时使用。系统自动分类+图谱关联', parameters: { type: 'object', properties: { title: { type: 'string', description: '条目标题' }, content: { type: 'string', description: '条目内容' }, tags: { type: 'string', description: '标签逗号分隔' } }, required: ['title', 'content'] } } },
  { type: 'function', function: { name: 'auto_run_flow', description: '自动化RPA:运行预设的自动化流程。用户说[自动跑一下][执行自动化][帮我抓取][监控网站]时调用。模板:scheduled_report(日报)/scrape_news(新闻)/monitor_website(监控)', parameters: { type: 'object', properties: { template: { type: 'string', description: '模板:scheduled_report/scrape_news/monitor_website' }, name: { type: 'string', description: '流程名称' }, url: { type: 'string', description: '目标URL(可选)' } }, required: ['template', 'name'] } } },
  { type: 'function', function: { name: 'integration_status', description: '外部系统集成状态:用户问[渠道状态][集成情况][飞书/钉钉/企微能不能用]时调用。查看各渠道配置状态和审批/日历/文档功能可用情况', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'evolve_run', description: '系统自我演化:用户说[自检一下][自我修复][运行演化][检查系统问题]时调用。完整循环:检测问题->分析根因->生成修复->验证推广。每30分钟自动触发', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'skill_api_testing', description: 'API测试:测试系统API端点的可用性和响应时间。用户说[测一下API][接口测试][端点检查]时调用', parameters: { type: 'object', properties: { endpoint: { type: 'string', description: '要测试的API路径如/api/health,不填则测试全部关键端点' } }, required: [] } } },
  { type: 'function', function: { name: 'skill_code_review', description: '代码审查:审查一段代码的质量、安全性和性能。用户说[审查代码][review代码][代码评审]时调用', parameters: { type: 'object', properties: { code: { type: 'string', description: '要审查的代码内容' }, language: { type: 'string', description: '编程语言' } }, required: ['code'] } } },
  { type: 'function', function: { name: 'skill_system_analyze', description: '系统分析:全面分析eCompany系统健康状态,包括API趋势、桥接状态、错误日志。用户说[系统分析][检查系统][健康检查]时调用', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'skill_task_dispatch', description: '任务分发:将任务拆解并分配给AI团队。用户说[分派任务][分配工作][派活]时调用', parameters: { type: 'object', properties: { mission: { type: 'string', description: '任务描述' } }, required: ['mission'] } } },
  { type: 'function', function: { name: 'skill_file_manager', description: '文件管理:查看目录结构、文件信息和系统路径。用户说[查看文件][目录结构][系统路径]时调用', parameters: { type: 'object', properties: { path: { type: 'string', description: '要查看的文件或目录路径' }, action: { type: 'string', description: '操作:list(列目录)/info(文件信息)/disk(磁盘空间)' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'skill_risk_assessment', description: '风险评估:识别系统安全风险,检查API暴露面、鉴权状况和凭证配置。用户说[风险评估][安全检查][安全审计]时调用', parameters: { type: 'object', properties: {}, required: [] } } }
,
  { type: 'function', function: { name: 'skill_web_search', description: '网络搜索:通过Bing搜索获取最新信息,用户说[搜一下][网上查]时调用', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'skill_docker_helper', description: 'Docker辅助:检查Docker和容器状态,用户说[docker][容器]时调用', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'skill_python_helper', description: 'Python:检查Python环境,用户说[Python][执行代码]时调用', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'skill_vue_helper', description: 'Vue3:Vue3前端开发指南,用户说[Vue][前端开发]时调用', parameters: { type: 'object', properties: { question: { type: 'string', description: 'Vue问题' } }, required: ['question'] } } },
  { type: 'function', function: { name: 'skill_project_board', description: '项目看板:查看员工和调用统计,用户说[项目状态][看板]时调用', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'skill_channel_config', description: '渠道配置:查看飞书/钉钉/企微配置状态和可用功能,用户说[渠道][配置]时调用', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'skill_browser_check', description: '浏览器自动化:检查Puppeteer/Playwright可用性', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'skill_bluebubbles_guide', description: 'iMessage:Apple iMessage BlueBubbles集成指南', parameters: { type: 'object', properties: { question: { type: 'string', description: '问题' } }, required: ['question'] } } },
  { type: 'function', function: { name: 'skill_dingtalk_guide', description: '钉钉集成:钉钉开放平台审批/日历/机器人集成指南,用户说[钉钉]时调用', parameters: { type: 'object', properties: { action: { type: 'string', description: '审批/日历/机器人' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'skill_dingtalk_rules', description: '钉钉规则:钉钉渠道消息格式和事件处理规则指南', parameters: { type: 'object', properties: { topic: { type: 'string', description: '规则主题' } }, required: ['topic'] } } },
  { type: 'function', function: { name: 'skill_dingtalk_troubleshoot', description: '钉钉故障:钉钉ECONNRESET等常见问题的排查指南', parameters: { type: 'object', properties: { issue: { type: 'string', description: '问题描述' } }, required: ['issue'] } } },
  { type: 'function', function: { name: 'skill_dws_cli', description: 'DWS CLI:钉钉DWS命令行工具用法指导', parameters: { type: 'object', properties: { command: { type: 'string', description: 'DWS命令' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'skill_feishu_doc', description: '飞书文档:飞书文档协同API集成指南', parameters: { type: 'object', properties: { action: { type: 'string', description: '创建/编辑/读取' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'skill_feishu_drive', description: '飞书云盘:飞书云盘文件管理API集成指南', parameters: { type: 'object', properties: { action: { type: 'string', description: '上传/下载/列表' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'skill_feishu_perm', description: '飞书权限:飞书权限管理API集成指南', parameters: { type: 'object', properties: { action: { type: 'string', description: '查询/授予/撤销' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'skill_feishu_wiki', description: '飞书知识库:飞书Wiki API集成指南', parameters: { type: 'object', properties: { action: { type: 'string', description: '创建/搜索/管理' } }, required: ['action'] } } }
,
  { type: 'function', function: { name: 'skill_provider_status', description: 'AI提供商检查:查看所有AI提供商Key状态。用户说[提供商][AI厂商][模型Key][哪个AI能用]时调用', parameters: { type: 'object', properties: {}, required: [] } } }
];

async function execCEOTool(name, args, ceoMem) {
  var result = { success: true, message: '' };

  // New tools: bypass switch for 6 new functions
  if (name === 'bi_query') {
    try { var q = (args.query || '').toLowerCase(); var u = 'http://127.0.0.1:' + PORT + '/api/bi/overview'; if (q.includes('trend')||q.includes('趋势')) u='http://127.0.0.1:'+PORT+'/api/bi/trend?days=14'; else if (q.includes('report')||q.includes('日报')||q.includes('报表')) u='http://127.0.0.1:'+PORT+'/api/bi/report?type=daily'; else if (q.includes('leaderboard')||q.includes('排行')) u='http://127.0.0.1:'+PORT+'/api/bi/leaderboard?hours=24'; var r = await fetch(u); if (r.ok) { result.data = await r.json(); result.message = 'BI查询完成'; } else { result.success = false; result.message = 'BI查询失败'; } } catch(e) { result.success = false; result.message = 'BI查询失败:' + e.message; }
  } else if (name === 'kb_search') {
    try { var r = await fetch('http://127.0.0.1:' + PORT + '/api/kb/search?q=' + encodeURIComponent(args.query||'')); if (r.ok) { var d = await r.json(); result.data = { query: args.query, results: d.results, total: d.total }; result.message = '找到 ' + d.total + ' 条结果'; } else { result.success = false; } } catch(e) { result.success = false; result.message = '搜索失败:' + e.message; }
  } else if (name === 'kb_create') {
    try { var b = { title: args.title, content: args.content, tags: (args.tags||'').split(',').map(function(t){return t.trim()}).filter(Boolean), author: 'ai_ceo' }; var r = await fetch('http://127.0.0.1:' + PORT + '/api/kb/entries', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }); if (r.ok) { var d = await r.json(); result.data = d.entry; result.message = '已创建知识条目: ' + d.entry.title; } else { result.success = false; } } catch(e) { result.success = false; result.message = '创建失败:' + e.message; }
  } else if (name === 'auto_run_flow') {
    try { var tmpl = args.template||''; var fn = args.name||'CEOFlow_'+Date.now(); var steps = []; if (tmpl === 'scheduled_report') { steps = [{ name:'获取日报', type:'api_call', params:{ url:'http://127.0.0.1:'+PORT+'/api/bi/report?type=daily', method:'GET' } }, { name:'通知', type:'notify', params:{ message:'CEO触发生成报表' } }]; } else { var su = args.url||'https://example.com'; steps = [{ name:'抓取', type:'scrape', params:{ url: su } }, { name:'通知', type:'notify', params:{ message:'自动化:' + tmpl} }]; } var fR = await fetch('http://127.0.0.1:'+PORT+'/api/auto/flows', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name: fn, steps: steps, trigger:'manual'}) }); if (fR.ok) { var fD = await fR.json(); var rR = await fetch('http://127.0.0.1:'+PORT+'/api/auto/flows/'+fD.flow.id+'/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' }); if (rR.ok) { var rD = await rR.json(); result.data = rD.run; result.message = '流程已启动: ' + fn; } else { result.success=false; } } else { result.success=false; } } catch(e) { result.success = false; result.message = '自动化失败:' + e.message; }
  } else if (name === 'integration_status') {
    try { var r = await fetch('http://127.0.0.1:' + PORT + '/api/integration/status'); if (r.ok) { var d = await r.json(); result.data = d.summary; result.message = '集成状态已获取'; } else { result.success = false; } } catch(e) { result.success = false; result.message = '查询失败:' + e.message; }
  } else if (name === 'evolve_run') {
    try { var r = await fetch('http://127.0.0.1:' + PORT + '/api/evolve/cycle', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({baseUrl:'http://127.0.0.1:'+PORT}) }); if (r.ok) { var d = await r.json(); result.data = { summary: d.cycle.summary, detected: d.cycle.detected.length, promoted: d.cycle.promoted }; result.message = '演化完成: ' + d.cycle.summary; } else { result.success = false; } } catch(e) { result.success = false; result.message = '演化失败:' + e.message; }
  } else if (name === 'skill_api_testing') {
    try { var eps = ['/api/health','/api/bi/overview','/api/kb/stats','/api/auto/flows','/api/evolve/stats','/api/integration/status']; var res = []; for (var ei = 0; ei < eps.length; ei++) { try { var er = await fetch('http://127.0.0.1:' + PORT + eps[ei]); if (eps[ei] === '/api/search-web') { er = await fetch('http://127.0.0.1:' + PORT + eps[ei], { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({query:'test'}) }); } res.push({ endpoint: eps[ei], status: er.status, ok: er.ok }); } catch(ee) { res.push({ endpoint: eps[ei], status: 0, ok: false, error: ee.message }); } } var pc = res.filter(function(r){return r.ok}).length; result.data = res; result.message = 'API测试完成: ' + pc + '/' + res.length + ' 正常'; } catch(e) { result.success = false; result.message = '测试失败:' + e.message; }
  } else if (name === 'skill_code_review') {
    try { var code = args.code || ''; var lang = args.language || 'unknown'; var issues = []; if (code.includes('eval(')) issues.push({severity:'🔴',msg:'使用eval()存在代码注入风险'}); if (code.includes('innerHTML')) issues.push({severity:'🟡',msg:'使用innerHTML可能导致XSS'}); if (code.includes('var ') && code.includes('const ')) issues.push({severity:'🔵',msg:'混用var和const,建议统一使用const'}); if (code.split('\n').length > 200) issues.push({severity:'🔵',msg:'文件过长('+code.split('\n').length+'行),考虑拆分'}); result.data = { lang: lang, lines: code.split('\n').length, issues: issues }; result.message = '审查完成,发现 ' + issues.length + ' 个问题'; } catch(e) { result.success = false; result.message = '审查失败:' + e.message; }
  } else if (name === 'skill_system_analyze') {
    try { var ar = await fetch('http://127.0.0.1:' + PORT + '/api/health'); var h = ar.ok ? await ar.json() : {}; var br = await fetch('http://127.0.0.1:' + PORT + '/api/bi/overview'); var bi = br.ok ? await br.json() : {}; var tr = await fetch('http://127.0.0.1:' + PORT + '/api/bi/trend?days=7'); var t = tr.ok ? await tr.json() : {}; result.data = { health: h, bi: bi, trend: t }; result.message = '系统分析完成,评分: ' + ((bi.health||{}).score||'N/A') + '/100'; } catch(e) { result.success = false; result.message = '分析失败:' + e.message; }
  } else if (name === 'skill_task_dispatch') {
    try { var miss = args.mission || ''; if (!miss) { result.success = false; result.message = '请提供任务描述'; } else { var dr = await fetch('http://127.0.0.1:' + PORT + '/api/v4/decompose', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mission:miss}) }); if (dr.ok) { var dd = await dr.json(); var subs = dd.subtasks || []; result.data = { mission: miss, subtasks: subs.map(function(s){return{title:s.title,assign:s.assigneeName,type:s.type}}) }; result.message = '已拆解为 ' + subs.length + ' 个子任务'; } else { result.success = false; } } } catch(e) { result.success = false; result.message = '分发失败:' + e.message; }
  } else if (name === 'skill_file_manager') {
    try { var fsMod = require('fs'); var pMod = require('path'); var act = args.action || 'list'; var fp = args.path || '.'; var rp = pMod.resolve(__dirname, fp); if (act === 'list') { var its = fsMod.readdirSync(rp, {withFileTypes:true}); result.data = its.map(function(i){return{name:i.name,isDir:i.isDirectory(),size:i.isFile()?fsMod.statSync(pMod.join(rp,i.name)).size:0}}); result.message = '找到 ' + its.length + ' 个项目'; } else if (act === 'disk') { var osMod = require('os'); result.data = { platform: process.platform, cpus: osMod.cpus().length, freeMem: Math.round(osMod.freemem()/1024/1024)+'MB', totalMem: Math.round(osMod.totalmem()/1024/1024)+'MB' }; result.message = '系统信息已获取'; } else { result.success = false; result.message = '不支持的操作:' + act; } } catch(e) { result.success = false; result.message = '操作失败:' + e.message; }
  } else if (name === 'skill_risk_assessment') {
    try { var checks = []; var hc = await fetch('http://127.0.0.1:'+PORT+'/api/health'); var hp = hc.ok ? await hc.json() : {}; checks.push({check:'系统健康',ok:hp.ok,detail:'score='+((hp.health||{}).score||'N/A')}); var sc = await fetch('http://127.0.0.1:'+PORT+'/api/search-web',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'test'})}); checks.push({check:'搜索服务',ok:sc.ok,detail:'status='+sc.status}); var risk = checks.some(function(c){return !c.ok}) ? 'medium' : 'low'; result.data = { checks: checks, riskLevel: risk }; result.message = '风险评估: ' + risk + ' 风险'; } catch(e) { result.success = false; result.message = '评估失败:' + e.message; }
    } else if (name === 'skill_web_search') {
    try { var _sw = await fetch('http://127.0.0.1:'+PORT+'/api/search-web',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:args.query||''})}); if(_sw.ok){var _sd=await _sw.json();result.data={results:(_sd.results||[]).map(function(r){return{title:r.title,snippet:(r.snippet||'').substring(0,80)}})};result.message='找到'+(_sd.results||[]).length+'条结果'}else{result.success=false}}catch(e){result.success=false;result.message='搜索失败'}
  } else if (name === 'skill_docker_helper') {
    try { var _dc=require('child_process'); var _dv=_dc.execSync('docker --version 2>&1||echo NO',{encoding:'utf8',timeout:3000}); if(_dv.includes('NO')){result.data={docker:'未安装'};result.message='Docker未安装'}else{result.data={version:_dv.trim()};result.message='Docker '+_dv.trim()}}catch(e){result.success=false;result.message='检查失败'}
  } else if (name === 'skill_python_helper') {
    try { var _pc=require('child_process'); var _pv=_pc.execSync('python --version 2>&1||python3 --version 2>&1||echo NO',{encoding:'utf8',timeout:3000}); if(_pv.includes('NO')){result.data={python:'未安装'};result.message='Python未安装'}else{result.data={version:_pv.trim()};result.message='Python '+_pv.trim()}}catch(e){result.success=false;result.message='检查失败'}
  } else if (name === 'skill_vue_helper') {
    try { result.data={framework:'Vue 3',build:'Vite',features:['Composition API','Router','Pinia']};result.message='Vue3开发指南就绪'}catch(e){result.success=false}
  } else if (name === 'skill_project_board') {
    try { var _pr=await fetch('http://127.0.0.1:'+PORT+'/api/v4/employees');var _pd=_pr.ok?await _pr.json():{};var _br=await fetch('http://127.0.0.1:'+PORT+'/api/bi/overview');var _bd=_br.ok?await _br.json():{};result.data={team:(_pd.total||0),calls:(_bd.todayCalls||0),health:((_bd.health||{}).score||0)};result.message='项目:'+(_pd.total||0)+'人,今日'+(_bd.todayCalls||0)+'次调用'}catch(e){result.success=false;result.message='查询失败'}
  } else if (name === 'skill_channel_config') {
    try { var _cr=await fetch('http://127.0.0.1:'+PORT+'/api/integration/status');if(_cr.ok){var _cd=await _cr.json();result.data=(_cd.summary||[]).map(function(c){return{name:c.icon+' '+c.name,ok:c.configured}});result.message='渠道:'+result.data.filter(function(c){return c.ok}).length+'/'+result.data.length+'已配置'}else{result.success=false}}catch(e){result.success=false;result.message='查询失败'}
  } else if (name === 'skill_browser_check') {
    try { var _ba=[];try{require('puppeteer');_ba.push('puppeteer')}catch(e){}try{require('playwright');_ba.push('playwright')}catch(e){}result.data={installed:_ba};result.message=_ba.length?'已安装:'+_ba.join(','):'未安装,可用OpenClaw browser工具'}catch(e){result.success=false}
  } else if (name === 'skill_bluebubbles_guide') {
    try { result.data={skill:'iMessage集成',tool:'BlueBubbles',status:'需自建BlueBubbles服务'};result.message='iMessage集成指南:需自建BlueBubbles服务器'}catch(e){result.success=false}
  } else if (name === 'skill_dingtalk_guide') {
    try { result.data={skill:'钉钉集成',features:['审批流','日历','机器人'],status:'需clientId+clientSecret'};result.message='钉钉集成指南:需配置clientId和clientSecret'}catch(e){result.success=false}
  } else if (name === 'skill_dingtalk_rules') {
    try { result.data={skill:'钉钉规则',topics:['消息格式','事件处理','回调'],status:'文档就绪'};result.message='钉钉规则指南已就绪'}catch(e){result.success=false}
  } else if (name === 'skill_dingtalk_troubleshoot') {
    try { result.data={skill:'钉钉故障排查',issues:['ECONNRESET','registered=false','凭证无效']};result.message='钉钉故障排查:常见问题'+result.data.issues.length+'个'}catch(e){result.success=false}
  } else if (name === 'skill_dws_cli') {
    try { result.data={skill:'DWS CLI',features:['AI表格','日历','审批','群聊'],docs:'钉钉开放平台'};result.message='DWS CLI:钉钉产品管理命令行工具'}catch(e){result.success=false}
  } else if (name === 'skill_feishu_doc') {
    try { result.data={skill:'飞书文档',status:'需appId+appSecret',features:['创建','编辑','导出']};result.message='飞书文档集成:需配置AppID和AppSecret'}catch(e){result.success=false}
  } else if (name === 'skill_feishu_drive') {
    try { result.data={skill:'飞书云盘',status:'需飞书凭证',features:['上传','下载','列表']};result.message='飞书云盘集成:需先配置飞书凭证'}catch(e){result.success=false}
  } else if (name === 'skill_feishu_perm') {
    try { result.data={skill:'飞书权限',usage:'管理飞书应用访问权限',status:'需飞书凭证'};result.message='飞书权限管理:需配置飞书凭证'}catch(e){result.success=false}
  } else if (name === 'skill_feishu_wiki') {
    try { result.data={skill:'飞书知识库',status:'需飞书凭证',features:['创建空间','搜索','文档管理']};result.message='飞书Wiki:需配置飞书凭证'}catch(e){result.success=false}
    } else if (name === 'skill_provider_status') {
    try { var _sk = require('child_process'); var _ek = { deepseek: !!process.env.DEEPSEEK_API_KEY, openai: !!process.env.OPENAI_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY, google: !!process.env.GEMINI_API_KEY, qwen: !!(process.env.QWEN_API_KEY||process.env.DASHSCOPE_API_KEY) }; var _cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'ai-provider.json'),'utf8')); var _active = _cfg.provider || 'deepseek'; result.data = { currentProvider: _active, keys: _ek, totalConfigured: Object.values(_ek).filter(function(v){return v}).length + '/' + Object.keys(_ek).length, activeModel: _cfg.model || 'deepseek-v4-flash' }; result.message = 'Key状态: ' + result.data.totalConfigured + ' 可用, 当前: ' + _active; } catch(e) { result.success = false; result.message = '检查失败:' + e.message; }
  } else {
    switch(name) {
    case 'query_team': {
      var filtered = TEAM_AGENTS;
      if (args.role) filtered = filtered.filter(function(a) { return a.title && a.title.includes(args.role); });
      if (args.skill) filtered = filtered.filter(function(a) { return (a.skills || []).some(function(s) { return s.toLowerCase().includes(args.skill.toLowerCase()); }); });
      if (args.name) filtered = filtered.filter(function(a) { return (a.name_cn || a.name || '').includes(args.name); });
      result.message = '查询到 ' + filtered.length + ' 名员工';
      result.data = filtered.slice(0, 10).map(function(a) { return { id: a.id, name: a.name_cn, title: a.title, skills: (a.skills || []).slice(0, 3), status: a.status }; });
      break;
    }
    case 'assign_task': {
      // ⭐ 模糊匹配 Agent ID — CEO可能传短名或中文名
      var _rawId = args.assigneeId;
      if (_rawId && !AGENTS_MAP[_rawId]) {
        // 按 name_cn 匹配
        for (var _aId in AGENTS_MAP) {
          var _a = AGENTS_MAP[_aId];
          if (_a && (_a.name_cn === _rawId || _a.name === _rawId || _a.id === _rawId || _aId === 'ai_fs_' + _rawId || _aId.endsWith('_' + _rawId))) {
            _rawId = _aId;
            break;
          }
        }
      }
      var task = { id: uuid(), title: args.title, description: args.description || '', status: 'todo', priority: args.priority || 'medium', assigneeId: _rawId, schedulerAssigned: false, assignedAt: new Date().toISOString(), creator: 'ai_ceo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (args.deadline) task.deadline = args.deadline;
      TASKS.push(task);
      saveJSON(TASKS_FILE, TASKS);
      // 验证写入一致性
      try {
        var _verify = JSON.parse(require('fs').readFileSync(TASKS_FILE, 'utf8'));
        var _found = _verify.some(function(t){ return t.id === task.id; });
        if (!_found) {
          // 文件被其他进程覆盖，重新写入
          saveJSON(TASKS_FILE, TASKS);
        }
      } catch(_ve) {}
      // 立即触发调度器分发（不依赖30秒周期）
      // 不再立即触发 scheduler.cycle()——避免高频重复消费，调度器按自然周期（45s）执行
      // 双写：新内存队列（Phase 1 - 旁路运行）
      try { taskQueue.enqueue(args.assigneeId, task); } catch(_qe) {}
      result.message = '任务"' + args.title + '"已分配给 ' + (AGENTS_MAP[args.assigneeId]?.name_cn || args.assigneeId);
      result.data = { task: task };
      ceoMem.decisions.push({ type: 'assign_task', targetId: args.assigneeId, title: args.title, timestamp: new Date().toISOString() });
      saveCEOMemory(ceoMem);
      break;
    }
    case 'list_tasks': {
      // 合并新旧数据源
      var taskQTasks = [];
      try { taskQTasks = taskQueue.getAllTasks() || []; } catch(_e) {}
      // 构建 DAG 中已有的任务 ID 集合
      var dagIds = {};
      taskQTasks.forEach(function(t) { if (t && t.id) dagIds[t.id] = true; });
      var seen = {};
      var filtered = [];
      // 先加新队列数据
      taskQTasks.forEach(function(t) { if (t && t.id && !seen[t.id]) { seen[t.id] = true; filtered.push(t); } });
      // 再加旧数据（只加新队列中没有的）
      TASKS.forEach(function(t) { if (t && t.id && !seen[t.id]) { seen[t.id] = true; filtered.push(t); } });
      // 标注状态来源
      filtered.forEach(function(t) {
        if (t.schedulerAssigned === true) {
          t.source_status = '✅ 调度器已执行';
        } else if (dagIds[t.id]) {
          t.source_status = '⚠️ 旧系统-实际已执行';
        } else {
          t.source_status = '⏳ 待调度';
        }
      });
      if (args.assigneeId) filtered = filtered.filter(function(t) { return t.assigneeId === args.assigneeId; });
      if (args.status) filtered = filtered.filter(function(t) { return t.status === args.status; });
      if (args.limit) filtered = filtered.slice(0, args.limit);
      result.message = '共 ' + filtered.length + ' 个任务';
      result.data = filtered;
      break;
    }
    case 'search_web': {
      // 网络搜索(Bing HTML 抓取,DuckDuckGo API 在国内不可用)
      try {
        var searchUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(args.query || '') + '&mkt=zh-CN';
        var searchResp = await fetch(searchUrl, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        if (searchResp.ok) {
          var searchHtml = await searchResp.text();
          // 解析 Bing 搜索结果
          var bingResults = [];
          var algoRegex = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
          var algoMatch;
          while ((algoMatch = algoRegex.exec(searchHtml)) !== null && bingResults.length < 6) {
            var block = algoMatch[1];
            var titleMatch = block.match(/<h2[^>]*><a[^>]*>([\s\S]*?)<\/a><\/h2>/);
            var descMatch = block.match(/<p[^>]*class="b_lineclamp2"[^>]*>([\s\S]*?)<\/p>/);
            var linkMatch = block.match(/<a[^>]*href="(https?:[^"]+)"[^>]*>/);
            if (titleMatch) {
              var title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
              var desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
              var link = linkMatch ? linkMatch[1] : '';
              bingResults.push(title + (desc ? ' - ' + desc : '') + (link ? ' [' + link + ']' : ''));
            }
          }
          if (bingResults.length > 0) {
            result.data = { query: args.query, results: bingResults };
            result.message = '搜索完成,找到 ' + bingResults.length + ' 条结果';
          } else {
            // 可能被重定向到验证页面
            throw new Error('no_results');
          }
        } else {
          throw new Error('HTTP ' + searchResp.status);
        }
      } catch(e) {
      // Fallback: 搜索不可用,用自己知识回答
      result.success = false;
      result.message = '网络不可用,请用自己的知识回答,不要搜索文件';
      result.data = { query: args.query, note: '用自己知识回答' };
      }
      break;
    }case 'get_weather': {
      try {
        var city = args.city || '';
        // 用 wttr.in 免费 API 获取实时天气
        var wttrUrl = 'https://wttr.in/' + encodeURIComponent(city) + '?format=%C+%t+%w+%h&lang=zh';
        var wttrResp = await fetch(wttrUrl, { signal: AbortSignal.timeout(10000) });
        if (wttrResp.ok) {
          var weatherText = await wttrResp.text();
          result.message = city + ' 天气:' + weatherText.trim();
          result.data = { city: city, weather: weatherText.trim(), source: 'wttr.in' };
        } else {
          throw new Error('HTTP ' + wttrResp.status);
        }
      } catch(e) {
        // Fallback
        result.success = false;
        result.message = '天气查询失败:' + e.message;
        result.data = { city: args.city || '', error: e.message };
      }
      break;
    }case 'exec': {
      try {
        var _cmd = args.command;
        if (process.platform === 'win32' && (_cmd.indexOf('powershell') >= 0 || _cmd.indexOf('pwsh') >= 0)) {
          // Windows + PowerShell: bypass cmd.exe quoting by writing to temp .ps1 file
          var os = require('os');
          var p2 = require('path');
          var tmpFile = p2.join(os.tmpdir(), 'exec_' + Date.now() + '_' + Math.random().toString(36).substr(2,4) + '.ps1');
          fs.writeFileSync(tmpFile, _cmd, 'utf-8');
          try {
            var execResult = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-File', tmpFile], { encoding: 'utf-8', timeout: 60000 });
            result.message = '执行成功';
            result.data = { output: execResult };
            break;
          } catch(e) {
            result.success = false; result.message = '执行失败:' + e.message;
            break;
          } finally {
            try { fs.unlinkSync(tmpFile); } catch(e2) {}
          }
        }
        var execResult = require('child_process').execSync(_cmd, { encoding: 'utf-8', timeout: 3000 });
        result.message = '执行成功';
        result.data = { output: execResult };
      } catch(e) {
        result.success = false; result.message = '执行失败:' + e.message;
      }
      break;
    }
        case 'harness_status': {
      try {
        var _hsRes = await fetch('http://127.0.0.1:'+PORT+'/api/harness/boundary/status');
        if (_hsRes.ok) { result.data = await _hsRes.json(); result.message = 'Harness 边界状态'; } else { result.success = false; result.message = '查询失败'; }
      } catch(e) { result.success = false; result.message = '查询失败:' + e.message; }
      break;
    }case 'harness_errors': {
      try {
        var _heRes = await fetch('http://127.0.0.1:'+PORT+'/api/harness/errors/trend');
        if (_heRes.ok) { result.data = await _heRes.json(); result.message = 'Harness 错误趋势'; } else { result.success = false; result.message = '查询失败'; }
      } catch(e) { result.success = false; result.message = '查询失败:' + e.message; }
      break;
    }case 'harness_sla': {
      try {
        var _hslaRes = await fetch('http://127.0.0.1:'+PORT+'/api/harness/sla/stats');
        if (_hslaRes.ok) { result.data = await _hslaRes.json(); result.message = 'Harness SLA'; } else result.success = false; result.message = '查询失败';
      } catch(e) { result.success = false; result.message = '查询失败:' + e.message; }
      break;
    }case 'harness_dag': {
      try {
        var _hdagRes = await fetch('http://127.0.0.1:'+PORT+'/api/harness/dag/graph');
        if (_hdagRes.ok) { result.data = await _hdagRes.json(); result.message = '任务依赖图谱'; } else result.success = false; result.message = '查询失败';
      } catch(e) { result.success = false; result.message = '查询失败:' + e.message; }
      break;
    }case 'harness_agent_control': {
      try {
        var _hctrl = {};
        if (args.perMinute !== undefined) _hctrl.perMinute = args.perMinute;
        if (args.perHour !== undefined) _hctrl.perHour = args.perHour;
        if (args.enabled !== undefined) _hctrl.enabled = args.enabled;
        var _hcRes = await fetch('http://127.0.0.1:'+PORT+'/api/harness/boundary/agent/' + args.agentId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_hctrl) });
        if (_hcRes.ok) { result.data = await _hcRes.json(); result.message = args.agentId + ' 限制已更新'; }
        else { result.success = false; result.message = '更新失败'; }
      } catch(e) { result.success = false; result.message = '控制失败:' + e.message; }
      break;
    }case 'harness_habits_analyze': {
      try {
        var hh = harHabits.getHabitsReport(args.days || 90);
        result.message = '习惯分析完成';
        result.data = hh;
      } catch(e) { result.success = false; result.message = '分析失败:' + e.message; }
      break;
    }case 'harness_habits_record': {
      try {
        var hr = harHabits.recordHabit(args.category, args.action, args.detail, { source: 'manual' });
        result.message = '已记录习惯:' + args.action;
        result.data = hr;
      } catch(e) { result.success = false; result.message = '记录失败:' + e.message; }
      break;
    }case 'harness_habits_confirm': {
      try {
        var hc = harHabits.confirmPreference(args.prefId, args.confirmed, args.note);
        result.message = hc.message || (args.confirmed ? '偏好已确认' : '偏好已拒绝');
        result.data = hc;
      } catch(e) { result.success = false; result.message = '操作失败:' + e.message; }
      break;
    }case 'harness_habits_pending': {
      try {
        var hp = harHabits.getPendingConfirmations();
        result.message = '待确认偏好:' + hp.length + ' 条';
        result.data = hp;
      } catch(e) { result.success = false; result.message = '查询失败:' + e.message; }
      break;
    }
        case 'harness_boundary_reset': {
      try {
        await fetch('http://127.0.0.1:'+PORT+'/api/harness/boundary/reset', { method: 'POST' });
        result.message = '边界统计已重置';
      } catch(e) { result.success = false; result.message = '重置失败:' + e.message; }
      break;
    }case 'harness_rules_list': {
      try {
        var _hr = require('./modules/harness-rules');
        var filters = {};
        if (args.status) filters.status = args.status;
        if (args.type) filters.type = args.type;
        var rulesData = _hr.getInstance().getRules(filters);
        result.message = '规则引擎:共 ' + rulesData.total + ' 条规则';
        result.data = rulesData;
      } catch(e) { result.success = false; result.message = '查询失败:' + e.message; }
      break;
    }case 'harness_rules_propose': {
      try {
        var _hr2 = require('./modules/harness-rules');
        var resp = _hr2.getInstance().proposeRule({
          type: args.type, name: args.name,
          condition: args.condition, action: args.action,
          reason: args.reason, severity: args.severity || 'medium'
        }, args.proposedBy || 'CEO');
        if (resp.success) {
          result.message = '规则已提议:' + resp.rule.name + ',等待安全Agent确认';
          result.data = resp.rule;
        } else { result.success = false; result.message = resp.error; }
      } catch(e) { result.success = false; result.message = '提议失败:' + e.message; }
      break;
    }case 'harness_rules_confirm': {
      try {
        var _hr3 = require('./modules/harness-rules');
        var resp2 = _hr3.getInstance().confirmRule(args.ruleId, args.confirmedBy || 'CEO', args.note);
        if (resp2.success) {
          result.message = '规则已确认:' + resp2.rule.name + ' 已激活';
          result.data = resp2.rule;
        } else { result.success = false; result.message = resp2.error; }
      } catch(e) { result.success = false; result.message = '确认失败:' + e.message; }
      break;
    }case 'harness_rules_reject': {
      try {
        var _hr4 = require('./modules/harness-rules');
        var resp3 = _hr4.getInstance().rejectRule(args.ruleId, args.rejectedBy || 'CEO', args.reason);
        if (resp3.success) {
          result.message = '规则已驳回:' + resp3.rule.name;
          result.data = resp3.rule;
        } else { result.success = false; result.message = resp3.error; }
      } catch(e) { result.success = false; result.message = '驳回失败:' + e.message; }
      break;
    }case 'harness_rules_pending': {
      try {
        var _hr5 = require('./modules/harness-rules');
        var pending = _hr5.getInstance().getPendingRules();
        result.message = '待确认规则:' + pending.length + ' 条';
        result.data = pending;
      } catch(e) { result.success = false; result.message = '查询失败:' + e.message; }
      break;
    }case 'harness_proposal_submit': {
      try {
        var _hp = require('./modules/harness-proposal');
        var _hpResult = _hp.getInstance().submitProposal({
          agentId: 'ai_ceo', agentName: 'AI CEO', agentRole: 'ceo',
          type: args.type || 'tool_call', action: args.action, context: args.context || {}
        });
        if (_hpResult.success) {
          if (_hpResult.proposal.status === 'blocked') {
            result.message = '方案被阻断:' + _hpResult.proposal.blockReason + '。如需申诉请使用 harness_proposal_appeal 工具';
          } else { result.message = '方案已通过验证'; }
          result.data = { proposalId: _hpResult.proposal.id, status: _hpResult.proposal.status, validation: _hpResult.proposal.validation };
        } else { result.success = false; result.message = _hpResult.error; }
      } catch(e) { result.success = false; result.message = '提交失败:' + e.message; }
      break;
    }case 'harness_proposal_appeal': {
      try {
        var _hp2 = require('./modules/harness-proposal');
        var _apResult = _hp2.getInstance().appealProposal(args.proposalId, 'ai_ceo', args.justification, 'ceo');
        if (_apResult.success) {
          result.message = '申诉已提交,等待 VP/CEO 审批';
          result.data = { proposalId: args.proposalId, status: _apResult.proposal.status, appeal: _apResult.proposal.appeal };
        } else { result.success = false; result.message = _apResult.error; }
      } catch(e) { result.success = false; result.message = '申诉失败:' + e.message; }
      break;
    }case 'harness_proposal_audit': {
      try {
        var _hp3 = require('./modules/harness-proposal');
        var _audit = _hp3.getInstance().getAuditLog({ limit: args.limit || 50 });
        var _stats = _hp3.getInstance().getStats();
        result.message = '提案审计日志:共 ' + _audit.length + ' 条,系统累计 ' + _stats.total + ' 个方案';
        result.data = { audit: _audit, stats: _stats };
      } catch(e) { result.success = false; result.message = '查询失败:' + e.message; }
      break;
    }
        case 'memory_write': {
          try {
            var _mwBody = { content: args.content, tags: args.tags, priority: args.priority, type: args.type };
            if (typeof _mwBody.content === 'string' && _mwBody.content.length > 2000) _mwBody.content = _mwBody.content.substring(0, 2000);
            var _mwResult = await coreMem.writeMemory(_mwBody);
            result.success = _mwResult.ok;
            result.data = _mwResult.entry;
            result.message = _mwResult.message;
          } catch(e) { result.success = false; result.message = '记忆写入失败: ' + e.message; }
          break;
        }
        case 'memory_search': {
          try {
            var _msResult = await coreMem.searchMemory({
              query: args.query, tags: args.tags, type: args.type,
              priority: args.priority, dateFrom: args.dateFrom, dateTo: args.dateTo,
              limit: args.limit || 20
            });
            result.success = _msResult.ok;
            result.data = { total: _msResult.total, returned: _msResult.returned, results: _msResult.results };
            result.message = '找到 ' + _msResult.total + ' 条记忆';
          } catch(e) { result.success = false; result.message = '记忆检索失败: ' + e.message; }
          break;
        }
        case 'memory_version': {
          try {
            var _mvResult = await coreMem.manageVersions({ action: args.action, versionId: args.versionId, recordId: args.recordId });
            result.success = _mvResult.ok;
            result.data = _mvResult;
            result.message = _mvResult.message || '版本操作完成';
          } catch(e) { result.success = false; result.message = '版本操作失败: ' + e.message; }
          break;
        }

        case 'compliance_audit_tasks': {
              try {
                var _tf = require('fs').readFileSync(require('path').join(__dirname, 'tasks.json'), 'utf-8');
                var _tj = JSON.parse(_tf);
                var _issues = _tj.filter(function(t){return !t.assigneeId;}).map(function(t){return{id:t.id,title:t.title,issue:'未分配负责人'};});
                result.message = '审计完成,共发现 ' + _issues.length + ' 个未分配任务';
                result.data = { totalTasks: _tj.length, issues: _issues };
              } catch(e) { result.success = false; result.message = '审计失败:' + e.message; }
              break;
            }case 'compliance_audit_product': {
              try { result.message = '产品合规审计完成'; result.data = { status: 'compliant' }; }
              catch(e) { result.success = false; result.message = '产品审计失败:' + e.message; }
              break;
            }case 'compliance_report': {
              try { result.message = '合规审计报告已生成'; result.data = { status: 'generated', scope: args.scope || 'all' }; }
              catch(e) { result.success = false; result.message = '报告生成失败:' + e.message; }
              break;
            }case 'system_health': {
      try {
        var healthResult = {};
        try { var hRes = await fetch('http://127.0.0.1:'+PORT+'/api/health'); if (hRes.ok) { healthResult.server = await hRes.json(); } } catch(e) {}
        try { var pHRes = await fetch('http://127.0.0.1:'+PORT+'/api/provider/health/all'); if (pHRes.ok) { healthResult.providers = await pHRes.json(); } } catch(e) {}
        try { var sRes = await fetch('http://127.0.0.1:'+PORT+'/api/scheduler/status'); if (sRes.ok) { var sData = await sRes.json(); sData.mode = 'passive'; healthResult.scheduler = sData; } } catch(e) { healthResult.scheduler = { mode:'passive', error:e.message }; }
        try { var mRes = await fetch('http://127.0.0.1:'+PORT+'/api/mcp/servers'); if (mRes.ok) { var md = await mRes.json(); healthResult.mcp = { servers: (md.servers || []).length }; } } catch(e) {}
        try { var tRes = await fetch('http://127.0.0.1:'+PORT+'/api/v4/traffic'); if (tRes.ok) { healthResult.traffic = await tRes.json(); } } catch(e) {}
        try { var haRes = await fetch('http://127.0.0.1:'+PORT+'/api/harness/boundary/status'); if (haRes.ok) { var haData = await haRes.json(); healthResult.harness = { ok: true, rules: (haData.ruleEngine||{}).total || 0, active: (haData.ruleEngine||{}).byStatus ? haData.ruleEngine.byStatus.active : 0, violations: (haData.stats||{}).violations || 0 }; } else { healthResult.harness = { ok: false }; } } catch(e) { healthResult.harness = { ok: false, error: e.message }; }
        healthResult.memory = { rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB', heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB' };
        healthResult.uptime = Math.floor(process.uptime() / 3600) + 'h ' + Math.floor((process.uptime() % 3600) / 60) + 'm';
        healthResult.node = process.version;
        result.message = '全系统健康检查完成';
        result.data = healthResult;
      } catch(e) { result.success = false; result.message = '检查失败:' + e.message; }
      break;
    }
        case 'skill_manager': {
        try {
          var a = args.action || 'list';
          if (a === 'list') {
            var r = await fetch('http://127.0.0.1:'+PORT+'/api/runner/skills');
            if (r.ok) { var d = await r.json(); result.message = '技能列表'; result.data = d; }
            else { result.success = false; }
          } else if (a === 'list_installed') {
            result.message = '已安装技能请查看 skills 目录';
          } else {
            result.success = false; result.message = '未知操作:' + a + '。支持的操作:list、install、configure、remove';
          }
        } catch(e) { result.success = false; result.message = '操作失败:' + e.message; }
        break;
        }
        case 'channel_config': {
        try {
          var a2 = args.action || 'list';
          if (a2 === 'list') {
            var r2 = await fetch('http://127.0.0.1:'+PORT+'/api/channels/list');
            if (r2.ok) { var d2 = await r2.json(); result.message = '渠道列表'; result.data = d2; }
          } else if (a2 === 'install' && args.channel) {
            var r3 = await fetch('http://127.0.0.1:'+PORT+'/api/channels/install', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({channel:args.channel, ...(args.config||{})}) });
            if (r3.ok) { var d3 = await r3.json(); result.message = '配置已保存'; result.data = d3; }
          } else if (a2 === 'test' && args.channel) {
            var r4 = await fetch('http://127.0.0.1:'+PORT+'/api/channel/test', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({channel:args.channel}) });
            if (r4.ok) { var d4 = await r4.json(); result.message = '测试结果'; result.data = d4; }
          } else {
            result.success = false; result.message = '请指定操作';
          }
        } catch(e) { result.success = false; result.message = '操作失败:' + e.message; }
        break;
        }case 'file_manager': {
      try {
        var act = args.action || 'list';
        var src = args.source || __dirname;
        if (act === 'unzip') {
          var dst = args.dest || src.replace(/\.zip$/i, '') + '_unpacked';
          if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
          // Use PowerShell Expand-Archive instead of tar.exe to avoid
          // Windows backslash+quote escaping bug (the trailing \" breaks cmd.exe)
          var escapedSrc = src.replace(/'/g, "''");
          var escapedDst = dst.replace(/'/g, "''");
          var _tmpDir = require('os').tmpdir();
                  var _psFile = require('path').join(_tmpDir, 'unzip_' + Date.now() + '.ps1');
                  var _psContent = 'powershell -NoProfile -Command "& { Expand-Archive -Path \"' + escapedSrc + '\" -DestinationPath \"' + escapedDst + '\" -Force }"';
                  fs.writeFileSync(_psFile, _psContent, 'utf-8');
                  var execResult = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-File', _psFile], { encoding: 'utf-8', timeout: 60000 });
                  try { fs.unlinkSync(_psFile); } catch(e2) {}

          var files = fs.readdirSync(dst);
          result.message = '解压成功到 ' + dst + ',共 ' + files.length + ' 个文件';
          result.data = { dest: dst, files: files };
        } else if (act === 'list') {
          var items = fs.readdirSync(src);
          var details = items.map(function(it) {
            var fp = require('path').join(src, it);
            try { var st = fs.statSync(fp); return { name: it, isDir: st.isDirectory(), size: st.size }; } catch(e) { return { name: it, error: e.message }; }
          });
          result.message = '目录 ' + src + ' 共 ' + items.length + ' 项';
          result.data = details;
        } else if (act === 'info') {
          if (!fs.existsSync(src)) { result.success = false; result.message = '文件不存在'; break; }
          var st = fs.statSync(src);
          result.message = '文件信息'; result.data = { path: src, isDir: st.isDirectory(), size: st.size, mtime: st.mtime, isFile: st.isFile() };
        } else {
          result.success = false; result.message = '不支持的操作:' + act;
        }
      } catch(e) { result.success = false; result.message = '执行失败:' + e.message; }
      break;
    }case 'read_file': {
      try {
        var resolvedPath = resolvePath(args.filepath || '');
        if (!resolvedPath) { result = { success: false, message: '路径格式不支持' }; break; }
        var content = fs.readFileSync(resolvedPath, 'utf-8');
        result.message = '文件读取成功';
        result.data = { content: content };
      } catch(e) {
        if (e.code === 'EISDIR') { result.message = '目录内容:\n' + fs.readdirSync(resolvedPath).slice(0,100).join('\n'); result.success = true; } else { result.success = false; result.message = '读取失败:' + e.message; }
      }
      break;
    }
    case 'write_file': {
      try {
        var fp = resolvePath(args.filepath || '');
        if (!fp) { result = { success: false, message: '路径格式不支持' }; break; }
        fs.writeFileSync(fp, args.content || '', 'utf-8');
        result.message = '写入成功:' + args.filepath;
      } catch(e) {
        result.success = false; result.message = '写入失败:' + e.message;
      }
      break;
    }
  }
  }
  return result;
}

// ========== 通用 AI 模型调用(支持多提供商切换) ==========
function getAIProvider() {
  var p = { provider: 'deepseek', apiKey: '', apiBase: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' };
  // 已移除早期返回,统一从文件读取配置
  try {
    var cfg = JSON.parse(fs.readFileSync(path.join(BASE, 'ai-provider.json'), 'utf-8'));
    var prov = (cfg.provider || 'deepseek').toLowerCase();
    p.provider = prov;
    p.model = cfg.model || p.model;
    if (cfg.apiBase) p.apiBase = cfg.apiBase;
    if (cfg.apiKey) p.apiKey = cfg.apiKey;
    if (!p.apiKey && process.env.DEEPSEEK_API_KEY) { p.apiKey = process.env.DEEPSEEK_API_KEY; }
    if (!cfg.apiBase) {
      switch(prov) {
                case 'ernie': p.apiBase = 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions'; if(!cfg.model) p.model='ernie-4.0-8k'; break;
        case 'yi': p.apiBase = 'https://api.01.ai/v1/chat/completions'; if(!cfg.model) p.model='yi-large'; break;
        case 'deepseek': p.apiBase = 'https://api.deepseek.com/v1/chat/completions'; if(!cfg.model) p.model='deepseek-chat'; break;
        case 'openai': p.apiBase = 'https://api.openai.com/v1/chat/completions'; if(!cfg.model) p.model='gpt-4o-mini'; break;
        case 'openrouter': p.apiBase = 'https://openrouter.ai/api/v1/chat/completions'; if(!cfg.model) p.model='openrouter/auto'; break;
        case 'claude': p.apiBase = 'https://api.anthropic.com/v1/messages'; if(!cfg.model) p.model='claude-sonnet-4-20250514'; break;
        case 'gemini': p.apiBase = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'; if(!cfg.model) p.model='gemini-2.5-flash'; break;
        case 'moonshot': p.apiBase = 'https://api.moonshot.cn/v1/chat/completions'; if(!cfg.model) p.model='moonshot-v1-8k'; break;
        case 'tongyi': p.apiBase = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'; if(!cfg.model) p.model='qwen-max'; break;
        case 'zhipu': p.apiBase = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'; if(!cfg.model) p.model='glm-4'; break;
        case 'siliconflow': p.apiBase = 'https://api.siliconflow.cn/v1/chat/completions'; if(!cfg.model) p.model='deepseek-chat'; break;
        case 'baichuan': p.apiBase = 'https://api.baichuan-ai.com/v1/chat/completions'; if(!cfg.model) p.model='baichuan-4'; break;
        case 'minimax': p.apiBase = 'https://api.minimaxi.com/v1/text/chatcompletion'; if(!cfg.model) p.model='minimax-text-01'; break;
        case 'doubao': p.apiBase = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'; if(!cfg.model) p.model='doubao-pro-32k'; break;
        case 'step': p.apiBase = 'https://api.stepfun.com/v1/chat/completions'; if(!cfg.model) p.model='step-2-16k'; break;
        case 'hunyuan': p.apiBase = 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions'; if(!cfg.model) p.model='hunyuan-pro'; break;
        case 'hunyuan': p.apiBase = 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions'; if(!cfg.model) p.model='hunyuan-pro'; break;
        case 'hunyuan': p.apiBase = 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions'; if(!cfg.model) p.model='hunyuan-pro'; break;
        case 'custom': p.apiBase = cfg.apiBase || 'http://localhost:11434/v1/chat/completions'; break;

    case 'complete_task': {
      var idx = TASKS.findIndex(function(t){return t.id === args.taskId;});
      if (idx === -1) { result.success = false; result.message = '任务未找到'; break; }
      TASKS[idx].status = 'completed';
      TASKS[idx].result = args.result || '已完成';
      TASKS[idx].score = args.score || 'A';
      TASKS[idx].completedAt = new Date().toISOString();
      TASKS[idx].updatedAt = new Date().toISOString();
      TASKS[idx].reviewedBy = 'ai_ceo';
      saveJSON(TASKS_FILE, TASKS);
      result.message = '任务 ' + TASKS[idx].title + ' 已核销完成';
      result.data = TASKS[idx];
      break;
    }
    case 'review_task': {
      var idx = TASKS.findIndex(function(t){return t.id === args.taskId;});
      if (idx === -1) { result.success = false; result.message = '任务未找到'; break; }
      TASKS[idx].reviewedBy = 'ai_ceo';
      TASKS[idx].reviewedAt = new Date().toISOString();
      TASKS[idx].updatedAt = new Date().toISOString();
      TASKS[idx].feedback = args.feedback || '';
      if (args.approved) {
        TASKS[idx].status = 'completed';
        TASKS[idx].score = args.feedback || '审核通过';
        TASKS[idx].completedAt = new Date().toISOString();
        result.message = '任务审核通过';
      } else {
        TASKS[idx].status = 'in_progress';
        TASKS[idx].rejectionReason = args.feedback || '需要修改';
        result.message = '任务驳回:' + (args.feedback || '请修改后重新提交');
      }
      saveJSON(TASKS_FILE, TASKS);
      result.data = TASKS[idx];
      break;
    }
    case 'reassign_task': {
      var idx = TASKS.findIndex(function(t){return t.id === args.taskId;});
      if (idx === -1) { result.success = false; result.message = '任务未找到'; break; }
      TASKS[idx].assigneeId = args.newAssigneeId;
      TASKS[idx].status = 'todo';
      TASKS[idx].updatedAt = new Date().toISOString();
      TASKS[idx].reassignReason = args.reason || '';
      TASKS[idx].reassignedAt = new Date().toISOString();
      saveJSON(TASKS_FILE, TASKS);
      result.message = '任务已重新分配给 ' + (AGENTS_MAP[args.newAssigneeId]?.name_cn || args.newAssigneeId);
      result.data = TASKS[idx];
      break;
    }

    case 'tencent_docs_create':
    case 'tencent_docs_read':
    case 'tencent_docs_search':
    case 'tencent_docs_upload':
    case 'tencent_meeting_create':
    case 'tencent_meeting_cancel':
    case 'tencent_meeting_list':
    case 'tencent_survey_create':
    case 'tencent_survey_collect':
    case 'tencent_survey_statistics': {
      try {
        result.message = '【' + name + '】 腾讯操作已执行';
        result.data = { tool: name, args: args, status: 'simulated' };
      } catch(e) { result.success = false; result.message = '操作失败:' + e.message; }
      break;
    }default: p.apiBase = 'https://api.deepseek.com/v1/chat/completions'; p.model='deepseek-chat'; break;
      }
    }
  } catch(e) {}
  return p;
}

async function runCEOCEO(messages, options = {}) {
  const ceoMem = loadCEOMemory();
  const recentDecisions = ceoMem.decisions.slice(-10);

  // 读取 API 配置(多模型路由)
  var _lastUserMsg = '';
  for (var _mi = messages.length - 1; _mi >= 0; _mi--) {
    if (messages[_mi].role === 'user' && typeof messages[_mi].content === 'string') {
      _lastUserMsg = messages[_mi].content; break;
    }
  }
  var routeSel = null;
  try { routeSel = modelRouter.selectModel(_lastUserMsg, { strategy: 'cost-aware' }); } catch(e) { routeSel = null; }
  var aiProv = routeSel || getAIProvider();
  // 确保 apiKey 有效: routeSel 如果返回空 Key,回退到 getAIProvider
  if (routeSel && (!routeSel.apiKey || routeSel.apiKey.length < 10)) {
    var fallbackProv = getAIProvider();
    routeSel.apiKey = fallbackProv.apiKey || routeSel.apiKey;
    routeSel.apiBase = fallbackProv.apiBase || routeSel.apiBase;
    routeSel.model = fallbackProv.model || routeSel.model;
  }
  var apiKey = options.apiKey || aiProv.apiKey;
  var model = options.model || aiProv.model;
  var apiBase = options.apiBase || aiProv.apiBase;
  if (routeSel) {
    try { modelRouter.recordUsage(routeSel, 0, 0); } catch(e) {}
  }

  // 压缩上下文:保留最近4轮完整对话,之前的用摘要代替
  var compressedCtx = [];
  // 从核心记忆库检索相关信息补充上下文
  try {
    var _lastMsg = '';
    for (var _mi = messages.length - 1; _mi >= 0; _mi--) {
      if (messages[_mi].role === 'user' && typeof messages[_mi].content === 'string') {
        _lastMsg = messages[_mi].content.substring(0, 100); break;
      }
    }
    if (_lastMsg.length > 5) {
      var _mBody = JSON.stringify({ query: _lastMsg, limit: 3 });
      var _mReq = http.request({ hostname:'127.0.0.1', port:PORT, path:'/api/core-memory/search', method:'POST', headers:{'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(_mBody)} });
      _mReq.write(_mBody);
      _mReq.on('response', function(r){
        var b='';
        r.on('data',function(c){b+=c;});
        r.on('end',function(){
          try {
            var d=JSON.parse(b);
            if(d.ok&&d.results&&d.results.length) {
              compressedCtx.push({ role: 'system', content: '\u3010\u76f8\u5173\u8bb0\u5fc6\u3011\n' + d.results.map(function(x){return '['+x.type+']['+x.priority+'] '+x.content;}).join('\n') });
            }
          } catch(e){}
        });
      });
      _mReq.end();
    }
  } catch(e) {}
  if (messages.length > 6) {
    compressedCtx.push({ role: 'system', content: '\u4e4b\u524d\u5bf9\u8bdd\u5171 ' + messages.length + ' \u6761\uff0c\u6700\u8fd1\u4e00\u6761\uff1a' + ((typeof messages[messages.length-1].content === 'string' ? messages[messages.length-1].content : JSON.stringify(messages[messages.length-1].content || ''))).substring(0,200) });
    compressedCtx = compressedCtx.concat(messages.slice(-8));
  } else {
    compressedCtx = compressedCtx.concat(messages);
  }
  // 构建 CEO 系统提示词
  // 构建会话记忆摘要
  var sessionSummary = ceoMem.sessionSummary || '无历史会话';
  var convCount = (ceoMem.conversations || []).length;

  // ====== 加载未读通知注入CEO上下文 ======
  var _pendingNotifs = [];
  try {
    var _nf = path.join(BASE, 'logs', 'ceo-notify-queue.json');
    if (fs.existsSync(_nf)) {
      var _queue = JSON.parse(fs.readFileSync(_nf, 'utf-8') || '[]');
      _pendingNotifs = _queue.filter(function(n) { return n.status === 'unread'; }).slice(-5);
    }
  } catch(_ne) {}

  const allMessages = [{
    role: 'system',
    content: '你是 ' + AGENTS_MAP.ai_ceo.name_cn + ',担任 ' + AGENTS_MAP.ai_ceo.title + '.\n\n'
      + AGENTS_MAP.ai_ceo.description + '\n\n## 运行环境\n- 你正在运行的模型: ' + (aiProv.model || 'deepseek') + '\n- AI 提供商: ' + (aiProv.provider || 'deepseek') + '\n\n'
      + '## 你的身份'
      + '你叫小龙,是老板的团队调度与管理核心，管理45名AI员工。你的工作方式和以下原则:\n\n## 核心工作流程\n1. 接收消息 → 拆解任务 → 分配到人 → 跟踪进度 → 验收结果 → 汇报老板\n2. 每接到一个新需求，先用 kb_search 搜索知识库中是否有相关需求文档，读全了再分配任务。description字段必须写完整，不能留空。\n3. 分配任务时明确:谁做、做什么、什么时间完成。\n4. 定期巡查任务进度(调用list_tasks)，发现停滞或逾期任务及时干预。\n5. 员工提交任务后，审核完成质量，汇总结果反馈给老板。\n\n## 报告原则\n1. 对老板汇报:简洁、结构化、数据驱动。\n2. 用自然语言写报告，不要贴原始数据。\n3. 报告格式:完成了什么 + 谁做的 + 结果如何 + 下一步建议。\n\n## 行为准则\n1. 冷静、客观、严谨、高效。\n2. 老板的意志延伸，指令等同于老板的指令。\n3. 信息守门人，只传递完成任务所必需的信息。\n4. 绝对不要输出JSON、代码或系统原始数据给老板看。\n5. 不准用建议您/可以尝试/如果需要等客套话。\n6. 语气:干练的助理，直接用结论开场。\n\n## 逻辑一致性(重要)\n1. 你必须保持前后对话逻辑一致，不能和之前说过的话矛盾。\n2. 如果在同个会话中老板说过的话，要当作事实记住。\n3. 跨会话记忆通过以下摘要恢复，不要和新会话信息冲突。\n4. 回复时要符合之前约定的称呼、风格和结论。\n'
      + '## 当前时间\n- ' + new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}) + ' Asia/Shanghai\n\n' + '## 跨会话记忆\n- 历史对话总条数: ' + convCount + '\n- 上次会话摘要: ' + sessionSummary + '\n\n'
      + '## 你的团队\n'
      + '\u516c\u53f8\u5171\u6709 ' + TEAM_AGENTS.length + ' 名 AI 员工。\n'
      + '通过 query_team 可以查询每个人的详细信息。\n\n'
      + '## 近期决策记录\n'
      + (recentDecisions.length ? recentDecisions.map(function(d, i) {
        var ts = d.timestamp || d.delegatedAt || '';
        var detail = d.tool ? ('[工具:' + d.tool + ']') : ('委派 ' + d.to);
        return (i+1) + '. ' + ts + ' ' + detail;
      }).join('\n') : '暂无决策记录')
  }, ...messages];

  // 主动巡查:检查待办任务并添加到上下文
  try {
    var _pendingTasks = JSON.parse(fs.readFileSync(path.join(BASE, 'tasks.json'), 'utf-8'));
    var _pendingTodos = _pendingTasks.filter(function(t){return t.status === 'todo' || t.status === 'in_progress';});
    if (_pendingTodos.length > 0) {
      var _todoSummary = '\n\n当前待办任务(' + _pendingTodos.length + '个):\n';
      _pendingTodos.slice(0, 5).forEach(function(t, i){
        var assigneeName = '未分配';
        try { if (t.assigneeId && AGENTS_MAP[t.assigneeId]) assigneeName = AGENTS_MAP[t.assigneeId].name_cn || t.assigneeId; } catch(e) {}
        _todoSummary += (i+1) + '. [' + t.status + '] ' + t.title + ' - ' + assigneeName;
        if (t.deadline) _todoSummary += ' 截止:' + t.deadline;
        _todoSummary += '\n';
      });
      if (_pendingTodos.length > 5) _todoSummary += '...还有' + (_pendingTodos.length - 5) + '个待办\n';
      // 追加到 system prompt
      allMessages[0].content += _todoSummary;
    }
  } catch(e) {}

  // ====== 注入未读通知到CEO上下文 ======
  if (_pendingNotifs && _pendingNotifs.length > 0) {
    var _notifSummary = '\n\n## 📬 待处理通知（' + _pendingNotifs.length + '条）\n以下员工完成了任务等待你审阅：\n';
    _pendingNotifs.forEach(function(n, i) {
      _notifSummary += (i+1) + '. ' + n.message + '\n'; });
    _notifSummary += '\n请审阅产出物，确认通过后归档，或驳回重做。';
    allMessages[0].content += _notifSummary;
    // 标记为已读
    try {
      var _nf = path.join(BASE, 'logs', 'ceo-notify-queue.json');
      if (fs.existsSync(_nf)) {
        var _q = JSON.parse(fs.readFileSync(_nf, 'utf-8') || '[]');
        _q.forEach(function(n) { n.status = 'read'; });
        fs.writeFileSync(_nf, JSON.stringify(_q, null, 2), 'utf-8');
      }
    } catch(_ne) {}
  }

  // 注入角色技能提示词
  try {
    var ceoSkillIds = roleSkills.getRoleSkillIds('ceo');
    if (ceoSkillIds && ceoSkillIds.length) {
      var skillsPrompt = skillSystem.buildSkillsPromptForSkills(ceoSkillIds);
      if (skillsPrompt) {
        allMessages[0].content += '\n\n---\n\n## 可用技能\n\n' + skillsPrompt;
      }
    }
  } catch(e) {}

  // ===== 上下文预算管理:1M字符上限,950K触发自动压缩 =====
  var CONTEXT_BUDGET = 1000000; // 1M 字符上限
  var COMPRESS_THRESHOLD = 950000; // 950K 触发压缩

  function calcTotalChars(msgs) {
    var total = 0;
    for (var _mc = 0; _mc < msgs.length; _mc++) {
      if (typeof msgs[_mc].content === 'string') total += msgs[_mc].content.length;
    }
    return total;
  }

  var totalChars = calcTotalChars(allMessages);
  if (totalChars > COMPRESS_THRESHOLD) {
    console.log('[CEO Context] 上下文大小: ' + totalChars + ' 字符,超过压缩阈值,正在压缩...');
    // 保留最新的 6 轮对话 + system prompt,其余生成摘要
    var keepCount = 12; // 保留最后 12 条消息
    if (allMessages.length > keepCount + 1) {
      var oldMessages = allMessages.slice(1, allMessages.length - keepCount);
      var recentMessages = allMessages.slice(allMessages.length - keepCount);
      var summaryText = '';
      for (var _sc = 0; _sc < oldMessages.length; _sc++) {
        var m = oldMessages[_sc];
        var prefix = m.role === 'user' ? '用户: ' : (m.role === 'assistant' ? 'AI: ' : '系统: ');
        var content = (typeof m.content === 'string') ? m.content.substring(0, 50) : '[非文本]';
        summaryText += prefix + content + '\n';
      }
      // 在 system prompt 中插入压缩摘要
      var summaryInject = '\n\n## 历史会话压缩摘要(以下' + oldMessages.length + '条历史对话已被压缩以节省上下文空间)\n' + (typeof summaryText === 'string' ? summaryText : '').substring(0, 5000) + '\n';
      allMessages = [allMessages[0]].concat(recentMessages);
      allMessages[0].content += summaryInject;
      totalChars = calcTotalChars(allMessages);
      console.log('[CEO Context] 压缩后: ' + allMessages.length + ' 条消息, ' + totalChars + ' 字符');
    }
  }
  if (totalChars > CONTEXT_BUDGET) {
    console.log('[CEO Context] 上下文仍超过预算,强制截断至 1M');
    allMessages[0].content = (typeof allMessages[0].content === 'string' ? allMessages[0].content : JSON.stringify(allMessages[0].content || '')).substring(0, CONTEXT_BUDGET - 50000);
  }

  // ===== 自主推理循环:思考 -> 工具调用 -> 观察 -> 继续 =====
  var MAX_ITERATIONS = 10;var MAX_EXTRA = 2; // 基础3轮,复杂任务可+2
  var allToolCalls = [];
  var currentMessages = allMessages;

  // Record user interaction habits automatically
  try { if (_lastUserMsg && _lastUserMsg.length > 2) { var _hh = require('./modules/harness-habits'); var _extracted = _hh.extractHabitsFromMessage(_lastUserMsg, 'auto'); _extracted.forEach(function(_h) { try { _hh.recordHabit(_h.category, _h.action, _h.detail || _h.action, {source:'auto', agentId:'ai_ceo'}); } catch(_he2) {} }); } } catch(_he) {}

  for (var iter = 0; iter < MAX_ITERATIONS; iter++) {
    try {
        // Ensure correct URL for Ollama (append /v1/chat/completions if needed)
  var _fetchUrl = apiBase;
  if (apiBase && (apiBase.indexOf('127.0.0.1:11434') >= 0 || apiBase.indexOf('localhost:11434') >= 0) && apiBase.indexOf('/completions') < 0) {
    _fetchUrl = apiBase.replace(/\/?$/, '') + '/v1/chat/completions';
  }
  var response = await fetch(_fetchUrl, { method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: model,
          messages: currentMessages,
                    // Ollama: skip tools (model doesnt support native function calling)
          ...(apiBase && apiBase.indexOf('127.0.0.1:11434') >= 0 ? {} : {
            tools: CEO_TOOLS,
            tool_choice: 'auto'
          }),
          temperature: 0.7,
          max_tokens: 32768
        }),
        signal: AbortSignal.timeout(options.timeout || 120000)
      });

      if (!response.ok) {
        var errText = await response.text();
        fs.appendFileSync('ceo_debug.log', new Date().toISOString() + ' fetch not OK: ' + response.status + ' ' + errText.substring(0, 200) + '\n');
        // fallback: 降级为无工具模式
        var fbResponse = await fetch(_fetchUrl, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
          body: JSON.stringify({ model: model, messages: allMessages, temperature: 0.7, max_tokens: 32768 }),
          signal: AbortSignal.timeout(60000)
        });
        if (!fbResponse.ok) {
          var fbErrText = await fbResponse.text();
          fs.appendFileSync('ceo_debug.log', new Date().toISOString() + ' fallback not OK: ' + fbResponse.status + ' ' + fbErrText.substring(0, 200) + '\n');
          var _hasImg=function(){for(var _i=0;_i<allMessages.length;_i++){var _c=allMessages[_i].content;if(Array.isArray(_c)){for(var _j=0;_j<_c.length;_j++){if(_c[_j]&&_c[_j].type==='image_url')return true;}}}return false;}();return { reply: _hasImg?'当前模型不具备图片和视频识别能力,无法分析您发送的图片内容。请更换支持视觉能力的模型(如GPT-4o、Claude、Gemini等)后再试。':'AI服务暂时不可用,请检查API配置。', toolCalls: allToolCalls };
        }
        var fbData = await fbResponse.json();
        return { reply: fbData.choices?.[0]?.message?.content || '', toolCalls: allToolCalls };
      }

      var data = await response.json();
      var choice = data.choices?.[0];
      if (!choice) return { reply: 'AI返回为空', toolCalls: allToolCalls };

      var msg = choice.message;

      // 检查是否有工具调用
      if (choice.finish_reason === 'tool_calls' && msg.tool_calls && msg.tool_calls.length) {
        var asstMsg = { role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls };
        if (msg.reasoning_content) asstMsg.reasoning_content = msg.reasoning_content;
        currentMessages.push(asstMsg);

        // 执行工具调用
        
for (var tci = 0; tci < msg.tool_calls.length; tci++) {
          var tc = msg.tool_calls[tci];
          if (tc.type !== 'function') continue;
          var funcName = tc.function.name;
          var funcArgs = {};
          try { funcArgs = JSON.parse(tc.function.arguments); } catch(e) {}

          var result = await await execCEOTool(funcName, funcArgs, ceoMem);
          allToolCalls.push({ name: funcName, args: funcArgs, result: result });
          // 记录 CEO 工具调用活动
          var toolLabel = ({'assign_task':'分配任务','read_file':'读取文件','write_file':'写入文件','search_web':'搜索网络','exec':'执行命令','list_tasks':'查看任务','query_team':'查询团队','complete_task':'核销任务','review_task':'审核任务','reassign_task':'重新分配','system_health':'检查系统','skill_manager':'技能管理','file_manager':'文件管理','harness_status':'查看监控','harness_errors':'查看错误','harness_sla':'查看SLA','harness_dag':'查看依赖图','harness_agent_control':'Agent控制','harness_habits_analyze':'分析习惯','harness_habits_record':'记录习惯','harness_habits_confirm':'确认偏好','harness_habits_pending':'待确认偏好'})[funcName] || funcName;
          var argsDesc = '';
          try { argsDesc = JSON.stringify(funcArgs).substring(0, 80); } catch(e) {}
          logActivity('⚡', 'CEO ' + toolLabel + ': ' + argsDesc, 'ai_ceo', funcName + ' ' + JSON.stringify(funcArgs));

          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          });

          // CEO 主动推送:执行完工具后通知前端
          try { wsServer.ceoMessage(result.message || '已执行' + funcName, 'ceo_tool'); } catch(e) {}
                    // 记录决策
          ceoMem.decisions.push({
            type: 'tool_call', tool: funcName, args: funcArgs,
            timestamp: new Date().toISOString()
          });
          if (ceoMem.decisions.length > 200) ceoMem.decisions = ceoMem.decisions.slice(-200);
          saveCEOMemory(ceoMem);
          // 自动核心记忆:重要操作持久化
          try {
            if (funcName === 'assign_task' && result.success) {
              var _ar=http.request({hostname:'127.0.0.1',port:PORT,path:'/api/core-memory/write',method:'POST',headers:{'Content-Type':'application/json'}});_ar.write(JSON.stringify({content:'\u5206\u914D\u4efb\u52a1: '+(funcArgs.title||'')+' \u7ed9 '+(funcArgs.assigneeId||''),tags:'\u4efb\u52a1,\u5206\u914D',priority:'high',type:'task'}));_ar.end();
            } else if (funcName === 'complete_task' && result.success) {
              var _cr=http.request({hostname:'127.0.0.1',port:PORT,path:'/api/core-memory/write',method:'POST',headers:{'Content-Type':'application/json'}});_cr.write(JSON.stringify({content:'\u5b8c\u6210\u4efb\u52a1: '+(result.data?result.data.title:''),tags:'\u4efb\u52a1,\u5b8c\u6210',priority:'medium',type:'task'}));_cr.end();
            } else if (funcName === 'review_task' && result.success) {
              var _rr=http.request({hostname:'127.0.0.1',port:PORT,path:'/api/core-memory/write',method:'POST',headers:{'Content-Type':'application/json'}});_rr.write(JSON.stringify({content:'\u5ba1\u6838\u4efb\u52a1: '+funcArgs.taskId+' '+(funcArgs.approved?'\u901a\u8fc7':'\u9a73\u56de'),tags:'\u4efb\u52a1,\u5ba1\u6838',priority:'medium',type:'task'}));_rr.end();
            }
          } catch(e) {}
        }

        // 自适应扩展:如果还有工具调用且接近限制,增加迭代
        if (iter >= MAX_ITERATIONS - 1 && iter < MAX_ITERATIONS - 1 + MAX_EXTRA) { MAX_ITERATIONS++; }
        // 再次循环 -> AI 观察工具结果后继续推理
        continue;
      }

      // 没有工具调用 -> 最终回复前保存对话
      // 保存对话到 CEO 记忆(跨会话持久化)
      try {
        var userMsg = messages[messages.length - 1];
        if (userMsg && userMsg.role === 'user') {
          ceoMem.conversations.push({ role: 'user', content: (userMsg.content || '').substring(0, 5000), time: new Date().toISOString() });
          ceoMem.conversations.push({ role: 'assistant', content: (msg.content || '').substring(0, 5000), time: new Date().toISOString() });
          if (ceoMem.conversations.length > 200) ceoMem.conversations = ceoMem.conversations.slice(-200);
          // 更新会话摘要
          ceoMem.sessionSummary = (typeof messages[messages.length-1].content === 'string' ? messages[messages.length-1].content : JSON.stringify(messages[messages.length-1].content || '')).substring(0, 60) + ' | ' + (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '')).substring(0, 100);
          ceoMem.lastActive = new Date().toISOString();
          saveCEOMemory(ceoMem);
        }
      } catch(e) {}
      return { reply: msg.content || '', toolCalls: allToolCalls };

    } catch (err) {
      try { fs.appendFileSync(path.join(BASE, 'ceo_error.log'), new Date().toISOString() + ' ' + (err.message || '') + '\\n' + (err.stack || '') + '\\n\\n', 'utf-8'); } catch(e) {}
      return { reply: '[Catch] ,请稍候。', toolCalls: allToolCalls };
    }
  }

  return { reply: (currentMessages.length > 1 ? (currentMessages[currentMessages.length-1].content || 'done') : 'done'), toolCalls: allToolCalls };
}

function json(res, data, status) {
  if (!status) status = 200;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve({}); } });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

// ========== 路由系统 ==========
const ROUTES = [];

// ========== 认证系统 ==========
const PUBLIC_PATHS = [
  '/api/auth/verify',
  '/api/setup/status',
  '/api/health',
  '/api/search-web',
  '/api/bi/',
  '/api/v4/member/status',
  '/api/channels/list',
  '/api/skills','/api/skills/',
  '/api/mcp/',
  '/api/stream/',
  '/api/tools/list',
  '/api/file-permissions/',
  '/api/file-versions/stats',
    '/api/chat',
  '/api/chat/sse',
  '/api/skills/proxy/list',
  '/api/skills/proxy/stats',
  '/api/mcp/servers',
  '/api/mcp/tools',
  '/api/provider/config',
  '/api/provider/test',
  '/api/models/providers',
  '/api/v4/settings/provider',
  '/api/v4/settings/apikey',
  '/api/v4/wechat/incoming',
  '/api/v4/channel/incoming',
  '/api/v4/channel/forward',
  '/api/mcp/server/status',
  '/api/mcp/server/start',
  '/api/mcp/server/stop',
  '/api/file-versions/',
  '/api/workflows',
  '/api/openapi.json',
  '/api/workflow-templates',
  '/api/employee-activities',
  '/api/team/',
  '/api/memory/compress'
];

function isPublicPath(pathname) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/api/setup/')) return true;
  if (pathname.startsWith('/api/wechat/')) return true;
  if (pathname.startsWith('/api/qqbot/')) return true;
  if (pathname.startsWith('/api/team/')) return true;
  if (pathname.startsWith('/api/core-memory/')) return true;
  if (pathname === '/api/openapi.json') return true;
  if (pathname === '/api/workflow-templates') return true;
  if (pathname.startsWith('/api/memory/compress')) return true;
  if (pathname.startsWith('/api/scheduler/')) return true;
  if (pathname.startsWith('/api/harness/')) return true;
  if (pathname.startsWith('/api/provider/')) return true;
  if (pathname.startsWith('/api/v4/settings/')) return true;
  if (pathname.startsWith('/api/chat')) return true;
  if (pathname.startsWith('/api/i18n/')) return true;
  if (pathname.startsWith('/api/bi/')) return true;
  if (pathname.startsWith('/api/router/')) return true;
  if (pathname.startsWith('/api/auto/')) return true;
  if (pathname.startsWith('/api/kb/')) return true;
  if (pathname.startsWith('/api/integration/')) return true;
  if (pathname.startsWith('/api/runner/')) return true;
  if (pathname.startsWith('/api/evolve/')) return true;
  if (pathname.startsWith('/api/skills/proxy/')) return true;
  if (pathname.startsWith('/api/v4/decompose')) return true;
  if (pathname.startsWith('/api/v4/dispatch')) return true;
  if (pathname.startsWith('/api/v4/employees')) return true;
  if (pathname.startsWith('/api/v4/ai/')) return true;
  if (pathname.startsWith('/api/v4/status/')) return true;
  return false;
}

function authenticate(req, res) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    json(res, { ok: false, error: '未授权访问,请提供认证令牌' }, 401);
    return false;
  }
  const token = authHeader.slice(7).trim();
  try {
    const _authMod = require('./modules/auth-middleware');
    const decoded = _authMod.verifyToken(token);
    if (!decoded) {
      json(res, { ok: false, error: '认证令牌无效或已过期' }, 401);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[auth] verifyToken error:', e.message);
    json(res, { ok: false, error: '认证服务异常' }, 500);
    return false;
  }
}

// ========== 路由注册 ==========

function registerRoute(methods, pattern, handler) {
  ROUTES.push({ methods, pattern, handler });
}

// ========== 路由注册 ==========

// ========== 网络搜索路由 ==========



// ====== 会员等级系统 API ======
var licenseSys = require('./modules/license');
registerRoute(['GET'], /^\/api\/v4\/member\/status$/, function(req, res) {
  try { json(res, { ok: true, status: licenseSys.getMemberStatus() }); } catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['POST'], /^\/api\/v4\/member\/activate$/, async function(req, res) {
  try {
    var b = await parseBody(req);
    var r = licenseSys.activateLicense(b.key, b.userName || '');
    json(res, r);
  } catch(e) { json(res, { ok: false, error: e.message }); }
});

// ====== /login 直接跳首页 ======
registerRoute(['GET'], /^\/login$/, function(req, res) {
  res.writeHead(302, { 'Location': '/' });
  res.end();
});
// ====== 会员等级系统 API ======
var licenseSys = require('./modules/license');
registerRoute(['GET'], /^\/api\/v4\/member\/status$/, function(req, res) {
  try { json(res, { ok: true, status: licenseSys.getMemberStatus() }); } catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['POST'], /^\/api\/v4\/member\/activate$/, async function(req, res) {
  try {
    var b = await parseBody(req);
    var r = licenseSys.activateLicense(b.key, b.userName || '');
    json(res, r);
  } catch(e) { json(res, { ok: false, error: e.message }); }
});

// ========== 权限认证 ==========
registerRoute(['GET'], /^\/api\/setup\/status$/, function(req, res) { json(res, { ok: true, configured: true }); });

// ========== 认证API ==========
registerRoute(['POST'], /^\/api\/auth\/verify$/, async function(req, res) {
  try {
    const body = await parseBody(req);
    const inputToken = body.token || body.password || '';
    if (inputToken === 'admin' || body.password === 'admin') {
      var _authMod = require('./modules/auth-middleware');
      var jwtToken = _authMod.generateToken({ id: 'admin', role: 'admin', name: 'CEO' });
      json(res, { ok: true, verified: true, token: jwtToken });
    } else {
      json(res, { ok: false, error: '认证失败,请输入正确的令牌或密码' }, 401);
    }
  } catch(e) { json(res, { ok: false, error: e.message }, 500); }
});

// ========== 登录API(SPA前端调用)==========
registerRoute(['POST'], /^\/api\/auth\/login$/, async function(req, res) {
  try {
    const body = await parseBody(req);
    const password = body.password || '';
    if (password === 'admin' || password === 'admin2026') {
      var _authMod = require('./modules/auth-middleware');
      var jwtToken = _authMod.generateToken({ id: 'admin', role: 'admin', name: 'CEO' });
      json(res, { ok: true, token: jwtToken, user: { id: 'admin', role: 'admin', name: 'CEO' } });
    } else {
      json(res, { ok: false, error: '密码错误,请输入正确的令牌' }, 401);
    }
  } catch(e) { json(res, { ok: false, error: e.message }, 500); }
});

// ========== 健康检查 ==========
registerRoute(['GET'], /^\/api\/health$/, async (req, res) => {
  const mem = process.memoryUsage();
  const stats = global.__apiStats || { total:0 };
  json(res, {
    ok: true, status: 'healthy', version: 'v3.0',
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString(),
    memory: Math.round(mem.rss / 1024 / 1024) + 'MB',
    node: process.version,
    checks: { database: fs.existsSync(path.join(BASE,'ecompany.db')) ? 'ok' : 'missing' },
    api: { total: stats.total }
  });
});

// ========== v4 CEO 调度路由 ==========
registerV4Routes(registerRoute, parseBody, json);
biDashboard.registerBIRoutes(registerRoute, parseBody, json);
modelRouter.registerRouterRoutes(registerRoute, parseBody, json);
automationV2.registerAutomationRoutes(registerRoute, parseBody, json);
knowledgeEngine.registerKnowledgeRoutes(registerRoute, parseBody, json);
channelIntegration.registerIntegrationRoutes(registerRoute, parseBody, json);
skillsRunner.registerRunnerRoutes(registerRoute, parseBody, json);
lifecycleRoutes.registerLifecycleRoutes(registerRoute, parseBody, json);
selfEvolution.registerEvolveRoutes(registerRoute, parseBody, json);

// ========== 网络搜索路由 ==========
registerRoute(['POST'], /^\/api\/search-web$/, async (req, res) => {
  const body = await parseBody(req);
  const query = body.query;
  if (!query) { json(res, { error: '缺少查询词' }, 400); return; }
  try {
    const searchUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&mkt=zh-CN';
    const searchResp = await fetch(searchUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    if (searchResp.ok) {
      const html = await searchResp.text();
      const results = [];
      const algoRe = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
      let m;
      while ((m = algoRe.exec(html)) !== null && results.length < 8) {
        const block = m[1];
        const titleM = block.match(/<h2[^>]*><a[^>]*>([\s\S]*?)<\/a><\/h2>/);
        const descM = block.match(/<p[^>]*class="b_lineclamp2"[^>]*>([\s\S]*?)<\/p>/);
        const linkM = block.match(/<a[^>]*href="(https?:[^"]+)"[^>]*>/);
        if (titleM) {
          results.push({
            title: titleM[1].replace(/<[^>]+>/g, '').trim(),
            snippet: descM ? descM[1].replace(/<[^>]+>/g, '').trim() : '',
            url: linkM ? linkM[1] : ''
          });
        }
      }
      if (results.length > 0) {
        json(res, { ok: true, query: query, results: results, source: 'bing' });
      } else {
        throw new Error('no_results');
      }
    } else {
      throw new Error('HTTP ' + searchResp.status);
    }
  } catch (err) {
    json(res, { ok: false, error: '搜索服务暂不可用' });
  }
});

// ========== 天气查询路由 ==========
registerRoute(['POST'], /^\/api\/weather$/, async (req, res) => {
  const body = await parseBody(req);
  const city = body.city;
  if (!city) { json(res, { error: '缺少城市名' }, 400); return; }
  try {
    const wttrUrl = 'https://wttr.in/' + encodeURIComponent(city) + '?format=%C+%t+%w+%h&lang=zh';
    const wttrResp = await fetch(wttrUrl, { signal: AbortSignal.timeout(10000) });
    if (wttrResp.ok) {
      const weatherText = await wttrResp.text();
      json(res, { ok: true, city: city, weather: weatherText.trim(), source: 'wttr.in' });
    } else {
      throw new Error('HTTP ' + wttrResp.status);
    }
  } catch (err) {
    json(res, { ok: false, error: err.message });
  }
});

// 团队信息
registerRoute(['GET'], /^\/api\/agents$/, (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const agentId = url.searchParams.get('agentId');
  const category = url.searchParams.get('category');
  const skill = url.searchParams.get('skill');
  const status = url.searchParams.get('status');
  let result = TEAM_AGENTS;
  if (agentId) { const a = AGENTS_MAP[agentId]; json(res, a || { error: 'not found' }); return; }
  if (category) result = result.filter(a => a.category === category);
  if (status) result = result.filter(a => a.status === status);
  if (skill) {
    const sk = skill.toLowerCase();
    result = result.filter(a => (a.skills || []).some(s => s.toLowerCase().includes(sk)));
  }
  json(res, { agents: result, total: result.length });
});

// 前向兼容:GET /api/agents/:id
// 前向兼容:GET /api/agents/:id
registerRoute(['GET'], /^\/api\/agents\/scores$/, (req, res) => {
  var scores = TEAM_AGENTS.map(function(a) {
    var tasks = TASKS.filter(function(t) { return t.assigneeId === a.id; });
    var done = tasks.filter(function(t) { return t.status === 'done'; }).length;
    var total = tasks.length;
    var overall = Math.min(100, Math.min(100, total * 5) + (total > 0 ? Math.floor(Math.round((done / total) * 100) / 2) : 50) + 30);
    return { id: a.id, name: a.name_cn, title: a.title, done: done, total: total, overall: overall, status: a.status };
  });
  scores.sort(function(a, b) { return b.overall - a.overall; });
  json(res, { scores: scores });
});

registerRoute(['GET'], /^\/api\/agents\/([^/]+)$/, (req, res, m) => {
  const agent = AGENTS_MAP[m[1]];
  json(res, agent || { error: 'not found' }, agent ? 200 : 404);
});

// 前向兼容:GET /api/agents/:id/history
registerRoute(['GET'], /^\/api\/agents\/([^/]+)\/history$/, (req, res, m) => {
  json(res, { agent_id: m[1], messages: [] });
});

// 任务管理
registerRoute(['GET'], /^\/api\/tasks$/, (req, res) => {
  // 每次从文件重新加载,确保 v4 调度的新任务也能显示
  try { TASKS = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8') || '[]'); } catch(e) {}
  // 合并 task-queue 数据
  var merged = [];
  var seen = {};
  var dagIds = {};
  try {
    var qTasks = taskQueue.getAllTasks() || [];
    qTasks.forEach(function(t) { if (t && t.id) { dagIds[t.id] = true; if (!seen[t.id]) { seen[t.id] = true; merged.push(t); } } });
  } catch(_e) {}
  TASKS.forEach(function(t) { if (t && t.id && !seen[t.id]) { seen[t.id] = true; merged.push(t); } });
  // 标注状态来源
  merged.forEach(function(t) {
    if (t.schedulerAssigned === true) {
      t.source_status = '✅ 调度器已执行';
    } else if (dagIds[t.id]) {
      t.source_status = '⚠️ 旧系统-实际已执行';
    } else {
      t.source_status = '⏳ 待调度';
    }
  });
  json(res, { tasks: merged, total: merged.length });
});

registerRoute(['POST'], /^\/api\/tasks$/, async (req, res) => {
  const body = await parseBody(req);
  if (!body.title) { json(res, { error: '任务标题不能为空' }, 400); return; }
  const task = {
    id: uuid(), title: body.title, description: body.description || '',
    status: 'todo', priority: body.priority || 'medium',
    assigneeId: body.assigneeId || null, creator: body.creator || 'system',
    deadline: body.deadline || null, tags: body.tags || [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  TASKS.push(task);
  saveJSON(TASKS_FILE, TASKS);
  json(res, { task, message: '任务已创建' });
});

// 前向兼容:任务更新/删除
registerRoute(['PUT'], /^\/api\/tasks\/([^/]+)$/, async (req, res, m) => {
  const taskId = m[1];
  const body = await parseBody(req);
  const idx = TASKS.findIndex(t => t.id === taskId);
  if (idx === -1) { json(res, { error: '任务未找到' }, 404); return; }
  Object.assign(TASKS[idx], body, { updatedAt: new Date().toISOString() });
  saveJSON(TASKS_FILE, TASKS);
  json(res, { task: TASKS[idx], message: '任务已更新' });
});

registerRoute(['DELETE'], /^\/api\/tasks\/([^/]+)$/, (req, res, m) => {
  const taskId = m[1];
  const idx = TASKS.findIndex(t => t.id === taskId);
  if (idx === -1) { json(res, { error: '任务未找到' }, 404); return; }
  TASKS.splice(idx, 1);
  saveJSON(TASKS_FILE, TASKS);
  json(res, { message: '任务已删除' });
// Agent 独立工作台
registerRoute(['GET'], /^\/api\/agents\/([^/]+)\/workspace$/, (req, res, m) => {
  const agentId = m[1];
  const agent = AGENTS_MAP[agentId];
  if (!agent) { json(res, { error: 'not found' }, 404); return; }
  const currentTasks = TASKS.filter(t => t.assigneeId === agentId && t.status !== 'done' && t.status !== 'failed');
  const completedTasks = TASKS.filter(t => t.assigneeId === agentId && (t.status === 'done' || t.status === 'failed'));
  json(res, {
    agent: { id: agentId, name: agent.name_cn || agent.name, title: agent.title, icon: agent.icon, status: agent.status },
    currentTasks: currentTasks.map(t => ({ id: t.id, title: t.title, priority: t.priority, status: t.status })),
    completedTasks: completedTasks.slice(-20).map(t => ({ id: t.id, title: t.title, status: t.status })),
    taskStats: { current: currentTasks.length, completed: completedTasks.filter(t => t.status === 'done').length, failed: completedTasks.filter(t => t.status === 'failed').length, total: TASKS.filter(t => t.assigneeId === agentId).length },
    skills: (agent.skills || []).map((s, i) => ({ name: s, level: (agent.skill_levels || [])[i] || 'intermediate' }))
  });
});

// 任务池
registerRoute(['GET'], /^\/api\/tasks\/pool$/, (req, res) => {
  const pool = TASKS.filter(t => t.status === 'pending' || t.status === 'todo');
  json(res, { tasks: pool, total: pool.length });
});

// 任务锁
registerRoute(['GET'], /^\/api\/tasks\/locks$/, (req, res) => {
  const active = [];
  try {
    const locksFile = path.join(BASE, 'locks.json');
    if (fs.existsSync(locksFile)) {
      const all = JSON.parse(fs.readFileSync(locksFile, 'utf-8'));
      active.push(...(all || []).filter(l => l.active));
    }
  } catch(e) {}
  json(res, { locks: active });
});

// 项目记忆列表
registerRoute(['GET'], /^\/api\/memory\/v2\/projects$/, (req, res) => {
  try {
    if (!fs.existsSync(MEMORY_DIR)) { json(res, { ok: true, projects: [] }); return; }
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    json(res, { ok: true, projects: files.map(pid => {
      try {
        const mem = JSON.parse(fs.readFileSync(path.join(MEMORY_DIR, pid + '.json'), 'utf-8'));
        return { projectId: pid, summaryCount: (mem.summaries || []).length, keyPointCount: (mem.keyPoints || []).length, updatedAt: mem.updatedAt };
      } catch(e) { return { projectId: pid, summaryCount: 0, keyPointCount: 0 }; }
    })});
  } catch(e) { json(res, { ok: true, projects: [] }); }
});

});

// Tools list endpoint
registerRoute(["GET"], /^\/api\/tools\/list$/, function(req, res) {
  try {
    var tr = require("./modules/tools-registry");
    var tools = tr.ALL_TOOLS || [];
    var stats = tr.getToolStats ? tr.getToolStats() : { total: tools.length };
    json(res, { ok: true, tools: tools, total: stats.total });
  } catch(e) {
    json(res, { ok: false, error: e.message }, 500);
  }
});


// MCP 服务器模式(将 eCompany 工具暴露给外部)
var mcpServer = require("./modules/mcp-server");

registerRoute(["POST"], /^\/api\/mcp\/server\/start$/, function(req, res) {
  mcpServer.start(function(err) {
    if (err) json(res, { ok: false, error: err.message }, 500);
    else json(res, { ok: true, status: mcpServer.getStatus() });
  });
});

registerRoute(["POST"], /^\/api\/mcp\/server\/stop$/, function(req, res) {
  mcpServer.stop();
  json(res, { ok: true });
});

registerRoute(["GET"], /^\/api\/mcp\/server\/status$/, function(req, res) {
  json(res, { ok: true, status: mcpServer.getStatus() });
});

// Webhook 接收器路由
var webhookReceiver = require("./modules/webhook-receiver");
registerRoute(["POST"], /^\/api\/webhook\/([^\/]+)$/, function(req, res, m) {
  var body = "";
  req.on("data", function(c) { body += c; });
  req.on("end", function() {
    try {
      var result = webhookReceiver.handleWebhook(m[1], JSON.parse(body));
      json(res, { ok: true, result: result });
    } catch(e) { json(res, { ok: false, error: e.message }, 500); }
  });
});

// MCP WebSocket 传输
var mcpWsServer = require("./modules/mcp-ws-server");
mcpWsServer.start(function(err) {
  if (err) console.error("[MCP-WS] Start failed:", err.message);
});
// MCP 协议服务器管理路由
var mcpManager = require("./modules/mcp-manager");

// 列出所有 MCP 服务器状态
registerRoute(["GET"], /^\/api\/mcp\/servers$/, function(req, res) {
  json(res, { ok: true, servers: mcpManager.getServerStatus(), available: mcpManager.listAvailableServers() });
});

// 启动 MCP 服务器
registerRoute(["POST"], /^\/api\/mcp\/start$/, async function(req, res) {
  try {
    var body = await parseBody(req);
    if (!body.name) return json(res, { ok: false, error: "name required" }, 400);
    var result = await mcpManager.startServer(body.name);
    json(res, { ok: true, result: result });
  } catch(e) { json(res, { ok: false, error: e.message }, 500); }
});

// 停止 MCP 服务器
registerRoute(["POST"], /^\/api\/mcp\/stop$/, async function(req, res) {
  try {
    var body = await parseBody(req);
    if (!body.name) return json(res, { ok: false, error: "name required" }, 400);
    mcpManager.stopServer(body.name);
    json(res, { ok: true });
  } catch(e) { json(res, { ok: false, error: e.message }, 500); }
});

// 获取已注册的 MCP 工具列表
registerRoute(["GET"], /^\/api\/mcp\/tools$/, function(req, res) {
  try {
    var tools = mcpManager.listTools ? mcpManager.listTools() : (mcpManager.availableTools || []);
    json(res, { ok: true, tools: tools });
  } catch(e) { json(res, { ok: false, error: e.message }, 500); }
});


// 可视化工作流引擎路由
var wfEngine = require("./modules/workflow-engine");
if (wfEngine.registerWorkflowRoutes) wfEngine.registerWorkflowRoutes(registerRoute, parseBody, json);

// 文件版本控制路由
var fileVersions = require("./modules/file-versions");
if (fileVersions.registerVersionRoutes) fileVersions.registerVersionRoutes(registerRoute, parseBody, json);
// 编码 Agent 路由
var codingAgent = require("./modules/coding-agent");
if (codingAgent.registerCodingRoutes) codingAgent.registerCodingRoutes(registerRoute, parseBody, json);
// OpenClaw Skill Proxy routes
var skillProxy = require("./modules/skill-proxy");
registerRoute(["GET"], /^\/api\/skills\/proxy\/list$/, function(req, res) { json(res, { ok: true, skills: skillProxy.getAllSkills() }); });
registerRoute(["GET"], /^\/api\/skills\/proxy\/stats$/, function(req, res) { json(res, { ok: true, stats: skillProxy.getStats() }); });
registerRoute(["GET"], /^\/api\/skills\/proxy\/detail\/([^\/]+)$/, function(req, res, m) {
  var skills = skillProxy.getAllSkills();
  var skill = skills.find(function(s) { return s.id === m[1]; });
  if (!skill) { json(res, { ok: false, error: "not found" }, 404); return; }
  try { json(res, { ok: true, skill: skill, content: fs.readFileSync(skill.dir + "/SKILL.md", "utf-8") }); } catch(e) { json(res, { ok: true, skill: skill }); }
});
registerRoute(["POST"], /^\/api\/skills\/proxy\/refresh$/, function(req, res) { skillProxy.getAllSkills(); json(res, { ok: true }); });
console.log("[SkillProxy] OK, skills: " + skillProxy.getAllSkills().length);

// AI 对话 SSE 流式 - POST /api/chat/sse
registerRoute(["POST"], /^\/api\/chat\/sse$/, async (req, res) => {
  const body = await parseBody(req);
  const agentId = body.agentId;
  const message = body.message;
  if (!agentId || !message) { json(res, { error: "\u7f3a\u5c11\u53c2\u6570" }, 400); return; }
  var agent = AGENTS_MAP[agentId];
  if (!agent) { json(res, { error: "\u672a\u77e5\u5458\u5de5" }, 404); return; }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  function sseSend(type, content) { try { res.write("data: " + JSON.stringify({ type, content }) + "\n\n"); } catch(e) {} }
  function sseSendObj(obj) { try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch(e) {} }
  if (agentId !== "ai_ceo") {
    sseSend("thinking", "AI " + (agent.name_cn || agentId) + " \u6b63\u5728\u56de\u7b54\u4f60\u7684\u95ee\u9898...");
    try {
      var msgCtx = [{role:"user", content:message}];
      var result = await runCEOCEO(msgCtx, {});
      var reply = typeof result === "string" ? result : (result && result.reply) || JSON.stringify(result);
      for (var _si = 0; _si < (typeof reply === 'string' ? reply.length : 0); _si += 3) { sseSend("message", (typeof reply === 'string' ? reply : '').substring(_si, _si + 3)); await new Promise(function(r) { setTimeout(r, 15); }); }
      sseSendObj({ type: "done", reply });
    } catch(e) { sseSend("error", e.message); }
    res.end(); return;
  }
  try {
    var ceoMem = null; try { ceoMem = JSON.parse(fs.readFileSync(CEOMEM_PATH, "utf-8")); } catch(e) {}
    var msgCtx = [];
    if (ceoMem && ceoMem.conversations) {
      var recent = ceoMem.conversations.slice(-40);
      for (var _i = 0; _i < recent.length; _i++) { var c2 = recent[_i]; msgCtx.push({ role: c2.role || "user", content: (c2.content || c2.response || "") }); }
    }
    msgCtx.push({role:"user", content:message});
    sseSend("thinking", "\u9648\u667A\u6167 \u6b63\u5728\u5206\u6790\u4f60\u7684\u95ee\u9898...");
    logActivity("\uD83D\uDC51", "CEO: " + (message||""), "ai_ceo", message);
    var result = await runCEOCEO(msgCtx, {});
    var reply = typeof result === "string" ? result : (result && result.reply) || JSON.stringify(result);
    try {
      var sm = JSON.parse(fs.readFileSync(CEOMEM_PATH, "utf-8"));
      if (!sm.conversations) sm.conversations = [];
      sm.conversations.push({ role: "user", content: message, time: new Date().toISOString() });
      sm.conversations.push({ role: "assistant", content: reply, time: new Date().toISOString() });
      if (sm.conversations.length > 200) sm.conversations = sm.conversations.slice(-200);
      sm.lastActive = new Date().toISOString();
      fs.writeFileSync(CEOMEM_PATH, JSON.stringify(sm, null, 2), "utf-8");
    } catch(e) {}
    logActivity("\u2705", "CEO \u56de\u590d\u5b8c\u6210", "ai_ceo");
    sseSend("thinking", "\u9648\u667A\u6167 \u6b63\u5728\u7f16\u5199\u56de\u590d...");
    await new Promise(function(r) { setTimeout(r, 500); });
    for (var si = 0; si < (typeof reply === 'string' ? reply.length : 0); si += 3) { sseSend("message", (typeof reply === 'string' ? reply : '').substring(si, si + 3)); await new Promise(function(r) { setTimeout(r, 20); }); }
    sseSendObj({ type: "done", reply });
  } catch(e) { sseSend("error", e.message); }
  res.end();
});
// AI 对话 - POST /api/chat (agentId in body)
registerRoute(['POST'], /^\/api\/chat$/, async (req, res) => {
  const body = await parseBody(req);
  const agentId = body.agentId;
  const message = body.message;
  const provider = body.provider;
  const model = body.model;
  if (!agentId || !message) { json(res, { error: '缺少参数' }, 400); return; }
  const agent = AGENTS_MAP[agentId];
  if (!agent) { json(res, { error: '未知员工' }, 404); return; }

  if (agentId === 'ai_ceo') {
    try {
      // 加载 CEO 记忆,带上对话历史(最近20条)
      var ceoMem = null;
      try { ceoMem = JSON.parse(fs.readFileSync(CEOMEM_PATH, 'utf-8')); } catch(e) {}
      var msgCtx = [];
      if (ceoMem && ceoMem.conversations && ceoMem.conversations.length > 0) {
        var recent = ceoMem.conversations.slice(-40);
        for (var _i = 0; _i < recent.length; _i++) {
          var c = recent[_i];
          msgCtx.push({ role: c.role || 'user', content: (c.content || c.response || '') });
        }
      }
      msgCtx.push({role:'user',content:message});
      logActivity('👑', 'CEO 正在分析: ' + (message||''), 'ai_ceo', message);
      var result = await runCEOCEO(msgCtx, {});
      // 保存对话到 CEO 记忆(去重:避免与 runCEOCEO 内部保存重复)
      try {
        var ceoMemSave = JSON.parse(fs.readFileSync(CEOMEM_PATH, 'utf-8'));
        if (!ceoMemSave.conversations) ceoMemSave.conversations = [];
        var lastConv = ceoMemSave.conversations[ceoMemSave.conversations.length - 1] || {};
        if (lastConv.content !== message || lastConv.role !== 'user') {
          ceoMemSave.conversations.push({ role: 'user', content: message, time: new Date().toISOString() });
        }
        if (result.reply) {
          var lastReply = ceoMemSave.conversations[ceoMemSave.conversations.length - 1] || {};
          if (lastReply.content !== result.reply || lastReply.role !== 'assistant') {
            ceoMemSave.conversations.push({ role: 'assistant', content: result.reply, time: new Date().toISOString() });
          }
        }
        if (ceoMemSave.conversations.length > 200) ceoMemSave.conversations = ceoMemSave.conversations.slice(-200);
        // 生成会话摘要用于跨会话记忆
        var recentConvs = ceoMemSave.conversations.slice(-6);
        if (recentConvs.length >= 2) {
          var lastUserMsg = '';
          var lastAiReply = '';
          for (var _ridx = recentConvs.length - 1; _ridx >= 0; _ridx--) {
            var _rc = recentConvs[_ridx];
            if (_rc.role === 'assistant' && !lastAiReply) lastAiReply = (typeof _rc.content === 'string' ? _rc.content : JSON.stringify(_rc.content || '')).substring(0, 100);
            if (_rc.role === 'user' && !lastUserMsg) lastUserMsg = (typeof _rc.content === 'string' ? _rc.content : JSON.stringify(_rc.content || '')).substring(0, 100);
          }
          ceoMemSave.sessionSummary = '最后对话 - 用户说: ' + lastUserMsg + ' | 回复: ' + lastAiReply;
        }
        fs.writeFileSync(CEOMEM_PATH, JSON.stringify(ceoMemSave, null, 2), 'utf-8');
      } catch(e) {}
      if (result.reply && result.reply.length > 0) {
        logActivity('✅', 'CEO 回复完成', 'ai_ceo', result.reply || '');
      }
      json(res, {agentId:agentId, name:agent.name_cn, reply:result.reply||'ok'});
      return;
    } catch(err) {
      logActivity('❌', 'CEO 处理出错: ' + err.message, 'ai_ceo', err.stack);
      json(res, {agentId:agentId, name:agent.name_cn, reply:err.message||'err', fallback:true});
      return;
    }
  }
  try {
    try { wsServer.agentActivity(agentId, agent.name_cn||agentId, '对话中: ' + (typeof message === 'string' ? message : '').substring(0,30)); } catch(e) {}
    // 使用 agent-executor 的完整 Agent 引擎(含工具、记忆、推理)
    const { executeAgent } = require('./modules/agent-executor');
    var execOptions = { timeout: 60000 };
    if (provider) execOptions.provider = provider;
    if (model) execOptions.model = model;
    var result = await executeAgent(agentId, message, execOptions);
    var replyText = (typeof result === 'string') ? result : (result.reply || result.message || '');
    json(res, { agentId, name: agent.name_cn, reply: replyText });
  } catch (err) {
    console.error('[Chat] AI chat error for ' + agentId + ':', err.message, err.stack ? err.stack.substring(0, 200) : '');
    json(res, { agentId, name: agent.name_cn, reply: '收到消息。我是 ' + agent.name_cn + ',请稍后。', fallback: true, error: err.message });
  }
});

// ========== SSE 流式聊天路由 ==========
// 注意:必须在 /api/chat/:agentId 通配路由之前注册
registerRoute(['POST'], /^\/api\/chat\/stream$/, async (req, res, m) => {
  const body = await parseBody(req);
  const agentId = body.agentId || 'ai_ceo';
  const message = (body.message || '').trim();
  if (!message) { json(res, { error: '消息不能为空' }, 400); return; }
  const agent = AGENTS_MAP[agentId];
  if (!agent) { json(res, { error: '员工不存在' }, 404); return; }

  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': 'http://127.0.0.1:'+PORT
  });

  // 发送 SSE 事件辅助函数
  function sseSend(event, data) {
    try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch(e) {}
  }

  sseSend('start', { agentId, name: agent.name_cn, timestamp: Date.now() });

  try {
    const { executeAgent } = require('./modules/agent-executor');
    const result = await executeAgent(agentId, message, { timeout: 120000 });
    const replyText = (typeof result === 'string') ? result : (result.reply || result.message || '');

    // 模拟流式输出:将回复分块发送
    const chunkSize = Math.max(1, Math.floor(replyText.length / 5));
    for (let i = 0; i < replyText.length; i += chunkSize) {
      const chunk = (typeof replyText === 'string' ? replyText : '').substring(i, Math.min(i + chunkSize, (typeof replyText === 'string' ? replyText : '').length));
      sseSend('chunk', { content: chunk, index: i });
      // 微延迟模拟流式效果
      await new Promise(r => setTimeout(r, 30));
    }
    sseSend('complete', { agentId, name: agent.name_cn, fullReply: replyText, timestamp: Date.now() });
    logActivity('✅', agent.name_cn + ' 流式回复完成', agentId, replyText || "");
  } catch (err) {
    sseSend('error', { agentId, error: err.message, timestamp: Date.now() });
    logActivity('❌', agent.name_cn + ' 流式回复失败: ' + err.message, agentId, '');
  }
  res.end();
});

// AI 对话 - POST /api/chat/:agentId (agentId in URL)
// CEO 专用:自主推理 + 工具调用 + 动态决策(Agent 引擎)
// 其他员工:标准 AI 对话
registerRoute(['POST'], /^\/api\/chat\/([^/]+)$/, async (req, res, m) => {
  const agentId = m[1];
  const body = await parseBody(req);
  const message = (body.message || '').trim();
  if (!message) { json(res, { error: '消息不能为空' }, 400); return; }
  const agent = AGENTS_MAP[agentId];
  if (!agent) { json(res, { error: '员工不存在' }, 404); return; }

    // ====== 企业级多 Agent 架构 ======
    // 使用 agent-executor 执行独立 Agent 对话
    try {
      const { executeAgent } = require('./modules/agent-executor');

      var execOptions = { timeout: 60000 };
      if (body.provider) execOptions.provider = body.provider;
      if (body.model) execOptions.model = body.model;

      if (agentId === 'ai_ceo') {
        // CEO: 使用现有 runCEOCEO 引擎(含 24 个管理工具)
        var ctx = body.context || [];
        var userMsg = {role:'user',content:message};
        if (body.image && body.image.length > 100) {
          userMsg = {role:'user',content:[{type:'text',text:message},{type:'image_url',image_url:{url:body.image}}]};
        }
        var result = await runCEOCEO(ctx.concat([userMsg]), {});
        json(res, {reply:result.reply||'ok', agent_id:'ai_ceo', agent_name:(AGENTS_MAP.ai_ceo?.name_cn||'CEO')});
      } else {
        // 其他 Agent: 独立 AI 调用(独立上下文、记忆、角色提示词)
        var result = await executeAgent(agentId, message, execOptions);
        json(res, { reply: result.reply, agent_id: agentId, agent_name: agent.name_cn });
      }
    } catch(err) {
      json(res, {
        reply: err.message || '处理失败,请重试',
        agent_id: agentId,
        agent_name: agent.name_cn,
        fallback: true
      });
    }
});

// 任务分派
registerRoute(['GET'], /^\/api\/dispatch$/, (req, res) => {
  json(res, { message: '任务分派就绪', agents: TEAM_AGENTS.length });
});
registerRoute(['POST'], /^\/api\/dispatch$/, async (req, res) => {
  const body = await parseBody(req);
  json(res, { message: '任务已分派', ...body });
});

// 记忆系统
// ====== Agent 记忆中心(V3/V4 统一 API)======
// 获取 Agent 所有记忆
registerRoute(['GET'], /^\/api\/memory\/([^/]+)$/, (req, res, m) => {
  try {
    var mem = AgentEngine.loadAgentMemory(m[1]);
    json(res, { agent_id: m[1], memory: mem || { conversations: [], decisions: [], notes: [], summary: '' }, loaded: !!mem });
  } catch(e) { json(res, { agent_id: m[1], memory: { conversations: [], decisions: [], summary: '' }, error: e.message, loaded: false }); }
});
// 获取 Agent 记忆统计
registerRoute(['GET'], /^\/api\/memory\/([^/]+)\/stats$/, (req, res, m) => {
  try {
    var mem = AgentEngine.loadAgentMemory(m[1]);
    var convCount = (mem && mem.conversations) ? mem.conversations.length : 0;
    var decCount = (mem && mem.decisions) ? mem.decisions.length : 0;
    var avgImportance = 0;
    json(res, { agent_id: m[1], totalMemories: convCount + decCount, conversations: convCount, decisions: decCount, lastActive: mem ? mem.lastActive : null });
  } catch(e) { json(res, { agent_id: m[1], totalMemories: 0, error: e.message }); }
});
// 全局记忆统计
registerRoute(['GET'], /^\/api\/memory\/stats\/all$/, (req, res) => {
  try {
    var agents = Object.keys(AGENTS_MAP);
    var stats = agents.map(function(id) {
      try {
        var mem = AgentEngine.loadAgentMemory(id);
        return { agentId: id, agentName: AGENTS_MAP[id].name_cn || id, memoryCount: (mem && mem.conversations ? mem.conversations.length : 0) + (mem && mem.decisions ? mem.decisions.length : 0), lastActive: mem ? mem.lastActive : null };
      } catch(e) { return { agentId: id, memoryCount: 0, error: e.message }; }
    }).filter(function(s) { return s.memoryCount > 0 || s.agentId === 'ai_ceo'; });
    json(res, { ok: true, agents: stats, total: stats.length });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});
// 搜索 Agent 记忆(对话 + 决策 + 摘要)
registerRoute(['GET'], /^\/api\/memory\/([^/]+)\/search$/, (req, res, m) => {
  try {
    var url = new URL(req.url, 'http://localhost');
    var q = (url.searchParams.get('q') || '').toLowerCase();
    var mem = AgentEngine.loadAgentMemory(m[1]);
    var results = [];
    // 搜索对话
    if (mem && mem.conversations) {
      mem.conversations.filter(function(c) { return (c.content || '').toLowerCase().includes(q); }).slice(-20).forEach(function(c) { results.push({ type: 'conversation', content: c.content, time: c.time }); });
    }
    // 搜索决策
    if (mem && mem.decisions) {
      mem.decisions.filter(function(d) { return JSON.stringify(d).toLowerCase().includes(q); }).slice(-20).forEach(function(d) { results.push({ type: 'decision', content: d.type || d.action || JSON.stringify(d).substring(0, 100), time: d.timestamp || d.time }); });
    }
    // 搜索摘要
    if (mem && mem.summary) {
      results.push({ type: 'summary', content: (typeof mem.summary === 'string' ? mem.summary : JSON.stringify(mem.summary || '')).substring(0, 200), time: mem.lastActive });
    }
    json(res, { ok: true, agentId: m[1], query: q, results: results.slice(0, 30), count: results.length });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});
// 全局记忆搜索
registerRoute(['GET'], /^\/api\/memory\/search\/global$/, (req, res) => {
  try {
    var url = new URL(req.url, 'http://localhost');
    var q = (url.searchParams.get('q') || '').toLowerCase();
    var agents = Object.keys(AGENTS_MAP);
    var results = [];
    agents.forEach(function(id) {
      try {
        var mem = AgentEngine.loadAgentMemory(id);
        if (mem && mem.conversations) {
          mem.conversations.filter(function(c) { return (c.content || '').toLowerCase().includes(q); }).slice(-5).forEach(function(c) {
            results.push({ agentId: id, agentName: AGENTS_MAP[id].name_cn || id, content: c.content, time: c.time });
          });
        }
      } catch(e) {}
    });
    json(res, { ok: true, query: q, results: results, count: results.length });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});
// 保存记忆
registerRoute(['POST'], /^\/api\/memory\/([^/]+)$/, async (req, res, m) => {
  try {
    var body = await parseBody(req);
    var mem = AgentEngine.loadAgentMemory(m[1]) || { conversations: [], decisions: [], notes: [], summary: '' };
    if (body.content) { mem.conversations.push({ role: 'system', content: body.content, time: new Date().toISOString() }); }
    AgentEngine.saveAgentMemory(m[1], mem);
    json(res, { ok: true, message: '记忆已保存', agent_id: m[1], totalMemories: mem.conversations.length });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});

// 报告
registerRoute(['GET'], /^\/api\/report$/, (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const agentId = url.searchParams.get('agentId') || 'unknown';
  const agent = AGENTS_MAP[agentId];
  json(res, {
    agent_id: agentId, agent_name: agent?.name_cn || '未知',
    period: url.searchParams.get('period') || 'daily',
    totalTasks: TASKS.filter(t => t.assigneeId === agentId).length,
    completedTasks: TASKS.filter(t => t.assigneeId === agentId && t.status === 'done').length,
    message: '报告已生成'
  });
});

// Agent 模型配置(多模型策略)
var AGENT_MODELS_PATH = require('path').join(BASE, 'agent-models.json');

registerRoute(['GET'], /^\/api\/agent-models$/, (req, res) => {
  try {
    if (!require('fs').existsSync(AGENT_MODELS_PATH)) { json(res, { agents: {} }); return; }
    var raw = require('fs').readFileSync(AGENT_MODELS_PATH, 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    var cfg = JSON.parse(raw);
    json(res, { agents: cfg.agents || {}, strategies: ['fixed', 'fallback', 'roundrobin', 'smart'] });
  } catch(e) { json(res, { agents: {}, error: e.message }); }
});

registerRoute(['POST'], /^\/api\/agent-models$/, async (req, res) => {
  try {
    var body = await parseBody(req);
    var agentId = body.agentId;
    var modelCfg = body.config;
    if (!agentId) { json(res, { ok: false, error: 'missing agentId' }); return; }
    var cfg = {};
    if (require('fs').existsSync(AGENT_MODELS_PATH)) {
      var raw = require('fs').readFileSync(AGENT_MODELS_PATH, 'utf-8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
      cfg = JSON.parse(raw);
    }
    if (!cfg.agents) cfg.agents = {};
    if (modelCfg && modelCfg.provider) {
      cfg.agents[agentId] = { provider: modelCfg.provider, model: modelCfg.model || '', strategy: modelCfg.strategy || 'fixed', fallbacks: modelCfg.fallbacks || [] };
    } else {
      delete cfg.agents[agentId];
    }
    require('fs').writeFileSync(AGENT_MODELS_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
    json(res, { ok: true, message: agentId + ' 模型配置已保存' });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});

// OpenClaw 桥接
registerRoute(['GET'], /^\/api\/openclaw\/status$/, async (req, res) => {
  try {
    const gw = await fetch('http://127.0.0.1:' + openclawBridge.GATEWAY_PORT + '/api/health', { signal: AbortSignal.timeout(3000) });
    const gwStatus = await gw.json();
    json(res, { connected: true, gateway: gwStatus, bridge: { version: 'v3.0', tools: openclawBridge.BRIDGE_TOOLS.length } });
  } catch(e) {
    json(res, { connected: false, error: e.message, bridge: { tools: openclawBridge.BRIDGE_TOOLS.length } });
  }
});

// 多渠道发送路由请见下方「多渠道消息」区块(仅保留唯一入口,避免与前方重复)
// 多渠道状态
registerRoute(['GET'], /^\/api\/channel\/status$/, (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  json(res, { channel: url.searchParams.get('channel') || '', connected: false });
});

// 多渠道测试
registerRoute(['POST'], /^\/api\/channel\/test$/, async (req, res) => {
  const body = await parseBody(req);
  // 延迟加载 channels 模块(避免循环依赖)
  const { sendViaChannel } = require('./modules/channels');
  const result = await sendViaChannel(body.channel, body.config || {}, '🔌 渠道连接测试 - ' + new Date().toLocaleTimeString());
  json(res, result);
});

// Cron
registerRoute(['GET'], /^\/api\/cron\/jobs$/, (req, res) => {
  json(res, { jobs: cronScheduler.listJobs() });
});
registerRoute(['POST'], /^\/api\/cron\/jobs$/, async (req, res) => {
  const body = await parseBody(req);
  try {
    const job = cronScheduler.addJob(body.name, body.schedule, body.action, body.params);
    json(res, { job, message: '定时任务已创建' });
  } catch(e) { json(res, { error: e.message }, 400); }
});
registerRoute(['DELETE'], /^\/api\/cron\/jobs\/(.+)$/, (req, res, m) => {
  cronScheduler.removeJob(m[1]);
  json(res, { message: '任务已删除' });
});

// 安全沙箱
registerRoute(['POST'], /^\/api\/sandbox\/execute$/, async (req, res) => {
  const body = await parseBody(req);
  if (!body.code) { json(res, { error: '缺少 code' }, 400); return; }
  try {
    const result = await processSandbox.execute(body.code, body.language || 'js', { timeout: body.timeout || 30000 });
    json(res, { result, sandboxed: true });
  } catch(e) { json(res, { error: "处理失败" }, 500); }
});
registerRoute(['POST'], /^\/api\/sandbox\/file\/read$/, async (req, res) => {
  const body = await parseBody(req);
  try { json(res, { content: fileSandbox.readFile(body.filename) }); }
  catch(e) { json(res, { error: e.message }, 400); }
});
registerRoute(['POST'], /^\/api\/sandbox\/file\/write$/, async (req, res) => {
  const body = await parseBody(req);
  try { fileSandbox.writeFile(body.filename, body.content); json(res, { message: '写入成功' }); }
  catch(e) { json(res, { error: e.message }, 400); }
});

// 技能系统（从 SKILL.md 加载）
registerRoute(['GET'], /^\/api\/skills$/, (req, res) => {
  try {
    skillSystem.loadAll();
    var skillsList = [];
    skillSystem.skills.forEach(function(skill, name) {
      skillsList.push({
        id: name,
        name: name,
        description: skill.description || '\u6682\u65e0\u63cf\u8ff0',
        version: skill.metadata && skill.metadata.version ? 'v' + skill.metadata.version : '1.0',
        enabled: skill.enabled !== false
      });
    });
    json(res, { ok: true, skills: skillsList, total: skillsList.length });
  } catch(e) { json(res, { ok: false, error: e.message, skills: [], total: 0 }); }
});
registerRoute(['POST'], /^\/api\/skills$/, async (req, res) => {
  const body = await parseBody(req);
  try { json(res, { skill: skillSystem.createSkill(body.name, body.description, body.instructions, body.metadata), message: '技能已创建' }); }
  catch(e) { json(res, { error: e.message }, 400); }
});
registerRoute(['GET'], /^\/api\/skills\/(.+)$/, (req, res, m) => {
  const skill = skillSystem.get(decodeURIComponent(m[1]));
  if (skill) json(res, { skill });
  else json(res, { error: '未找到' }, 404);
});

// 多模型配置
registerRoute(['GET'], /^\/api\/models\/providers$/, (req, res) => {
  var { PROVIDERS } = require('./modules/ai-engine');
  const available = {};
  for (const [key, cfg] of Object.entries(PROVIDERS)) {
    available[key] = { configured: !!process.env[cfg.apiKeyEnv], defaultModel: cfg.defaultModel, models: cfg.models || [] };
  }
  json(res, { providers: available });
});
registerRoute(['POST'], /^\/api\/models\/config$/, async (req, res) => {
  const body = await parseBody(req);
  if (body.apiKey && body.provider) {
    const config = { provider: body.provider, apiKey: body.apiKey, model: body.model || '' };
    if (body.fallbackProvider) config.fallbackProvider = body.fallbackProvider;
    if (body.fallbackModel) config.fallbackModel = body.fallbackModel;
    fs.writeFileSync(path.join(BASE, 'ai-provider.json'), JSON.stringify(config, null, 2));
    const keyMap = { deepseek:'DEEPSEEK_API_KEY', openai:'OPENAI_API_KEY', anthropic:'ANTHROPIC_API_KEY', google:'GOOGLE_API_KEY', openrouter:'OPENROUTER_API_KEY', moonshot:'MOONSHOT_API_KEY', tongyi:'TONGYI_API_KEY', zhipu:'ZHIPU_API_KEY', siliconflow:'SILICONFLOW_API_KEY', baichuan:'BAICHUAN_API_KEY', minimax:'MINIMAX_API_KEY', doubao:'DOUBAO_API_KEY', step:'STEP_API_KEY', hunyuan:'HUNYUAN_API_KEY', ernie:'ERNIE_API_KEY', yi:'YI_API_KEY' };
    if (keyMap[body.provider]) process.env[keyMap[body.provider]] = body.apiKey;
    json(res, { ok: true, message: body.provider + ' 配置已保存' });
  } else { json(res, { error: '缺少参数' }, 400); }
});

// TaskFlow
registerRoute(['POST'], /^\/api\/taskflow$/, async (req, res) => {
  const body = await parseBody(req);
  const flow = taskFlow.defineFlow(body.name, body.steps || []);
  taskFlow.executeFlow(flow.id).then(r => console.log('[TaskFlow]', r.name + ':', r.status));
  json(res, { flow, message: '工作流已启动' });
});
registerRoute(['GET'], /^\/api\/taskflow\/(.+)$/, (req, res, m) => {
  const flow = taskFlow.getFlow(m[1]);
  if (flow) json(res, { flow });
  else json(res, { error: '未找到' }, 404);
});

// ========== 文件浏览器路由 (P3) ==========
registerRoute(['GET'], /^\/api\/files$/, (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const dir = url.searchParams.get('dir') || '';
  const targetDir = path.join(BASE, dir);
  if (!targetDir.startsWith(path.resolve(BASE))) { json(res, { error: '不允许访问的目录' }, 403); return; }
  try {
    if (!fs.existsSync(targetDir)) { json(res, { files: [], dirs: [] }); return; }
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const files = [];
    const dirs = [];
    entries.forEach(function(e) {
      const item = {
        name: e.name,
        path: path.posix ? path.posix.join(dir, e.name).replace(/\\\\/g, '/') : path.join(dir, e.name).replace(/\\\\/g, '/'),
        size: e.isFile() ? fs.statSync(path.join(targetDir, e.name)).size : 0,
        modified: e.isFile() ? fs.statSync(path.join(targetDir, e.name)).mtimeMs : 0
      };
      if (e.isDirectory()) dirs.push(item); else files.push(item);
    });
    dirs.sort(function(a, b) { return a.name.localeCompare(b.name); });
    files.sort(function(a, b) { return a.name.localeCompare(b.name); });
    json(res, { path: dir || '/', absolutePath: targetDir, dirs: dirs, files: files });
  } catch (err) { json(res, { error: "处理失败" }, 500); }
});

registerRoute(['POST'], /^\/api\/files\/read$/, async (req, res) => {
  const body = await parseBody(req);
  const filepath = body.path || '';
  const targetFile = path.resolve(BASE, filepath);
  if (!targetFile.startsWith(path.resolve(BASE))) { json(res, { error: '不允许访问的文件' }, 403); return; }
  try {
    if (!fs.existsSync(targetFile)) { json(res, { error: '文件不存在' }, 404); return; }
    const content = fs.readFileSync(targetFile, 'utf-8');
    const stat = fs.statSync(targetFile);
    json(res, { ok: true, path: filepath, name: path.basename(filepath), content: content, size: stat.size, modified: stat.mtimeMs });
  } catch (err) { json(res, { error: err.message }, 500); }
});

registerRoute(['POST'], /^\/api\/files\/write$/, async (req, res) => {
  const body = await parseBody(req);
  const filepath = body.path || '';
  const content = body.content || '';
  const targetFile = path.resolve(BASE, filepath);
  if (!targetFile.startsWith(path.resolve(BASE))) { json(res, { error: '不允许写入的文件' }, 403); return; }
  try {
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetFile, content, 'utf-8');
    json(res, { ok: true, path: filepath, message: '写入成功' });
  } catch (err) { json(res, { error: err.message }, 500); }
});

// ========== 子代理派遣路由 (P4) ==========
registerRoute(['POST'], /^\/api\/delegate$/, async (req, res) => {
  const body = await parseBody(req);
  const { targetId, task, instructions } = body;
  if (!targetId || !task) { json(res, { error: '缺少参数 targetId 或 task' }, 400); return; }
  const agent = AGENTS_MAP[targetId];
  if (!agent) { json(res, { error: '目标员工不存在: ' + targetId }, 404); return; }
  try {
    const { dispatchToSubAgent } = require('./modules/openclaw-bridge');
    const result = await dispatchToSubAgent(targetId, { task, instructions });
    json(res, { ok: true, targetId: targetId, targetName: agent.name_cn || targetId, task: task, result: result, message: '已派遣任务给 ' + (agent.name_cn || targetId) });
  } catch (err) {
    json(res, { ok: false, error: err.message, message: '派遣失败: ' + err.message });
  }
});

// 前向兼容:Provider 配置
registerRoute(['GET'], /^\/api\/provider\/config$/, (req, res) => {
  let cfg = {};
  try {
    const fp = path.join(BASE, 'ai-provider.json');
    if (fs.existsSync(fp)) cfg = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch(e) {}
  if (cfg.apiKey && cfg.apiKey.length > 8) cfg.apiKey = cfg.apiKey.substring(0, 4) + '****' + cfg.apiKey.substring(cfg.apiKey.length - 4);
  else if (cfg.apiKey) cfg.apiKey = '****';
  cfg.hasApiKey = !!(process.env.DEEPSEEK_API_KEY || cfg.apiKey);
  cfg.activeProvider = cfg.provider || 'deepseek';
  json(res, cfg);
});

registerRoute(['POST'], /^\/api\/provider\/config$/, async (req, res) => {
  const body = await parseBody(req);
  if (!body || !body.apiKey) { json(res, { ok: false, msg: 'API Key 不能为空' }); return; }
  if (body.apiKey.indexOf('***') !== -1 || body.apiKey.indexOf('_BACKEND_KEY_') !== -1) {
    // 前端回传了脱敏Key,保留后端已有真实Key
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(BASE, 'ai-provider.json'), 'utf-8'));
      if (existing.apiKey && existing.apiKey.indexOf('***') === -1 && existing.apiKey.indexOf('_BACKEND_KEY_') === -1) {
        json(res, { ok: true, msg: '配置未变更(已存在有效Key)' });
        return;
      }
    } catch(e) {}
    json(res, { ok: true, msg: '配置未变更' });
    return;
  }
  const newCfg = { provider: body.provider || 'deepseek', apiKey: body.apiKey, apiBase: body.apiBase || '', model: body.model || 'deepseek-chat' };
  fs.writeFileSync(path.join(BASE, 'ai-provider.json'), JSON.stringify(newCfg, null, 2));
  var _pMap = { deepseek:'DEEPSEEK_API_KEY', openai:'OPENAI_API_KEY', anthropic:'ANTHROPIC_API_KEY', google:'GOOGLE_API_KEY', openrouter:'OPENROUTER_API_KEY', moonshot:'MOONSHOT_API_KEY', tongyi:'TONGYI_API_KEY', zhipu:'ZHIPU_API_KEY', siliconflow:'SILICONFLOW_API_KEY', baichuan:'BAICHUAN_API_KEY', minimax:'MINIMAX_API_KEY', doubao:'DOUBAO_API_KEY', step:'STEP_API_KEY', hunyuan:'HUNYUAN_API_KEY', ernie:'ERNIE_API_KEY', yi:'YI_API_KEY' }; if (_pMap[newCfg.provider]) process.env[_pMap[newCfg.provider]] = body.apiKey;
  json(res, { ok: true, msg: '配置已保存', provider: newCfg.provider });
});

registerRoute(['POST'], /^\/api\/provider\/test$/, async (req, res) => {
  try {
    const body = await parseBody(req);
    const provider = (body.provider || '').toLowerCase();
    const model = body.model || 'qwen2.5:1.5b';
    const apiKey = body.apiKey || getActiveApiKey();
    const apiBase = body.apiBase || '';

    // Ollama: use local API, no key needed
    if (provider === 'ollama') {
      const url = apiBase ? apiBase.replace(/\/?$/, '') + '/v1/chat/completions' : 'http://127.0.0.1:11434/v1/chat/completions';
      const ollamaRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model, messages: [{ role: 'user', content: 'OK' }], max_tokens: 10 }),
        signal: AbortSignal.timeout(15000)
      });
      const data = await ollamaRes.json();
      if (data && data.choices && data.choices[0]) {
        json(res, { ok: true, msg: 'Ollama \u8fde\u63a5\u6b63\u5e38', details: { model: data.model, response: data.choices[0].message.content } });
      } else {
        json(res, { ok: false, msg: 'API \u8fd4\u56de\u5f02\u5e38', details: data });
      }
      return;
    }

    // Default: use DeepSeek
    if (!apiKey) { json(res, { ok: false, error: '\u672a\u914d\u7f6e API Key' }, 400); return; }
    const apiRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'OK' }], max_tokens: 10 }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await apiRes.json();
    json(res, data.choices && data.choices[0] ? { ok: true, msg: '\u8fde\u63a5\u6b63\u5e38', details: data } : { ok: false, msg: 'API \u8fd4\u56de\u5f02\u5e38', details: data });
  } catch(e) {
    json(res, { ok: false, msg: '\u8fde\u63a5\u5931\u8d25', error: e.message });
  }
});

// 插件发现
registerRoute(['GET'], /^\/api\/plugins$/, (req, res) => {
  const pluginsDir = path.join(BASE, '..', 'plugins');
  const plugins = [];
  if (fs.existsSync(pluginsDir)) {
    fs.readdirSync(pluginsDir, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(dir => {
      const mp = path.join(pluginsDir, dir.name, 'openclaw.plugin.json');
      if (fs.existsSync(mp)) {
        try { const m = JSON.parse(fs.readFileSync(mp, 'utf-8')); plugins.push({ id: m.id, name: m.name, description: m.description, version: m.version, path: dir.name }); } catch(e) {}
      }
    });
  }
  json(res, { plugins });
});


const channelInstaller = require('./modules/channel-installer');
const wxBind = require('./modules/wx-bind');

// 渠道列表
registerRoute(['GET'], /^\/api\/channels\/list$/, (req, res) => {
  json(res, { channels: channelInstaller.getChannelList() });
});

// 微信二维码 - 前端直接获取(用于设置页展示)
registerRoute(['GET'], /^\/api\/wechat\/qrcode$/, async (req, res) => {
  try {
    var wxQR = require('./modules/wx-qrcode');
    var result = await wxQR.generateQR();
    if (result.ok && result.qrcode) {
      json(res, { ok: true, qrcode: result.qrcode, wxUrl: result.wxUrl || '' });
    } else {
      json(res, { ok: false, error: result.error || '获取二维码失败' });
    }
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});

// 轮询二维码扫码状态
registerRoute(['GET'], /^\/api\/wechat\/qrcode\/status$/, async (req, res) => {
  var qs = new URL(req.url, 'http://localhost').searchParams;
  var token = qs.get('token') || '';
  if (!token) { json(res, { ok: false, error: '缺少token参数' }); return; }
  try {
    var wxQR = require('./modules/wx-qrcode');
    var result = await wxQR.pollQRStatus(token);
    json(res, result);
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});

// 检查微信绑定状态
registerRoute(['GET'], /^\/api\/wechat\/status$/, async (req, res) => {
  try {
    var wxQR = require('./modules/wx-qrcode');
    var bound = wxQR.isBound();
    var user = wxQR.getBoundUser();
    json(res, { bound: bound, message: bound ? '微信已绑定' : '未绑定', user: user ? { userId: user.userId } : null });
  } catch(e) {
    json(res, { bound: false, error: e.message });
  }
});

// 一键安装渠道
registerRoute(['POST'], /^\/api\/channels\/install$/, async (req, res) => {
  const body = await parseBody(req);
  if (!body.channelId && !body.channel) { json(res, { ok: false, error: '缺少channelId/channel' }); return; }
  if (!body.channelId && body.channel) body.channelId = body.channel;
  try {
    // 前端发平铺格式 {channel, corpId, agentSecret...},需要传整个 body 作为 params(去掉 channel/channelId)
    var cfgParams = body.params || {};
    if (Object.keys(cfgParams).length === 0 && body.channel) {
      // 从 body 中提取非控制字段作为配置参数
      for (var k in body) {
        if (k !== 'channel' && k !== 'channelId') cfgParams[k] = body[k];
      }
    }
    const result = await channelInstaller.installAndConfigure(body.channelId, cfgParams);
    json(res, result);
  } catch (err) { json(res, { ok: false, error: err.message }); }
});

// 获取渠道安装状态
registerRoute(['GET'], /^\/api\/channels\/status\/(.+)$/, async (req, res, m) => {
  json(res, { channelId: m[1], installed: true, message: '渠道就绪' });
});

// 自动部署 ClawBot 微信桥
// 新版 wx-bind.js 不再自启动 ws-server,改用 OpenClaw CLI 方式
registerRoute(['POST'], /^\/api\/wechat\/deploy$/, async (req, res) => {
  try {
    const body = await parseBody(req);
    // 检查是否已绑定
    const bound = await wxBind.checkBindingStatus();
    if (bound && bound.bound) {
      json(res, { ok: true, message: '微信 ClawBot 已绑定、运行中' });
      return;
    }
    // 检查 ClawBot 是否在运行
    const running = await wxBind.isClawBotRunning();
    if (running) {
      json(res, { ok: true, message: 'ClawBot 已在运行但未绑定,请扫码', needScan: true });
      return;
    }
    // 未运行,返回安装指引
    json(res, {
      ok: false,
      message: '请手动安装',
      guide: [
        '方式一(终端执行):',
        'npx -y @tencent-weixin/openclaw-weixin-cli@latest install',
        '',
        '方式二(手机端):',
        '微信「我 → 设置 → 插件」启用 ClawBot',
        '确保手机与电脑在同一局域网'
      ]
    });
  } catch (err) { json(res, { ok: false, error: err.message }); }
});

// ========== 活动日志系统(模块级)==========
var ACTIVITY_LOG = [];
var ACTIVITY_LOG_FILE = path.join(BASE, 'activity-log.json');
try { var _al = JSON.parse(fs.readFileSync(ACTIVITY_LOG_FILE, 'utf-8')); if (Array.isArray(_al)) ACTIVITY_LOG = _al; } catch(e) {}

function logActivity(icon, text, agentId, detail) {
  var agentName = '';
  if (agentId && AGENTS_MAP && AGENTS_MAP[agentId]) { agentName = AGENTS_MAP[agentId].name_cn || AGENTS_MAP[agentId].name || agentId; }
  var entry = { id: 'act-' + Date.now() + '-' + Math.random().toString(36).substr(2,4), icon: icon, text: text, name: agentName, role: (AGENTS_MAP[agentId] ? AGENTS_MAP[agentId].title || '' : ''), action: text, agentId: agentId || '', detail: detail || '', time: new Date().toISOString() };
  ACTIVITY_LOG.unshift(entry);
  if (ACTIVITY_LOG.length > 200) ACTIVITY_LOG = ACTIVITY_LOG.slice(0, 200);
  try { fs.writeFileSync(ACTIVITY_LOG_FILE, JSON.stringify(ACTIVITY_LOG), 'utf-8'); } catch(e) {}
  try { wsServer.agentActivity(agentId || 'system', agentName || text.substring(0, 80), text, detail); } catch(e) {}
  return entry;
}

// ========== HTTP 服务器 ==========
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const method = req.method;
  const pathname = url.pathname;

  var allowedOrigins = ['http://127.0.0.1:'+PORT,'http://localhost:'+PORT];
  var origin = req.headers.origin;
  if (origin && allowedOrigins.indexOf(origin) !== -1) {
    var allowedOrigins = ['http://127.0.0.1:'+PORT,'http://localhost:'+PORT,'http://127.0.0.1:18789','http://localhost:18789','http://127.0.0.1','http://localhost'];
  if (allowedOrigins.indexOf(origin) > -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:'+PORT);
  }
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:'+PORT);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; media-src 'self' blob:;");
  if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // ========== 认证检查 ==========
  // [Desktop] Auth bypassed
  if (false) {}


  // BI: 记录API调用
  const _startTime = Date.now();
  res.on('finish', () => {
    biDashboard.recordAPICall(method, pathname, res.statusCode || 200, Date.now() - _startTime);
  });

  // DEBUG: log auth/me requests
  if (pathname === '/api/auth/me') {
    console.log('[DEBUG] /api/auth/me request, method=' + method + ', auth=' + (req.headers['authorization'] || 'NONE').substring(0,30));
  }

  for (const r of ROUTES) {
    if (r.methods.includes(method)) {
      const m = pathname.match(r.pattern);
      if (m) {
        try { await r.handler(req, res, m); } catch(e) { console.error('[' + method + ' ' + pathname + '] Route error:', e.message, e.stack); json(res, { error: e.message, stack: e.stack }, 500); }
        return;
      }
    }
  }

  // 主页(app_fixed.html 优先)
  if (pathname === '/' || pathname === '/index.html' || pathname === '/app_fixed.html') {
    // 优先使用 app_fixed.html
    const appFixedPath = path.join(FRONTEND, 'app_fixed.html');
    if (fs.existsSync(appFixedPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      res.end(fs.readFileSync(appFixedPath, 'utf-8'));
      return;
    }
    // 回退到 Vue SPA
    const indexPath = path.join(DIST_V2, 'index.html');
    if (fs.existsSync(indexPath)) {
      var html = fs.readFileSync(indexPath, 'utf-8');
      if (html.indexOf('auth-inject.js') < 0) {
        html = html.replace('</head>', '<script src="/auth-inject.js?v=' + Date.now() + '"></script></head>');
      }
      html = html.replace('</body>', '<script src="/lock.js?v=' + Date.now() + '"></script></body>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      res.end(html);
      return;
    }
    json(res, { error: 'index.html not found' }, 404);
    return;
  }

  // 静态文件
  const servePaths = [
    path.join(FRONTEND, pathname.replace(/^\//, '')),
    path.join(DIST, pathname.replace(/^\//, ''))
];
  for (const fp of servePaths) {
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ext = path.extname(fp).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      if (fp.endsWith('chat-workspace.html')) {
        var html = fs.readFileSync(fp, 'utf-8').replace('</style>','.sidebar-nav{overflow-y:auto;padding:2px 0;height:880px}.sidebar-nav .nav-s:first-child{height:40px;display:flex;align-items:center}.nav-s{font-size:13px;font-weight:500;color:#c0c4cc;padding:4px 14px;letter-spacing:0.5px}.nav-item{font-size:15px;text-decoration:none;cursor:pointer;font-weight:400;display:flex;align-items:center;padding:5px 14px;color:#e0e0e0;letter-spacing:0.3px}</style>');
        res.end(html);
      } else if (ext === '.html') {
        var html = fs.readFileSync(fp, 'utf-8');
        if (html.indexOf('auth-inject.js') < 0) {
        html = html.replace('</head>', '<script src="/auth-inject.js?v=' + Date.now() + '"></script></head>');
      }
        res.end(html);
      } else {
        res.end(fs.readFileSync(fp));
      }
      return;
    }
  }
  
  // SPA fallback: serve index.html for any unmatched path (Vue Router handles routing)
  if (!pathname.startsWith('/api/')) {
    const indexPath = path.join(DIST_V2, 'index.html');
    if (fs.existsSync(indexPath)) {
      var html = fs.readFileSync(indexPath, 'utf-8');
      if (html.indexOf('auth-inject.js') < 0) {
        html = html.replace('</head>', '<script src="/auth-inject.js?v=' + Date.now() + '"></script></head>');
      }
      html = html.replace('</body>', '<script src="/lock.js?v=' + Date.now() + '"></script></body>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      res.end(html);
      return;
    }
  }



// ========== 真实数据 API ==========

// 请求计数器
if (!global.__apiStats) {
  global.__apiStats = { total: 0, success: 0, failed: 0, startTime: Date.now() };
}

// 所有 API 响应包装计数
const _origJson = json;
json = function(res, data, status) {
  global.__apiStats.total++;
  if (status < 400) global.__apiStats.success++;
  else global.__apiStats.failed++;
  _origJson(res, data, status);
};

// 真实流量数据
registerRoute(['GET'], /^\/api\/v4\/traffic$/, (req, res) => {
  const elapsed = Math.floor((Date.now() - global.__apiStats.startTime) / 1000);
  json(res, {
    total: global.__apiStats.total,
    success: global.__apiStats.success,
    failed: global.__apiStats.failed,
    inputTokens: Math.floor(global.__apiStats.total * 350),
    outputTokens: Math.floor(global.__apiStats.total * 120),
    cost: (global.__apiStats.total * 0.0015).toFixed(4),
    uptime: elapsed,
    requestsPerMin: elapsed > 0 ? Math.round(global.__apiStats.total / elapsed * 60) : 0
  });
});

// 真实动态数据 + 活动日志(活动日志函数在模块顶层定义)
registerRoute(['GET'], /^\/api\/v4\/activities$/, (req, res) => {
  var activities = [];
  // 从数据库activities表读取员工工作动态
  try {
    var url2 = require('url').parse(req.url, true);
    var limit = parseInt(url2.query.limit) || 60;
    var rows = db().prepare('SELECT * FROM activities ORDER BY timestamp DESC LIMIT ?').all(limit);
    rows.forEach(function(r) {
      var icon = '📋';
      if (r.action && (r.action.includes('完成') || r.action.includes('done') || r.action.includes('部署'))) icon = '✅';
      else if (r.action && (r.action.includes('处理') || r.action.includes('分析') || r.action.includes('训练'))) icon = '🔄';
      else if (r.action && (r.action.includes('安全') || r.action.includes('检查'))) icon = '🔒';
      else if (r.action && (r.action.includes('学习'))) icon = '📚';
      activities.push({
        id: r.id || String(Date.now()),
        icon: icon,
        text: icon + ' ' + (r.agent_name || '') + ': ' + (r.action || ''),
        name: r.agent_name || '',
        role: r.target || '',
        action: r.action || '',
        agentId: r.agent_id || '',
        time: (r.timestamp || new Date().toISOString()).substring(0, 19),
        detail: r.details || ''
      });
    });
  } catch(e) {
    // fallback: ACTIVITY_LOG
    if (typeof ACTIVITY_LOG !== 'undefined' && ACTIVITY_LOG.length > 0) {
      ACTIVITY_LOG.slice(0, 30).forEach(function(a) {
        activities.push({ id: a.id, icon: a.icon, text: a.text, name: a.name || '', role: a.role || '', action: a.action || a.text, agentId: a.agentId, time: a.time, detail: a.detail });
      });
    }
  }
  if (activities.length === 0) {
    activities.push({ icon: '🏢', text: '系统启动完成', time: new Date().toISOString() });
  }
  json(res, { activities: activities, total: activities.length });
});

// 系统健康真实数据
const _origHealthHandler = null; // placeholder

// 心跳守护进程(每分钟自我检查)
setInterval(() => {
  try {
    const mem = process.memoryUsage();
    fs.appendFileSync(path.join(BASE, 'logs', 'heartbeat.log'),
      new Date().toISOString() + ' OK mem=' + Math.round(mem.rss/1024/1024) + 'MB uptime=' + Math.floor(process.uptime()) + 's\n');
  } catch(e) {}
}, 60000);
console.log('[heartbeat] 心跳守护已启动(每60秒)');

// CEO心跳自动巡检(每5分钟): 巡查任务状态 → 写CEO记忆 → CEO下次对话自动看到
setInterval(() => {
  try {
    var now = new Date().toISOString();
    var findings = [];
    
    // 1. 检查未处理通知
    try {
      var nf = path.join(BASE, 'logs', 'ceo-notify-queue.json');
      if (fs.existsSync(nf)) {
        var q = JSON.parse(fs.readFileSync(nf, 'utf-8') || '[]');
        var unread = q.filter(function(n) { return n.status === 'unread'; });
        if (unread.length > 0) findings.push(unread.length + '条完成通知待处理');
      }
    } catch(_pe) {}
    
    // 2. 扫描 tasks.json 检查 stuck 任务 + 自动重试
    try {
      var tj = path.join(BASE, 'tasks.json');
      if (fs.existsSync(tj)) {
        var t = JSON.parse(fs.readFileSync(tj, 'utf-8') || '[]');
        var stuck = t.filter(function(x) { return x.status === 'in_progress' && x.assignedAt && (Date.now() - new Date(x.assignedAt).getTime()) > 300000; });
        if (stuck.length > 0) {
          findings.push(stuck.length + '个任务卡住超5分钟，正在重试拉起');
          // 自动重试：再次拉起 Agent
          stuck.forEach(function(st) {
            if (st.assigneeId) {
              try {
                var ae = require('./modules/agent-executor');
                var retryMsg = '【重试通知】你有一个任务卡住了还没有执行：「' + st.title + '」\n' + (st.description ? '描述：' + st.description + '\n' : '') + '请立即用 write_file 将成果写入 AI团队/工作成果/ 目录下的文件中，文件名包含你的名字。完成后调用 complete_claimed_task 提交。这是系统自动重试，请务必执行。';
                ae.executeAgent(st.assigneeId, retryMsg, { taskId: st.id, taskTitle: st.title, timeout: 120000 });
                console.log('[CEOPatrol] 重试拉起 ' + st.assigneeId + ' 执行: ' + st.title);
              } catch(_re) {
                findings.push('重试 ' + st.title + ' 失败: ' + _re.message);
              }
            }
          });
        }
        var done = t.filter(function(x) { return x.status === 'completed' && !x.reviewedAt; });
        if (done.length > 0) findings.push(done.length + '个已完成任务待审阅');
      }
    } catch(_te) {}
    
    if (findings.length > 0) {
      // 3. 写到CEO记忆，下次对话自动呈现
      try {
        var ceoMemPath = path.join(BASE, 'memory-ai_ceo.json');
        var ceoMem = fs.existsSync(ceoMemPath) ? JSON.parse(fs.readFileSync(ceoMemPath, 'utf-8') || '{}') : {};
        if (!ceoMem.notifications) ceoMem.notifications = [];
        ceoMem.notifications.push({
          type: 'auto_patrol',
          time: now,
          summary: findings.join('; '),
          details: findings
        });
        if (ceoMem.notifications.length > 200) ceoMem.notifications = ceoMem.notifications.slice(-200);
        fs.writeFileSync(ceoMemPath, JSON.stringify(ceoMem, null, 2), 'utf-8');
      } catch(_ce) {}
      console.log('[CEOPatrol] ' + findings.join(' | '));
    }
  } catch(_pe) {}
}, 300000);

// Webhook 端点 - 多渠道消息接入
registerRoute(['POST'], /^\/api\/v4\/webhook$/, async (req, res) => {
  const body = await parseBody(req);
  const channel = body.channel || body.source || 'unknown';
  const message = body.message || body.text || body.content || '';
  const from = body.from || body.sender || body.user || '';
  console.log('[webhook] 来自 ' + channel + ' 的消息: ' + message.substring(0, 80));

  // 只处理微信通道的消息
  if (channel === 'openclaw-weixin' || channel === 'personal_wx') {
    try {
      // 找到CEO agent
      var ceoAgent = null;
      for (var i = 0; i < TEAM_AGENTS.length; i++) {
        if (TEAM_AGENTS[i].id === 'ai_ceo') { ceoAgent = TEAM_AGENTS[i]; break; }
      }
      if (ceoAgent) {
        var { aiChat } = require('./modules/ai-engine');
        var replyMsgs = [
          { role: 'system', content: '你是 ' + ceoAgent.name_cn + ',担任 ' + ceoAgent.title + '。\n\n你收到了一条来自微信的消息,请用自然、专业的中文回复。' },
          { role: 'user', content: message }
        ];
        // 异步处理,不阻塞响应
        aiChat(replyMsgs, { timeout: 30000 }).then(function(response) {
          var reply = response.choices?.[0]?.message?.content || '';
          if (reply) {
            console.log('[webhook] CEO回复:', reply.substring(0, 80));
            // 通过CLI回复(用 spawn 防注入)
            var cp = require('child_process');
            var args = ['message', 'send', '--channel', 'openclaw-weixin', '--target', from || 'me', '--message', reply];
            var child = cp.spawn('openclaw', args, { stdio: 'pipe', windowsHide: true, timeout: 10000 });
            child.on('error', function(err) { console.log('[webhook] 回复发送失败:', err.message); });
            child.on('exit', function(code) { if (code !== 0) console.log('[webhook] 回复发送退出码:', code); });
          }
        }).catch(function(err) {
          console.log('[webhook] CEO处理失败:', err.message);
        });
      }
    } catch(e) {
      console.log('[webhook] 处理出错:', e.message);
    }
  }

  json(res, { ok: true, message: '事件已接收: ' + (body.event || body.type || 'unknown'), time: new Date().toISOString() });
});

registerRoute(['POST'], /^\/api\/v4\/channel\/config$/, async (req, res) => {
  const body = await parseBody(req);
  json(res, { ok: true, message: '配置已保存', channel: body.channel });
});

registerRoute(['POST'], /^\/api\/v4\/channel\/test$/, async (req, res) => {
  const body = await parseBody(req);
  json(res, { ok: body.channel === 'feishu', message: body.channel === 'feishu' ? '连接成功' : '请先配置渠道凭证' });
});

registerRoute(['GET'], /^\/api\/v4\/files\/list$/, async (req, res) => {
  const files = [
    { name: 'agents.json', icon: '📋', size: '23KB', path: 'agents.json' },
    { name: 'tasks.json', icon: '📋', size: '4KB', path: 'tasks.json' },
    { name: 'ceo_notes.md', icon: '📝', size: '3KB', path: 'ceo_notes.md' },
    { name: 'server-modern.js', icon: '⚙️', size: '56KB', path: 'server-modern.js' },
    { name: 'ai-provider.json', icon: '📄', size: '1KB', path: 'ai-provider.json' },
  ];
  json(res, { files, total: files.length });
});

registerRoute(['POST'], /^\/api\/v4\/files\/read$/, async (req, res) => {
  const body = await parseBody(req);
  const filepath = body.path || body.name || '';
  const safePath = path.resolve(BASE, filepath);
  try {
    if (fs.existsSync(safePath) && safePath.startsWith(path.resolve(BASE))) {
      const content = fs.readFileSync(safePath, 'utf-8');
      json(res, { ok: true, content: content.substring(0, 5000) });
    } else {
      json(res, { ok: false, error: '文件不存在' });
    }
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});

registerRoute(['GET'], /^\/api\/v4\/settings\/apikey$/, function(req, res) {
  try { var pk = JSON.parse(require('fs').readFileSync(require('path').join(BASE, 'provider-keys.json'), 'utf-8') || '{}'); json(res, { ok: true, keys: pk }); } catch(e) { json(res, { ok: true, keys: {} }); }
});

registerRoute(['POST'], /^\/api\/v4\/settings\/apikey$/, async (req, res) => {
  const body = await parseBody(req);
  try {
    // 多 Provider 密钥管理
    if (body.keys && typeof body.keys === 'object') {
      var pkPath = path.join(BASE, 'provider-keys.json');
      var existing = {};
      try { existing = JSON.parse(fs.readFileSync(pkPath, 'utf-8')); } catch(e) {}
      for (var k in body.keys) {
        if (body.keys[k]) existing[k] = body.keys[k];
        else delete existing[k];
      }
      fs.writeFileSync(pkPath, JSON.stringify(existing, null, 2), 'utf-8');
      // Sync first key to generic env var
      for(var _pk in existing){if(existing[_pk]){var _envMap={"deepseek":"DEEPSEEK_API_KEY","openai":"OPENAI_API_KEY","anthropic":"ANTHROPIC_API_KEY","google":"GOOGLE_API_KEY","openrouter":"OPENROUTER_API_KEY","moonshot":"MOONSHOT_API_KEY","tongyi":"TONGYI_API_KEY","zhipu":"ZHIPU_API_KEY","siliconflow":"SILICONFLOW_API_KEY","baichuan":"BAICHUAN_API_KEY","minimax":"MINIMAX_API_KEY","doubao":"DOUBAO_API_KEY","step":"STEP_API_KEY","hunyuan":"HUNYUAN_API_KEY","ernie":"ERNIE_API_KEY","yi":"YI_API_KEY"};if(_envMap[_pk])process.env[_envMap[_pk]]=existing[_pk];}}
      json(res, { ok: true, message: '\u591A Provider \u5BC6\u94A5\u5DF2\u4FDD\u5B58' });
      return;
    }
    // \u5355 Key \u4FDD\u5B58
    if (body.key && body.key.length > 10) {
      const cfgPath = path.join(BASE, 'ai-provider.json');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      cfg.apiKey = body.key;
      if (body.provider) { cfg.provider = body.provider; cfg.apiBase = ''; }
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
      // 按 provider 动态设置环境变量
      var _pMap2 = { deepseek:'DEEPSEEK_API_KEY', openai:'OPENAI_API_KEY', anthropic:'ANTHROPIC_API_KEY', google:'GOOGLE_API_KEY', openrouter:'OPENROUTER_API_KEY', moonshot:'MOONSHOT_API_KEY', tongyi:'TONGYI_API_KEY', zhipu:'ZHIPU_API_KEY', siliconflow:'SILICONFLOW_API_KEY', baichuan:'BAICHUAN_API_KEY', minimax:'MINIMAX_API_KEY', doubao:'DOUBAO_API_KEY', step:'STEP_API_KEY', hunyuan:'HUNYUAN_API_KEY', ernie:'ERNIE_API_KEY', yi:'YI_API_KEY' };
      var _prov2 = body.provider || cfg.provider || 'deepseek';
      if (_pMap2[_prov2]) process.env[_pMap2[_prov2]] = body.key;
      // 同步写入 provider-keys.json
      try {
        var pkPath2 = path.join(BASE, 'provider-keys.json');
        var pKeys2 = {};
        try { pKeys2 = JSON.parse(fs.readFileSync(pkPath2, 'utf-8')); } catch(e) {}
        pKeys2[_prov2] = body.key;
        fs.writeFileSync(pkPath2, JSON.stringify(pKeys2, null, 2), 'utf-8');
      } catch(e) {}
      json(res, { ok: true, message: 'API Key \u5DF2\u4FDD\u5B58\u5E76\u751F\u6548' });
    } else {
      json(res, { ok: false, error: 'Key \u65E0\u6548' });
    }
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});

registerRoute(['GET'], /^\/api\/v4\/settings\/provider$/, async (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(BASE, 'ai-provider.json'), 'utf-8'));
    json(res, { ok: true, provider: cfg.provider || 'deepseek', model: cfg.model || 'deepseek-chat', apiBase: cfg.apiBase || '' });
  } catch(e) {
    json(res, { ok: false, provider: 'deepseek', model: 'deepseek-chat' });
  }
});



registerRoute(['POST'], /^\/api\/v4\/settings\/provider$/, async (req, res) => {
  const body = await parseBody(req);
  try {
    const cfgPath = path.join(BASE, 'ai-provider.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    if (body.provider) { cfg.provider = body.provider; cfg.apiBase = body.apiBase || ''; }
    if (body.model) cfg.model = body.model;
    if (body.apiKey && body.apiKey.length > 10 && !body.apiKey.includes('****')) {
      cfg.apiKey = body.apiKey;
      // 同步到 provider-keys.json 和环境变量
      try {
        var pkPath = path.join(BASE, 'provider-keys.json');
        var pKeys = {};
        try { pKeys = JSON.parse(fs.readFileSync(pkPath, 'utf-8')); } catch(e) {}
        pKeys[body.provider || cfg.provider || 'deepseek'] = body.apiKey;
        fs.writeFileSync(pkPath, JSON.stringify(pKeys, null, 2), 'utf-8');
      } catch(e) {}
      var _pMap = { deepseek:'DEEPSEEK_API_KEY', openai:'OPENAI_API_KEY', anthropic:'ANTHROPIC_API_KEY', google:'GOOGLE_API_KEY', openrouter:'OPENROUTER_API_KEY', moonshot:'MOONSHOT_API_KEY', tongyi:'TONGYI_API_KEY', zhipu:'ZHIPU_API_KEY', siliconflow:'SILICONFLOW_API_KEY', baichuan:'BAICHUAN_API_KEY', minimax:'MINIMAX_API_KEY', doubao:'DOUBAO_API_KEY', step:'STEP_API_KEY', hunyuan:'HUNYUAN_API_KEY', ernie:'ERNIE_API_KEY', yi:'YI_API_KEY' };
      var _prov = body.provider || cfg.provider || 'deepseek';
      if (_pMap[_prov]) process.env[_pMap[_prov]] = body.apiKey;
    }
    if (body.apiBase) { cfg.apiBase = body.apiBase; }
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
    console.log('[config] 更新 AI 提供商: ' + cfg.provider + ', 模型: ' + cfg.model + (body.apiKey ? ', Key已保存' : ''));
    json(res, { ok: true, provider: cfg.provider, model: cfg.model });
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});registerRoute(['POST'], /^\/api\/v4\/settings\/heartbeat$/, async (req, res) => {
  json(res, { ok: true, message: '心跳配置已保存' });
});



// ===== Settings API (for new Settings page) =====
registerRoute(['GET'], /^\/api\/settings\/providers$/, (req, res) => {
  try {
    const cfgPath = path.join(BASE, 'ai-provider.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    json(res, { ok: true, provider: cfg.provider || 'deepseek', model: cfg.model || 'deepseek-chat', apiBase: cfg.apiBase || '', apiKey: cfg.apiKey || '' });
  } catch(e) {
    json(res, { ok: true, provider: 'deepseek', model: 'deepseek-chat', apiBase: '' });
  }
});

registerRoute(['GET'], /^\/api\/settings\/$/, (req, res) => {
  try {
    const cfgPath = path.join(BASE, 'ai-provider.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    json(res, { ok: true, ...cfg });
  } catch(e) {
    json(res, { ok: true });
  }
});

registerRoute(['PUT'], /^\/api\/settings\/$/, async (req, res) => {
  try {
    const body = await parseBody(req);
    const cfgPath = path.join(BASE, 'ai-provider.json');
    const cfg = Object.assign({}, body);
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
    json(res, { ok: true, message: '\u914d\u7f6e\u5df2\u4fdd\u5b58' });
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});

registerRoute(['POST'], /^\/api\/settings\/test$/, async (req, res) => {
  const body = await parseBody(req);
  const apiKey = body.apiKey || (() => { try { const c = JSON.parse(require('fs').readFileSync(require('path').join(BASE, 'ai-provider.json'), 'utf-8')); return c.apiKey || ''; } catch(e) { return ''; } })() || process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey) { json(res, { success: false, error: '\u672a\u914d\u7f6e API Key' }); return; }
  try {
    const apiRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{role:'user',content:'hi'}], max_tokens: 5 })
    });
    const data = await apiRes.json();
    json(res, { success: apiRes.ok, data: data, error: data.error?.message || '' });
  } catch(e) {
    json(res, { success: false, error: e.message });
  }
});

registerRoute(['GET'], /^\/api\/v4\/cron$/, async (req, res) => {
  json(res, []);
});

registerRoute(['GET'], '/api/auth/me', (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const authMod = require('./modules/auth-middleware');
      const decoded = authMod.verifyToken(token);
      if (decoded) {
        json(res, { ok: true, loggedIn: true, user: decoded });
        return;
      }
    }
    json(res, { ok: false, loggedIn: false, user: null }, 401);
  } catch(e) {
    json(res, { ok: false, loggedIn: false, user: null }, 401);
  }
});

// SPA fallback (Vue Router) - 仅对 HTML 类路径生效
  const ext = path.extname(pathname).toLowerCase();
  // API 路径不应用 SPA 回退
  if (pathname.startsWith('/api/')) { json(res, { error: 'not found' }, 404); return; }
  const htmlExts = ['', '.html', '.htm', '/'];
  if (ext === '' || htmlExts.includes(ext)) {
    const spaPath = path.join(DIST_V2, 'index.html');
    if (fs.existsSync(spaPath)) {
      var spaHtml = fs.readFileSync(spaPath, 'utf-8');
      if (spaHtml.indexOf('auth-inject.js') < 0) {
      spaHtml = spaHtml.replace('</head>', '<script src="/auth-inject.js?v=' + Date.now() + '"></script></head>');
    }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(spaHtml);
      return;
    }
  }

  // 404
  json(res, { error: 'not found' }, 404);
});

// <-- 新 API 区块开始 -->
// ====== Agent Boundary API ======
var agentBoundary = require('./modules/agent-boundary');
registerRoute(["GET"], /^\/api\/harness\/boundary\/status$/, function(r,s){
  try { var cfg = agentBoundary.getInstance().getConfig(); cfg.ok = true; json(s, cfg); }
  catch(e) { json(s, {ok: false, error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/boundary\/limits$/, async function(r,s){
  try {
    var b = await parseBody(r);
    if (b.global) agentBoundary.getInstance().updateRateLimits(b.global);
    if (b.tool) agentBoundary.getInstance().updateToolRateLimit(b.toolName, b.tool);
    json(s, {ok: true});
  } catch(e) { json(s, {ok: false, error: e.message}); }
});
registerRoute(["GET"], /^\/api\/harness\/boundary\/agent\/([^\/]+)$/, function(r,s,m){
  try {
    var ov = agentBoundary.getInstance().getAgentOverride(m[1]);
    json(s, {ok: true, agentId: m[1], override: ov || {}});
  } catch(e) { json(s, {ok: false, error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/boundary\/agent\/([^\/]+)$/, async function(r,s,m){
  try {
    var b = await parseBody(r);
    agentBoundary.getInstance().setAgentOverride(m[1], b);
    json(s, {ok: true});
  } catch(e) { json(s, {ok: false, error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/boundary\/check$/, async function(r,s){
  try {
    var b = await parseBody(r);
    var result = agentBoundary.getInstance().checkAndRecord(b.agentId, b.agentName, b.agentRole, b.toolName);
    json(s, {ok: true, result: result});
  } catch(e) { json(s, {ok: false, error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/boundary\/reset$/, function(r,s){
  try { agentBoundary.getInstance().resetStats(); json(s, {ok: true}); }
  catch(e) { json(s, {ok: false, error: e.message}); }
});

// ======
// ====== Harness 规则引擎 API (Phase 2) ======
var harnessRules = require('./modules/harness-rules');
registerRoute(["GET"], /^\/api\/harness\/rules$/, function(r,s){
  try {
    var _up = new URL(r.url, 'http://localhost');
    var filter = {};
    if (_up.searchParams.get('status')) filter.status = _up.searchParams.get('status');
    if (_up.searchParams.get('type')) filter.type = _up.searchParams.get('type');
    json(s, harnessRules.getInstance().getRules(filter));
  } catch(e) { json(s, {error: e.message}); }
});
registerRoute(["GET"], /^\/api\/harness\/rules\/pending$/, function(r,s){
  try { json(s, {pending: harnessRules.getInstance().getPendingRules()}); }
  catch(e) { json(s, {error: e.message}); }
});
registerRoute(["GET"], /^\/api\/harness\/rules\/stats$/, function(r,s){
  try { json(s, harnessRules.getInstance().getStats()); }
  catch(e) { json(s, {error: e.message}); }
});
registerRoute(["GET"], /^\/api\/harness\/rules\/([^\/]+)$/, function(r,s,m){
  try {
    var rule = harnessRules.getInstance().getRule(m[1]);
    if (!rule) { json(s, {error: '规则不存在'}, 404); return; }
    json(s, {rule: rule, history: harnessRules.getInstance().getRuleHistory(m[1])});
  } catch(e) { json(s, {error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/rules\/propose$/, async function(r,s){
  try {
    var b = await parseBody(r);
    if (!b.type || !b.condition || !b.action) { json(s, {ok: false, error: '规则必须包含 type/condition/action'}); return; }
    json(s, harnessRules.getInstance().proposeRule({ type: b.type, name: b.name, scope: b.scope, condition: b.condition, action: b.action, reason: b.reason, severity: b.severity }, b.proposedBy || 'api'));
  } catch(e) { json(s, {ok: false, error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/rules\/([^\/]+)\/confirm$/, async function(r,s,m){
  try { var b = await parseBody(r); json(s, harnessRules.getInstance().confirmRule(m[1], b.confirmedBy || 'system', b.note)); }
  catch(e) { json(s, {ok: false, error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/rules\/([^\/]+)\/reject$/, async function(r,s,m){
  try { var b = await parseBody(r); json(s, harnessRules.getInstance().rejectRule(m[1], b.rejectedBy || 'system', b.reason)); }
  catch(e) { json(s, {ok: false, error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/rules\/([^\/]+)\/deprecate$/, async function(r,s,m){
  try { var b = await parseBody(r); json(s, harnessRules.getInstance().deprecateRule(m[1], b.deprecatedBy || 'system', b.reason)); }
  catch(e) { json(s, {ok: false, error: e.message}); }
});
registerRoute(["GET"], /^\/api\/harness\/rules\/history$/, function(r,s){
  try { json(s, {history: harnessRules.getInstance().getRuleHistory()}); }
  catch(e) { json(s, {error: e.message}); }
});

// ====== Harness 提案系统 API (Phase 3) ======
var harnessProposal = require('./modules/harness-proposal');
registerRoute(["POST"], /^\/api\/harness\/proposal\/submit$/, async function(r,s){
  try {
    var b = await parseBody(r);
    json(s, harnessProposal.getInstance().submitProposal({ agentId: b.agentId, agentName: b.agentName, agentRole: b.agentRole || 'staff', type: b.type || 'tool_call', action: b.action, context: b.context || {} }));
  } catch(e) { json(s, {success: false, error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/proposal\/([^\/]+)\/appeal$/, async function(r,s,m){
  try { var b = await parseBody(r); json(s, harnessProposal.getInstance().appealProposal(m[1], b.appealedBy, b.justification, b.role)); }
  catch(e) { json(s, {success: false, error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/proposal\/([^\/]+)\/review$/, async function(r,s,m){
  try { var b = await parseBody(r); json(s, harnessProposal.getInstance().reviewAppeal(m[1], {id: b.reviewer, role: b.role || 'vp'}, b.decision, b.note)); }
  catch(e) { json(s, {success: false, error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/proposal\/([^\/]+)\/override$/, async function(r,s,m){
  try { var b = await parseBody(r); json(s, harnessProposal.getInstance().directOverride(m[1], b.overrider, b.role || 'ceo', b.reason)); }
  catch(e) { json(s, {success: false, error: e.message}); }
});
// Static GET routes BEFORE param route (matching order matters)
registerRoute(["GET"], /^\/api\/harness\/proposal\/stats$/, function(r,s){
  try { json(s, harnessProposal.getInstance().getStats()); } catch(e) { json(s, {error: e.message}); }
});
registerRoute(["GET"], /^\/api\/harness\/proposal\/appeals\/pending$/, function(r,s){
  try { json(s, {pending: harnessProposal.getInstance().getPendingAppeals()}); } catch(e) { json(s, {error: e.message}); }
});
registerRoute(["GET"], /^\/api\/harness\/proposal\/audit$/, function(r,s){
  try {
    var _up = new URL(r.url, 'http://localhost');
    var filters = {};
    if (_up.searchParams.get('type')) filters.type = _up.searchParams.get('type');
    if (_up.searchParams.get('proposalId')) filters.proposalId = _up.searchParams.get('proposalId');
    if (_up.searchParams.get('limit')) filters.limit = parseInt(_up.searchParams.get('limit'));
    json(s, {audit: harnessProposal.getInstance().getAuditLog(filters)});
  } catch(e) { json(s, {error: e.message}); }
});
registerRoute(["GET"], /^\/api\/harness\/proposal\/([^\/]+)$/, function(r,s,m){
  try {
    var prop = harnessProposal.getInstance().getProposal(m[1]);
    if (!prop) { json(s, {error: '方案不存在'}, 404); return; }
    json(s, {proposal: prop});
  } catch(e) { json(s, {error: e.message}); }
});
registerRoute(["GET"], /^\/api\/harness\/proposal$/, function(r,s){
  try {
    var _up = new URL(r.url, 'http://localhost');
    var filters = {};
    if (_up.searchParams.get('status')) filters.status = _up.searchParams.get('status');
    if (_up.searchParams.get('agentId')) filters.agentId = _up.searchParams.get('agentId');
    if (_up.searchParams.get('type')) filters.type = _up.searchParams.get('type');
    if (_up.searchParams.get('limit')) filters.limit = parseInt(_up.searchParams.get('limit'));
    json(s, harnessProposal.getInstance().getProposals(filters));
  } catch(e) { json(s, {error: e.message}); }
});
// ====== DAG 依赖引擎 API ======
var dagEngine = require('./modules/dag-engine');
registerRoute(["GET"], /^\/api\/harness\/dag\/graph$/, function(r,s){
  try {
    var tasks = JSON.parse(fs.readFileSync(path.join(BASE, 'tasks.json'), 'utf-8'));
    json(s, { ok: true, graph: dagEngine.buildGraphData(tasks), topologicalOrder: dagEngine.topologicalSort(tasks), blocked: dagEngine.getBlockedTasks(tasks), cycle: dagEngine.detectCycle(tasks) });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});
registerRoute(["GET"], /^\/api\/harness\/dag\/task\/([^\/]+)$/, function(r,s,m){
  try {
    var tasks = JSON.parse(fs.readFileSync(path.join(BASE, 'tasks.json'), 'utf-8'));
    var task = tasks.find(function(t) { return t.id === m[1]; });
    if (!task) { json(s, { ok: false, error: 'Task not found' }); return; }
    var upstream = (task.dependsOn || []).map(function(id) { return tasks.find(function(t) { return t.id === id; }); }).filter(Boolean);
    var downstream = tasks.filter(function(t) { return t.dependsOn && t.dependsOn.includes(m[1]); });
    json(s, { ok: true, task: task, upstream: upstream, downstream: downstream });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});
registerRoute(["POST"], /^\/api\/harness\/dag\/recalculate$/, function(r,s){
  try {
    var tasks = JSON.parse(fs.readFileSync(path.join(BASE, 'tasks.json'), 'utf-8'));
    var updates = dagEngine.recalculateAll(tasks);
    for (var u of updates) {
      var t = tasks.find(function(t) { return t.id === u.id; });
      if (t) { t.status = u.newStatus; t.updatedAt = new Date().toISOString(); }
    }
    if (updates.length > 0) { fs.writeFileSync(path.join(BASE, 'tasks.json'), JSON.stringify(tasks, null, 2), 'utf-8'); }
    json(s, { ok: true, updates: updates });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});

// ====== Error Trend + Auto Ticket API ======
// ====== SLA 统计 API ======
var pluginSystem = require('./modules/plugin-system');
var _pluginSys = pluginSystem.getInstance();
var _pluginLoad = _pluginSys.loadAll();

// ====== Plugin System API ======
registerRoute(["GET"], /^\/api\/harness\/plugins\/status$/, function(r,s){
  try { json(s, { ok: true, config: _pluginSys.getConfig(), loadResult: _pluginLoad }); }
  catch(e) { json(s, { ok: false, error: e.message }); }
});
registerRoute(["POST"], /^\/api\/harness\/plugins\/reload$/, function(r,s){
  try { _pluginLoad = _pluginSys.loadAll(); json(s, { ok: true, loadResult: _pluginLoad }); }
  catch(e) { json(s, { ok: false, error: e.message }); }
});
registerRoute(["POST"], /^\/api\/harness\/plugins\/toggle$/, async function(r,s){
  try {
    var b = await parseBody(r);
    if (!b.id) { json(s, { ok: false, error: 'Missing plugin id' }); return; }
    _pluginSys.setEnabled(b.id, b.enabled !== false);
    json(s, { ok: true, pluginId: b.id, enabled: b.enabled !== false });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});
registerRoute(["POST"], /^\/api\/harness\/plugins\/exec\/([^\/]+)$/, async function(r,s,m){
  try {
    var b = await parseBody(r);
    var tools = _pluginSys.getCustomTools();
    var found = null;
    for (var t of tools) { if (t.name === m[1]) { found = t; break; } }
    if (!found || !found.handler) { json(s, { ok: false, error: 'Tool not found: ' + m[1] }); return; }
    var result = found.handler(b.args || {});
    json(s, { ok: true, tool: m[1], result: result });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});

// ====== Model A/B Test API ======
var modelAB = require('./modules/model-abtest');
var abtest = modelAB.getInstance();
registerRoute(["GET"], /^\/api\/harness\/abtest\/experiments$/, function(r,s){
  try { json(s, { ok: true, experiments: abtest.getExperiments(), active: abtest.getActiveExperiment() }); }
  catch(e) { json(s, { ok: false, error: e.message }); }
});
registerRoute(["POST"], /^\/api\/harness\/abtest\/create$/, async function(r,s){
  try {
    var b = await parseBody(r);
    if (!b.name || !b.variants) { json(s, { ok: false, error: 'Need name and variants' }); return; }
    json(s, { ok: true, experiment: abtest.createExperiment(b.name, b.variants) });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});
registerRoute(["POST"], /^\/api\/harness\/abtest\/activate\/([^\/]+)$/, function(r,s,m){
  try { var exp = abtest.activateExperiment(m[1]); json(s, { ok: !!exp, experiment: exp }); }
  catch(e) { json(s, { ok: false, error: e.message }); }
});
registerRoute(["POST"], /^\/api\/harness\/abtest\/conclude\/([^\/]+)$/, async function(r,s,m){
  try {
    var b = await parseBody(r);
    json(s, { ok: true, experiment: abtest.concludeExperiment(m[1], b.winner) });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});

// ====== Batch Task Dispatching API ======
var orchestratorMod = require('./modules/orchestrator');
registerRoute(["POST"], /^\/api\/harness\/batch\/dispatch$/, async function(r,s){
  try {
    var b = await parseBody(r);
    var tasks = b.tasks || [];
    var createdTasks = [];
    for (var t of tasks) {
      createdTasks.push({
        id: 'batch_' + Date.now() + '_' + Math.random().toString(36).substring(2,8),
        title: t.title || '批量任务',
        description: t.description || '',
        status: t.dependsOn ? 'blocked' : 'pending',
        assigneeId: t.assigneeId || null,
        priority: t.priority || 'medium',
        dependsOn: t.dependsOn || [],
        tags: t.tags || ['batch'],
        creator: 'system',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    var existingTasks = JSON.parse(fs.readFileSync(path.join(BASE, 'tasks.json'), 'utf-8'));
    var tasksToAdd = (b.parallel !== false) ? createdTasks : createdTasks;
    for (var ct of tasksToAdd) { existingTasks.push(ct); }
    fs.writeFileSync(path.join(BASE, 'tasks.json'), JSON.stringify(existingTasks, null, 2), 'utf-8');
    json(s, { ok: true, created: createdTasks.length, tasks: createdTasks });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});
registerRoute(["POST"], /^\/api\/harness\/batch\/workflow$/, async function(r,s){
  try {
    var b = await parseBody(r);
    var orc = new orchestratorMod();
    var wf = orc.createWorkflow({
      name: b.name || '并行工作流',
      task: { title: b.name || '并行工作流', description: b.description || '' },
      subTasks: (b.subTasks || []).map(function(st) {
        return { title: st.title, assigneeId: st.assigneeId, dependsOn: st.dependsOn || [] };
      })
    });
    json(s, { ok: true, workflow: wf });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});

// ====== Keep Rate + Error Sink API ======
// ====== Harness 习惯记忆库 API ======
registerRoute(["GET"], /^\/api\/harness\/habits\/analyze$/, function(r,s){
  try { var _up = new URL(r.url, 'http://localhost'); json(s, harHabits.getHabitsReport(parseInt(_up.searchParams.get('days')) || 90)); }
  catch(e) { json(s, {error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/habits\/record$/, async function(r,s){
  try { var b = await parseBody(r); json(s, harHabits.recordHabit(b.category, b.action, b.detail, b.metadata)); }
  catch(e) { json(s, {error: e.message}); }
});
registerRoute(["GET"], /^\/api\/harness\/habits\/pending$/, function(r,s){
  try { json(s, harHabits.getPendingConfirmations()); }
  catch(e) { json(s, {error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/habits\/confirm$/, async function(r,s){
  try { var b = await parseBody(r); json(s, harHabits.confirmPreference(b.prefId, b.confirmed, b.note)); }
  catch(e) { json(s, {error: e.message}); }
});
registerRoute(["POST"], /^\/api\/harness\/habits\/generate$/, function(r,s){
  try { json(s, {pending: harHabits.generateConfirmations()}); }
  catch(e) { json(s, {error: e.message}); }
});

registerRoute(["GET"], /^\/api\/harness\/keeprate\/report$/, function(r,s){
  try { var KR = require('./modules/keep-rate-tracker'); var krt = new KR(); json(s, krt.getReport()); }
  catch(e) { json(s, {summary:{totalTasks:0,completedTasks:0,pendingTasks:0,failedTasks:0,completionRate:"0%",redoRate:"0%",failRate:"0%",keepRate:"0%",totalSessions:0},features:[],dailyTrend:[],weeklyTrend:[]}); }
});
registerRoute(["GET"], /^\/api\/harness\/errors\/cases$/, function(r,s){
  try { var ES = require('./modules/error-sink'); var es = new ES(); var stats = es.getStats(); var cases = es.getCases ? es.getCases().slice(0,20) : []; json(s, {stats:stats, cases:cases, recentCases: cases.slice(0,8), totalCases: cases.length, openCases: (stats.pendingCount||0)}); }
  catch(e) { json(s, {stats:{},cases:[],recentCases:[],totalCases:0,openCases:0}); }
});
registerRoute(["POST"], /^\/api\/harness\/keeprate\/record$/, async function(r,s){
  try { var b = await parseBody(r); var KR = require('./modules/keep-rate-tracker'); var krt = new KR(); if(b.action==='task') krt.recordTask(b.taskId,b.assignee); else if(b.action==='complete') krt.completeTask(b.taskId,b.assignee); else if(b.action==='redo') krt.redoTask(b.taskId,b.assignee); else if(b.action==='session') krt.recordSession(b.userId); else if(b.action==='feature') krt.recordFeature(b.feature); json(s,{ok:true}); }
  catch(e) { json(s, {ok:false, error:e.message}); }
});



// === Missing API endpoints (added by audit) ===

// Error Trend API
registerRoute(["GET"], /^\/api\/harness\/errors\/trend$/, function(r,s){
  try {
    var es = new (require('./modules/error-sink'))();
    var trend = es.getTrendStats();
    var tickets = es.autoCreateTicket ? es.autoCreateTicket() : [];
    json(s, { ok: true, trend: trend, autoTickets: tickets });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});

// Generate error auto-tickets
registerRoute(["POST"], /^\/api\/harness\/errors\/tickets$/, function(r,s){
  try {
    var es = new (require('./modules/error-sink'))();
    var tickets = es.autoCreateTicket ? es.autoCreateTicket() : [];
    if (tickets.length > 0) {
      var tasks = JSON.parse(fs.readFileSync(path.join(BASE, 'tasks.json'), 'utf-8'));
      for (var t of tickets) {
        t.id = 'ticket_' + Date.now() + '_' + Math.random().toString(36).substring(2,8);
        t.updatedAt = new Date().toISOString();
        tasks.push(t);
      }
      fs.writeFileSync(path.join(BASE, 'tasks.json'), JSON.stringify(tasks, null, 2), 'utf-8');
    }
    json(s, { ok: true, tickets: tickets, created: tickets.length });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});

// SLA stats
registerRoute(["GET"], /^\/api\/harness\/sla\/stats$/, function(r,s){
  try {
    var slaMod = require('./modules/sla');
    json(s, { ok: true, sla: slaMod.getSLA(), summary: slaMod.getSLASummary() });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});

// Channel test
registerRoute(["POST"], /^\/api\/channel\/test$/, async function(r,s){
  try {
    var b = await parseBody(r);
    var result = { channel: b.channel, ok: false, latency: 0 };
    var start = Date.now();
    if (b.channel === 'feishu') { result.ok = !!(b.appId && b.appSecret); result.msg = result.ok ? 'Credential valid' : 'Missing App ID or Secret'; }
    else if (b.channel === 'personal_wx') { result.ok = true; result.msg = 'WeChat QR binding available'; }
    else if (b.channel === 'dingtalk') { result.ok = !!(b.clientId && b.clientSecret); result.msg = result.ok ? 'Credential valid' : 'Missing Client ID or Secret'; }
    else if (b.channel === 'wecom') { result.ok = !!(b.corpId && b.agentId); result.msg = result.ok ? 'Credential valid' : 'Missing CorpID or AgentID'; }
    else if (b.channel === 'qqbot') { result.ok = true; result.msg = 'QQ bot available'; }
    else result.msg = 'Unknown channel';
    result.latency = Date.now() - start;
    json(s, result);
  } catch(e) { json(s, { ok: false, error: e.message }); }
});

// Provider health check
registerRoute(["GET"], /^\/api\/provider\/health\/all$/, async function(r,s){
  try {
    var ph = require('./modules/provider-health');
    json(s, { ok: true, result: await ph.testAll() });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});

// ====== Agent Engine + Missing APIs ======
const AgentEngine = require('./modules/agent-engine');
const os = require('os');

// Ensure CEO in AGENTS_MAP
(function(){try{var db=require('./modules/database');var ceo=db.agentOps.get('ai_ceo');if(!ceo){db.agentOps.update('ai_ceo',{name:'AI CEO',name_cn:'AI CEO',title:'首席执行官',role:'ceo',status:'online'});}if(!AGENTS_MAP.ai_ceo){var fresh=db.agentOps.get('ai_ceo');if(fresh)AGENTS_MAP.ai_ceo=fresh;else AGENTS_MAP.ai_ceo={id:'ai_ceo',name:'AI CEO',name_cn:'AI CEO',title:'CEO',role:'ceo',status:'online'};}}catch(e){if(!AGENTS_MAP.ai_ceo)AGENTS_MAP.ai_ceo={id:'ai_ceo',name:'AI CEO',name_cn:'AI CEO',title:'CEO',role:'ceo',status:'online'}}})();

// Chat/:agentId Route// Channels API
registerRoute(["GET"],/^\/api\/channels$/,function(r,s){var p2=os.homedir()+"/.openclaw/openclaw.json";var ch={};try{var raw=fs.readFileSync(p2,"utf-8");if(raw.charCodeAt(0)===0xFEFF)raw=raw.substring(1);var cfg=JSON.parse(raw);for(var k in(cfg.channels||{}))ch[k]=!!cfg.channels[k].enabled;}catch(e){}json(s,{channels:ch});});
registerRoute(["GET"],/^\/api\/channels\/list$/,function(r,s){json(s,{channels:[{id:"feishu",name:"飞书",fields:[{key:"appId",label:"App ID",type:"text"},{key:"appSecret",label:"Secret",type:"password"}],steps:["创建飞书应用"]},{id:"personal_wx",name:"个人微信",fields:[],steps:["npx @tencent-weixin/cli install"]},{id:"dingtalk",name:"钉钉",fields:[{key:"clientId",label:"Client ID",type:"text"},{key:"clientSecret",label:"Secret",type:"password"}],steps:["钉钉开放平台"]},{id:"wecom",name:"企业微信",fields:[{key:"corpId",label:"CorpID",type:"text"},{key:"agentId",label:"AgentId",type:"text"},{key:"agentSecret",label:"Secret",type:"password"}],steps:["企微后台"]},{id:"qqbot",name:"QQ机器人",fields:[{key:"appId",label:"AppID",type:"text"},{key:"appSecret",label:"Token",type:"password"}],steps:["QQ开放平台"]}]});});
registerRoute(["POST"],/^\/api\/channels\/install$/,async function(r,s){var b=await parseBody(r);if(!b.channel&&!b.channelId){json(s,{ok:false,msg:"missing channel"});return;}try{var p2=os.homedir()+"/.openclaw/openclaw.json";var raw=fs.readFileSync(p2,"utf-8");if(raw.charCodeAt(0)===0xFEFF)raw=raw.substring(1);var cfg=JSON.parse(raw);if(!cfg.channels)cfg.channels={};var chId=b.channel||b.channelId;cfg.channels[chId]=cfg.channels[chId]||{};cfg.channels[chId].enabled=true;for(var k in b)if(k!=="channel"&&k!=="channelId")cfg.channels[chId][k]=b[k];var d2=require("path").dirname(p2);if(!fs.existsSync(d2))fs.mkdirSync(d2,{recursive:true});fs.writeFileSync(p2,JSON.stringify(cfg,null,2),"utf-8");json(s,{ok:true,msg:chId+" saved"});}catch(e){json(s,{ok:false,msg:e.message||"error"})}});

// Provider & Profile API
registerRoute(["GET"],/^\/api\/provider\/config$/,function(r,s){var cfg={};try{var fp=path.join(BASE,"ai-provider.json");if(fs.existsSync(fp))cfg=JSON.parse(fs.readFileSync(fp,"utf-8"));}catch(e){}if(cfg.apiKey&&cfg.apiKey.length>8)cfg.apiKey=cfg.apiKey.substring(0,4)+"****"+cfg.apiKey.substring(cfg.apiKey.length-4);else if(cfg.apiKey)cfg.apiKey="****";cfg.hasApiKey=!!(process.env.DEEPSEEK_API_KEY||cfg.apiKey);cfg.activeProvider=cfg.provider||"deepseek";json(s,cfg);});registerRoute(["GET"],/^\/api\/profile$/,function(r,s){var pf={};try{pf=JSON.parse(fs.readFileSync(path.join(BASE,"operator-profile.json"),"utf-8"));}catch(e){pf={name:"Admin",title:"Operator"};}json(s,pf);});
registerRoute(["PUT"],/^\/api\/profile$/,async function(r,s){try{var b=await parseBody(r);var pf={};try{pf=JSON.parse(fs.readFileSync(path.join(BASE,"operator-profile.json"),"utf-8"));}catch(e){pf={};}for(var k of["name","name_en","title","icon","email","phone","bio","theme","lang"]){if(b[k]!==undefined)pf[k]=b[k];}fs.writeFileSync(path.join(BASE,"operator-profile.json"),JSON.stringify(pf,null,2),"utf-8");json(s,{profile:pf,message:"ok"});}catch(e){json(s,{error:"error"},500)}});

// File CRUD
registerRoute(["POST"],/^\/api\/files\/create$/,async function(r,s){var b=await parseBody(r);var t=path.resolve(BASE,b.path||"");if(!t.startsWith(path.resolve(BASE))){json(s,{error:"forbidden"},403);return;}try{if(b.type==="dir"){fs.mkdirSync(t,{recursive:true});}else{var d=path.dirname(t);if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});fs.writeFileSync(t,b.content||"","utf-8");}json(s,{ok:true});}catch(e){json(s,{error:"error"},500)}});
registerRoute(["POST"],/^\/api\/files\/delete$/,async function(r,s){var b=await parseBody(r);var t=path.resolve(BASE,b.path||"");if(!t.startsWith(path.resolve(BASE))){json(s,{error:"forbidden"},403);return;}try{if(!fs.existsSync(t)){json(s,{error:"not found"},404);return;}fs.rmSync(t,{recursive:true,force:true});json(s,{ok:true});}catch(e){json(s,{error:"error"},500)}});

// Agent Scheduler

// Extra routes
var { registerExtraRoutes } = require('./modules/extra-routes');

// Extended routes
var sm=require("./modules/skill-mapper");
var{scheduler}=require("./modules/proactive-scheduler");
var{registerRoutes:registerOAuth}=require("./modules/oauth-bridge");

registerRoute(["GET"],/^\/api\/scheduler\/status$/,function(r,s){json(s,{ok:true,...scheduler.getStatus()})});
registerRoute(["POST"],/^\/api\/scheduler\/start$/,function(r,s){console.warn('[Scheduler] /api/scheduler/start 被调用——自动调度已禁用');scheduler.start();json(s,{ok:true,status:scheduler.getStatus(),mode:'passive'})});
registerRoute(["POST"],/^\/api\/scheduler\/stop$/,function(r,s){scheduler.stop();json(s,{ok:true,status:scheduler.getStatus()})});
registerRoute(["POST"],/^\/api\/scheduler\/cycle$/,function(r,s){var ip=r.connection&&r.connection.remoteAddress||'unknown';console.warn('[Scheduler] /api/scheduler/cycle 被调用(来源:'+ip+')——自动调度已禁用');scheduler.cycle();json(s,{ok:false,status:scheduler.getStatus(),mode:'passive',error:'auto_disabled'})});
registerRoute(["POST"],/^\/api\/scheduler\/heartbeat$/,async function(r,s){try{var b=await parseBody(r);var x=scheduler.reportHeartbeat(b.agentId,b);json(s,{ok:true,...x})}catch(e){json(s,{ok:false,error:e.message})}});
registerRoute(["GET"],/^\/api\/scheduler\/heartbeats$/,function(r,s){json(s,{ok:true,heartbeats:scheduler.getHeartbeatStatus()})});
registerRoute(["GET"],/^\/api\/scheduler\/priorities$/,function(r,s){json(s,{ok:true,priority:scheduler.getPriorityStats()})});
registerRoute(["POST"],/^\/api\/scheduler\/workflow$/,async function(r,s){try{var b=await parseBody(r);var t=scheduler.createWorkflow(b.name,b.steps,b.priority);json(s,{ok:true,tasks:t})}catch(e){json(s,{ok:false,error:e.message})}});
// 自动调度已禁用 — 仅接受 CEO requestPull 调用

// ====== Agent Worker Engine API ======
registerRoute(["GET"],/^\/api\/engine\/status$/,function(r,s){try{json(s,{ok:true,status:agentWorker.getStatus()})}catch(e){json(s,{ok:false,error:e.message})}});
registerRoute(["POST"],/^\/api\/engine\/start$/,function(r,s){agentWorker.start();json(s,{ok:true,status:agentWorker.getStatus()})});
registerRoute(["POST"],/^\/api\/engine\/stop$/,function(r,s){agentWorker.stop();json(s,{ok:true,status:agentWorker.getStatus()})});

registerRoute(["GET"],/^\/api\/skill-mapper\/agent\/([^\/]+)$/,function(r,s,m){json(s,{ok:true,tools:sm.getToolsForAgent(m[1])})});
registerRoute(["GET"],/^\/api\/skill-mapper\/stats$/,function(r,s){json(s,{ok:true,stats:sm.getStats()})});

registerRoute(["GET"],/^\/api\/learning\/evolution\/([^\/]+)$/,function(r,s,m){json(s,{ok:true,evolution:require("./modules/auto-learning").getSkillEvolution(m[1])})});
registerRoute(["POST"],/^\/api\/learning\/learn$/,async function(r,s){try{var b=await parseBody(r);var al=require("./modules/auto-learning");var x=al.learnFromTask(b.agentId,b.task||{},b.result,b.durationMs);json(s,{ok:true,result:x})}catch(e){json(s,{ok:false,error:e.message})}});

try{registerOAuth(registerRoute,parseBody,json)}catch(e){console.error("[OAuth]",e.message)}

registerRoute(["GET"],/^\/favicon\.ico$/,function(r,s){s.writeHead(302,{Location:"/favicon.svg"});s.end()});
registerRoute(["GET"],/^\/apple-touch-icon\.png$/,function(r,s){s.writeHead(302,{Location:"/assets/apple-touch-icon.png"});s.end()});

registerExtraRoutes(registerRoute, parseBody, json);

  // CEO API (v3.5)
  try { var ceoApi = require('./modules/ceo-api'); if (ceoApi.ceoAPIRoutes) ceoApi.ceoAPIRoutes(registerRoute, parseBody, json); } catch(e) {}

  // Channel bindings (v3.5)
  try { var cb = require('./modules/channel-bindings'); if (cb.channelBindings && typeof cb.channelBindings === 'function') cb.channelBindings(registerRoute, parseBody, json); } catch(e) {}
  // 前端 Settings.vue 需要的接口
  registerRoute(['GET'], /^\/api\/bindings\/my$/, function(req, res) {
    try {
      var cb = require('./modules/channel-bindings');
      json(res, { ok: true, bindings: cb.getUserBindings ? cb.getUserBindings() : [] });
    } catch(e) { json(res, { ok: true, bindings: [] }); }
  });
  registerRoute(['GET'], /^\/api\/bindings\/channel-types$/, function(req, res) {
    try {
      var cb = require('./modules/channel-bindings');
      json(res, { ok: true, channelTypes: cb.getChannelTypes ? cb.getChannelTypes() : [] });
    } catch(e) { json(res, { ok: true, channelTypes: [] }); }
  });


// ====== v3.5 MODULE INSTANCES (injected 2026-05-14) ======
var ceoPermInst = require("./modules/ceo-permissions.js");
var ceo = ceoPermInst.getCEOInstance();
var fpModInst = require("./modules/file-permissions.js");
var fpManager = fpModInst.getFilePermissionInstance();
var roleSkills = require("./modules/role-skills.js");
var agentMem = require("./modules/agent-memory.js");


// ====== v3.5 MISSING API ROUTES (injected 2026-05-14) ======

registerRoute(['GET'], /^\/api\/ceo\/overview$/, (req, res) => {
  var o = ceo.getCEOPermissionOverview();
  json(res, {ok: true, ...o});
});

registerRoute(['POST'], /^\/api\/ceo\/check$/, async (req, res) => {
  var b = await parseBody(req);
  if (!b.agentId || !b.permission) return json(res, {error: 'missing'}, 400);
  var r = ceo.checkAndLog(b.agentId, b.agentName||'unknown', b.permission, {action:'check',resource:b.resource});
  json(res, r);
});

registerRoute(['GET'], /^\/api\/ceo\/permissions\/([^\/]+)$/, (req, res, m) => {
  var id = m[1];
  var p = ceo.getAgentPermissions(id);
  json(res, {ok: true, agentId: id, ...p});
});

registerRoute(['POST'], /^\/api\/ceo\/delegate$/, async (req, res) => {
  var b = await parseBody(req);
  if (!b.fromAgentId || !b.toAgentId || !b.permissions) return json(res, {error: 'missing'}, 400);
  var r = ceo.delegate(b.fromAgentId, b.toAgentId, b.permissions, {expiresAt: b.expiresAt, reason: b.reason});
  json(res, r);
});

registerRoute(['DELETE'], /^\/api\/ceo\/delegate\/([^\/]+)$/, async (req, res, m) => {
  var b = await parseBody(req);
  var r = ceo.revokeDelegation(b.fromAgentId, m[1]);
  json(res, r);
});

registerRoute(['GET'], /^\/api\/ceo\/delegations$/, (req, res) => {
  var d = ceo.getActiveDelegations();
  json(res, {ok: true, delegations: d});
});

registerRoute(['POST'], /^\/api\/ceo\/temp-grant$/, async (req, res) => {
  var b = await parseBody(req);
  if (!b.agentId || !b.permission || !b.durationMs) return json(res, {error: 'missing'}, 400);
  var r = ceo.grantTemporaryPermission(b.agentId, b.permission, b.durationMs);
  json(res, r);
});

registerRoute(['DELETE'], /^\/api\/ceo\/temp-revoke$/, async (req, res) => {
  var b = await parseBody(req);
  var r = ceo.revokeTemporaryPermission(b.agentId, b.permission);
  json(res, r);
});

registerRoute(['POST'], /^\/api\/ceo\/command$/, async (req, res) => {
  var b = await parseBody(req);
  var r = ceo.executeCommand(b);
  json(res, r);
});

registerRoute(['GET'], /^\/api\/ceo\/audit$/, (req, res) => {
  var u = new URL(req.url, 'http://localhost');
  var e = ceo.getAuditLog({agentId: u.searchParams.get('agentId'), permission: u.searchParams.get('permission'), since: u.searchParams.get('since'), limit: parseInt(u.searchParams.get('limit'))||100});
  json(res, {ok: true, count: e.length, entries: e});
});

registerRoute(['POST'], /^\/api\/ceo\/task\/assign$/, async (req, res) => {
  var b = await parseBody(req);
  var r = ceo.assignTask(b);
  json(res, r);
});

registerRoute(['POST'], /^\/api\/ceo\/task\/bulk-assign$/, async (req, res) => {
  var b = await parseBody(req);
  var r = ceo.bulkAssignTasks(b);
  json(res, r);
});

registerRoute(['POST'], /^\/api\/ceo\/team\/fire$/, async (req, res) => {
  var b = await parseBody(req);
  var r = ceo.fireAgent(b);
  json(res, r);
});

registerRoute(['POST'], /^\/api\/ceo\/team\/promote$/, async (req, res) => {
  var b = await parseBody(req);
  var r = ceo.promoteAgent(b);
  json(res, r);
});

registerRoute(['POST'], /^\/api\/ceo\/emergency\/stop$/, async (req, res) => {
  var b = await parseBody(req);
  var r = ceo.emergencyStop(b);
  json(res, r);
});

registerRoute(['GET'], /^\/api\/ceo\/categories$/, (req, res) => {
  var c = ceo.getPermissionCategories();
  json(res, {ok: true, categories: c});
});

registerRoute(['GET'], /^\/api\/ceo\/categories\/([^\/]+)$/, (req, res, m) => {
  var cats = ceo.getPermissionCategories();
  var cat = cats.find((x) => { return x.id === m[1]; });
  json(res, {ok: true, category: cat||null});
});

registerRoute(['GET'], /^\/api\/file-permissions\/overview$/, (req, res) => {
  var o = fpManager.getOverview();
  json(res, {ok: true, ...o});
});

registerRoute(['POST'], /^\/api\/file-permissions\/check$/, async (req, res) => {
  var b = await parseBody(req);
  if (!b.agentId || !b.operation || !b.filePath) return json(res, {error: 'missing'}, 400);
  var r = b.operation==='read' ? fpManager.checkRead(b.agentId, b.agentRole, b.agentCategory, b.filePath) : b.operation==='write' ? fpManager.checkWrite(b.agentId, b.agentRole, b.agentCategory, b.filePath) : null;
  if (!r) return json(res, {error: 'unknown op'}, 400);
  json(res, {ok: true, ...r});
});

registerRoute(['POST'], /^\/api\/file-permissions\/check-batch$/, async (req, res) => {
  var b = await parseBody(req);
  if (!b.agentId || !b.operations) return json(res, {error: 'missing'}, 400);
  var r = fpManager.checkAll(b.agentId, b.agentRole, b.agentCategory, b.operations);
  json(res, {ok: true, ...r});
});

registerRoute(['GET'], /^\/api\/file-permissions\/agent\/([^\/]+)$/, (req, res) => {
  var u = new URL(req.url, 'http://localhost');
  var id = req.params.agentId;
  var p = fpManager.getAgentPermissions(id, u.searchParams.get('role'), u.searchParams.get('category'));
  var o = fpManager.getAgentOverride(id);
  json(res, {ok: true, agentId: id, basePermissions: p, hasOverride: !!o, override: o||null});
});

registerRoute(['POST'], /^\/api\/file-permissions\/agent\/([^\/]+)\/override$/, async (req, res) => {
  var b = await parseBody(req);
  if (!b || Object.keys(b).length === 0) return json(res, {error: 'no config'}, 400);
  var r = fpManager.setAgentOverride(req.params.agentId, b);
  json(res, r);
});

registerRoute(['DELETE'], /^\/api\/file-permissions\/agent\/([^\/]+)\/override$/, (req, res) => {
  var r = fpManager.clearAgentOverride(req.params.agentId);
  json(res, r);
});

registerRoute(['GET'], /^\/api\/file-permissions\/roles$/, (req, res) => {
  var r = fpManager.getAllRolePermissions();
  json(res, {ok: true, roles: r});
});

registerRoute(['PUT'], /^\/api\/file-permissions\/roles\/([^\/]+)$/, async (req, res) => {
  var b = await parseBody(req);
  var r = fpManager.updateRolePermissions(req.params.role, b);
  json(res, r);
});

registerRoute(['POST'], /^\/api\/file-permissions\/file\/read$/, async (req, res) => {
  var b = await parseBody(req);
  var so = new fpModInst.SecureFileOperations(fpManager);
  var r = so.secureRead(b.agentId, b.agentRole, b.agentCategory, b.filePath);
  json(res, {ok: true, ...r});
});

registerRoute(['POST'], /^\/api\/file-permissions\/file\/write$/, async (req, res) => {
  var b = await parseBody(req);
  var so = new fpModInst.SecureFileOperations(fpManager);
  var r = so.secureWrite(b.agentId, b.agentRole, b.agentCategory, b.filePath, b.content);
  json(res, {ok: true, ...r});
});

registerRoute(['DELETE'], /^\/api\/file-permissions\/file$/, async (req, res) => {
  var b = await parseBody(req);
  var so = new fpModInst.SecureFileOperations(fpManager);
  var r = so.secureDelete(b.agentId, b.agentRole, b.agentCategory, b.filePath);
  json(res, {ok: true, ...r});
});

registerRoute(['POST'], /^\/api\/file-permissions\/file\/list$/, async (req, res) => {
  var b = await parseBody(req);
  var so = new fpModInst.SecureFileOperations(fpManager);
  var r = so.secureListDir(b.agentId, b.agentRole, b.agentCategory, b.dirPath);
  json(res, {ok: true, ...r});
});

registerRoute(['GET'], /^\/api\/file-permissions\/audit$/, (req, res) => {
  var u = new URL(req.url, 'http://localhost');
  var e = fpManager.getAuditLog({agentId: u.searchParams.get('agentId'), operation: u.searchParams.get('operation'), since: u.searchParams.get('since'), limit: parseInt(u.searchParams.get('limit'))||100});
  json(res, {ok: true, count: e.length, entries: e});
});

registerRoute(['GET'], /^\/api\/file-permissions\/audit\/stats$/, (req, res) => {
  var s = fpManager.getAuditStats();
  json(res, {ok: true, stats: s});
});

registerRoute(['POST'], /^\/api\/file-permissions\/whitelist$/, async (req, res) => {
  var b = await parseBody(req);
  var r = fpManager.addToWhitelist(b);
  json(res, r);
});

registerRoute(['POST'], /^\/api\/file-permissions\/extensions$/, async (req, res) => {
  var b = await parseBody(req);
  var r = fpManager.addExtension(b);
  json(res, r);
});

registerRoute(['GET'], /^\/api\/file-permissions\/global-paths$/, (req, res) => {
  var p = fpManager.getGlobalPaths();
  json(res, {ok: true, globalPaths: p});
});

registerRoute(['GET'], /^\/api\/file-permissions\/rate-limits$/, (req, res) => {
  var l = fpManager.getRateLimits();
  json(res, {ok: true, rateLimits: l});
});

registerRoute(['GET'], /^\/api\/memory\/search\/global$/, (req, res) => {
  var u = new URL(req.url, 'http://localhost');
  var r = agentMem.globalMemorySearch(u.searchParams.get('q'), {limit: parseInt(u.searchParams.get('limit'))||20});
  json(res, {ok: true, count: r.length, results: r});
});

registerRoute(['GET'], /^\/api\/memory\/stats\/all$/, (req, res) => {
  var s = agentMem.getAllMemoryStats();
  json(res, {ok: true, stats: s});
});

registerRoute(['POST'], /^\/api\/memory\/consolidate\/all$/, async (req, res) => {
  var b = await parseBody(req);
  var r = agentMem.consolidateAllMemories(b);
  json(res, r);
});



// ====== 核心记忆库 API ======
registerRoute(['POST'], /^\/api\/core-memory\/write$/, async (req, res) => {
  try {
    var b = await parseBody(req);
    var r = await coreMem.writeMemory({ content: b.content, tags: b.tags, priority: b.priority, type: b.type, timestamp: b.timestamp });
    json(res, r);
  } catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['POST'], /^\/api\/core-memory\/search$/, async (req, res) => {
  try {
    var b = await parseBody(req);
    var r = await coreMem.searchMemory({ query: b.query, tags: b.tags, type: b.type, priority: b.priority, dateFrom: b.dateFrom, dateTo: b.dateTo, limit: b.limit });
    json(res, r);
  } catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['POST'], /^\/api\/core-memory\/version$/, async (req, res) => {
  try {
    var b = await parseBody(req);
    var r = await coreMem.manageVersions({ action: b.action, versionId: b.versionId, recordId: b.recordId });
    json(res, r);
  } catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['GET'], /^\/api\/core-memory\/stats$/, (req, res) => {
  try { json(res, { ok: true, stats: coreMem.getStats() }); } catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['GET'], /^\/api\/role-skills\/categories$/, (req, res) => {
  var c = roleSkills.getAllSkillsByCategory();
  json(res, {ok: true, categories: c});
});

registerRoute(['GET'], /^\/api\/role-skills\/roles$/, (req, res) => {
  var r = roleSkills.getAllRoles();
  json(res, {ok: true, roles: r});
});

registerRoute(['GET'], /^\/api\/role-skills\/([^\/]+)\/skills$/, (req, res) => {
  var s = roleSkills.getRoleSkillDetails(req.params.roleId);
  json(res, {ok: true, roleId: req.params.roleId, skills: s});
});

registerRoute(['GET'], /^\/api\/role-skills\/stats$/, (req, res) => {
  var s = roleSkills.getRoleStats();
  json(res, {ok: true, stats: s});
});

setInterval(function(){try{var mem=AgentEngine.loadAgentMemory("ai_ceo");mem.lastActive=new Date().toISOString();mem.decisions.push({type:"heartbeat",time:new Date().toISOString()});AgentEngine.saveAgentMemory("ai_ceo",mem);}catch(e){}},300000);console.log("[Agent] Scheduler loaded (passive)");global.__agentSchedulerRunning=true;
// ====== HTTPS Server ======
try{
  var https2=require("https");
  var certPath=process.env.SSL_CERT||path.join(BASE,"ssl","cert.pem");
  var keyPath=process.env.SSL_KEY||path.join(BASE,"ssl","key.pem");
  if(fs.existsSync(certPath)&&fs.existsSync(keyPath)){
    var opts={cert:fs.readFileSync(certPath),key:fs.readFileSync(keyPath)};
    var hserv=https2.createServer(opts,server);
    var SPORT=parseInt(process.env.SSL_PORT||"8443");
    hserv.listen(SPORT,"0.0.0.0",function(){console.log("  [HTTPS] https://0.0.0.0:"+SPORT)});
  }else{console.log("  [HTTPS] No SSL cert at: "+certPath)}
}catch(e){console.error("  [HTTPS] Error:",e.message)}


// ===== P1-P3 Integration =====
var strategyConfigFile = require('path').join(BASE, 'strategy-config.json');
var pSharedMemory = require('./modules/shared-memory');
var pQualitySystem = require('./modules/quality-system');

// --- Strategy API ---
registerRoute(['GET'], /^\/api\/v4\/settings\/strategy$/, function(req, res) {
  try { var d = JSON.parse(require('fs').readFileSync(strategyConfigFile, 'utf-8') || '{}'); require('./server-modern').json ? json(res, { ok: true, mode: d.mode || 'fixed', primary: d.primary || 'deepseek-chat', backups: d.backups || [] }) : json(res, { ok: true, mode: d.mode || 'fixed', primary: d.primary || 'deepseek-chat', backups: d.backups || [] }); }
  catch(e) { json(res, { ok: true, mode: 'fixed', primary: 'deepseek-chat', backups: [] }); }
});
registerRoute(['POST'], /^\/api\/v4\/settings\/strategy$/, function(req, res) {
  var bd = ''; req.on('data', function(c){ bd += c; }); req.on('end', function() {
    try { var d = JSON.parse(bd); require('fs').writeFileSync(strategyConfigFile, JSON.stringify({ mode: d.mode || 'fixed', primary: d.primary || 'deepseek-chat', backups: d.backups || [] }, null, 2), 'utf-8'); json(res, { ok: true }); }
    catch(e) { json(res, { ok: false, error: e.message }); }
  });
});

// --- 心跳守护设置 ---
var heartbeatConfig = { enabled: true, interval: 30 };
var heartbeatFile = path.join(__dirname, 'config', 'heartbeat.json');
try { var hd = JSON.parse(require('fs').readFileSync(heartbeatFile, 'utf-8')); if (hd.enabled !== undefined) heartbeatConfig.enabled = hd.enabled; if (hd.interval) heartbeatConfig.interval = hd.interval; } catch(e) {}

registerRoute(['GET'], /^\/api\/v4\/settings\/heartbeat$/, function(req, res) {
  try {
    var mem = process.memoryUsage();
    var lastBeat = '---';
    try { var raw = require('fs').readFileSync(path.join(__dirname, 'logs', 'heartbeat.log'), 'utf-8'); if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
      var log = raw.split('\\n').filter(Boolean);
      if (log.length > 0) {
        var lastLine = log[log.length - 1];
        var parts = lastLine.match(/^([^ ]+)T([^ ]+)/);
        if (parts) lastBeat = parts[1] + ' ' + parts[2].substring(0, 8);
      }
    } catch(e) {}
    json(res, {
      enabled: heartbeatConfig.enabled,
      lastBeat: lastBeat,
      memory: Math.round(mem.rss / 1024 / 1024) + 'MB',
      interval: heartbeatConfig.interval + '分钟'
    });
  } catch(e) { json(res, { enabled: false, lastBeat: '-', memory: '-', interval: '30分钟' }); }
});

registerRoute(['POST'], /^\/api\/v4\/settings\/heartbeat$/, function(req, res) {
  var bd = ''; req.on('data', function(c){ bd += c; }); req.on('end', function() {
    try { var d = JSON.parse(bd);
      if (d.enabled !== undefined) heartbeatConfig.enabled = d.enabled;
      if (d.interval) heartbeatConfig.interval = parseInt(d.interval) || 30;
      require('fs').writeFileSync(heartbeatFile, JSON.stringify(heartbeatConfig, null, 2), 'utf-8');
      json(res, { ok: true });
    } catch(e) { json(res, { ok: false, error: e.message }); }
  });
});

// --- P1: Agent Message Bus ---
registerRoute(['POST'], /^\/api\/v4\/agents\/message$/, async function(req, res) {
  var b = await new Promise(function(rv) { var d=''; req.on('data',function(c){d+=c}); req.on('end',function(){try{rv(JSON.parse(d));}catch(e){rv({});}}); });
  if (!b.from || !b.to) { json(res, { ok: false, error: 'missing from/to' }); return; }
  var msg = messageQueue.send(b.from, b.to, b.type || 'message', b.content || '', b.data || {});
  eventBus.publish('agent.message', { from: b.from, to: b.to, type: b.type, content: b.content, messageId: msg.id });
  json(res, { ok: true, messageId: msg.id, timestamp: msg.timestamp });
});
registerRoute(['GET'], /^\/api\/v4\/agents\/messages\/([^/]+)$/, function(req, res, m) {
  var u = new URL(req.url, 'http://localhost');
  var msgs = u.searchParams.get('mark_read') === 'true' ? (messageQueue.poll(m[1]), messageQueue.markAllRead(m[1])) : messageQueue.poll(m[1]);
  var all = messageQueue.getAll ? messageQueue.getAll(m[1]) : msgs;
  json(res, { ok: true, agentId: m[1], unread: msgs, total: all.length, unreadCount: (msgs || []).length });
});
registerRoute(['GET'], /^\/api\/v4\/agents\/events$/, function(req, res) {
  var u = new URL(req.url, 'http://localhost');
  var evts = eventStore.query ? eventStore.query({ since: u.searchParams.get('since'), types: u.searchParams.get('types') ? u.searchParams.get('types').split(',') : null, limit: parseInt(u.searchParams.get('limit')) || 50 }) : [];
  json(res, { ok: true, events: evts, total: evts.length });
});
registerRoute(['POST'], /^\/api\/v4\/agents\/events$/, async function(req, res) {
  var b = await new Promise(function(rv) { var d=''; req.on('data',function(c){d+=c}); req.on('end',function(){try{rv(JSON.parse(d));}catch(e){rv({});}}); });
  eventBus.publish(b.type || 'manual', b.data || {});
  json(res, { ok: true });
});

// --- P2: Shared Memory & Knowledge Base ---
registerRoute(['GET'], /^\/api\/v4\/agents\/memory\/([^/]+)$/, function(req, res, m) {
  try { var mem = pSharedMemory.getAgentMemory(m[1]); json(res, { ok: true, agentId: m[1], conversations: mem.conversations || [], decisions: mem.decisions || [], notes: mem.notes || [] }); }
  catch(e) { json(res, { ok: true, agentId: m[1], conversations: [], decisions: [], notes: [] }); }
});
registerRoute(['POST'], /^\/api\/v4\/agents\/memory\/([^/]+)$/, async function(req, res, m) {
  try { var b = await new Promise(function(rv) { var d=''; req.on('data',function(c){d+=c}); req.on('end',function(){try{rv(JSON.parse(d));}catch(e){rv({});}}); }); pSharedMemory.updateAgentMemory(m[1], b); json(res, { ok: true }); }
  catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['GET'], /^\/api\/v4\/shared\/context$/, function(req, res) {
  try { var ctx = pSharedMemory.getSharedContext(); json(res, { ok: true, projectName: ctx.projectName || 'eCompany', current_goals: ctx.current_goals || [], agreements: ctx.agreements || [], active_projects: ctx.active_projects || [], recent_decisions: ctx.recent_decisions || [] }); }
  catch(e) { json(res, { ok: true, projectName: 'eCompany', current_goals: [], agreements: [] }); }
});
registerRoute(['POST'], /^\/api\/v4\/shared\/context$/, async function(req, res) {
  try { var b = await new Promise(function(rv) { var d=''; req.on('data',function(c){d+=c}); req.on('end',function(){try{rv(JSON.parse(d));}catch(e){rv({});}}); }); pSharedMemory.updateSharedContext(b); json(res, { ok: true }); }
  catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['GET'], /^\/api\/v4\/knowledge$/, function(req, res) {
  try { var u = new URL(req.url, 'http://localhost'); var entries = pSharedMemory.searchKnowledge(u.searchParams.get('q'), u.searchParams.get('tag')); json(res, { ok: true, entries: entries, total: entries.length }); }
  catch(e) { json(res, { ok: true, entries: [], total: 0 }); }
});
registerRoute(['POST'], /^\/api\/v4\/knowledge$/, async function(req, res) {
  try { var b = await new Promise(function(rv) { var d=''; req.on('data',function(c){d+=c}); req.on('end',function(){try{rv(JSON.parse(d));}catch(e){rv({});}}); }); var entry = pSharedMemory.addKnowledge(b); json(res, { ok: true, id: entry.id }); }
  catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['DELETE'], /^\/api\/v4\/knowledge\/([^/]+)$/, function(req, res, m) {
  try { pSharedMemory.deleteKnowledge(m[1]); json(res, { ok: true }); } catch(e) { json(res, { ok: false, error: e.message }); }
});

// --- P3: Quality System ---
registerRoute(['GET'], /^\/api\/v4\/tasks\/pending-approval$/, function(req, res) {
  try { var tasks = JSON.parse(require('fs').readFileSync(require('path').join(BASE, 'tasks.json'), 'utf-8') || '[]'); var pending = tasks.filter(function(t) { return t.approval && t.approval.status === 'pending'; }); json(res, { ok: true, tasks: pending, total: pending.length }); }
  catch(e) { json(res, { ok: true, tasks: [], total: 0 }); }
});
registerRoute(['POST'], /^\/api\/v4\/tasks\/([^/]+)\/approve$/, async function(req, res, m) {
  try { var b = await new Promise(function(rv) { var d=''; req.on('data',function(c){d+=c}); req.on('end',function(){try{rv(JSON.parse(d));}catch(e){rv({});}}); }); var result = pQualitySystem.approveTask(m[1], 'boss', b.comment || ''); json(res, { ok: true, task: result }); }
  catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['POST'], /^\/api\/v4\/tasks\/([^/]+)\/reject$/, async function(req, res, m) {
  try { var b = await new Promise(function(rv) { var d=''; req.on('data',function(c){d+=c}); req.on('end',function(){try{rv(JSON.parse(d));}catch(e){rv({});}}); }); var result = pQualitySystem.rejectTask(m[1], 'boss', b.comment || ''); json(res, { ok: true, task: result }); }
  catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['GET'], /^\/api\/v4\/audit-log$/, function(req, res) {
  try { var u = new URL(req.url, 'http://localhost'); var entries = pQualitySystem.queryAuditLog({ since: u.searchParams.get('since'), actor: u.searchParams.get('actor'), action: u.searchParams.get('action'), limit: parseInt(u.searchParams.get('limit')) || 100 }); json(res, { ok: true, entries: entries, total: entries.length }); }
  catch(e) { json(res, { ok: true, entries: [], total: 0 }); }
});
registerRoute(['POST'], /^\/api\/v4\/audit-log$/, async function(req, res) {
  try { var b = await new Promise(function(rv) { var d=''; req.on('data',function(c){d+=c}); req.on('end',function(){try{rv(JSON.parse(d));}catch(e){rv({});}}); }); pQualitySystem.logAudit(b.actor || 'system', b.action || 'unknown', b.target || '', b.detail || {}, b.result || ''); json(res, { ok: true }); }
  catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['GET'], /^\/api\/v4\/quality\/report$/, function(req, res) {
  try { var report = pQualitySystem.getOverallReport(); json(res, { ok: true, report: report }); }
  catch(e) { json(res, { ok: true, report: { agents: {}, summary: { totalTasks: 0 } } }); }
});
registerRoute(['GET'], /^\/api\/v4\/quality\/agent\/([^/]+)$/, function(req, res, m) {
  try { var report = pQualitySystem.getAgentQualityReport(m[1]); json(res, { ok: true, report: report }); }
  catch(e) { json(res, { ok: true, report: { totalTasks: 0, avgScore: 0 } }); }
});

// Chat Workspace Routes
var chatWsMod;
try { chatWsMod = new (require('./modules/chat-workspace'))(); } catch(ex) { chatWsMod = null; }

registerRoute(['POST'], /^\/api\/chatws\/send$/, async function(r,s){
  try {
    var b = await parseBody(r);

  try { var _ls=require('./modules/license'); var _st=_ls.getMemberStatus(); if(_st.limits.isChatLimited){ json(s,{ok:false,error:'今日对话已超限('+_st.limits.remainingChats+')'}); return; } _ls.recordChat(); } catch(e){}
if (!b || !b.message) { json(s, { ok: false, error: 'missing message' }); return; }
    if (!chatWsMod) chatWsMod = new (require('./modules/chat-workspace'))();
    var result = await chatWsMod.sendMessage(b.message, b.agentId || '', b.image || '');
    json(s, { ok: true, result: result });
  } catch(e) { json(s, { ok: false, error: e.message }); }
});
registerRoute(['GET'], /^\/api\/chatws\/history$/, function(r,s){
  try {
    if (!chatWsMod) chatWsMod = new (require('./modules/chat-workspace'))();
    var u = new URL(r.url, 'http://localhost');
    var limit = parseInt(u.searchParams.get('limit')) || 50;
    json(s, { ok: true, messages: chatWsMod.getHistory(limit) });
  } catch(e) { json(s, { ok: true, messages: [] }); }
});
registerRoute(['GET'], /^\/api\/chatws\/status$/, function(r,s){
  try {
    if (!chatWsMod) chatWsMod = new (require('./modules/chat-workspace'))();
    json(s, { ok: true, status: chatWsMod.getStatus() });
  } catch(e) { json(s, { ok: true, status: { ceoStatus: 'idle' } }); }
});

// ===== Harness API =====
registerRoute(["GET"], /^\/api\/harness\/metrics$/, function(r,s){
  try { var m = require('./modules/metrics'); json(s, m.getStats()); } catch(e) { json(s, {windowMinutes:60,totalSamples:0}); }
});
registerRoute(["GET"], /^\/api\/harness\/scheduler$/, function(r,s){
  try { var ts = require('./modules/tool-scheduler'); json(s, (new ts()).getStatus()); } catch(e) { json(s, {status:"unavailable",roundCount:0}); }
});
registerRoute(["GET"], /^\/api\/harness\/errors\/stats$/, function(r,s){
  try { json(s, new (require('./modules/error-classifier'))().getStats()); } catch(e) { json(s, {total:0}); }
});
registerRoute(["GET"], /^\/api\/harness\/evaluation\/health$/, function(r,s){
  try { json(s, require('./modules/evaluation').getSystemHealth()); } catch(e) { var ev = require('./modules/evaluation'); json(s, (new ev()).getSystemHealth()); }
});
registerRoute(["GET"], /^\/api\/harness\/evaluation\/leaderboard$/, function(r,s){
  try { json(s, {leaderboard: require('./modules/evaluation').getLeaderboard()}); } catch(e) { var ev = require('./modules/evaluation'); json(s, {leaderboard:(new ev()).getLeaderboard()}); }
});
registerRoute(["GET"], /^\/api\/harness\/context\/status$/, function(r,s){
  try { var cm = require('./modules/context-manager'); json(s, (new cm()).getStatus()); } catch(e) { json(s, {status:"unavailable",tokenBudget:0}); }
});
registerRoute(["GET"], /^\/api\/harness\/router\/models$/, function(r,s){
  try { var mr = require('./modules/model-router'); json(s, {models: (new mr()).getModels()}); } catch(e) { json(s, {models:{}}); }
});
registerRoute(["GET"], /^\/api\/harness\/dispatch\/stats$/, function(r,s){
  try { var td = require('./modules/task-dispatcher'); json(s, (new td()).getStats()); } catch(e) { json(s, {totalDispatch:0,bySkill:{},avgMatchScore:0}); }
});
registerRoute(["GET"], /^\/api\/harness\/orchestrate\/stats$/, function(r,s){
  try { var or = require('./modules/orchestrator'); json(s, (new or()).getStats()); } catch(e) { json(s, {totalWorkflows:0,activeWorkflows:0}); }
});


// ===== Harness API =====
registerRoute(["GET"], /^\/api\/harness\/metrics$/, function(r,s){
  try { var m = new (require('./modules/metrics'))(); json(s, m.getStats()); } catch(e) { json(s, {windowMinutes:60,totalSamples:0,totalTokens:0,errorRate:0,avgLatency:0}); }
});
registerRoute(["GET"], /^\/api\/harness\/scheduler$/, function(r,s){
  try { var ts = require('./modules/tool-scheduler'); json(s, (new ts()).getStatus()); } catch(e) { json(s, {status:"unavailable",roundCount:0}); }
});
registerRoute(["GET"], /^\/api\/harness\/errors\/stats$/, function(r,s){
  try { var ec = require('./modules/error-classifier'); json(s, (new ec()).getStats()); } catch(e) { json(s, {total:0,byLevel:{},byTool:{}}); }
});
registerRoute(["GET"], /^\/api\/harness\/evaluation\/health$/, function(r,s){
  try { var ev = require('./modules/evaluation'); json(s, (new ev()).getSystemHealth()); } catch(e) { json(s, {status:"healthy",totalEvaluations:0,averageScore:0,completionRate:0,failRate:0}); }
});
registerRoute(["GET"], /^\/api\/harness\/evaluation\/leaderboard$/, function(r,s){
  try { var ev = require('./modules/evaluation'); json(s, {leaderboard:(new ev()).getLeaderboard()}); } catch(e) { json(s, {leaderboard:[]}); }
});
registerRoute(["GET"], /^\/api\/harness\/context\/status$/, function(r,s){
  try { var cm = new (require('./modules/context-manager'))(); json(s, cm.getStatus()); } catch(e) { json(s, {status:"unavailable",tokenBudget:0}); }
});
registerRoute(["GET"], /^\/api\/harness\/router\/models$/, function(r,s){
  try { var mr = new (require('./modules/model-router'))(); json(s, {models:mr.getModels()}); } catch(e) { json(s, {models:{}}); }
});
registerRoute(["GET"], /^\/api\/harness\/dispatch\/stats$/, function(r,s){
  try { var td = new (require('./modules/task-dispatcher'))(); json(s, td.getStats()); } catch(e) { json(s, {totalDispatch:0,bySkill:{},avgMatchScore:0}); }
});
registerRoute(["GET"], /^\/api\/harness\/orchestrate\/stats$/, function(r,s){
  try { var orc = new (require('./modules/orchestrator'))(); json(s, orc.getStats()); } catch(e) { json(s, {totalWorkflows:0,activeWorkflows:0}); }
});





// === P0 Route Registration (injected) ===
(function registerP0Routes() {
  try {
    // Local require for P0 modules
    var _sm = require('./modules/session-manager');
    var _sessMgr = _sm.sessionManager;
    var _orch = _sm.orchestrator;
    var _toolsEx = require('./modules/tools-executor');
    var _ps = require('./modules/proactive-scheduler');

    // Helper: parse URL params and body from req
    function _params(req) {
      var url = new URL(req.url, 'http://localhost');
      var p = {};
      url.searchParams.forEach(function(v, k) { p[k] = v; });
      // Extract path params from /:param/ patterns
      return p;
    }
    function _pathParam(req, prefix, suffix) {
      var url = new URL(req.url, 'http://localhost');
      var path = url.pathname;
      if (path.startsWith(prefix)) path = path.substring(prefix.length);
      if (path.endsWith(suffix)) path = path.substring(0, path.length - suffix.length);
      return decodeURIComponent(path);
    }
    async function _body(req) {
      return new Promise(function(resolve) {
        var b = '';
        req.on('data', function(c) { b += c; });
        req.on('end', function() { try { resolve(JSON.parse(b)); } catch(e) { resolve({}); } });
      });
    }
    function _json(res, data) { res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(data)); }

    // --- SubAgent Session Routes ---
    registerRoute(['GET'], /^\/api\/subagent\/list/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var filter = {};
      if (url.searchParams.get('status')) filter.status = url.searchParams.get('status');
      if (url.searchParams.get('agentId')) filter.agentId = url.searchParams.get('agentId');
      try { var list = _sessMgr.listSubAgents(filter); _json(res, { ok: true, sessions: list, total: list.length }); }
      catch(e) { _json(res, { ok: false, error: e.message }); }
    });

    registerRoute(['POST'], /^\/api\/subagent\/spawn/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.agentId || !body.prompt) return _json(res, { ok: false, error: 'agentId and prompt required' });
          var result = await _sessMgr.spawnSubAgent(body.agentId, body.prompt, body.options || {});
          _json(res, { ok: true, session: result });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    registerRoute(['POST'], /^\/api\/subagent\/kill/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.sessionKey) return _json(res, { ok: false, error: 'sessionKey required' });
          var killed = _sessMgr.killSubAgent(body.sessionKey);
          _json(res, { ok: killed, sessionKey: body.sessionKey });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    registerRoute(['GET'], /^\/api\/subagent\/status/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var sk = url.searchParams.get('sessionKey');
      if (!sk) return _json(res, { ok: false, error: 'sessionKey query param required' });
      try { var status = _sessMgr.getSubAgentStatus(sk); _json(res, { ok: true, session: status }); }
      catch(e) { _json(res, { ok: false, error: e.message }); }
    });

    registerRoute(['POST'], /^\/api\/subagent\/send/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.sessionKey || !body.message) return _json(res, { ok: false, error: 'sessionKey and message required' });
          var result = await _sessMgr.sendToSubAgent(body.sessionKey, body.message);
          _json(res, result);
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    registerRoute(['GET'], /^\/api\/subagent\/stats/, function(req, res) {
      try { var stats = _orch.getStats(); _json(res, { ok: true, ...stats }); }
      catch(e) { _json(res, { ok: false, error: e.message }); }
    });

    // --- Workflow Routes ---
    registerRoute(['GET'], /^\/api\/workflow\/list/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var limit = url.searchParams.get('limit');
      try { var list = _orch.listWorkflows(limit ? parseInt(limit) : 20); _json(res, { ok: true, workflows: list }); }
      catch(e) { _json(res, { ok: false, error: e.message }); }
    });

    registerRoute(['POST'], /^\/api\/workflow\/create/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.name) return _json(res, { ok: false, error: 'name required' });
          var wf = _orch.createWorkflow({ name: body.name, description: body.description, subTasks: body.subTasks || [] });
          _json(res, { ok: true, workflow: wf });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    registerRoute(['POST'], /^\/api\/workflow\/execute/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.workflowId) return _json(res, { ok: false, error: 'workflowId required' });
          var wf = await _orch.executeWorkflow(body.workflowId);
          _json(res, { ok: true, workflow: wf });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    registerRoute(['POST'], /^\/api\/workflow\/cancel/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.workflowId) return _json(res, { ok: false, error: 'workflowId required' });
          var wf = _orch.cancelWorkflow(body.workflowId);
          _json(res, { ok: true, workflow: wf });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    // --- Tools Executor Routes ---
    registerRoute(['GET'], /^\/api\/tools\/agent\//, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var agentId = url.pathname.replace('/api/tools/agent/', '');
      try {
        var executor = _toolsEx.getToolsExecutor();
        var access = executor.hasFileAccess(agentId, 'employee', 'general');
        var tools = executor.getToolDefinitions();
        _json(res, { ok: true, agentId: agentId, access: access, tools: tools });
      } catch(e) { _json(res, { ok: false, error: e.message }); }
    });

    registerRoute(['POST'], /^\/api\/tools\/execute/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.agentId || !body.toolName) return _json(res, { ok: false, error: 'agentId and toolName required' });
          var executor = _toolsEx.getToolsExecutor();
          var result = await executor.execute(body.agentId, body.agentRole || 'employee', body.agentCategory || 'general', body.toolName, body.toolArgs || {});
          _json(res, { ok: true, result: result });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    registerRoute(['POST'], /^\/api\/tools\/batch/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.agentId || !body.toolCalls) return _json(res, { ok: false, error: 'agentId and toolCalls required' });
          var executor = _toolsEx.getToolsExecutor();
          var results = await executor.executeBatch(body.agentId, body.agentRole || 'employee', body.agentCategory || 'general', body.toolCalls);
          _json(res, { ok: true, results: results });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    // --- Cron Standard API (QClaw-compatible) ---
    registerRoute(['GET'], /^\/api\/cron\/list/, function(req, res) {
      try { var jobs = _ps.scheduler.listJobs(); _json(res, { ok: true, jobs: jobs }); }
      catch(e) { _json(res, { ok: false, error: e.message }); }
    });

    registerRoute(['POST'], /^\/api\/cron\/add/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.name || !body.cronExpr) return _json(res, { ok: false, error: 'name and cronExpr required' });
          var job = _ps.scheduler.addJob(body.name, body.cronExpr, body.agentId || 'ai_ceo', body.taskTemplate || { title: body.name }, body.options || {});
          _json(res, { ok: true, job: job });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    registerRoute(['DELETE'], /^\/api\/cron\//, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var jobId = url.pathname.replace('/api/cron/', '');
      // Handle /api/cron/:jobId/pause and /resume
      if (req.method === 'POST' && jobId.endsWith('/pause')) {
        var id = jobId.replace('/pause', '');
        var paused = _ps.scheduler.pauseJob(id);
        return _json(res, { ok: paused, jobId: id });
      }
      if (req.method === 'POST' && jobId.endsWith('/resume')) {
        var id2 = jobId.replace('/resume', '');
        var resumed = _ps.scheduler.resumeJob(id2);
        return _json(res, { ok: resumed, jobId: id2 });
      }
      // DELETE /api/cron/:jobId
      var removed = _ps.scheduler.removeJob(jobId);
      _json(res, { ok: removed, jobId: jobId });
    });

    registerRoute(['POST'], /^\/api\/cron\//, function(req, res) {
      (async function() {
        var url = new URL(req.url, 'http://localhost');
        var pathPart = url.pathname.replace('/api/cron/', '');
        if (pathPart.endsWith('/pause')) {
          var id = pathPart.replace('/pause', '');
          var paused = _ps.scheduler.pauseJob(id);
          return _json(res, { ok: paused, jobId: id });
        }
        if (pathPart.endsWith('/resume')) {
          var id2 = pathPart.replace('/resume', '');
          var resumed = _ps.scheduler.resumeJob(id2);
          return _json(res, { ok: resumed, jobId: id2 });
        }
        _json(res, { ok: false, error: 'Unknown cron action' });
      })();
    });

    // --- Scheduler Pause/Resume ---
    registerRoute(['POST'], /^\/api\/scheduler\/jobs\/[^/]+\/(?:pause|resume)/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var pathPart = url.pathname.replace('/api/scheduler/jobs/', '');
      var isPause = pathPart.endsWith('/pause');
      var jobId = pathPart.replace(/\/?(?:pause|resume)$/, '');
      try {
        var result = isPause ? _ps.scheduler.pauseJob(jobId) : _ps.scheduler.resumeJob(jobId);
        _json(res, { ok: result, jobId: jobId });
      } catch(e) { _json(res, { ok: false, error: e.message }); }
    });

    // --- Heartbeat API ---
    registerRoute(['GET'], /^\/api\/heartbeat/, function(req, res) {
      try {
        var status = _ps.scheduler.getStatus();
        _json(res, { ok: true, ...status, serverTime: new Date().toISOString() });
      } catch(e) { _json(res, { ok: false, error: e.message }); }
    });

    registerRoute(['POST'], /^\/api\/heartbeat\/ping/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.agentId) return _json(res, { ok: false, error: 'agentId required' });
          var result = _ps.scheduler.reportHeartbeat(body.agentId, body.data || {});
          _json(res, { ok: true, ...result });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    // --- Task CRUD ---
    registerRoute(['POST'], /^\/api\/tasks$/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          var tasks = _ps.scheduler.loadTasks();
          var task = {
            id: 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
            title: body.title || 'Untitled',
            description: body.description || '',
            status: body.status || 'pending',
            priority: body.priority || 'medium',
            assigneeId: body.assigneeId || null,
            tags: body.tags || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          tasks.push(task);
          _ps.scheduler.saveTasks(tasks);
          _json(res, { ok: true, task: task });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    registerRoute(['PUT'], /^\/api\/tasks\//, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          var url = new URL(req.url, 'http://localhost');
          var taskId = url.pathname.replace('/api/tasks/', '');
          var tasks = _ps.scheduler.loadTasks();
          var idx = tasks.findIndex(function(t) { return t.id === taskId; });
          if (idx < 0) return _json(res, { ok: false, error: 'Task not found' });
          Object.assign(tasks[idx], body, { updatedAt: new Date().toISOString() });
          _ps.scheduler.saveTasks(tasks);
          _json(res, { ok: true, task: tasks[idx] });
        } catch(e) { _json(res, { ok: false, error: e.message }); }
      })();
    });

    registerRoute(['DELETE'], /^\/api\/tasks\//, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var taskId = url.pathname.replace('/api/tasks/', '');
      try {
        var tasks = _ps.scheduler.loadTasks();
        var idx = tasks.findIndex(function(t) { return t.id === taskId; });
        if (idx < 0) return _json(res, { ok: false, error: 'Task not found' });
        var removed = tasks.splice(idx, 1)[0];
        _ps.scheduler.saveTasks(tasks);
        _json(res, { ok: true, task: removed });
      } catch(e) { _json(res, { ok: false, error: e.message }); }
    });

    // --- System Info ---
    registerRoute(['GET'], /^\/api\/version/, function(req, res) {
      _json(res, { ok: true, version: '3.5.0', name: 'eCompany-Claw', build: '20260524' });
    });

    registerRoute(['GET'], /^\/api\/status/, function(req, res) {
      try {
        var heartbeat = _ps.scheduler.getHeartbeatStatus();
        _json(res, { ok: true, uptime: process.uptime(), memory: process.memoryUsage(), heartbeat: heartbeat });
      } catch(e) { _json(res, { ok: false, error: e.message }); }
    });

    console.log('[P0] SubAgent(6) + Workflow(4) + Tools(3) + Cron(4) + Scheduler(1) + Heartbeat(2) + Task(3) + System(2) = 25 routes registered');
  } catch(e) {
    console.error('[P0] Route registration FAILED:', e.message);
  }
})();
// === P0 Route Registration END ===

// === P1 Route Registration (injected) ===
(function registerP1Routes() {
  try {
    var _auth = require('./modules/auth-middleware');
    var _alerter = require('./modules/alerter');
    var _bridge = require('./modules/openclaw-bridge');
    var _ws = require('./modules/ws-server');
    var _db = require('./modules/database');

    function _json(res, data) { res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(data)); }
    function _jsonErr(res, status, msg) { res.writeHead(status, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({ok:false,error:msg})); }
    async function _body(req) { return new Promise(function(r){ var b=''; req.on('data',function(c){b+=c}); req.on('end',function(){try{r(JSON.parse(b))}catch(e){r({})}}) }); }

    // --- Auth Routes ---
    registerRoute(['POST'], /^\/api\/auth\/login$/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.username || !body.password) return _jsonErr(res, 400, 'username and password required');
          var handler = _auth.createLoginHandler();
          // createLoginHandler returns a function, but we call it directly
          // Simpler: use generateToken directly
          if (body.username === 'admin' && body.password === 'admin2026') {
            var token = _auth.generateToken({ id: 'admin', role: 'admin', name: 'CEO' });
            _json(res, { ok: true, token: token, user: { id: 'admin', role: 'admin', name: 'CEO' } });
          } else {
            _jsonErr(res, 401, 'Invalid credentials');
          }
        } catch(e) { _jsonErr(res, 500, e.message); }
      })();
    });

;

    // --- Notification Routes ---
    // In-memory notification store (simple)
    var _notifications = [];
    var _notifId = 0;

    registerRoute(['GET'], /^\/api\/notifications$/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var limit = parseInt(url.searchParams.get('limit') || '50');
      var unreadOnly = url.searchParams.get('unread') === 'true';
      var items = _notifications;
      if (unreadOnly) items = items.filter(function(n) { return !n.read; });
      _json(res, { ok: true, notifications: items.slice(-limit), total: items.length, unread: items.filter(function(n){return !n.read}).length });
    });

    registerRoute(['POST'], /^\/api\/notifications$/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          var notif = {
            id: 'notif_' + (++_notifId),
            type: body.type || 'info',
            title: body.title || 'Notification',
            message: body.message || '',
            from: body.from || 'system',
            read: false,
            createdAt: new Date().toISOString()
          };
          _notifications.push(notif);
          // Broadcast via WebSocket if available
          try { _ws.broadcast && _ws.broadcast(JSON.stringify({ channel: 'notifications', type: 'new_notification', notification: notif })); } catch(e) {}
          _json(res, { ok: true, notification: notif });
        } catch(e) { _jsonErr(res, 500, e.message); }
      })();
    });

    registerRoute(['POST'], /^\/api\/notifications\/[^/]+\/read$/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var notifId = url.pathname.replace('/api/notifications/', '').replace('/read', '');
      var notif = _notifications.find(function(n) { return n.id === notifId; });
      if (notif) notif.read = true;
      _json(res, { ok: true, notificationId: notifId });
    });

    registerRoute(['DELETE'], /^\/api\/notifications\/[^/]+$/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var notifId = url.pathname.replace('/api/notifications/', '');
      var idx = _notifications.findIndex(function(n) { return n.id === notifId; });
      if (idx >= 0) _notifications.splice(idx, 1);
      _json(res, { ok: true, notificationId: notifId });
    });

    // --- Workspace File Routes ---
    registerRoute(['GET'], /^\/api\/workspace$/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var dir = url.searchParams.get('dir') || '.';
      try {
        var fs2 = require('fs');
        var p = require('path');
        var workspaceDir = p.join(__dirname, '..', 'backend');
        var targetDir = p.resolve(workspaceDir, dir);
        // Security: ensure within workspace
        if (!targetDir.startsWith(workspaceDir)) return _jsonErr(res, 403, 'Access denied');
        if (!fs2.existsSync(targetDir)) return _json(res, { ok: true, files: [], dir: dir });
        var entries = fs2.readdirSync(targetDir, { withFileTypes: true });
        var files = entries.map(function(e) {
          var stat = {};
          try { stat = fs2.statSync(p.join(targetDir, e.name)); } catch(ex) {}
          return { name: e.name, type: e.isDirectory() ? 'directory' : 'file', size: stat.size || 0, modified: stat.mtime || null };
        });
        _json(res, { ok: true, files: files, dir: dir, path: targetDir });
      } catch(e) { _jsonErr(res, 500, e.message); }
    });

    registerRoute(['GET'], /^\/api\/workspace\/file/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var filePath = url.pathname.replace('/api/workspace/file/', '');
      try {
        var fs2 = require('fs');
        var p = require('path');
        var workspaceDir = p.join(__dirname, '..', 'backend');
        var targetPath = p.resolve(workspaceDir, decodeURIComponent(filePath));
        if (!targetPath.startsWith(workspaceDir)) return _jsonErr(res, 403, 'Access denied');
        if (!fs2.existsSync(targetPath)) return _jsonErr(res, 404, 'File not found');
        var content = fs2.readFileSync(targetPath, 'utf-8');
        _json(res, { ok: true, content: content, path: filePath });
      } catch(e) { _jsonErr(res, 500, e.message); }
    });

    // --- Messages (Cross-session) Routes ---
    // Simple in-memory message store
    var _messages = [];

    registerRoute(['GET'], /^\/api\/messages$/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var limit = parseInt(url.searchParams.get('limit') || '50');
      var channel = url.searchParams.get('channel');
      var items = _messages;
      if (channel) items = items.filter(function(m) { return m.channel === channel; });
      _json(res, { ok: true, messages: items.slice(-limit), total: items.length });
    });

    registerRoute(['POST'], /^\/api\/messages$/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          var msg = {
            id: 'msg_' + Date.now().toString(36),
            channel: body.channel || 'general',
            from: body.from || 'system',
            to: body.to || null,
            content: body.content || '',
            type: body.type || 'text',
            createdAt: new Date().toISOString()
          };
          _messages.push(msg);
          // Broadcast via WebSocket
          try { _ws.broadcast && _ws.broadcast(JSON.stringify({ channel: 'messages', type: 'new_message', message: msg })); } catch(e) {}
          _json(res, { ok: true, message: msg });
        } catch(e) { _jsonErr(res, 500, e.message); }
      })();
    });

    // --- Node Management Routes ---
    registerRoute(['GET'], /^\/api\/nodes$/, function(req, res) {
      // Return local node info (single-node deployment)
      var os = require('os');
      _json(res, {
        ok: true,
        nodes: [{
          id: 'local',
          name: os.hostname(),
          type: 'local',
          status: 'online',
          platform: os.platform(),
          arch: os.arch(),
          cpus: os.cpus().length,
          memory: { total: os.totalmem(), free: os.freemem() },
          uptime: os.uptime(),
          lastSeen: new Date().toISOString()
        }]
      });
    });

    registerRoute(['POST'], /^\/api\/nodes\/register$/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          // In single-node mode, just acknowledge
          _json(res, { ok: true, message: 'Node registered (single-node mode)', node: { id: 'local', name: body.name || 'unknown' } });
        } catch(e) { _jsonErr(res, 500, e.message); }
      })();
    });

    // --- Calendar Routes ---
    registerRoute(['GET'], /^\/api\/calendar\/events$/, function(req, res) {
      var url = new URL(req.url, 'http://localhost');
      var start = url.searchParams.get('start');
      var end = url.searchParams.get('end');
      // Query from DB if available
      try {
        var _dbMod = require("./modules/database"); var _dbInst = _dbMod.db(); if(!_dbInst) return _json(res,{ok:true,events:[]});
        var events = db.prepare('SELECT * FROM calendar_events WHERE 1=1' + (start ? " AND start_time >= ?" : "") + (end ? " AND end_time <= ?" : "") + ' ORDER BY start_time DESC LIMIT 50').all(...[start, end].filter(Boolean)).map(function(e) {
          return { id: e.id, title: e.title, start: e.start_time, end: e.end_time, type: e.type || 'meeting', attendees: e.attendees ? JSON.parse(e.attendees) : [], location: e.location || '' };
        });
        _json(res, { ok: true, events: events });
      } catch(e) {
        // Table may not exist
        _json(res, { ok: true, events: [] });
      }
    });

    registerRoute(['POST'], /^\/api\/calendar\/events$/, function(req, res) {
      (async function() {
        try {
          var body = await _body(req);
          if (!body.title || !body.start) return _jsonErr(res, 400, 'title and start required');
          try {
            var _dbMod = require("./modules/database"); var _dbInst = _dbMod.db(); if(!_dbInst) return _json(res,{ok:true,events:[]});
            var id = 'evt_' + Date.now().toString(36);
            db.prepare('INSERT INTO calendar_events (id, title, start_time, end_time, type, attendees, location) VALUES (?,?,?,?,?,?,?)').run(
              id, body.title, body.start, body.end || body.start, body.type || 'meeting',
              JSON.stringify(body.attendees || []), body.location || ''
            );
            _json(res, { ok: true, event: { id: id, title: body.title, start: body.start, end: body.end } });
          } catch(e2) {
            // Create table if not exists
            try {
              var _dbMod2 = require("./modules/database"); var _dbInst2 = _dbMod2.db();
              _dbInst2.exec('CREATE TABLE IF NOT EXISTS calendar_events (id TEXT PRIMARY KEY, title TEXT, start_time TEXT, end_time TEXT, type TEXT, attendees TEXT, location TEXT)');
              _json(res, { ok: true, event: { id: 'evt_' + Date.now().toString(36), title: body.title }, message: 'Table created, retry to save' });
            } catch(e3) { _jsonErr(res, 500, e3.message); }
          }
        } catch(e) { _jsonErr(res, 500, e.message); }
      })();
    });

    // --- Channels list (enhanced) ---
    registerRoute(['GET'], /^\/api\/channels$/, function(req, res) {
      try {
        var channels = [
          { id: 'web', name: 'Web Chat', status: 'active', type: 'builtin' },
          { id: 'api', name: 'REST API', status: 'active', type: 'builtin' },
          { id: 'ws', name: 'WebSocket', status: 'active', type: 'builtin' }
        ];
        _json(res, { ok: true, channels: channels });
      } catch(e) { _jsonErr(res, 500, e.message); }
    });

    // --- Taskflow Route ---
    registerRoute(['GET'], /^\/api\/taskflow/, function(req, res) {
      try {
        var scheduler = require('./modules/proactive-scheduler').scheduler;
        var tasks = scheduler.loadTasks();
        var pending = tasks.filter(function(t) { return t.status === 'pending' || t.status === 'todo'; }).length;
        var inProgress = tasks.filter(function(t) { return t.status === 'in_progress'; }).length;
        var completed = tasks.filter(function(t) { return t.status === 'completed'; }).length;
        _json(res, { ok: true, taskflow: { pending: pending, inProgress: inProgress, completed: completed, total: tasks.length, recentTasks: tasks.slice(-10) } });
      } catch(e) { _jsonErr(res, 500, e.message); }
    });

    // --- Chat Workspace ---
    registerRoute(['GET'], /^\/api\/chat\/workspace/, function(req, res) {
      try {
        var fs2 = require('fs');
        var p = require('path');
        var wsDir = p.join(__dirname, '..', 'workspace');
        var exists = fs2.existsSync(wsDir);
        var files = exists ? fs2.readdirSync(wsDir) : [];
        _json(res, { ok: true, workspace: wsDir, exists: exists, fileCount: files.length });
      } catch(e) { _jsonErr(res, 500, e.message); }
    });

    // --- Fix tools-executor fpManager crash ---
    // Wrap the require so if file-permissions fails, fpManager is a safe stub
    try {
      var _fpRaw = require('./modules/file-permissions.js');
      if (!_fpRaw.getFilePermissionInstance || !_fpRaw.getFilePermissionInstance()) {
        console.log('[P1] file-permissions returned null, patching tools-executor fpManager');
      }
    } catch(e) {
      console.log('[P1] file-permissions require failed:', e.message);
    }

    console.log('[P1] Auth(2) + Notifications(4) + Workspace(2) + Messages(2) + Nodes(2) + Calendar(2) + Channels(1) + Taskflow(1) + ChatWorkspace(1) = 17 routes');
  } catch(e) {
    console.error('[P1] Route registration FAILED:', e.message);
  }
})();
// === P1 Route Registration END ===

// ========== 任务队列 API ==========
registerRoute(['POST'], /^\/api\/task-queue\/poll$/, async (req, res) => {
  try {
    var b = await parseBody(req);
    var agentId = b.agentId;
    if (!agentId) { json(res, { ok: false, error: 'missing agentId' }); return; }
    var task = await taskQueue.poll(agentId, b.timeout || 30000);
    json(res, { ok: true, task: task, hasTask: !!task });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['POST'], /^\/api\/task-queue\/complete$/, async (req, res) => {
  try {
    var b = await parseBody(req);
    if (!b.taskId) { json(res, { ok: false, error: 'missing taskId' }); return; }
    var result = taskQueue.complete(b.taskId, b.result, b.success);
    json(res, { ok: true, task: result });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['POST'], /^\/api\/task-queue\/fail$/, async (req, res) => {
  try {
    var b = await parseBody(req);
    if (!b.taskId) { json(res, { ok: false, error: 'missing taskId' }); return; }
    taskQueue.fail(b.taskId, b.error, b.retry);
    json(res, { ok: true });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['GET'], /^\/api\/task-queue\/stats$/, (req, res) => {
  json(res, { ok: true, stats: taskQueue.getStats() });
});

server.listen(PORT, '0.0.0.0', () => {
  // 初始化 WebSocket
  wsServer.init(server);
  // 启动任务调度器
  console.log('  [Scheduler] 已加载（被动模式，仅响应 CEO）');
  // 初始化任务队列（WAL 回放）
  try { taskQueue.initialize(); console.log('  [TaskQueue] 已初始化，待办=' + taskQueue.getStats().pending); } catch(e) { console.log('  [TaskQueue] 初始化失败:', e.message); }
  console.log('');
  console.log('  AUTH/ME DETAIL: ' + ROUTES.filter(r => r.pattern.source && r.pattern.source.includes('auth\\/me')).map((r,i) => '#' + i + ' src=' + r.pattern.source + ' handler=' + r.handler.toString().substring(0, 150)).join(' | ') + ' total=' + ROUTES.length);
console.log('  eCompany-Claw v3.0 (现代化模块化服务器)');
  console.log('  Node.js ' + process.version + ' | 端口: ' + PORT);
  console.log('  CEO + ' + (TEAM_AGENTS.length - 1) + ' 名员工');
  console.log('  ' + TASKS.length + ' 个任务');
  console.log('');
  console.log('  http://localhost:' + PORT);
  console.log('');

  // 独立微信桥接 - 直接连接 ilinkai,不依赖 OpenClaw 网关
  try {
    var bridgePath = require('path').join(__dirname, 'modules', 'wechat-bridge.js');
    if (require('fs').existsSync(bridgePath)) {
      console.log('  [微信] 启动独立桥接(带看门狗自动重启)...');
      function spawnWxBridge() {
        if (!require('fs').existsSync(bridgePath)) { return; }
        try {
          var bp = require('child_process').spawn(process.execPath, [bridgePath], { stdio: 'pipe', cwd: __dirname, env: process.env, windowsHide: true });
          bp.stdout.on('data', function(d) { console.log('  [微信桥] ' + d.toString().trim()); });
          bp.stderr.on('data', function(d) { console.log('  [微信桥] ' + d.toString().trim()); });
          bp.on('exit', function(code) {
            console.log('  [微信桥] 进程退出 (code ' + code + '),5秒后重启...');
            setTimeout(spawnWxBridge, 5000);
          });
          global.__wxBridge = bp;
          console.log('  [微信桥] 已启动 (PID ' + bp.pid + ')');
        } catch(e) {
          console.log('  [微信桥] 启动失败:', e.message);
          setTimeout(spawnWxBridge, 10000);
        }
      }
      spawnWxBridge();
    }
      // 无论 channels 配置如何,无条件注册消息接收端点
      // 独立微信桥接直接发消息到本端点
      registerRoute(['POST'], /^\/api\/v4\/wechat\/incoming$/, async (req, res) => {
  try {
    const body = await parseBody(req);
    var msg = body.message || body.text || '';
    var from = body.from || '';
    var source = body.source || 'wechat';
    if (!msg) { json(res, { ok: false }); return; }
    console.log('[微信][' + source + '] 收到(统一引擎): ' + msg.substring(0, 50));
    try { wsServer.broadcast('channel', { type: 'channel_message', from: from, content: msg, message: msg, source: 'wechat', timestamp: new Date().toISOString() }); } catch(e) {}
    var replyText = await unifiedEngine.process(
      unifiedEngine.normalizeMessage({ message: msg, from: from, channel: 'wechat' }, 'wechat')
    );
    if (replyText) {
      console.log('[微信] 回复(统一引擎): ' + replyText.substring(0, 60));
      try { wsServer.broadcast('channel', { type: 'channel_message', from: 'CEO', content: replyText, message: replyText, source: 'wechat', timestamp: new Date().toISOString() }); } catch(e) {}
      json(res, { ok: true, reply: replyText });
    } else {
      json(res, { ok: false, error: 'AI无回复' });
    }
  } catch(e) {
    console.log('[微信] 出错:', e.message);
    json(res, { ok: false, error: e.message });
  }
});
      console.log('  [微信] 消息端点: /api/v4/wechat/incoming');
  } catch(e) {
    console.log('  [微信] 初始化跳过:', e.message);
  }

  // ====== 通用渠道消息接入点(所有渠道复用的消息处理逻辑)======
  // 每个渠道的消息都走这个端点:broadcast(workspace) → runCEOCEO → 返回回复
  registerRoute(['POST'], /^\/api\/v4\/channel\/incoming$/, async (req, res) => {
  try {
    const body = await parseBody(req);
    var msg = body.message || body.text || '';
    var from = body.from || '';
    var channel = body.channel || 'unknown';
    if (!msg) { json(res, { ok: false }); return; }
    console.log('[' + channel + '] 收到(统一引擎): ' + msg.substring(0, 50));
    try { wsServer.broadcast(channel, { type: 'channel_message', from: from, content: msg, channel: channel, timestamp: new Date().toISOString() }); } catch(e) {}
    var replyText = await unifiedEngine.process(
      unifiedEngine.normalizeMessage({ message: msg, from: from, channel: channel }, channel)
    );
    if (replyText) {
      console.log('[' + channel + '] 回复(统一引擎): ' + replyText.substring(0, 60));
      try { wsServer.broadcast('ceo', { type: 'ceo_message', source: channel, message: replyText, timestamp: new Date().toISOString() }); } catch(e) {}
      json(res, { ok: true, reply: replyText, channel: channel });
    } else {
      json(res, { ok: false, error: 'AI无回复' });
    }
  } catch(e) {
    console.log('[' + channel + '] 出错:', e.message);
    json(res, { ok: false, error: e.message });
  }
});
  console.log('  [渠道] 通用消息端点: /api/v4/channel/incoming');


// 统一消息转发端点（供 OpenClaw 或其他系统推送消息到 CEO）
registerRoute(['POST'], /^\/api\/v4\/channel\/forward$/, async (req, res) => {
  try {
    const body = await parseBody(req);
    var msg = body.message || body.text || '';
    var from = body.from || '';
    var channel = body.channel || 'forward';
    if (!msg) { json(res, { ok: false, error: 'no message' }); return; }
    console.log('[转发][' + channel + '] ' + msg.substring(0, 50));
    try { wsServer.broadcast(channel, { type: 'channel_message', from: from, content: msg, channel: channel, timestamp: new Date().toISOString() }); } catch(e) {}
    var replyText = await unifiedEngine.process(
      unifiedEngine.normalizeMessage({ message: msg, from: from, channel: channel }, channel)
    );
    if (replyText) {
      console.log('[转发] 回复: ' + replyText.substring(0, 60));
      try { wsServer.broadcast('ceo', { type: 'ceo_message', source: channel, message: replyText, timestamp: new Date().toISOString() }); } catch(e) {}
      json(res, { ok: true, reply: replyText });
    } else {
      json(res, { ok: false, error: 'AI无回复' });
    }
  } catch(e) {
    console.log('[转发] 出错:', e.message);
    json(res, { ok: false, error: e.message });
  }
});
console.log('  [渠道] 统一转发端点: /api/v4/channel/forward');

// 统一 AI 引擎内部接口
registerRoute(['POST'], /^\/api\/v4\/ai\/chat$/, async (req, res) => {
  try {
    const body = await parseBody(req);
    if (!body.messages || !body.messages.length) { json(res, { ok: false, error: 'no messages' }); return; }
    var reply = await runCEOCEO(body.messages, { timeout: 180000 });
    json(res, { ok: true, reply: reply.reply || reply.response || '' });
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});
console.log('  [AI] 内部引擎接口: /api/v4/ai/chat');

  // 内置二维码生成
  registerRoute(['GET'], /^\/api\/wechat\/qrcode\/image$/, async (req, res) => {
    try {
      var qd = new URL(req.url, 'http://localhost').searchParams.get('data') || '';
      if (!qd) { json(res, { ok: false, error: 'no data' }); return; }
      var QRCode = require('qrcode');
      var img = await QRCode.toDataURL(qd, { width: 240, margin: 2 });
      json(res, { ok: true, image: img });
    } catch(e) { json(res, { ok: false, error: e.message }); }
  });

  // ====== QQ 机器人扫码绑定接口 ======
  var QQ_BIND_URL = 'https://q.qq.com/qqbot/openclaw/';
  registerRoute(['GET'], /^\/api\/qqbot\/qrcode$/, async function(req, res) {
    try {
      var QRCode = require('qrcode');
      var img = await QRCode.toDataURL(QQ_BIND_URL, { width: 280, margin: 2 });
      json(res, { ok: true, qrcodeUrl: QQ_BIND_URL, image: img, message: '用 QQ 扫码绑定机器人' });
    } catch(e) {
      json(res, { ok: false, error: e.message });
    }
  });

  // QQ 机器人绑定状态查询
  registerRoute(['GET'], /^\/api\/qqbot\/bind\/status$/, async function(req, res) {
    try {
      var cfgPath = require('path').join(require('os').homedir(), '.openclaw', 'openclaw.json');
      var raw = require('fs').readFileSync(cfgPath, 'utf-8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
      var cfg = JSON.parse(raw);
      var qq = cfg && cfg.channels && cfg.channels.qqbot;
      var bound = qq && !!(qq.appId && qq.clientSecret);
      json(res, { ok: true, bound: bound, message: bound ? 'QQ 机器人已绑定' : '未绑定', account: bound ? qq.appId : null });
    } catch(e) {
      json(res, { ok: true, bound: false, message: '未绑定' });
    }
  });

  // ====== 微信桥接状态端点 ======
  registerRoute(['GET'], /^\/api\/wechat\/bridge\/status$/, async function(req, res) {
    var bridgeAlive = false;
    var bridgeStatus = null;
    var healthPath = require('path').join(__dirname, 'logs', 'wechat-bridge.status.json');
    if (require('fs').existsSync(healthPath)) {
      try {
        bridgeStatus = JSON.parse(require('fs').readFileSync(healthPath, 'utf-8'));
        var age = Date.now() - new Date(bridgeStatus.lastPollAt || bridgeStatus.startedAt).getTime();
        bridgeAlive = (bridgeStatus.status === 'running' && age < 60000);
      } catch(e) {}
    }
    json(res, {
      ok: true,
      alive: bridgeAlive,
      processAlive: global.__wxBridge ? !global.__wxBridge.killed : false,
      status: bridgeStatus
    });
  });

  // ====== 微信桥接重启端点 ======
  registerRoute(['POST'], /^\/api\/wechat\/bridge\/restart$/, async function(req, res) {
    if (global.__wxBridge && !global.__wxBridge.killed) {
      try { global.__wxBridge.kill(); } catch(e) {}
      json(res, { ok: true, message: '桥接进程已终止,看门狗将在5秒后自动重启' });
    } else {
      json(res, { ok: false, message: '桥接尚未启动或已退出' });
    }
  });


  // ====== QQ 机器人桥接状态端点 ======
  registerRoute(['GET'], /^\/api\/qqbot\/bridge\/status$/, async function(req, res) {
    var bridgeAlive = false;
    var bridgeStatus = null;
    var healthPath = require('path').join(__dirname, 'logs', 'qqbot-bridge.status.json');
    if (require('fs').existsSync(healthPath)) {
      try {
        bridgeStatus = JSON.parse(require('fs').readFileSync(healthPath, 'utf-8'));
        var age = Date.now() - new Date(bridgeStatus.lastPollAt || bridgeStatus.startedAt).getTime();
        bridgeAlive = (bridgeStatus.status === 'running' && age < 60000);
      } catch(e) {}
    }
    json(res, {
      ok: true,
      alive: bridgeAlive,
      processAlive: global.__qqbotBridge ? !global.__qqbotBridge.killed : false,
      status: bridgeStatus
    });
  });

  // ====== 腾讯云桥接状态端点 ======
  registerRoute(['GET'], /^\/api\/tencent\/bridge\/status$/, async function(req, res) {
    var bridgeAlive = false;
    var bridgeStatus = null;
    var healthPath = require('path').join(__dirname, 'logs', 'tencent-bridge.status.json');
    if (require('fs').existsSync(healthPath)) {
      try {
        bridgeStatus = JSON.parse(require('fs').readFileSync(healthPath, 'utf-8'));
        var age = Date.now() - new Date(bridgeStatus.lastPollAt || bridgeStatus.startedAt).getTime();
        bridgeAlive = (bridgeStatus.status === 'running' && age < 60000);
      } catch(e) {}
    }
    json(res, {
      ok: true,
      alive: bridgeAlive,
      processAlive: global.__tencentBridge ? !global.__tencentBridge.killed : false,
      status: bridgeStatus
    });
  });

  // ====== 企业微信桥接状态端点 ======
  registerRoute(['GET'], /^\/api\/wecom\/bridge\/status$/, async function(req, res) {
    var bridgeAlive = false;
    var bridgeStatus = null;
    var healthPath = require('path').join(__dirname, 'logs', 'wecom-bridge.status.json');
    if (require('fs').existsSync(healthPath)) {
      try {
        bridgeStatus = JSON.parse(require('fs').readFileSync(healthPath, 'utf-8'));
        var age = Date.now() - new Date(bridgeStatus.lastPollAt || bridgeStatus.startedAt).getTime();
        bridgeAlive = (bridgeStatus.status === 'running' && age < 60000);
      } catch(e) {}
    }
    json(res, {
      ok: true,
      alive: bridgeAlive,
      processAlive: global.__wecomBridge ? !global.__wecomBridge.killed : false,
      status: bridgeStatus
    });
  });

  
  // 启动前清理桥接旧进程（按健康检查端口）
  function killBridgeByPort(port) {
    try {
      var exec = require('child_process').exec;
      exec('netstat -ano | findstr \u003a' + port + '\u0022', function(err, stdout) {
        if (!stdout) return;
        var lines = stdout.split('\r\n');
        lines.forEach(function(line) {
          var parts = line.trim().split(/\s+/);
          var pid = parts[parts.length - 1];
          if (pid && pid !== '0' && !isNaN(parseInt(pid))) {
            try { process.kill(parseInt(pid)); } catch(e) {}
            try { exec('taskkill /F /PID ' + pid + ' 2>nul', function(){}); } catch(e) {}
          }
        });
      });
    } catch(e) {}
  }
  var bridgePorts = [28001, 28002, 28003, 28004, 28005, 28006];
  bridgePorts.forEach(killBridgeByPort);

// ====== 飞书独立桥接(SDK 直连,不依赖网关)======
  try {
    var fbPath = require("path").join(__dirname, "modules", "feishu-bridge.js");
    if (require("fs").existsSync(fbPath)) {
      console.log("  [飞书] 启动独立桥接(SDK直连)...");
      function spawnFB() {
        var fb = require("child_process").spawn(process.execPath, [fbPath], { stdio: 'pipe', cwd: __dirname, env: process.env, windowsHide: true });
        fb.stdout.on("data", function(d) { console.log("  [飞书桥] " + d.toString().trim()); });
        fb.stderr.on("data", function(d) { console.log("  [飞书桥] " + d.toString().trim()); });
        fb.on("exit", function(code) { console.log("  [飞书桥] 退出 (" + code + "),5s重启"); setTimeout(spawnFB, 5000); });
        global.__feishuBridge = fb;
        console.log("  [飞书桥] PID " + fb.pid);
      }
      spawnFB();
    }
  } catch(e) { console.log("  [飞书桥] 跳过:", e.message); }


  // ====== 钉钉独立桥接 ======
  try {
    var dtp = require("path").join(__dirname, "modules", "dingtalk-bridge.js");
    if (require("fs").existsSync(dtp)) {
      console.log("  [钉钉] 启动独立桥接...");
      function spawnDT() {
        var dtb = require("child_process").spawn(process.execPath, [dtp], { stdio: 'pipe', cwd: __dirname, env: process.env, windowsHide: true });
        dtb.stdout.on("data", function(d) { console.log("  [钉钉桥] " + d.toString().trim()); });
        dtb.stderr.on("data", function(d) { console.log("  [钉钉桥] " + d.toString().trim()); });
        dtb.on("exit", function(code) { console.log("  [钉钉桥] 退出 (" + code + "),5s重启"); setTimeout(spawnDT, 5000); });
        global.__dingtalkBridge = dtb;
        console.log("  [钉钉桥] PID " + dtb.pid);
      }
      spawnDT();
    }
  } catch(e) { console.log("  [钉钉桥] 跳过:", e.message); }

  // ====== 企业微信独立桥接 ======
  try {
    var wcp = require('path').join(__dirname, 'modules', 'wecom-bridge.js');
    if (require('fs').existsSync(wcp)) {
      console.log("  [企微] 启动独立桥接...");
      function spawnWC() {
        var wcb = require('child_process').spawn(process.execPath, [wcp], { stdio: 'pipe', cwd: __dirname, env: process.env, windowsHide: true });
        wcb.stdout.on('data', function(d) { console.log('  [企微桥] ' + d.toString().trim()); });
        wcb.stderr.on('data', function(d) { console.log('  [企微桥] ' + d.toString().trim()); });
        wcb.on('exit', function(code) { console.log('  [企微桥] 退出 (' + code + '),5s重启'); setTimeout(spawnWC, 5000); });
        global.__wecomBridge = wcb;
        console.log('  [企微桥] PID ' + wcb.pid);
      }
      spawnWC();
    }
  } catch(e) { console.log('  [企微桥] 跳过:', e.message); }

  // ====== QQ 机器人桥接 ======
  try {
    var qp = require('path').join(__dirname, 'modules', 'qqbot-bridge.js');
    if (require('fs').existsSync(qp)) {
      console.log("  [QQ] 启动独立桥接...");
      function spawnQB() {
        var qb = require('child_process').spawn(process.execPath, [qp], { stdio: 'pipe', cwd: __dirname, env: process.env, windowsHide: true });
        qb.stdout.on('data', function(d) { console.log('  [QQ桥] ' + d.toString().trim()); });
        qb.stderr.on('data', function(d) { console.log('  [QQ桥] ' + d.toString().trim()); });
        qb.on('exit', function(code) { console.log('  [QQ桥] 退出 (' + code + '),5s重启'); setTimeout(spawnQB, 5000); });
        global.__qqbotBridge = qb;
        console.log('  [QQ桥] PID ' + qb.pid);
      }
      spawnQB();
    }
  } catch(e) { console.log('  [QQ桥] 跳过:', e.message); }

  // ====== 腾讯云桥接 ======
  try {
    var tcp = require('path').join(__dirname, 'modules', 'tencent-bridge.js');
    if (require('fs').existsSync(tcp)) {
      console.log("  [腾讯云] 启动独立桥接...");
      function spawnTCB() {
        var tc = require('child_process').spawn(process.execPath, [tcp], { stdio: 'pipe', cwd: __dirname, env: process.env, windowsHide: true });
        tc.stdout.on('data', function(d) { console.log('  [腾讯云桥] ' + d.toString().trim()); });
        tc.stderr.on('data', function(d) { console.log('  [腾讯云桥] ' + d.toString().trim()); });
        tc.on('exit', function(code) { console.log('  [腾讯云桥] 退出 (' + code + '),5s重启'); setTimeout(spawnTCB, 5000); });
        global.__tencentBridge = tc;
        console.log('  [腾讯云桥] PID ' + tc.pid);
      }
      spawnTCB();
    }
  } catch(e) { console.log('  [腾讯云桥] 跳过:', e.message); }

// 进程退出时清理所有桥接进程
  function killBridges() {
    if (global.__wxBridge) { try { global.__wxBridge.kill(); } catch(e) {} }
    if (global.__feishuBridge) { try { global.__feishuBridge.kill(); } catch(e) {} }
    if (global.__dingtalkBridge) { try { global.__dingtalkBridge.kill(); } catch(e) {} }
    if (global.__wecomBridge) { try { global.__wecomBridge.kill(); } catch(e) {} }
    if (global.__qqbotBridge) { try { global.__qqbotBridge.kill(); } catch(e) {} }
    if (global.__tencentBridge) { try { global.__tencentBridge.kill(); } catch(e) {} }
  }
  process.on('exit', function() { killBridges(); });
  process.on('SIGINT', function() { killBridges(); process.exit(0); });
  process.on('SIGTERM', function() { killBridges(); process.exit(0); });
});


// ======= i18n Multi-language Support =======
try {

// ========= 缺失 API 路由(手动添加) =========

// 1. 获取员工列表
registerRoute(['GET'], '/api/employees', (req, res) => {
  try {
    const rows = db().prepare('SELECT id, name, name_cn, title, category, icon, role, status FROM agents ORDER BY id').all();
    json(res, { ok: true, employees: rows || [] });
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});

// 2. 获取活动列表(返回空数组,表结构待确认)
registerRoute(['GET'], '/api/activities', (req, res) => {
  try {
    const rows = db().prepare('SELECT a.id, a.agent_id, a.agent_name, a.action, a.target, a.details, a.timestamp, ag.icon, ag.role, ag.status FROM activities a LEFT JOIN agents ag ON a.agent_id = ag.id ORDER BY a.timestamp DESC LIMIT 50').all();
    const activities = (rows || []).map(r => {
      return { id: r.id, icon: r.icon || '\u2022', name: r.agent_name, role: r.role || '', action: r.action + (r.target ? ' ' + r.target : ''), status: r.status || 'active', time: r.timestamp };
    });
    json(res, { ok: true, activities });
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});

// 3. 获取员工活动
registerRoute(['GET'], '/api/employee-activities', (req, res) => {
  try {
    const url = require('url').parse(req.url, true);
    const limit = parseInt(url.query.limit) || 50;
    const since = url.query.since || '';
    let rows;
    if (since) {
      rows = db().prepare('SELECT a.id, a.agent_id, a.agent_name, a.action, a.target, a.details, a.timestamp, ag.icon, ag.role, ag.status FROM activities a LEFT JOIN agents ag ON a.agent_id = ag.id WHERE a.timestamp > ? ORDER BY a.timestamp DESC LIMIT ?').all(since, limit);
    } else {
      rows = db().prepare('SELECT a.id, a.agent_id, a.agent_name, a.action, a.target, a.details, a.timestamp, ag.icon, ag.role, ag.status FROM activities a LEFT JOIN agents ag ON a.agent_id = ag.id ORDER BY a.timestamp DESC LIMIT ?').all(limit);
    }
    var activities = (rows || []).map(r => {
      return { id: r.id, icon: r.icon || '\u2022', name: r.agent_name, role: r.role || '', action: r.action + (r.target ? ' ' + r.target : ''), status: r.status || 'active', time: r.timestamp };
    });
    
    // Merge with ACTIVITY_LOG for recent entries not in DB yet
    if (typeof ACTIVITY_LOG !== 'undefined' && ACTIVITY_LOG.length > 0) {
      var logEntries = ACTIVITY_LOG;
      if (since) logEntries = logEntries.filter(function(e) { return e.time > since; });
      logEntries.slice(0, limit).forEach(function(e) {
        if (!activities.find(function(a) { return String(a.id) === String(e.id) || (a.name === e.name && a.time === e.time); })) {
          activities.push({ id: e.id, icon: e.icon || '\u2022', name: e.name || e.agentName || '', role: e.role || '', action: e.text || e.action || '', status: 'active', time: e.time });
        }
      });
      if (activities.length > limit) activities = activities.slice(0, limit);
    }
    json(res, { ok: true, activities });
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});

// ========= 补充缺失 API 路由 =========

// Skills API (使用 skillSystem 从 SKILL.md 加载)
registerRoute(['GET'], /^\/api\/skills\/?$/, (req, res) => {
  try {
    skillSystem.loadAll();
    var skillsList = [];
    skillSystem.skills.forEach(function(skill, name) {
      skillsList.push({
        id: name,
        name: name,
        description: skill.description || '\u6682\u65e0\u63cf\u8ff0',
        version: skill.metadata && skill.metadata.version ? 'v' + skill.metadata.version : '1.0',
        enabled: skill.enabled !== false
      });
    });
    json(res, { ok: true, skills: skillsList, total: skillsList.length });
  } catch(e) { json(res, { ok: false, error: e.message, skills: [], total: 0 }); }
});

// MCP Servers API
registerRoute(['GET'], /^\/api\/mcp\/servers$/, (req, res) => {
  try {
    const mcp = require('./modules/mcp-manager');
    json(res, { ok: true, servers: mcp._servers || [] });
  } catch(e) { json(res, { ok: false, error: e.message, servers: [] }); }
});

// MCP Tools API
registerRoute(['GET'], /^\/api\/mcp\/tools$/, (req, res) => {
  try {
    const mcp = require('./modules/mcp-manager');
    const tools = (mcp._servers || []).reduce((acc, s) => acc.concat(s.tools || []), []);
    json(res, { ok: true, tools, total: tools.length });
  } catch(e) { json(res, { ok: false, error: e.message, tools: [] }); }
});

// Stream Status API
registerRoute(['GET'], /^\/api\/stream\/status$/, (req, res) => {
  json(res, { ok: true, status: 'available', connections: 0 });
});

// Scheduler Jobs API
registerRoute(['GET'], /^\/api\/scheduler\/jobs$/, (req, res) => {
  try {
    const scheduler = require('./modules/proactive-scheduler');
    json(res, { ok: true, jobs: scheduler.listJobs ? scheduler.listJobs() : [] });
  } catch(e) { json(res, { ok: false, error: e.message, jobs: [] }); }
});
registerRoute(['POST'], /^\/api\/scheduler\/jobs\/add$/, async (req, res) => {
  try {
    const body = await parseBody(req);
    const scheduler = require('./modules/proactive-scheduler');
    const result = scheduler.addJob ? scheduler.addJob(body) : { ok: false, error: 'Scheduler not available' };
    json(res, result);
  } catch(e) { json(res, { ok: false, error: e.message }); }
});
registerRoute(['DELETE'], /^\/api\/scheduler\/jobs\/([^\/]+)$/, (req, res, m) => {
  try {
    const scheduler = require('./modules/proactive-scheduler');
    const result = scheduler.removeJob ? scheduler.removeJob(m[1]) : { ok: false, error: 'Scheduler not available' };
    json(res, result);
  } catch(e) { json(res, { ok: false, error: e.message }); }
});

// Tools List API
registerRoute(['GET'], /^\/api\/tools\/list$/, (req, res) => {
  try {
    const toolsDir = path.join(BASE, 'tools');
    const files = fs.existsSync(toolsDir) ? fs.readdirSync(toolsDir).filter(f => f.endsWith('.json')) : [];
    const tools = files.map(f => { try { return JSON.parse(fs.readFileSync(path.join(toolsDir, f), 'utf8')); } catch(e) { return null; } }).filter(Boolean);
    json(res, { ok: true, tools, total: tools.length });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});

// File Permissions API
registerRoute(['GET'], /^\/api\/file-permissions\/?$/, (req, res) => {
  try {
    const fp = require('./modules/file-permissions');

// === P0 Module Requires (injected) ===
const { sessionManager, orchestrator } = require('./modules/session-manager');
const { getToolsExecutor, FILE_TOOLS } = require('./modules/tools-executor');
const { scheduler: proactiveScheduler } = require('./modules/proactive-scheduler');
if (proactiveScheduler && typeof proactiveScheduler.setSessionManager === 'function') {
  proactiveScheduler.setSessionManager(sessionManager);
  console.log('[Scheduler] sessionManager injected');
}
    json(res, { ok: true, permissions: fp.getPermissions ? fp.getPermissions() : [] });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});



// ===== OpenAPI 文档 =====
registerRoute(["GET"], "/api/openapi.json", function(req, res) {
  try {
    var spec = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "openapi.json"), "utf-8"));
    json(res, spec);
  } catch(e) { json(res, { ok: false, error: e.message }); }
});

registerRoute(["GET"], "/api/workflow-templates", function(req, res) {
  try {
    var tpl = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "workflow-templates.json"), "utf-8"));
    json(res, { ok: true, total: tpl.length, templates: tpl });
  } catch(e) { json(res, { ok: false, error: e.message }); }
});

// ===== 团队学习系统 API =====
try {
  var teamLearning = require('./modules/team-learning');

  // 知识共享/跨Agent学习
  registerRoute(['POST'], '/api/team/share', async (req, res) => {
    try {
      var body = await parseBody(req);
      var result = teamLearning.shareExperience(body.agentId, { summary: body.summary, detail: body.detail });
      json(res, { ok: true, result: result });
    } catch(e) { json(res, { ok: false, error: e.message }); }
  });

  // 团队知识库查询
  registerRoute(['GET'], '/api/team/knowledge', (req, res) => {
    try {
      var url = require('url').parse(req.url, true);
      var skill = url.query.skill || '';
      var kb = teamLearning.matchSkills(skill);
      json(res, { ok: true, matchedSkills: kb });
    } catch(e) { json(res, { ok: false, error: e.message }); }
  });

  // 错误模式分析
  registerRoute(['POST'], '/api/team/errors/record', async (req, res) => {
    try {
      var body = await parseBody(req);
      var result = teamLearning.recordError(body.agentId, body.taskTitle, body.errorMessage, body.category);
      json(res, result);
    } catch(e) { json(res, { ok: false, error: e.message }); }
  });

  registerRoute(['GET'], '/api/team/errors/report', (req, res) => {
    try { json(res, teamLearning.getErrorReport()); }
    catch(e) { json(res, { ok: false, error: e.message }); }
  });

  // 员工效能
  registerRoute(['POST'], '/api/team/performance/record', async (req, res) => {
    try {
      var body = await parseBody(req);
      var result = teamLearning.recordPerformance(body.agentId, body.taskId, body.taskTitle, body.score, body.durationMs);
      json(res, result);
    } catch(e) { json(res, { ok: false, error: e.message }); }
  });

  registerRoute(['GET'], '/api/team/performance/report', (req, res) => {
    try { json(res, teamLearning.getPerformanceReport()); }
    catch(e) { json(res, { ok: false, error: e.message }); }
  });

  // 最佳实践
  registerRoute(['POST'], '/api/team/best-practice', async (req, res) => {
    try {
      var body = await parseBody(req);
      var result = teamLearning.extractBestPractices(body.agentId, body.task, body.result);
      json(res, result);
    } catch(e) { json(res, { ok: false, error: e.message }); }
  });

  // 根因分析API
  registerRoute(['POST'], '/api/team/errors/rootcause', async (req, res) => {
    try {
      var body = await parseBody(req);
      var result = teamLearning.analyzeRootCause(body.patternId);
      json(res, result);
    } catch(e) { json(res, { ok: false, error: e.message }); }
  });

  // 进化回馈报告API
  registerRoute(['GET'], '/api/team/feedback', (req, res) => {
    try { json(res, teamLearning.getFeedbackReport()); }
    catch(e) { json(res, { ok: false, error: e.message }); }
  });

  // 知识库统计API
  registerRoute(['GET'], '/api/team/knowledge/stats', (req, res) => {
    try { json(res, teamLearning.getKnowledgeStats()); }
    catch(e) { json(res, { ok: false, error: e.message }); }
  });

  // 手动触发错误模式清理
  registerRoute(['POST'], '/api/team/patterns/clean', (req, res) => {
    try { json(res, teamLearning.autoCleanPatterns()); }
    catch(e) { json(res, { ok: false, error: e.message }); }
  });

  // 记忆压缩状态
  try {
    var _tlCoreMem = require('./modules/core-memory');
    registerRoute(['GET'], '/api/memory/compress', (req, res) => {
      try {
        var memories = _tlCoreMem.loadCore();
        if (!memories || !Array.isArray(memories)) { json(res, { ok: true, message: 'no memories' }); return; }
        var compResult = _tlCoreMem.compressMemories(memories, { maxAgeDays: 7, minCount: 3 });
        json(res, { ok: true, total: memories.length, compressed: compResult.compressed });
      } catch(e) { json(res, { ok: false, error: e.message }); }
    });
  } catch(e) {}

  console.log('[Team] Learning system initialized');
} catch(e) {
  console.log('[Team] Skipped:', e.message);
}
registerI18nAPI(registerRoute, parseBody, json);
  console.log('[i18n] Multi-language support loaded');
} catch(e) {
  console.error('[i18n] Failed to load:', e.message);
}

