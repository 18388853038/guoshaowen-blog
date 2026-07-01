/**
 * unified-router.js — eCompany 统一消息路由器
 *
 * 所有外部消息的单一入口：
 *   微信 / 工作台 / API → unifiedRouter.handle() → unifiedEngine → AI回复
 *
 * 不再有独立的路由处理逻辑，所有渠道统一处理。
 */

const unifiedEngine = require('./unified-engine');

// ========== 渠道注册表 ==========
// 每个渠道的处理函数：接收原始消息，返回AI回复
const CHANNELS = {};

// ========== 注册渠道 ==========
function registerChannel(name, handler) {
  CHANNELS[name] = handler;
  console.log('[路由] 注册渠道: ' + name);
}

// ========== 处理消息（统一入口）==========
async function handle(rawMsg, channel) {
  var normalized = unifiedEngine.normalizeMessage(rawMsg, channel);
  var reply = await unifiedEngine.process(normalized);
  return reply;
}

// ========== 内置渠道处理器 ==========
// 这些由 server-modern 在启动时注册

registerChannel('weixin', {
  handler: async function(body) {
    return await handle(body, 'weixin');
  }
});

registerChannel('webchat', {
  handler: async function(body) {
    return await handle(body, 'webchat');
  }
});

registerChannel('api', {
  handler: async function(body) {
    return await handle(body, 'api');
  }
});

// ========== 导出 ==========
module.exports = {
  handle: handle,
  registerChannel: registerChannel,
  CHANNELS: CHANNELS,
  getChannels: function() {
    return Object.keys(CHANNELS);
  }
};
