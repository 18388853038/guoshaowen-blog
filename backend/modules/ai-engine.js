/**
 * eCompany AI Engine
 * 多模型 AI 引擎 - 支持 DeepSeek / OpenAI / Anthropic / Ollama 等
 * 注入：多模型故障切换、流式输出、高级工具调用
 */

// ========== 模型配置 ==========
const PROVIDERS = {
  "ollama": {
    "baseUrl": "http://127.0.0.1:11434/v1/chat/completions",
    "apiKeyEnv": "OLLAMA_API_KEY",
    "defaultModel": "qwen3.5:9b",
    "noApiKey": true,
    "models": [
      { "id": "qwen3.5:9b", "label": "Qwen 3.5 9B (本地)", "tags": ["通用", "推理", "本地"], "contextWindow": 32768 },
      { "id": "deepseek-coder-v2:16b", "label": "DeepSeek Coder V2 16B (本地)", "tags": ["代码", "推理", "本地"], "contextWindow": 32768 }
    ]
  },
  "ernie": {
    "baseUrl": "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions",
    "apiKeyEnv": "ERNIE_API_KEY",
    "defaultModel": "ernie-4.0-8k",
    "models": [
      { "id": "ernie-4.0-8k", "label": "文心4.0 8K", "tags": ["推理", "通用", "中文"], "contextWindow": 8000 },
      { "id": "ernie-4.0-32k", "label": "文心4.0 32K", "tags": ["推理", "通用", "长文本"], "contextWindow": 32000 },
      { "id": "ernie-bot", "label": "文心一言3.5", "tags": ["通用", "中文"], "contextWindow": 8000 },
      { "id": "ernie-speed-8k", "label": "文心 Speed 8K", "tags": ["快速", "推理"], "contextWindow": 8000 }
    ]
  },
  "yi": {
    "baseUrl": "https://api.01.ai/v1/chat/completions",
    "apiKeyEnv": "YI_API_KEY",
    "defaultModel": "yi-large",
    "models": [
      { "id": "yi-large", "label": "Yi Large", "tags": ["推理", "通用", "长文本"], "contextWindow": 160000 },
      { "id": "yi-medium", "label": "Yi Medium", "tags": ["通用", "均衡"], "contextWindow": 32000 },
      { "id": "yi-spark", "label": "Yi Spark", "tags": ["快速", "经济"], "contextWindow": 16000 }
    ]
  },
"deepseek": {
    "baseUrl": "https://api.deepseek.com/v1/chat/completions",
    "apiKeyEnv": "DEEPSEEK_API_KEY",
    "defaultModel": "deepseek-v4-flash",
    "models": [
      {
        "id": "deepseek-v4-flash",
        "label": "DeepSeek V4 Flash（快速版）",
        "tags": ["通用", "快速", "低成本"],
        "contextWindow": 128000
      },
      {
        "id": "deepseek-v4-pro",
        "label": "DeepSeek V4 Pro（专业版）",
        "tags": ["推理", "深度思考", "代码", "数学"],
        "contextWindow": 128000
      }
    ]
  },
  "openai": {
    "baseUrl": "https://api.openai.com/v1/chat/completions",
    "apiKeyEnv": "OPENAI_API_KEY",
    "defaultModel": "gpt-4o",
    "models": [
      {
        "id": "gpt-4o",
        "label": "GPT-4o",
        "tags": [
          "通用",
          "视觉",
          "推理"
        ],
        "contextWindow": 128000
      },
      {
        "id": "gpt-4o-mini",
        "label": "GPT-4o Mini",
        "tags": [
          "快速",
          "低成本"
        ],
        "contextWindow": 128000
      },
      {
        "id": "o1",
        "label": "O1",
        "tags": [
          "推理",
          "深度思考"
        ],
        "contextWindow": 200000
      }
    ]
  },
  "openrouter": {
    "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "defaultModel": "openrouter/auto",
    "models": [
      {
        "id": "openrouter/auto",
        "label": "OpenRouter Auto",
        "tags": [
          "自动选择"
        ]
      },
      {
        "id": "openrouter/deepseek",
        "label": "DeepSeek via OpenRouter",
        "tags": [
          "推理"
        ]
      }
    ]
  },
  "anthropic": {
    "baseUrl": "https://api.anthropic.com/v1/messages",
    "apiKeyEnv": "ANTHROPIC_API_KEY",
    "defaultModel": "claude-sonnet-4-20250514",
    "models": [
      {
        "id": "claude-sonnet-4-20250514",
        "label": "Claude Sonnet 4",
        "tags": [
          "推理",
          "代码",
          "长文本"
        ],
        "contextWindow": 200000
      },
      {
        "id": "claude-3-5-sonnet-20241022",
        "label": "Claude 3.5 Sonnet",
        "tags": [
          "推理",
          "代码",
          "视觉"
        ],
        "contextWindow": 200000
      },
      {
        "id": "claude-opus-4-20250514",
        "label": "Claude Opus 4",
        "tags": [
          "强推理",
          "复杂"
        ],
        "contextWindow": 200000
      }
    ]
  },
  "google": {
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "apiKeyEnv": "GEMINI_API_KEY",
    "defaultModel": "gemini-2.5-flash",
    "models": [
      {
        "id": "gemini-2.5-flash",
        "label": "Gemini 2.5 Flash",
        "tags": [
          "快速",
          "视觉",
          "多模态"
        ],
        "contextWindow": 1000000
      },
      {
        "id": "gemini-2.5-pro",
        "label": "Gemini 2.5 Pro",
        "tags": [
          "推理",
          "长文本",
          "多模态"
        ],
        "contextWindow": 1000000
      }
    ]
  },
  "moonshot": {
    "baseUrl": "https://api.moonshot.cn/v1/chat/completions",
    "apiKeyEnv": "MOONSHOT_API_KEY",
    "defaultModel": "moonshot-v1-8k",
    "models": [
      {
        "id": "moonshot-v1-8k",
        "label": "Moonshot 8K",
        "tags": [
          "快速",
          "文本"
        ]
      },
      {
        "id": "moonshot-v1-32k",
        "label": "Moonshot 32K",
        "tags": [
          "通用",
          "文本"
        ]
      },
      {
        "id": "moonshot-v1-128k",
        "label": "Moonshot 128K",
        "tags": [
          "长文本"
        ]
      }
    ]
  },
  "tongyi": {
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    "apiKeyEnv": "TONGYI_API_KEY",
    "defaultModel": "qwen3.7-max",
    "visionModel": "qwen-vl-max",
    "models": [
      {
        "id": "qwen3.7-max",
        "label": "Qwen 3.7 Max（最新版）",
        "tags": ["推理", "通用", "最新"],
        "contextWindow": 128000
      },
      {
        "id": "qwen-max",
        "label": "通义千问 Max（稳定版）",
        "tags": ["推理", "通用"],
        "contextWindow": 128000
      },
      {
        "id": "qwen-plus",
        "label": "通义千问 Plus",
        "tags": ["通用", "均衡"],
        "contextWindow": 64000
      },
      {
        "id": "qwen-turbo",
        "label": "通义千问 Turbo",
        "tags": ["快速", "低成本"],
        "contextWindow": 32000
      },
      {
        "id": "qwen-vl-max",
        "label": "通义千问 VL Max（视觉）",
        "tags": ["视觉", "多模态", "推理"],
        "contextWindow": 64000
      }
    ]
  },
  "zhipu": {
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "apiKeyEnv": "ZHIPU_API_KEY",
    "defaultModel": "glm-4",
    "models": [
      {
        "id": "glm-4",
        "label": "GLM-4",
        "tags": [
          "通用",
          "推理"
        ]
      },
      {
        "id": "glm-4-plus",
        "label": "GLM-4 Plus",
        "tags": [
          "强推理",
          "复杂"
        ]
      },
      {
        "id": "glm-4-flash",
        "label": "GLM-4 Flash",
        "tags": [
          "快速",
          "经济"
        ]
      }
    ]
  },
  "minimax": {
    "baseUrl": "https://api.minimaxi.com/v1/text/chatcompletion",
    "apiKeyEnv": "MINIMAX_API_KEY",
    "defaultModel": "minimax-text-01",
    "models": [
      {
        "id": "minimax-text-01",
        "label": "MiniMax Text 01",
        "tags": [
          "通用",
          "长文本"
        ]
      },
      {
        "id": "MiniMax-M2.5",
        "label": "MiniMax M2.5",
        "tags": [
          "推理",
          "代码"
        ]
      }
    ]
  },
  "baichuan": {
    "baseUrl": "https://api.baichuan-ai.com/v1/chat/completions",
    "apiKeyEnv": "BAICHUAN_API_KEY",
    "defaultModel": "baichuan-4",
    "models": [
      {
        "id": "baichuan-4",
        "label": "百川 4",
        "tags": [
          "通用",
          "推理"
        ]
      }
    ]
  },
  "doubao": {
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    "apiKeyEnv": "DOUBAO_API_KEY",
    "defaultModel": "doubao-pro-32k",
    "models": [
      {
        "id": "doubao-pro-32k",
        "label": "豆包 Pro 32K",
        "tags": [
          "通用",
          "推理"
        ]
      },
      {
        "id": "doubao-pro-128k",
        "label": "豆包 Pro 128K",
        "tags": [
          "长文本",
          "通用"
        ]
      },
      {
        "id": "doubao-lite-32k",
        "label": "豆包 Lite 32K",
        "tags": [
          "快速",
          "经济"
        ]
      }
    ]
  },
  "siliconflow": {
    "baseUrl": "https://api.siliconflow.cn/v1/chat/completions",
    "apiKeyEnv": "SILICONFLOW_API_KEY",
    "defaultModel": "Pro/DeepSeek-V3",
    "models": [
      {
        "id": "Pro/DeepSeek-V3",
        "label": "DeepSeek V3",
        "tags": [
          "通用",
          "推理"
        ]
      },
      {
        "id": "Pro/DeepSeek-R1",
        "label": "DeepSeek R1",
        "tags": [
          "推理",
          "深度思考"
        ]
      },
      {
        "id": "Qwen/Qwen2.5-72B-Instruct",
        "label": "Qwen 2.5 72B",
        "tags": [
          "通用",
          "代码"
        ]
      }
    ]
  },
  "step": {
    "baseUrl": "https://api.stepfun.com/v1/chat/completions",
    "apiKeyEnv": "STEP_API_KEY",
    "defaultModel": "step-2-16k",
    "models": [
      {
        "id": "step-2-16k",
        "label": "阶跃星辰 Step-2",
        "tags": [
          "通用",
          "推理"
        ]
      }
    ]
  },
  "hunyuan": {
    "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    "apiKeyEnv": "HUNYUAN_API_KEY",
    "defaultModel": "hunyuan-pro",
    "visionModel": "hunyuan-vision",
    "models": [
      {
        "id": "hunyuan-pro",
        "label": "混元 Pro",
        "tags": ["推理","通用"],
        "contextWindow": 256000
      },
      {
        "id": "hunyuan-vision",
        "label": "混元 Vision",
        "tags": ["视觉","多模态"],
        "contextWindow": 256000
      },
      {
        "id": "hunyuan-standard",
        "label": "混元 Standard",
        "tags": ["快速","经济"],
        "contextWindow": 256000
      },
      {
        "id": "hunyuan-lite",
        "label": "混元 Lite",
        "tags": ["快速","低成本"],
        "contextWindow": 256000
      },
      {
        "id": "hunyuan-code",
        "label": "混元代码",
        "tags": ["代码","推理"],
        "contextWindow": 256000
      }
    ]
  }
};;

// ========== 读取 AI 配置（支持备用提供商） ==========
function readAIProviderConfig() {
  const fs = require('fs');
  const path = require('path');
  const BASE = __dirname;
  const cfgPath = path.join(BASE, '..', 'ai-provider.json');
  const config = { provider: 'ollama', fallbackProvider: null, fallbackModel: null };
  try {
    if (fs.existsSync(cfgPath)) {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (raw.provider) config.provider = raw.provider;
      if (raw.fallbackProvider) config.fallbackProvider = raw.fallbackProvider;
      if (raw.fallbackModel) config.fallbackModel = raw.fallbackModel;
      // 仅当环境变量未设置时，才从配置文件读取作为兼容降级
      if (raw.apiKey) {
        const envKey = PROVIDERS[raw.provider]?.apiKeyEnv || 'DEEPSEEK_API_KEY';
        if (!process.env[envKey]) {
          let keyValue = raw.apiKey;
          // 解密 enc: 前缀的密钥
          if (keyValue && keyValue.startsWith('enc:')) {
            try {
              const { decrypt } = require('./key-vault');
              const fs = require('fs');
              const path = require('path');
              const masterKeyPath = path.join(BASE, '..', '.master-key');
              if (fs.existsSync(masterKeyPath)) {
                const masterKey = fs.readFileSync(masterKeyPath, 'utf8').trim();
                keyValue = decrypt(keyValue, masterKey);
              }
            } catch(ex) {
              console.error('[ai-engine] 解密失败:', ex.message);
              keyValue = '';
            }
          }
          if (keyValue) process.env[envKey] = keyValue;
        }
      }
    }
  } catch(e) { /* ignore */ }
  // Check env vars for fallback
  if (process.env.AI_FALLBACK_PROVIDER) config.fallbackProvider = process.env.AI_FALLBACK_PROVIDER;
  return config;
}

// ========== 执行一次 API 调用 ==========
async function callProviderOnce(providerName, messages, options) {
  // 每次调用前重新读取并解密 provider-keys.json
  try {
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const pkPath = path.join(__dirname, '..', 'provider-keys.json');
    if (fs.existsSync(pkPath)) {
      const allKeys = JSON.parse(fs.readFileSync(pkPath, 'utf8'));
      const MASTER_KEY_PATH = path.join(__dirname, '..', '.master-key');
      let masterKey = null;
      if (fs.existsSync(MASTER_KEY_PATH)) masterKey = fs.readFileSync(MASTER_KEY_PATH, 'utf8').trim();
      for (const [provider, encryptedKey] of Object.entries(allKeys)) {
        if (!encryptedKey) continue;
        let decryptedKey = '';
        if (encryptedKey.startsWith('enc:') && masterKey) {
          try {
            const ENCRYPTION_KEY = crypto.createHash('sha256').update(masterKey).digest();
            const parts = encryptedKey.replace('enc:', '').split(':');
            const iv = Buffer.from(parts[0], 'hex');
            const encrypted = Buffer.from(parts[1], 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv, { authTagLength: 16 });
            const authTag = encrypted.slice(-16);
            decipher.setAuthTag(authTag);
            const ciphertext = encrypted.slice(0, -16);
            decryptedKey = decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');
          } catch(ex) { continue; }
        } else if (!encryptedKey.startsWith('enc:')) {
          decryptedKey = encryptedKey;
        }
        if (decryptedKey) {
          const envKey = PROVIDERS[provider]?.apiKeyEnv || (provider.toUpperCase() + '_API_KEY');
          process.env[envKey] = decryptedKey;
        }
      }
    }
  } catch(e) { /* ignore */ }
  
  const { toolDefs, model, temperature = 0.7, maxTokens = 4096, timeout = 30000 } = options;
  // 调试日志
  try { fs.appendFileSync('F:\\eCompany-Dev\\backend\\logs\\ai-engine-debug.log', new Date().toISOString() + ' [callProviderOnce] providerName=' + providerName + '\\n'); } catch(ex) {}
  
  const providerCfg = PROVIDERS[providerName.toLowerCase()];
  if (!providerCfg) throw new Error(`不支持的 AI 提供商: ${providerName}`);
  
  // 调试日志：显示环境变量名和值（前10字符）
  try { fs.appendFileSync('F:\\eCompany-Dev\\backend\\logs\\ai-engine-debug.log', new Date().toISOString() + ' [callProviderOnce] apiKeyEnv=' + providerCfg.apiKeyEnv + ' envValue=' + (process.env[providerCfg.apiKeyEnv] ? process.env[providerCfg.apiKeyEnv].substring(0,10) + '...' : '(empty)') + '\\n'); } catch(ex) {}
  
  const apiKey = process.env[providerCfg.apiKeyEnv];
  // 本地模型（如 Ollama）不需要 API Key
  if (!apiKey && !providerCfg.noApiKey) throw new Error(`未配置 ${providerCfg.apiKeyEnv} 环境变量`);

  const body = {
    model: model || providerCfg.defaultModel,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  if (toolDefs && toolDefs.length) {
    body.tools = toolDefs;
    body.tool_choice = 'auto';
  }

  var _retries = 0;
  var _lastErr = null;
  while (_retries < 3) {
    _retries++;
    if (_retries > 1) await new Promise(function(r) { setTimeout(r, (_retries - 1) * 1500); });
    try {
      const controller = new AbortController();
      var rt = setTimeout(function() { controller.abort(); }, timeout);
      // Provider-specific request adaptation
      var _url = providerCfg.baseUrl;
      var _headers = { 'Content-Type': 'application/json' };
      var _body = JSON.stringify(body);
      var pn = providerName.toLowerCase();
      // 本地模型（Ollama）不需要 Authorization 头
      if (!providerCfg.noApiKey) {
        if (pn === 'anthropic') {
          _headers['x-api-key'] = apiKey;
          _headers['anthropic-version'] = '2023-06-01';
          var sysMsg = '', anthMsgs = [];
          for (var _m of messages) {
            if (_m.role === 'system') { sysMsg = _m.content; continue; }
            if (_m.role === 'tool') continue;
            anthMsgs.push({ role: _m.role, content: _m.content });
          }
          var anthBody = { model: body.model, max_tokens: body.max_tokens, messages: anthMsgs };
          if (body.temperature !== undefined) anthBody.temperature = body.temperature;
          if (sysMsg) anthBody.system = sysMsg;
          _body = JSON.stringify(anthBody);
        } else if (pn === 'ernie') {
          var keyParts = apiKey.split('|');
          var cid = keyParts[0], csec = keyParts[1] || keyParts[0];
          var tokenRes = await fetch('https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=' + encodeURIComponent(cid) + '&client_secret=' + encodeURIComponent(csec), { signal: controller.signal });
          var tokenData = await tokenRes.json();
          if (tokenData.access_token) _url = providerCfg.baseUrl + '?access_token=' + tokenData.access_token;
        } else if (pn === 'zhipu' || pn === 'minimax' || pn === 'hunyuan') {
          _headers['Authorization'] = 'Bearer ' + apiKey;
        } else {
          _headers['Authorization'] = 'Bearer ' + apiKey;
        }
      }
      const res = await fetch(_url, {
      method: 'POST',
      headers: _headers,
      body: _body,
      signal: controller.signal
    });
    clearTimeout(rt);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${providerName} API ${res.status}: ${errText.substring(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    _lastErr = err;
      clearTimeout(timer);
      continue;
    }
  }
  throw _lastErr || new Error(providerName + ' 调用失败（已重试 3 次）');
}

// ========== AI 调用（带多提供商遍历降级） ==========
async function aiChat(messages, options = {}) {
  const { toolDefs, provider, model, temperature = 0.7, maxTokens = 4096, timeout = 30000 } = options;

  const config = readAIProviderConfig();
  const activeProvider = provider || config.provider || process.env.AI_PROVIDER || 'ollama';

  // 第一优先级：显式指定的 provider
  if (provider) {
    return await callProviderOnce(provider, messages, options);
  }

  // 第二优先级：尝试主提供商
  try {
    const result = await callProviderOnce(activeProvider, messages, options);
    return result;
  } catch (primaryErr) {
    // 主提供商失败，尝试备用提供商
    const fallbackProvider = config.fallbackProvider || process.env.AI_FALLBACK_PROVIDER;
    if (fallbackProvider && fallbackProvider !== activeProvider) {
      try {
        const fallbackOptions = { ...options };
        if (config.fallbackModel) fallbackOptions.model = config.fallbackModel;
        const result = await callProviderOnce(fallbackProvider, messages, fallbackOptions);
        return result;
      } catch (fallbackErr) {
        throw new Error(`主提供商(${activeProvider})和备用提供商(${fallbackProvider})均失败: ${fallbackErr.message}`);
      }
    }
    // 主提供商失败，遍历所有其它已配置的提供商
    for (var _p of Object.keys(PROVIDERS)) {
      if (_p === activeProvider) continue;
      if (_p === fallbackProvider) continue;
      try {
        var _envKey = PROVIDERS[_p].apiKeyEnv;
        if (process.env[_envKey] || PROVIDERS[_p].noApiKey) {
          return await callProviderOnce(_p, messages, options);
        }
      } catch(_e) { /* try next */ }
    }
    throw primaryErr;
  }
}

// ========== 多轮对话（含工具调用） ==========
async function aiChatWithTools(messages, tools, options = {}) {
  // 第一轮：调用模型（可能返回工具调用）
  const response = await aiChat(messages, { ...options, toolDefs: tools });
  if (!response.choices?.length) throw new Error('API 返回为空');

  const choice = response.choices[0];

  // 如果没有工具调用，直接返回
  if (choice.finish_reason !== 'tool_calls' || !choice.message?.tool_calls) {
    return { reply: choice.message?.content || '', toolCalls: [] };
  }

  // 执行工具调用
  const secondMessages = [...messages, choice.message];
  const toolResults = [];

  for (const tc of choice.message.tool_calls) {
    if (tc.type === 'function') {
      const funcName = tc.function.name;
      let funcArgs = {};
      try { funcArgs = JSON.parse(tc.function.arguments); } catch (e) {}

      toolResults.push({ name: funcName, args: funcArgs });

      secondMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify({ result: `工具 ${funcName} 已执行`, args: funcArgs })
      });
    }
  }

  // 第二轮：获取最终回复
  const secondResponse = await aiChat(secondMessages, { ...options, toolDefs: tools });
  const finalReply = secondResponse.choices?.[0]?.message?.content || '';

  return { reply: finalReply, toolCalls: toolResults };
}

// ========== 流式输出 ==========
async function* aiChatStream(messages, options = {}) {
  const { provider, model } = options;
  const activeProvider = provider || process.env.AI_PROVIDER || 'ollama';
  const providerCfg = PROVIDERS[activeProvider];
  if (!providerCfg) throw new Error(`不支持的提供商: ${activeProvider}`);

  const apiKey = process.env[providerCfg.apiKeyEnv];
  if (!apiKey && !providerCfg.noApiKey) throw new Error(`未配置 ${providerCfg.apiKeyEnv}`);

  const headers = { 'Content-Type': 'application/json' };
  if (!providerCfg.noApiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(providerCfg.baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model || providerCfg.defaultModel,
      messages,
      stream: true,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 4096
    })
  });

  if (!res.ok) throw new Error(`API ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) yield content;
        } catch (e) { /* 跳过解析错误 */ }
      }
    }
  }
}

module.exports = {
  PROVIDERS,
  aiChat,
  aiChatWithTools,
  aiChatStream
};
