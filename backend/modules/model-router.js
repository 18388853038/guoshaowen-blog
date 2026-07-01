/**
 * eCompany Multi-Model Router v1.0
 * 多模型智能路由 — 根据任务类型自动选择最优模型
 * 
 * 路由策略:
 * - 主模型: Ollama 本地 (Qwen 3.5 9B / DeepSeek Coder V2)
 * - 备用: DeepSeek V4 Flash 云端
 * - 兜底: Qwen 免费云端
 */
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');

// ========== 默认模型配置 ==========
const DEFAULT_PROVIDERS = {
  ollama: {
    name: 'Ollama (本地)',
    baseUrl: 'http://127.0.0.1:11434',
    apiFormat: '/v1/chat/completions',
    noApiKey: true,
    models: {
      'qwen3.5:9b': {
        name: 'Qwen 3.5 9B',
        capabilities: ['simple', 'search', 'translate', 'summarize', 'analysis', 'code', 'chat'],
        cost: { input: 0, output: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
        reasoning: true,
        speed: 'fast'
      },
      'deepseek-coder-v2:16b': {
        name: 'DeepSeek Coder V2 16B',
        capabilities: ['code', 'debug', 'analysis', 'reasoning'],
        cost: { input: 0, output: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
        reasoning: true,
        speed: 'normal'
      }
    }
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiFormat: '/v1/chat/completions',
    models: {
      'deepseek-v4-flash': {
        name: 'DeepSeek V4 Flash',
        capabilities: ['simple', 'search', 'translate', 'summarize'],
        cost: { input: 0.14, output: 0.28 },
        contextWindow: 1000000,
        maxTokens: 384000,
        reasoning: true,
        speed: 'fast'
      },
      'deepseek-v4-pro': {
        name: 'DeepSeek V4 Pro',
        capabilities: ['analysis', 'code', 'reasoning', 'complex'],
        cost: { input: 1.74, output: 3.48 },
        contextWindow: 1000000,
        maxTokens: 384000,
        reasoning: true,
        speed: 'normal'
      },
      'deepseek-chat': {
        name: 'DeepSeek Chat (V3)',
        capabilities: ['simple', 'chat', 'translate'],
        cost: { input: 0.28, output: 0.42 },
        contextWindow: 131072,
        maxTokens: 8192,
        reasoning: false,
        speed: 'fast'
      },
      'deepseek-reasoner': {
        name: 'DeepSeek Reasoner',
        capabilities: ['reasoning', 'analysis', 'math', 'code'],
        cost: { input: 0.28, output: 0.42 },
        contextWindow: 131072,
        maxTokens: 65536,
        reasoning: true,
        speed: 'slow'
      }
    }
  },
  qwen: {
    name: 'Qwen (阿里云)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiFormat: '',
    models: {
      'qwen3.5-plus': {
        name: 'Qwen 3.5 Plus',
        capabilities: ['simple', 'chat', 'translate', 'analysis', 'code'],
        cost: { input: 0, output: 0 },
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: false,
        speed: 'fast'
      },
      'qwen3-max-2026-01-23': {
        name: 'Qwen3 Max',
        capabilities: ['complex', 'analysis', 'reasoning', 'code'],
        cost: { input: 0, output: 0 },
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: false,
        speed: 'normal'
      },
      'qwen3-coder-plus': {
        name: 'Qwen3 Coder Plus',
        capabilities: ['code', 'debug', 'analysis'],
        cost: { input: 0, output: 0 },
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: false,
        speed: 'normal'
      }
    }
  }
};

// ========== 任务类型识别 ==========

const TASK_PATTERNS = {
  simple: [
    /^(你好|hi|hello|在吗|早安|晚安|你是谁|你叫什么)/i,
    /^(天气|搜索|翻译)/i,
    /^(谢谢|好的|明白|知道了|ok|yes|no|是|否)/i,
  ],
  search: [
    /^(?!.*(趋势|报表|数据|统计|排行|系统|分析)).*(搜索|查找|找一下|搜一下|查一下|search)/i,
  ],
  code: [
    /写一个|写一段|代码|编程|实现|函数|class|function|bug|debug|修复.*问题/,
    /api|接口|api|API|路由|端点|endpoint/,
    /docker|dockerfile|deploy|部署|ci|cd/,
    /登录|注册|认证|auth|token|jwt/i,
  ],
  analysis: [
    /分析|统计|对比|比较|评估|review|总结|归纳|汇报|报告|报表/,
    /为什么|如何|原理|机制|架构|设计方案/,
    /数据|图表|趋势|维度|dashboard/,
    /^查(一下|一?下)?(系统|趋势|数据|报表|统计|排行)/i,
  ],
  creative: [
    /写(一|篇|首|段)|创作|创意|文案|策划|脚本|方案/,
    /故事|文章|文章|内容|描述|形容/,
  ],
  complex: [
    /系统设计|架构设计|技术方案|整体方案/,
    /多轮|复杂|大型|综合/,
    /计划|规划|路线图|roadmap/,
  ]
};

function classifyTask(text) {
  if (!text) return 'simple';
  for (const [type, patterns] of Object.entries(TASK_PATTERNS)) {
    for (const p of patterns) {
      if (p.test(text)) return type;
    }
  }
  if (text.length > 500) return 'analysis';
  if (text.length > 200) return 'complex';
  return 'simple';
}

// ========== 路由表 (Ollama 为主, DeepSeek 云端备用) ==========

const ROUTING_TABLE = {
  simple: [
    { provider: 'ollama', model: 'qwen3.5:9b', reason: '本地快速响应' },
    { provider: 'deepseek', model: 'deepseek-v4-flash', reason: '云端备用' },
  ],
  search: [
    { provider: 'ollama', model: 'qwen3.5:9b', reason: '本地搜索问答' },
    { provider: 'deepseek', model: 'deepseek-v4-flash', reason: '云端备用' },
  ],
  code: [
    { provider: 'ollama', model: 'deepseek-coder-v2:16b', reason: '本地代码模型' },
    { provider: 'ollama', model: 'qwen3.5:9b', reason: '本地通用备用' },
    { provider: 'deepseek', model: 'deepseek-v4-flash', reason: '云端兜底' },
  ],
  analysis: [
    { provider: 'ollama', model: 'qwen3.5:9b', reason: '本地分析推理' },
    { provider: 'deepseek', model: 'deepseek-v4-flash', reason: '云端备用' },
  ],
  creative: [
    { provider: 'ollama', model: 'qwen3.5:9b', reason: '本地创意写作' },
    { provider: 'deepseek', model: 'deepseek-v4-flash', reason: '云端备用' },
  ],
  complex: [
    { provider: 'ollama', model: 'qwen3.5:9b', reason: '本地处理' },
    { provider: 'deepseek', model: 'deepseek-v4-flash', reason: '云端备用' },
  ],
  reasoning: [
    { provider: 'ollama', model: 'deepseek-coder-v2:16b', reason: '本地深度推理' },
    { provider: 'ollama', model: 'qwen3.5:9b', reason: '本地备用' },
    { provider: 'deepseek', model: 'deepseek-v4-flash', reason: '云端兜底' },
  ]
};

// ========== 配置管理 ==========

let providerConfigs = {};
let usageStats = { calls: 0, byProvider: {}, totalCost: 0, todayCost: 0 };

function loadConfig() {
  try {
    const cfgPath = path.join(BASE, 'model-router.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      providerConfigs = cfg.providers || {};
      if (cfg.routingOverride) {
        Object.assign(ROUTING_TABLE, cfg.routingOverride);
      }
      if (cfg.defaults) {
        Object.keys(providerConfigs).forEach(p => {
          const def = cfg.defaults;
          if (!providerConfigs[p].models) providerConfigs[p].models = {};
          Object.keys(DEFAULT_PROVIDERS[p]?.models || {}).forEach(m => {
            if (!providerConfigs[p].models[m]) {
              providerConfigs[p].models[m] = { enabled: true };
            }
          });
        });
      }
      // 从 ai-provider.json 同步 Key（确保 Key 最新）
      try {
        var _apPath = path.join(BASE, 'ai-provider.json');
        if (fs.existsSync(_apPath)) {
          var _apCfg = JSON.parse(fs.readFileSync(_apPath, 'utf-8'));
          if (_apCfg.apiKey && _apCfg.apiKey.length > 10) {
            Object.keys(providerConfigs).forEach(function(_p) {
              if (_p === 'deepseek' || _p === _apCfg.provider) {
                providerConfigs[_p].apiKey = _apCfg.apiKey;
              }
            });
          }
        }
      } catch(_ape) {}
    } else {
      const defaultCfg = generateDefaultConfig();
      fs.writeFileSync(cfgPath, JSON.stringify(defaultCfg, null, 2), 'utf-8');
      providerConfigs = defaultCfg.providers;
    }
  } catch(e) {
    console.error('[ModelRouter] Config load error:', e.message);
    providerConfigs = {};
  }
}

function generateDefaultConfig() {
  return {
    enabled: true,
    strategy: 'speed-first',
    providers: {
      ollama: {
        enabled: true,
        noApiKey: true,
        apiKey: '',
        models: {
          'qwen3.5:9b': { enabled: true, priority: 1 },
          'deepseek-coder-v2:16b': { enabled: true, priority: 2 }
        }
      },
      deepseek: {
        enabled: true,
        apiKey: (function(){try{var c=JSON.parse(fs.readFileSync(path.join(BASE,'ai-provider.json'),'utf-8'));return c.apiKey||process.env.DEEPSEEK_API_KEY||''}catch(e){return process.env.DEEPSEEK_API_KEY||''}})(),
        models: {
          'deepseek-v4-flash': { enabled: true, priority: 1 },
          'deepseek-v4-pro': { enabled: false, priority: 2 },
          'deepseek-chat': { enabled: false, priority: 3 },
          'deepseek-reasoner': { enabled: false, priority: 4 }
        }
      },
      qwen: {
        enabled: true,
        apiKey: process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '',
        models: {
          'qwen3.5-plus': { enabled: true, priority: 1 },
          'qwen3-max-2026-01-23': { enabled: false, priority: 2 },
          'qwen3-coder-plus': { enabled: false, priority: 3 }
        }
      }
    },
    routingOverride: {},
    createdAt: new Date().toISOString()
  };
}

// ========== 核心路由函数 ==========

function selectModel(taskText, options = {}) {
  const taskType = options.taskType || classifyTask(taskText);
  const routes = ROUTING_TABLE[taskType] || ROUTING_TABLE.simple;
  const strategy = options.strategy || 'speed-first';

  loadConfigIfNeeded();

  for (const route of routes) {
    const provCfg = providerConfigs[route.provider];
    if (!provCfg || !provCfg.enabled) continue;

    const modelCfg = provCfg.models && provCfg.models[route.model];
    if (modelCfg && modelCfg.enabled === false) continue;

    // 本地模型（Ollama）不需要 API Key
    if (!provCfg.noApiKey) {
      const apiKey = provCfg.apiKey || process.env[route.provider.toUpperCase() + '_API_KEY'] || '';
      if (!apiKey) continue;
    }

    return {
      provider: route.provider,
      model: route.model,
      apiKey: provCfg.apiKey || '',
      apiBase: getApiBase(route.provider, route.model, provCfg),
      taskType: taskType,
      reason: route.reason,
      cost: DEFAULT_PROVIDERS[route.provider]?.models[route.model]?.cost || { input: 0, output: 0 },
      contextWindow: DEFAULT_PROVIDERS[route.provider]?.models[route.model]?.contextWindow || 131072
    };
  }

  return getLegacyFallback();
}

function getApiBase(provider, model, provCfg) {
  const defaults = DEFAULT_PROVIDERS[provider];
  if (provCfg && provCfg.baseUrl) {
    let base = provCfg.baseUrl.replace(/\/+$/, '');
    if (provCfg.apiFormat) base += provCfg.apiFormat;
    else base += defaults?.apiFormat || '/v1/chat/completions';
    return base;
  }
  if (defaults) {
    return (defaults.baseUrl + (defaults.apiFormat || '/v1/chat/completions'));
  }
  return 'http://127.0.0.1:11434/v1/chat/completions';
}

let configLoaded = false;
function loadConfigIfNeeded() {
  if (!configLoaded) { loadConfig(); configLoaded = true; }
}

function getLegacyFallback() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(BASE, 'ai-provider.json'), 'utf-8'));
    const p = cfg.provider || 'ollama';
    return {
      provider: p,
      model: cfg.model || 'qwen3.5:9b',
      apiKey: cfg.apiKey || '',
      apiBase: cfg.apiBase || 'http://127.0.0.1:11434/v1/chat/completions',
      taskType: 'fallback',
      reason: 'Legacy config fallback',
      cost: { input: 0, output: 0 }
    };
  } catch(e) {
    return {
      provider: 'ollama',
      model: 'qwen3.5:9b',
      apiKey: '',
      apiBase: 'http://127.0.0.1:11434/v1/chat/completions',
      taskType: 'fallback',
      reason: 'Ultimate fallback',
      cost: { input: 0, output: 0 }
    };
  }
}

// ========== 用量统计 ==========

function recordUsage(route, inputTokens, outputTokens) {
  usageStats.calls++;
  const key = route.provider + '/' + route.model;
  if (!usageStats.byProvider[key]) usageStats.byProvider[key] = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
  usageStats.byProvider[key].calls++;
  usageStats.byProvider[key].inputTokens += inputTokens || 0;
  usageStats.byProvider[key].outputTokens += outputTokens || 0;
  const cost = (route.cost?.input || 0) * (inputTokens || 0) / 1000000 + (route.cost?.output || 0) * (outputTokens || 0) / 1000000;
  usageStats.byProvider[key].cost += cost;
  usageStats.totalCost += cost;
  usageStats.todayCost += cost;
}

function getUsageStats() {
  return usageStats;
}

function resetDailyStats() {
  usageStats.todayCost = 0;
}

// ========== 路由测试 ==========

function testRoute(text) {
  const taskType = classifyTask(text);
  const route = selectModel(text);
  return {
    input: text.substring(0, 100),
    classified: taskType,
    selected: route
  };
}

// ========== 注册HTTP路由 ==========

function registerRouterRoutes(registerRoute, parseBody, json) {
  registerRoute(['POST'], /^\/api\/router\/select$/, async (req, res) => {
    try {
      const body = await parseBody(req);
      const text = body.text || body.query || '';
      const taskType = body.taskType || classifyTask(text);
      const route = selectModel(text, { taskType, strategy: body.strategy });
      json(res, { ok: true, taskType, route });
    } catch(e) { json(res, { ok: false, error: e.message }, 500); }
  });

  registerRoute(['POST'], /^\/api\/router\/classify$/, async (req, res) => {
    try {
      const body = await parseBody(req);
      const text = body.text || body.query || '';
      const taskType = classifyTask(text);
      json(res, { ok: true, taskType, input: text.substring(0, 200) });
    } catch(e) { json(res, { ok: false, error: e.message }, 500); }
  });

  registerRoute(['GET'], /^\/api\/router\/stats$/, (req, res) => {
    json(res, { ok: true, ...usageStats });
  });

  registerRoute(['GET'], /^\/api\/router\/config$/, (req, res) => {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(BASE, 'model-router.json'), 'utf-8'));
      Object.keys(cfg.providers || {}).forEach(p => {
        if (cfg.providers[p].apiKey) cfg.providers[p].apiKey = cfg.providers[p].apiKey.slice(0,8) + '...';
      });
      json(res, { ok: true, config: cfg, routingTable: ROUTING_TABLE });
    } catch(e) { json(res, { ok: false, error: e.message }, 500); }
  });

  registerRoute(['POST'], /^\/api\/router\/config$/, async (req, res) => {
    try {
      const body = await parseBody(req);
      const cfgPath = path.join(BASE, 'model-router.json');
      const current = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (body.providers) {
        Object.keys(body.providers).forEach(p => {
          if (!current.providers[p]) current.providers[p] = {};
          Object.assign(current.providers[p], body.providers[p]);
        });
      }
      if (body.strategy) current.strategy = body.strategy;
      fs.writeFileSync(cfgPath, JSON.stringify(current, null, 2), 'utf-8');
      configLoaded = false;
      loadConfig();
      json(res, { ok: true, message: '配置已更新' });
    } catch(e) { json(res, { ok: false, error: e.message }, 500); }
  });
}

loadConfig();

module.exports = {
  classifyTask,
  selectModel,
  recordUsage,
  getUsageStats,
  resetDailyStats,
  testRoute,
  registerRouterRoutes
};
