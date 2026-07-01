/**
 * ai-image.js — AI 图像生成引擎
 *
 * 封装多家 provider 的图像生成 API，统一接口：
 *   generateImage(prompt, options) → { url, b64, provider, model }
 *
 * 支持的 provider:
 *   - openai (DALL-E 3 / DALL-E 2)
 *   - deepseek (目前不支持，保留扩展点)
 *   - siliconflow (FLUX / SDXL)
 *   - ollama (本地，Flux via API)
 *
 * 复用 ai-engine.js 的 provider-keys.json 密钥体系
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const PK_PATH = path.join(__dirname, '..', 'provider-keys.json');

// ========== Provider 图像能力定义 ==========
const IMAGE_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/images/generations',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: [
      { id: 'dall-e-3', label: 'DALL-E 3', maxSize: 1024, supports: ['hd', 'quality'] },
      { id: 'dall-e-2', label: 'DALL-E 2', maxSize: 1024 },
    ],
    defaultModel: 'dall-e-3',
    supportsBase64: true,
  },
  siliconflow: {
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1/images/generations',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    models: [
      { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1-schnell (快速)', maxSize: 1024 },
      { id: 'stabilityai/stable-diffusion-3-5-large', label: 'SD 3.5 Large', maxSize: 1024 },
      { id: 'Pro/midjourney', label: 'Midjourney (Pro)', maxSize: 1024 },
    ],
    defaultModel: 'black-forest-labs/FLUX.1-schnell',
    supportsBase64: false,
  },
  // DeepSeek 当前不支持图像生成，保留扩展位置
  // 本地 Ollama + Flux 模型
};

// ========== 读取加密 Key ==========
function readApiKey(providerName) {
  var envKey = IMAGE_PROVIDERS[providerName]?.apiKeyEnv;
  if (envKey && process.env[envKey]) return process.env[envKey];

  // 从 provider-keys.json 读
  try {
    if (!fs.existsSync(PK_PATH)) return null;
    var allKeys = JSON.parse(fs.readFileSync(PK_PATH, 'utf-8'));
    var provider = providerName === 'openai' ? 'openai' : providerName;
    return allKeys[provider] || process.env[envKey] || null;
  } catch(e) {
    return null;
  }
}

// ========== 图像生成 ==========
async function generateImage(prompt, options = {}) {
  var provider = options.provider || 'openai';
  var model = options.model || IMAGE_PROVIDERS[provider]?.defaultModel;
  var size = options.size || '1024x1024';
  var quality = options.quality || 'standard'; // dall-e-3 only: standard | hd
  var n = options.n || 1;
  var timeout = options.timeout || 60000;

  var provCfg = IMAGE_PROVIDERS[provider];
  if (!provCfg) throw new Error('不支持的图像提供商: ' + provider);

  // DALL-E 3 只支持 n=1
  if (model === 'dall-e-3' && n > 1) n = 1;

  var apiKey = readApiKey(provider);
  if (!apiKey) throw new Error('提供商 ' + provider + ' 未配置 API Key');

  // 构建请求体
  var body = { prompt, n, size };

  // DALL-E 专属参数
  if (model === 'dall-e-3') {
    body.model = 'dall-e-3';
    body.quality = quality;
  }
  if (model === 'dall-e-2') {
    body.model = 'dall-e-2';
  }
  // SiliconFlow 需要指定 model
  if (provider === 'siliconflow' || provider === 'ollama') {
    body.model = model;
  }

  // 发起请求
  var url = new URL(provCfg.baseUrl);
  var fetchImpl = url.protocol === 'https:' ? https : http;

  return new Promise(function(resolve, reject) {
    var data = JSON.stringify(body);
    var req = fetchImpl.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': 'Bearer ' + apiKey,
      },
      timeout: timeout,
    }, function(res) {
      var chunks = '';
      res.on('data', function(c) { chunks += c; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(chunks);
          if (res.statusCode >= 400) {
            reject(new Error(provider + ' API ' + res.statusCode + ': ' + (parsed.error?.message || chunks.substring(0, 200))));
            return;
          }

          var result;

          // OpenAI/DALL-E 格式: { data: [{ url, b64_json }] }
          if (parsed.data && Array.isArray(parsed.data)) {
            result = {
              images: parsed.data.map(function(d, i) {
                return {
                  url: d.url || '',
                  b64: d.b64_json || '',
                  index: i,
                  revisedPrompt: d.revised_prompt || '',
                };
              }),
              provider: provider,
              model: model,
              created: parsed.created || Date.now(),
            };
          }
          // SiliconFlow / OpenAI 兼容格式
          else if (parsed.images && Array.isArray(parsed.images)) {
            result = {
              images: parsed.images.map(function(d, i) {
                return {
                  url: d.url || '',
                  b64: d.b64 || '',
                  index: i,
                };
              }),
              provider: provider,
              model: model,
              created: parsed.created || Date.now(),
            };
          }
          else {
            result = {
              raw: parsed,
              provider: provider,
              model: model,
            };
          }

          resolve(result);
        } catch(e) {
          reject(new Error('解析响应失败: ' + e.message + ' body=' + chunks.substring(0, 200)));
        }
      });
    });

    req.on('error', function(e) { reject(new Error('请求失败: ' + e.message)); });
    req.on('timeout', function() { req.destroy(); reject(new Error('请求超时')); });
    req.write(data);
    req.end();
  });
}

// ========== 获取可用图像提供商列表 ==========
function getAvailableProviders() {
  var result = [];
  for (var key of Object.keys(IMAGE_PROVIDERS)) {
    var prov = IMAGE_PROVIDERS[key];
    result.push({
      id: key,
      name: prov.name,
      models: prov.models,
      defaultModel: prov.defaultModel,
      configured: !!readApiKey(key),
    });
  }
  return result;
}

// ========== 测试连接 ==========
async function testProvider(providerName) {
  return !!readApiKey(providerName);
}

module.exports = {
  generateImage,
  getAvailableProviders,
  testProvider,
  IMAGE_PROVIDERS,
};
