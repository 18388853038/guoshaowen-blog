/**
 * eCompany AI Engine
 * 多模型 AI 引擎 - 支持 DeepSeek / OpenAI / Anthropic / Ollama 等
 * 注入：多模型故障切换、流式输出、高级工具调用
 */

// ========== 模型配置 ==========
const PROVIDERS = {
  "ollama": {
    "baseUrl": process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1/chat/completions",
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
      { "id": "ernie-3.5-8k", "label": "文心3.5 8K", "tags": ["通用", "中文"], "contextWindow": 8000 },
      { "id": "ernie-speed-128k", "label": "文心 Speed 128K", "tags": ["快速", "长文本", "经济"], "contextWindow": 128000 },
      { "id": "ernie-speed-8k", "label": "文心 Speed 8K", "tags": ["快速", "推理"], "contextWindow": 8000 },
      { "id": "ernie-lite-8k", "label": "文心 Lite 8K", "tags": ["轻量", "经济"], "contextWindow": 8000 }
    ]
  },
  "yi": {
    "baseUrl": "https://api.01.ai/v1/chat/completions",
    "apiKeyEnv": "YI_API_KEY",
    "defaultModel": "yi-large",
    "models": [
      { "id": "yi-large", "label": "Yi Large", "tags": ["推理", "通用", "长文本"], "contextWindow": 160000 },
      { "id": "yi-large-turbo", "label": "Yi Large Turbo", "tags": ["推理", "快速"], "contextWindow": 32000 },
      { "id": "yi-medium", "label": "Yi Medium", "tags": ["通用", "均衡"], "contextWindow": 32000 },
      { "id": "yi-medium-turbo", "label": "Yi Medium Turbo", "tags": ["均衡", "快速"], "contextWindow": 16000 },
      { "id": "yi-spark", "label": "Yi Spark", "tags": ["快速", "经济"], "contextWindow": 16000 },
      { "id": "yi-lightning", "label": "Yi Lightning", "tags": ["快速", "轻量"], "contextWindow": 16000 }
    ]
  },
  "deepseek": {
    "baseUrl": "https://api.deepseek.com/v1/chat/completions",
    "apiKeyEnv": "DEEPSEEK_API_KEY",
    "defaultModel": "deepseek-chat",
    "models": [
      { "id": "deepseek-chat", "label": "DeepSeek Chat V3（⚠️ 2026/07/24 弃用）", "tags": ["通用", "快速", "低成本"], "contextWindow": 1000000 },
      { "id": "deepseek-reasoner", "label": "DeepSeek R1（⚠️ 2026/07/24 弃用）", "tags": ["推理", "深度思考"], "contextWindow": 64000 },
      { "id": "deepseek-v4-flash", "label": "DeepSeek V4 Flash（轻量版）🌟 推荐", "tags": ["快速", "低成本", "轻量"], "contextWindow": 1000000 },
      { "id": "deepseek-v4-pro", "label": "DeepSeek V4 Pro（专业版）", "tags": ["推理", "深度思考", "代码", "数学"], "contextWindow": 1000000 }
    ]
  },
  "openai": {
    "baseUrl": "https://api.openai.com/v1/chat/completions",
    "apiKeyEnv": "OPENAI_API_KEY",
    "defaultModel": "gpt-4o",
    "models": [
      { "id": "gpt-4o", "label": "GPT-4o", "tags": ["通用", "视觉", "推理"], "contextWindow": 128000 },
      { "id": "gpt-4o-mini", "label": "GPT-4o Mini", "tags": ["快速", "低成本"], "contextWindow": 128000 },
      { "id": "gpt-4o-mini-high", "label": "GPT-4o Mini High", "tags": ["低成本", "高精度"], "contextWindow": 128000 },
      { "id": "o1", "label": "O1", "tags": ["推理", "深度思考"], "contextWindow": 200000 },
      { "id": "o3-mini", "label": "O3 Mini", "tags": ["推理", "快速"], "contextWindow": 200000 },
      { "id": "gpt-4-turbo", "label": "GPT-4 Turbo", "tags": ["通用", "高精度"], "contextWindow": 128000 },
      { "id": "gpt-4", "label": "GPT-4", "tags": ["通用", "稳定"], "contextWindow": 8192 }
    ]
  },
  "openrouter": {
    "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "defaultModel": "openrouter/auto",
    "models": [
      { "id": "openrouter/auto", "label": "OpenRouter Auto", "tags": ["自动选择"], "contextWindow": 128000 },
      { "id": "openrouter/deepseek", "label": "DeepSeek via OpenRouter", "tags": ["推理"], "contextWindow": 128000 }
    ]
  },
  "anthropic": {
    "baseUrl": "https://api.anthropic.com/v1/messages",
    "apiKeyEnv": "ANTHROPIC_API_KEY",
    "defaultModel": "claude-sonnet-4-20250514",
    "models": [
      { "id": "claude-sonnet-4-20250514", "label": "Claude Sonnet 4", "tags": ["推理", "通用", "代码", "长文本"], "contextWindow": 200000 },
      { "id": "claude-3-5-sonnet-20241022", "label": "Claude 3.5 Sonnet", "tags": ["推理", "通用", "代码"], "contextWindow": 200000 },
      { "id": "claude-opus-4-20250514", "label": "Claude Opus 4", "tags": ["深度思考", "推理", "高精度"], "contextWindow": 200000 },
      { "id": "claude-3-5-haiku-20241022", "label": "Claude 3.5 Haiku", "tags": ["快速", "低成本", "轻量"], "contextWindow": 200000 },
      { "id": "claude-3-haiku-20240307", "label": "Claude 3 Haiku", "tags": ["快速", "经济"], "contextWindow": 200000 }
    ]
  },
  "google": {
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "apiKeyEnv": "GOOGLE_API_KEY",
    "defaultModel": "gemini-2.5-flash",
    "models": [
      { "id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash", "tags": ["快速", "多模态", "低成本"], "contextWindow": 1000000 },
      { "id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro", "tags": ["推理", "多模态", "深度思考"], "contextWindow": 1000000 },
      { "id": "gemini-2.0-flash", "label": "Gemini 2.0 Flash", "tags": ["快速", "多模态"], "contextWindow": 1000000 },
      { "id": "gemini-1.5-pro", "label": "Gemini 1.5 Pro", "tags": ["推理", "稳定"], "contextWindow": 2000000 },
      { "id": "gemini-1.5-flash", "label": "Gemini 1.5 Flash", "tags": ["快速", "经济"], "contextWindow": 1000000 }
    ]
  },
  "gemini": {
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "apiKeyEnv": "GEMINI_API_KEY",
    "defaultModel": "gemini-2.5-flash",
    "models": [
      { "id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash", "tags": ["快速", "多模态", "低成本"], "contextWindow": 1000000 },
      { "id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro", "tags": ["推理", "多模态", "深度思考"], "contextWindow": 1000000 }
    ]
  },
  "moonshot": {
    "baseUrl": "https://api.moonshot.cn/v1/chat/completions",
    "apiKeyEnv": "MOONSHOT_API_KEY",
    "defaultModel": "moonshot-v1-8k",
    "models": [
      { "id": "moonshot-v1-8k", "label": "Moonshot 8K", "tags": ["通用", "中文"], "contextWindow": 8000 },
      { "id": "moonshot-v1-32k", "label": "Moonshot 32K", "tags": ["通用", "长文本"], "contextWindow": 32000 },
      { "id": "moonshot-v1-128k", "label": "Moonshot 128K", "tags": ["长文本", "深度"], "contextWindow": 128000 }
    ]
  },
  "tongyi": {
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    "apiKeyEnv": "DASHSCOPE_API_KEY",
    "defaultModel": "qwen3.7-max",
    "models": [
      { "id": "qwen3.7-max", "label": "Qwen 3.7 Max（最新旗舰）", "tags": ["推理", "高精度", "中文"], "contextWindow": 131072 },
      { "id": "qwen3.7-plus", "label": "Qwen 3.7 Plus（均衡型）", "tags": ["均衡", "通用", "中文"], "contextWindow": 131072 },
      { "id": "qwen3.6-flash", "label": "Qwen 3.6 Flash（快速型）", "tags": ["快速", "低成本", "中文"], "contextWindow": 131072 },
      { "id": "qwen3.6-flash-lite", "label": "Qwen 3.6 Flash Lite", "tags": ["轻量", "经济"], "contextWindow": 131072 },
      { "id": "qwen-max", "label": "通义千问 Max（稳定版）", "tags": ["推理", "稳定", "中文"], "contextWindow": 32768 },
      { "id": "qwen-plus", "label": "通义千问 Plus", "tags": ["均衡", "通用"], "contextWindow": 131072 },
      { "id": "qwen-turbo", "label": "通义千问 Turbo", "tags": ["快速", "经济"], "contextWindow": 131072 },
      { "id": "qwen-vl-max", "label": "通义千问 VL Max（视觉多模态）", "tags": ["视觉", "多模态", "中文"], "contextWindow": 32768 },
      { "id": "qwen2.5-72b-instruct", "label": "Qwen 2.5 72B", "tags": ["推理", "开源", "中文"], "contextWindow": 131072 }
    ]
  },
  "zhipu": {
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "apiKeyEnv": "ZHIPUAI_API_KEY",
    "defaultModel": "glm-4-plus",
    "models": [
      { "id": "glm-4-plus", "label": "GLM-4 Plus", "tags": ["推理", "高精度", "中文"], "contextWindow": 128000 },
      { "id": "glm-4", "label": "GLM-4", "tags": ["通用", "中文"], "contextWindow": 128000 },
      { "id": "glm-4-flash", "label": "GLM-4 Flash", "tags": ["快速", "经济", "中文"], "contextWindow": 128000 },
      { "id": "glm-4-flashx", "label": "GLM-4 FlashX", "tags": ["快速", "轻量"], "contextWindow": 128000 },
      { "id": "glm-4-air", "label": "GLM-4 Air", "tags": ["轻量", "经济"], "contextWindow": 128000 },
      { "id": "glm-4-long", "label": "GLM-4 Long（长文本）", "tags": ["长文本", "深度"], "contextWindow": 1048576 },
      { "id": "glm-4v-plus", "label": "GLM-4V Plus（视觉）", "tags": ["视觉", "多模态"], "contextWindow": 128000 }
    ]
  },
  "siliconflow": {
    "baseUrl": "https://api.siliconflow.cn/v1/chat/completions",
    "apiKeyEnv": "SILICONFLOW_API_KEY",
    "defaultModel": "Pro/DeepSeek-V3",
    "models": [
      { "id": "Pro/DeepSeek-V3", "label": "DeepSeek V3", "tags": ["推理", "通用", "中文"], "contextWindow": 64000 },
      { "id": "Pro/DeepSeek-R1", "label": "DeepSeek R1", "tags": ["推理", "深度思考"], "contextWindow": 64000 },
      { "id": "Qwen/Qwen2.5-72B-Instruct", "label": "Qwen 2.5 72B", "tags": ["推理", "开源", "中文"], "contextWindow": 32768 },
      { "id": "Qwen/Qwen2.5-32B-Instruct", "label": "Qwen 2.5 32B", "tags": ["均衡", "开源"], "contextWindow": 32768 },
      { "id": "Qwen/Qwen2.5-14B-Instruct", "label": "Qwen 2.5 14B", "tags": ["快速", "开源"], "contextWindow": 32768 },
      { "id": "Qwen/Qwen2.5-7B-Instruct", "label": "Qwen 2.5 7B", "tags": ["轻量", "开源"], "contextWindow": 32768 },
      { "id": "THUDM/glm-4-9b-chat", "label": "GLM-4 9B", "tags": ["中文", "开源"], "contextWindow": 128000 },
      { "id": "internlm/internlm2_5-7b-chat", "label": "InternLM 2.5 7B", "tags": ["中文", "开源"], "contextWindow": 32768 },
      { "id": "BAAI/bge-large-zh-v1.5", "label": "BGE Large（嵌入）", "tags": ["嵌入", "中文"], "contextWindow": 512 },
      { "id": "meta-llama/Meta-Llama-3.1-8B-Instruct", "label": "Llama 3.1 8B", "tags": ["通用", "开源"], "contextWindow": 128000 },
      { "id": "google/gemma-2-9b-it", "label": "Gemma 2 9B", "tags": ["通用", "开源"], "contextWindow": 8192 }
    ]
  },
  "baichuan": {
    "baseUrl": "https://api.baichuan-ai.com/v1/chat/completions",
    "apiKeyEnv": "BAICHUAN_API_KEY",
    "defaultModel": "baichuan-4",
    "models": [
      { "id": "baichuan-4", "label": "百川 4", "tags": ["通用", "推理", "中文"], "contextWindow": 96000 },
      { "id": "baichuan-3-turbo", "label": "百川 3 Turbo", "tags": ["快速", "推理"], "contextWindow": 32768 }
    ]
  },
  "minimax": {
    "baseUrl": "https://api.minimax.chat/v1/text/chatcompletion_v2",
    "apiKeyEnv": "MINIMAX_API_KEY",
    "defaultModel": "MiniMax-M2.5",
    "models": [
      { "id": "MiniMax-M2.5", "label": "MiniMax M2.5", "tags": ["推理", "通用", "中文"], "contextWindow": 1048576 },
      { "id": "minimax-text-01", "label": "MiniMax Text 01", "tags": ["通用", "中文", "长文本"], "contextWindow": 1048576 },
      { "id": "abab-5.5s", "label": "Abab 5.5s", "tags": ["推理", "中文"], "contextWindow": 8192 },
      { "id": "abab-5.5", "label": "Abab 5.5", "tags": ["通用", "中文"], "contextWindow": 8192 }
    ]
  },
  "doubao": {
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    "apiKeyEnv": "DOUBAO_API_KEY",
    "defaultModel": "doubao-pro-32k",
    "models": [
      { "id": "doubao-pro-32k", "label": "豆包 Pro 32K", "tags": ["推理", "通用", "中文"], "contextWindow": 32000 },
      { "id": "doubao-pro-128k", "label": "豆包 Pro 128K", "tags": ["推理", "长文本"], "contextWindow": 128000 },
      { "id": "doubao-pro-256k", "label": "豆包 Pro 256K", "tags": ["推理", "超长文本"], "contextWindow": 256000 },
      { "id": "doubao-lite-32k", "label": "豆包 Lite 32K", "tags": ["轻量", "经济", "中文"], "contextWindow": 32000 },
      { "id": "doubao-lite-128k", "label": "豆包 Lite 128K", "tags": ["经济", "长文本"], "contextWindow": 128000 },
      { "id": "ep-20250312144904-5lzbr", "label": "豆包 1.5 Pro 256K", "tags": ["旗舰", "推理", "超长文本"], "contextWindow": 256000 }
    ]
  },
  "step": {
    "baseUrl": "https://api.stepfun.com/v1/chat/completions",
    "apiKeyEnv": "STEP_API_KEY",
    "defaultModel": "step-2-16k",
    "models": [
      { "id": "step-2-16k", "label": "阶跃星辰 Step-2", "tags": ["推理", "通用", "中文"], "contextWindow": 16000 },
      { "id": "step-1-32k", "label": "阶跃星辰 Step-1 32K", "tags": ["均衡", "中文"], "contextWindow": 32000 },
      { "id": "step-1-flash", "label": "阶跃星辰 Step-1 Flash", "tags": ["快速", "经济"], "contextWindow": 8000 },
      { "id": "step-2v-32k", "label": "阶跃星辰 Step-2V（视觉）", "tags": ["视觉", "多模态"], "contextWindow": 32000 }
    ]
  },
  "hunyuan": {
    "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    "apiKeyEnv": "HUNYUAN_API_KEY",
    "defaultModel": "hunyuan-pro",
    "models": [
      { "id": "hunyuan-pro", "label": "混元 Pro", "tags": ["推理", "高精度", "中文"], "contextWindow": 32768 },
      { "id": "hunyuan-standard", "label": "混元 Standard", "tags": ["均衡", "通用", "中文"], "contextWindow": 32768 },
      { "id": "hunyuan-lite", "label": "混元 Lite", "tags": ["轻量", "经济", "中文"], "contextWindow": 32768 },
      { "id": "hunyuan-vision", "label": "混元 Vision", "tags": ["视觉", "多模态"], "contextWindow": 32768 },
      { "id": "hunyuan-code", "label": "混元代码", "tags": ["代码", "推理"], "contextWindow": 32768 },
      { "id": "hunyuan-turbo", "label": "混元 Turbo", "tags": ["快速", "推理"], "contextWindow": 32768 }
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
// 延迟加载 execCEOTool（由 server-modern.js 注入全局）
var _execCEOTool = null;
try {
  var execTools = require('./executor-tools');
  if (execTools && typeof execTools.execCEOTool === 'function') {
    _execCEOTool = execTools.execCEOTool;
  }
} catch(e) { /* fallback below */ }
var _execCEOToolFn = _execCEOTool || (typeof globalThis !== 'undefined' && globalThis.execCEOTool) || null;

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

      // 执行实际工具函数
      var toolResult = '';
      try {
        if (_execCEOToolFn) {
          var raw = await Promise.resolve(_execCEOToolFn(funcName, funcArgs));
          if (raw && typeof raw === 'object') {
            toolResult = JSON.stringify(raw, null, 2);
          } else if (raw !== undefined) {
            toolResult = String(raw);
          } else {
            toolResult = 'null';
          }
        } else {
          toolResult = JSON.stringify({ note: 'execCEOTool不可用', args: funcArgs, funcName: funcName });
        }
      } catch(e) {
        toolResult = JSON.stringify({ error: e.message, args: funcArgs });
      }

      secondMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolResult
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
