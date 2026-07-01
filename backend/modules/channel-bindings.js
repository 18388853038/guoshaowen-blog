/**
 * eCompany 用户级通讯绑定模块
 * 
 * 功能：用户绑定个人通讯渠道（微信/企业微信/飞书/钉钉/QQ）到 eCompany AI 系统
 * - 每个用户可以绑定多个渠道
 * - 消息通过绑定的渠道直接与 AI Agent 对话
 * - 支持绑定/解绑/查询/消息收发
 */

const database = require('./database');
const getDB = typeof database.getDB === 'function' ? database.getDB : (typeof database.db === 'function' ? database.db : null);
const { sendViaChannel } = require('./channels');

function generateId() {
  return 'bind_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ==================== 绑定 CRUD ====================

/**
 * 创建绑定
 */
function createBinding(data) {
  const db = getDB();
  if (!db) return { ok: false, error: '数据库不可用' };

  const id = data.id || generateId();
  const now = new Date().toISOString();

  try {
    // 检查是否已存在同渠道同用户的绑定
    const existing = db.prepare(
      'SELECT id FROM channel_bindings WHERE user_id = ? AND channel_type = ? AND status = ?'
    ).get(data.userId || 'admin', data.channelType, 'active');

    if (existing) {
      return { ok: false, error: '该渠道已绑定，请先解绑再重新绑定' };
    }

    db.prepare(`
      INSERT INTO channel_bindings (id, user_id, channel_type, channel_user_id, channel_user_name, credentials, bound_agent_id, is_primary, status, last_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.userId || 'admin',
      data.channelType,
      data.channelUserId || '',
      data.channelUserName || '',
      JSON.stringify(data.credentials || {}),
      data.boundAgentId || 'ai_ceo',
      data.isPrimary ? 1 : 0,
      'active',
      now,
      now,
      now
    );

    return {
      ok: true,
      binding: getBinding(id)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 获取单个绑定
 */
function getBinding(id) {
  const db = getDB();
  if (!db) return null;

  try {
    const row = db.prepare('SELECT * FROM channel_bindings WHERE id = ?').get(id);
    if (row) {
      row.credentials = JSON.parse(row.credentials || '{}');
    }
    return row;
  } catch (e) {
    return null;
  }
}

/**
 * 获取用户所有绑定
 */
function getUserBindings(userId) {
  const db = getDB();
  if (!db) return [];

  try {
    const rows = db.prepare(
      'SELECT * FROM channel_bindings WHERE user_id = ? AND status = ? ORDER BY is_primary DESC, created_at DESC'
    ).all(userId || 'admin', 'active');
    return rows.map(row => {
      row.credentials = JSON.parse(row.credentials || '{}');
      return row;
    });
  } catch (e) {
    return [];
  }
}

/**
 * 获取所有活跃绑定（管理员视图）
 */
function getAllBindings() {
  const db = getDB();
  if (!db) return [];

  try {
    const rows = db.prepare(
      'SELECT * FROM channel_bindings WHERE status = ? ORDER BY user_id, channel_type'
    ).all('active');
    return rows.map(row => {
      row.credentials = JSON.parse(row.credentials || '{}');
      // 隐藏敏感信息
      row.credentials = Object.keys(row.credentials).reduce((acc, key) => {
        const val = row.credentials[key];
        if (typeof val === 'string' && val.length > 6) {
          acc[key] = val.substring(0, 3) + '****' + val.substring(val.length - 3);
        } else {
          acc[key] = val;
        }
        return acc;
      }, {});
      return row;
    });
  } catch (e) {
    return [];
  }
}

/**
 * 解绑
 */
function removeBinding(id, userId) {
  const db = getDB();
  if (!db) return { ok: false, error: '数据库不可用' };

  try {
    const binding = db.prepare('SELECT * FROM channel_bindings WHERE id = ?').get(id);
    if (!binding) return { ok: false, error: '绑定不存在' };
    if (binding.user_id !== userId) return { ok: false, error: '无权操作此绑定' };

    db.prepare(
      "UPDATE channel_bindings SET status = 'inactive', updated_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), id);

    return { ok: true, message: '已解绑' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 更新绑定
 */
function updateBinding(id, userId, updates) {
  const db = getDB();
  if (!db) return { ok: false, error: '数据库不可用' };

  try {
    const binding = db.prepare('SELECT * FROM channel_bindings WHERE id = ?').get(id);
    if (!binding) return { ok: false, error: '绑定不存在' };
    if (binding.user_id !== userId) return { ok: false, error: '无权操作此绑定' };

    if (updates.boundAgentId) {
      db.prepare("UPDATE channel_bindings SET bound_agent_id = ?, updated_at = ? WHERE id = ?")
        .run(updates.boundAgentId, new Date().toISOString(), id);
    }
    if (updates.isPrimary !== undefined) {
      db.prepare("UPDATE channel_bindings SET is_primary = ?, updated_at = ? WHERE id = ?")
        .run(updates.isPrimary ? 1 : 0, new Date().toISOString(), id);
    }
    if (updates.credentials) {
      db.prepare("UPDATE channel_bindings SET credentials = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(updates.credentials), new Date().toISOString(), id);
    }

    return { ok: true, binding: getBinding(id) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 通过渠道信息查找绑定（用于消息路由）
 */
function findBindingByChannel(channelType, channelUserId) {
  const db = getDB();
  if (!db) return null;

  try {
    return db.prepare(
      'SELECT * FROM channel_bindings WHERE channel_type = ? AND channel_user_id = ? AND status = ? LIMIT 1'
    ).get(channelType, channelUserId, 'active');
  } catch (e) {
    return null;
  }
}

/**
 * 根据绑定的 agent 获取对话信息
 */
function getBindingAgent(binding) {
  return {
    agentId: binding.bound_agent_id || 'ai_ceo',
    userId: binding.user_id,
    channelType: binding.channel_type,
    channelUserId: binding.channel_user_id
  };
}

// ==================== 消息收发 ====================

/**
 * 接收外部消息并路由到 AI Agent
 * 调用方：OpenClaw gateway webhook / 消息回调
 */
async function receiveMessage(channelType, channelUserId, message, extra) {
  // 1. 查找绑定
  const binding = findBindingByChannel(channelType, channelUserId);
  if (!binding) {
    return { ok: false, error: '未找到绑定的用户，请先在 eCompany 绑定此渠道' };
  }

  // 2. 更新最后活跃时间
  const db = getDB();
  if (db) {
    try {
      db.prepare("UPDATE channel_bindings SET last_active = ?, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), new Date().toISOString(), binding.id);
    } catch (e) {}
  }

  // 3. 获取绑定的 Agent 信息
  const agentInfo = getBindingAgent(binding);

  // 4. 发送到 AI 对话系统（通过 server-modern.js 的对话 API）
  try {
    const http = require('http');
    const result = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        agentId: agentInfo.agentId,
        message: message,
        userId: agentInfo.userId,
        channelType: channelType,
        channelUserId: channelUserId,
        source: 'external_channel',
        extra: extra || {}
      });

      const req = http.request({
        hostname: '127.0.0.1',
        port: 8002,
        path: '/api/chat/external',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 60000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve({ ok: true, reply: data }); }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('AI 响应超时')); });
      req.write(postData);
      req.end();
    });

    return result;
  } catch (e) {
    return { ok: false, error: 'AI 处理失败: ' + e.message };
  }
}

/**
 * 通过绑定渠道发送消息
 */
async function sendToUser(bindingId, message) {
  const binding = getBinding(bindingId);
  if (!binding) return { ok: false, error: '绑定不存在' };

  const creds = typeof binding.credentials === 'string' 
    ? JSON.parse(binding.credentials) 
    : (binding.credentials || {});

  return await sendViaChannel(binding.channel_type, {
    ...creds,
    to: binding.channel_user_id
  }, message);
}

// ==================== 渠道定义 ====================

const CHANNEL_TYPES = {
  personal_wx: {
    id: 'personal_wx',
    name: '个人微信',
    icon: '💬',
    color: '#07C160',
    method: '扫码绑定',
    bindMode: 'qrcode',
    description: '通过个人微信与 AI 对话',
    pluginRequired: '@tencent-weixin/openclaw-weixin',
    pluginName: 'Weixin ClawBot',
    setupSteps: [
      '1. 确保已安装 Weixin ClawBot 插件（@tencent-weixin/openclaw-weixin）',
      '2. 点击下方「生成绑定二维码」',
      '3. 用微信扫描二维码',
      '4. 扫码成功后系统自动完成绑定'
    ],
    fields: []
  },
  wecom: {
    id: 'wecom',
    name: '企业微信',
    icon: '🏢',
    color: '#2BAD13',
    method: 'API 凭证',
    description: '通过企业微信与 AI 对话',
    setupSteps: [
      '1. 登录企业微信管理后台',
      '2. 进入应用管理 → 自建应用',
      '3. 获取 CorpID、AgentID、Secret',
      '4. 填写凭证并保存'
    ],
    fields: [
      { key: 'corpId', label: '企业 CorpID', type: 'text', placeholder: '企业微信后台获取', required: true },
      { key: 'agentId', label: '应用 AgentID', type: 'text', placeholder: '应用详情页获取', required: true },
      { key: 'agentSecret', label: '应用 Secret', type: 'password', placeholder: '应用详情页获取', required: true },
      { key: 'userId', label: '企微 User ID', type: 'text', placeholder: '你在企微的用户ID', required: true }
    ]
  },
  feishu: {
    id: 'feishu',
    name: '飞书',
    icon: '📘',
    color: '#3370FF',
    method: 'AppID + Secret',
    description: '通过飞书与 AI 对话',
    setupSteps: [
      '1. 打开飞书开放平台 open.feishu.cn',
      '2. 创建企业自建应用',
      '3. 开通机器人能力',
      '4. 获取 App ID 和 App Secret',
      '5. 配置事件订阅回调地址'
    ],
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', placeholder: '飞书开放平台获取', required: true },
      { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: '飞书开放平台获取', required: true },
      { key: 'userId', label: '飞书 Open ID', type: 'text', placeholder: 'ou_xxx 你的飞书用户ID', required: true }
    ]
  },
  dingtalk: {
    id: 'dingtalk',
    name: '钉钉',
    icon: '📱',
    color: '#0089FF',
    method: 'API 凭证',
    description: '通过钉钉与 AI 对话',
    setupSteps: [
      '1. 打开钉钉开放平台',
      '2. 创建企业内部机器人',
      '3. 获取 Client ID 和 Client Secret',
      '4. 配置消息接收地址'
    ],
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', placeholder: '钉钉开放平台获取', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: '钉钉开放平台获取', required: true },
      { key: 'userId', label: '钉钉 User ID', type: 'text', placeholder: '你的钉钉用户ID', required: true }
    ]
  },
  qqbot: {
    id: 'qqbot',
    name: 'QQ 机器人',
    icon: '🐧',
    color: '#12B7F5',
    method: 'API 凭证',
    description: '通过 QQ 与 AI 对话',
    setupSteps: [
      '1. 打开 QQ 开放平台 q.qq.com',
      '2. 创建机器人',
      '3. 获取 AppID 和 AppSecret',
      '4. 配置消息回调'
    ],
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', placeholder: 'QQ 开放平台获取', required: true },
      { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: 'QQ 开放平台获取', required: true },
      { key: 'qq', label: 'QQ 号', type: 'text', placeholder: '你的 QQ 号', required: true }
    ]
  }
};

function getChannelTypes() {
  return Object.keys(CHANNEL_TYPES).map(function(key) {
    return CHANNEL_TYPES[key];
  });
}

function getChannelType(channelType) {
  return CHANNEL_TYPES[channelType] || null;
}

// ==================== 绑定统计 ====================

function getBindingStats() {
  const db = getDB();
  if (!db) return { total: 0, byChannel: {} };

  try {
    const rows = db.prepare(
      "SELECT channel_type, COUNT(*) as count FROM channel_bindings WHERE status = 'active' GROUP BY channel_type"
    ).all();
    
    const stats = { total: 0, byChannel: {} };
    rows.forEach(function(row) {
      stats.byChannel[row.channel_type] = row.count;
      stats.total += row.count;
    });
    return stats;
  } catch (e) {
    return { total: 0, byChannel: {} };
  }
}

function channelBindings(registerRoute, parseBody, json) {
  registerRoute(['GET'], /^\/api\/bindings\/overview$/, function(req, res) {
    try {
      var stats = getBindingStats();
      var all = getAllBindings();
      json(res, {
        ok: true,
        channels: stats || [],
        total: (all || []).length,
        bindings: all || []
      });
    } catch(e) {
      json(res, { ok: true, channels: [], total: 0, bindings: [] });
    }
  });
  
  registerRoute(['GET'], /^\/api\/bindings\/stats$/, function(req, res) {
    try {
      var stats = getBindingStats();
      json(res, { ok: true, stats: stats || [] });
    } catch(e) {
      json(res, { ok: true, stats: [] });
    }
  });
  
  registerRoute(['GET'], /^\/api\/bindings\/list$/, function(req, res) {
    try {
      var all = getAllBindings();
      json(res, { ok: true, bindings: all || [] });
    } catch(e) {
      json(res, { ok: true, bindings: [] });
    }
  });
}

module.exports = {
  createBinding,
  getBinding,
  getUserBindings,
  getAllBindings,
  removeBinding,
  updateBinding,
  findBindingByChannel,
  receiveMessage,
  sendToUser,
  getChannelTypes,
  getChannelType,
  getBindingStats,
  getBindingAgent,
  channelBindings
};
