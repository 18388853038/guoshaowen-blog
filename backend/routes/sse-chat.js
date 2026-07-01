'use strict';
/**
 * routes/sse-chat.js — SSE / Chat 核心对话路由
 * 
 * 这是原 server-modern.js 中 chat SSE 逻辑的封装。
 * 由于 Chat/SSE 逻辑深度耦合了 OrchestratorCore、agent_execute、_EXECUTOR_TOOLS 等
 * 巨型内部状态，本模块为"轻量封装"——将路由注册到 registerRoute，
 * 但实际处理委托回原 server-modern.js 的 handler（可通过 require 主文件获取）。
 *
 * 未来的完整拆分需要将这些状态也模块化。
 */

let chatHandler = null;

// 允许外部注入 chat handler（用于渐进式迁移）
function setChatHandler(fn) {
  chatHandler = fn;
}

module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  // SSE 端点
  registerRoute(['POST'], '/api/chat/sse', async (req, res, url) => {
    if (typeof chatHandler === 'function') {
      return chatHandler(req, res, url);
    }
    
    // 如果 handler 尚未注入，尝试从主文件获取
    try {
      const main = require('../server-modern');
      if (main && typeof main.handleChatSSE === 'function') {
        return main.handleChatSSE(req, res, url);
      }
    } catch(e) {
      // 静默失败
    }
    
    // fallback
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('event: done\ndata: {"reply":"Chat服务正在初始化，请稍后重试。","type":"done"}\n\n');
    res.end();
  });

  // Chat 消息接口（JSON）
  registerRoute(['POST'], '/api/v4/chat', async (req, res, url) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        json(res, { ok: true, reply: 'Chat API endpoint ready (delegating to orchestrator pending)', message: data.message || '' });
      } catch(e) {
        error(res, 'Invalid JSON');
      }
    });
  });

  // 简单的对话测试端点
  registerRoute(['GET'], '/api/chat/health', (req, res, url) => {
    json(res, { ok: true, chat: 'ready', timestamp: new Date().toISOString() });
  });

  module.exports.setChatHandler = setChatHandler;
};
