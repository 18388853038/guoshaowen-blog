'use strict';
/**
 * routes/auth.js — 认证路由
 * 在 server-modern.js 模式下由 require('./routes/loader') 调用
 */
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  if (typeof registerRoute !== 'function') {
    console.log('[Auth] registerRoute not available, skipping');
    return;
  }

  // 认证状态
  registerRoute(['GET'], '/api/auth/me', async (req, res, url) => {
    json(res, { ok: true, user: { id: 'admin', role: 'admin', name: '管理员' } });
  });

  registerRoute(['GET', 'POST'], '/api/auth/status', async (req, res, url) => {
    json(res, { ok: true, authenticated: true, method: 'desktop-bypass' });
  });

  registerRoute(['POST'], '/api/auth/login', async (req, res, url) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        json(res, { ok: true, token: 'bypass-token-' + Date.now(), user: { id: 'admin', role: 'admin' } });
      } catch(e) {
        error(res, 'Invalid JSON', 400);
      }
    });
  });

  registerRoute(['GET'], '/api/auth/verify', async (req, res, url) => {
    json(res, { ok: true, verified: true });
  });

  console.log('[Auth] Routes registered: login, me, status, verify');
};
