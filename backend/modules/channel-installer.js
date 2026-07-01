/**
 * eCompany 渠道插件自动安装模块 v2
 * 
 * 遵循各平台官方文档规范：
 *   微信   → https://docs.openclaw.ai/channels/wechat.md  (扫码绑定)
 *   飞书   → https://docs.openclaw.ai/channels/feishu.md  (扫码或 AppID+Secret)
 *   钉钉   → 钉钉开放平台 (ClientID+ClientSecret)
 *   企业微信 → 企微开放平台 (CorpID+AgentID+Secret)
 *   QQ 机器人 → https://docs.openclaw.ai/channels/qqbot.md (AppID+Secret)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json');

function isOpenClawAvailable() {
  try {
    execSync('openclaw --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch (e) { return false; }
}

async function isGatewayRunning() {
  try {
    const res = await fetch('http://127.0.0.1:18789/', { signal: AbortSignal.timeout(2000) });
    return true;
  } catch (e) { return false; }
}

function readOpenClawConfig() {
  try {
    if (fs.existsSync(OPENCLAW_CONFIG)) {
      return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
    }
  } catch (e) {}
  return {};
}

function writeOpenClawConfig(config) {
  const dir = path.dirname(OPENCLAW_CONFIG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2), 'utf-8');
}

function runCommand(cmd, cwd, timeoutMs) {
  timeoutMs = timeoutMs || 60000;
  try {
    const result = execSync(cmd, {
      cwd: cwd || __dirname,
      timeout: timeoutMs,
      stdio: 'pipe',
      encoding: 'utf-8',
      windowsHide: true
    });
    return { ok: true, output: (result || '').trim() };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message).trim() };
  }
}

// ========== 各渠道的安装与配置 ==========
// 严格遵循各平台官方文档

const CHANNEL_HANDLERS = {
  // ===== 1. 个人微信 (WeChat / Weixin) =====
  personal_wx: {
    id: 'personal_wx',
    name: '个人微信',
    icon: '💬',
    officialDocs: 'https://docs.openclaw.ai/channels/wechat.md',
    method: '扫码绑定',
    steps: [
      '1. 在电脑终端执行: npx -y @tencent-weixin/openclaw-weixin-cli@latest install',
      '2. 终端显示二维码后，打开手机微信「扫一扫」扫码',
      '3. 扫码成功后，ClawBot 自动与系统绑定',
      '4. 或者: openclaw channels login --channel openclaw-weixin'
    ],
    fields: [],
    async isReady() {
      try {
        const res = await fetch('http://127.0.0.1:19088/health', { signal: AbortSignal.timeout(2000) });
        return res.ok;
      } catch (e) { return false; }
    },
    async install() {
      return runCommand('npx -y @tencent-weixin/openclaw-weixin-cli@latest install', null, 120000);
    },
    async configure() {
      return { ok: true, message: '个人微信使用扫码绑定，无需额外配置' };
    }
  },

  // ===== 2. 飞书 Feishu =====
  feishu: {
    id: 'feishu',
    name: '飞书',
    icon: '📘',
    officialDocs: 'https://docs.openclaw.ai/channels/feishu.md',
    method: '扫码自动创建 或 手动配置',
    steps: [
      '方式一（推荐）: openclaw channels login --channel feishu',
      '  终端显示二维码，用飞书 App 扫码，自动创建机器人',
      '',
      '方式二（手动）:',
      '  1. 打开 https://open.feishu.cn -> 创建企业自建应用',
      '  2. 开通机器人能力，发布应用',
      '  3. 获取 App ID 和 App Secret',
      '  4. 在下表填写凭证'
    ],
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', placeholder: '从飞书开放平台获取' },
      { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: '从飞书开放平台获取' },
      { key: 'receiveId', label: '接收者 Open ID', type: 'text', placeholder: 'ou_xxx 可选' }
    ],
    async isReady() {
      const cfg = readOpenClawConfig();
      return !!(cfg.channels?.feishu?.appId || cfg.plugins?.entries?.['openclaw-feishu']?.enabled);
    },
    async install() {
      return runCommand('openclaw plugins install @openclaw/feishu');
    },
    async configure(params) {
      if (!params.appId || !params.appSecret) return { ok: false, error: '缺少 AppID 或 AppSecret' };
      const config = readOpenClawConfig();
      if (!config.channels) config.channels = {};
      config.channels.feishu = { enabled: true, appId: params.appId, appSecret: params.appSecret };
      if (params.receiveId) config.channels.feishu.receiveId = params.receiveId;
      writeOpenClawConfig(config);
      return { ok: true, message: '飞书配置已保存到 openclaw.json' };
    }
  },

  // ===== 3. 钉钉 DingTalk =====
  dingtalk: {
    id: 'dingtalk',
    name: '钉钉',
    icon: '📱',
    officialDocs: 'https://open.dingtalk.com/document/orgapp/overview',
    method: 'API 凭证',
    steps: [
      '1. 打开 https://open-dev.dingtalk.com -> 创建应用',
      '2. 在「凭证与基础信息」获取 Client ID 和 Client Secret',
      '3. 添加机器人能力并发布',
      '4. 在下表填写凭证',
      '',
      'Webhook 方式（群机器人）:',
      '  在钉钉群->群设置->机器人->添加机器人',
      '  获取 Webhook URL，如有加签密钥也一并填写'
    ],
    fields: [
      { key: 'clientId', label: 'Client ID (AppKey)', type: 'text', placeholder: '从钉钉开放平台获取' },
      { key: 'clientSecret', label: 'Client Secret (AppSecret)', type: 'password', placeholder: '从钉钉开放平台获取' },
      { key: 'userIds', label: '接收者 User ID（逗号分隔）', type: 'text', placeholder: '如: manager123,user456' },
      { key: 'webhookUrl', label: '或 Webhook URL', type: 'text', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=xxx' },
      { key: 'webhookSecret', label: 'Webhook 加签密钥', type: 'password', placeholder: '可选' }
    ],
    async isReady() {
      const cfg = readOpenClawConfig();
      return !!(cfg.channels?.dingtalk?.clientId || cfg.channels?.dingtalk?.webhookUrl);
    },
    async install() {
      return { ok: true, message: '钉钉使用平台 API 无需安装额外插件' };
    },
    async configure(params) {
      const config = readOpenClawConfig();
      if (!config.channels) config.channels = {};
      config.channels.dingtalk = { enabled: true };
      if (params.clientId && params.clientSecret) {
        config.channels.dingtalk.clientId = params.clientId;
        config.channels.dingtalk.clientSecret = params.clientSecret;
        config.channels.dingtalk.userIds = (params.userIds || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      }
      if (params.webhookUrl) {
        config.channels.dingtalk.webhookUrl = params.webhookUrl;
        if (params.webhookSecret) config.channels.dingtalk.secret = params.webhookSecret;
      }
      writeOpenClawConfig(config);
      return { ok: true, message: '钉钉配置已保存到 openclaw.json' };
    }
  },

  // ===== 4. 企业微信 WeCom =====
  wecom: {
    id: 'wecom',
    name: '企业微信',
    icon: '🏢',
    officialDocs: 'https://developer.work.weixin.qq.com/document/path/90511',
    method: 'API 凭证',
    steps: [
      '=== 方式一：WebSocket 长连接（推荐，无需公网 IP）===',
      '1. 登录企微后台 -> 应用管理 -> 智能机器人',
      '2. 开启「API 模式」-> 选择「长连接」',
      '3. 复制 BotID 和 Secret 填入下方',
      '',
      '=== 方式二：HTTP 回调（需公网 URL + Tunnel）===',
      '4. 创建自建应用，获取 CorpID / AgentId / Secret',
      '5. 在应用详情页启用「接收消息」并配置回调 URL',
      '6. 获取 Token 和 EncodingAESKey 填入下方'
    ],
    fields: [
      { key: 'connectMode', label: '连接方式', type: 'text', placeholder: '留空=长连接(推荐)，填 webhook=回调模式' },
      { key: 'botId', label: '【长连接】BotID', type: 'text', placeholder: '智能机器人页面获取' },
      { key: 'botSecret', label: '【长连接】Secret', type: 'password', placeholder: '智能机器人页面获取' },
      { key: 'divider1', label: '─── 以下为回调模式（二选一）───', type: 'text', placeholder: '' },
      { key: 'corpId', label: '【回调】企业 CorpID', type: 'text', placeholder: '管理后台「我的企业」获取' },
      { key: 'agentSecret', label: '【回调】应用 Secret', type: 'password', placeholder: '应用详情页获取' },
      { key: 'agentId', label: '【回调】AgentId', type: 'text', placeholder: '应用详情页获取' },
      { key: 'token', label: '【回调】Token', type: 'text', placeholder: '回调配置中自定义' },
      { key: 'encodingAESKey', label: '【回调】EncodingAESKey', type: 'text', placeholder: '43位随机字符串' }
    ],
    async isReady() {
      const cfg = readOpenClawConfig();
      return !!(cfg.channels?.wecom?.botId || cfg.channels?.wecom?.corpId || cfg.channels?.wecom?.webhookUrl);
    },
    async install() {
      return { ok: true, message: '企业微信使用平台 API 无需安装额外插件' };
    },
    async configure(params) {
      const config = readOpenClawConfig();
      if (!config.channels) config.channels = {};
      config.channels.wecom = { enabled: true };
      // WebSocket 长连接模式
      if (params.botId && params.botSecret) {
        config.channels.wecom.botId = params.botId;
        config.channels.wecom.botSecret = params.botSecret;
        // 清除旧的回调凭证
        delete config.channels.wecom.corpId;
        delete config.channels.wecom.agentSecret;
        delete config.channels.wecom.agentId;
        delete config.channels.wecom.token;
        delete config.channels.wecom.encodingAESKey;
      }
      // HTTP 回调模式
      if (params.corpId && params.agentSecret && params.agentId) {
        config.channels.wecom.corpId = params.corpId;
        config.channels.wecom.agentSecret = params.agentSecret;
        config.channels.wecom.agentId = params.agentId;
        config.channels.wecom.token = params.token || '';
        config.channels.wecom.encodingAESKey = params.encodingAESKey || '';
        // 清除旧的长连接凭证
        delete config.channels.wecom.botId;
        delete config.channels.wecom.botSecret;
      }
      if (params.webhookUrl) {
        config.channels.wecom.webhookUrl = params.webhookUrl;
      }
      writeOpenClawConfig(config);
      return { ok: true, message: '企业微信配置已保存到 openclaw.json' };
    }
  },

  // ===== 5. QQ 机器人 =====
  qqbot: {
    id: 'qqbot',
    name: 'QQ 机器人',
    icon: '🐧',
    officialDocs: 'https://docs.openclaw.ai/channels/qqbot.md',
    method: 'API 凭证',
    steps: [
      '？？ 扫码绑定: 打开 /qqbot-bind.html 查看二维码',
      '1. 打开 q.qq.com -> 用 QQ 扫码登录',
      '2. 点击「创建机器人」',
      '3. 在「开发配置」获取 AppID 和 Secret',
      '4. 在下表填写凭证'
    ],
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', placeholder: 'QQ 开放平台获取' },
      { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: 'QQ 开放平台获取' },
      { key: 'groupOpenId', label: '群 OpenID（可选）', type: 'text', placeholder: '发送消息的目标群 ID' }
    ],
    async isReady() {
      const cfg = readOpenClawConfig();
      return !!(cfg.channels?.qqbot?.appId);
    },
    async install() {
      return { ok: true, message: 'QQ 机器人使用独立桥接无需安装 OpenClaw 插件' };
    },
    async configure(params) {
      if (!params.appId || !params.appSecret) {
        return { ok: false, error: '缺少 AppID 或 AppSecret' };
      }
      var config = readOpenClawConfig();
      if (!config.channels) config.channels = {};
      config.channels.qqbot = { enabled: true, appId: params.appId, clientSecret: params.appSecret };
      if (params.groupOpenId) config.channels.qqbot.groupOpenId = params.groupOpenId;
      writeOpenClawConfig(config);
      return { ok: true, message: 'QQ 机器人配置已保存到 openclaw.json（供 eCompany 桥接使用）' };
    }
  },

  // ===== 6. 腾讯云 Tencent Cloud =====
  tencent: {
    id: 'tencent',
    name: '腾讯云',
    icon: '☁️',
    officialDocs: 'https://cloud.tencent.com/document/product/213',
    method: 'API 凭证',
    steps: [
      '1. 打开 https://console.cloud.tencent.com/cam/capi',
      '2. 创建或使用已有 API 密钥',
      '3. 复制 SecretId 和 SecretKey 填入下方',
      '4. 即可启用腾讯文档/会议/问卷等办公工具'
    ],
    fields: [
      { key: 'secretId', label: 'SecretId', type: 'text', placeholder: '腾讯云 API 密钥 ID' },
      { key: 'secretKey', label: 'SecretKey', type: 'password', placeholder: '腾讯云 API 密钥 Key' }
    ],
    async isReady() {
      var cfg = readOpenClawConfig();
      return !!(cfg.channels?.tencent?.secretId);
    },
    async install() {
      return { ok: true, message: '腾讯云桥接已就绪' };
    },
    async configure(params) {
      if (!params.secretId || !params.secretKey) {
        return { ok: false, error: '缺少 SecretId 或 SecretKey' };
      }
      var config = readOpenClawConfig();
      if (!config.channels) config.channels = {};
      config.channels.tencent = { enabled: true, secretId: params.secretId, secretKey: params.secretKey };
      writeOpenClawConfig(config);
      return { ok: true, message: '腾讯云配置已保存到 openclaw.json（供 eCompany 桥接使用）' };
    }
  }
};

async function installAndConfigure(channelId, params) {
  var handler = CHANNEL_HANDLERS[channelId];
  if (!handler) return { ok: false, error: '未知渠道: ' + channelId };
  var ready = await handler.isReady();
  // 如果有新的配置参数，跳过 isReady 检查，直接重新配置
  var hasNewParams = params && Object.keys(params).length > 0;
  if (ready && !hasNewParams) {
    return { ok: true, message: handler.name + ' 已经是就绪状态' };
  }
  if (!ready) {
    var installResult = await handler.install();
    if (!installResult.ok) return { ok: false, error: '安装失败: ' + installResult.error, step: 'install' };
  }
  var configureResult = await handler.configure(params || {});
  if (!configureResult.ok) return { ok: false, error: '配置失败: ' + configureResult.error, step: 'configure' };
  var extra = isOpenClawAvailable() ? '建议执行 openclaw gateway restart 使配置生效' : '';
  return { ok: true, message: configureResult.message + (extra ? '。' + extra : '') };
}

function getChannelList() {
  return Object.keys(CHANNEL_HANDLERS).map(function(id) {
    var h = CHANNEL_HANDLERS[id];
    return { id: id, name: h.name, icon: h.icon, method: h.method, steps: h.steps,
      officialDocs: h.officialDocs, fields: h.fields || [],
      needsConfig: !!(h.fields && h.fields.length > 0), openclawAvailable: isOpenClawAvailable() };
  });
}

module.exports = { installAndConfigure: installAndConfigure, getChannelList: getChannelList,
  isOpenClawAvailable: isOpenClawAvailable, isGatewayRunning: isGatewayRunning, CHANNEL_HANDLERS: CHANNEL_HANDLERS };
