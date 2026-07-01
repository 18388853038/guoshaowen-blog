'use strict';
/**
 * server-core.js — 重构后的核心启动入口
 * 整合 lib/ 基础设施 + routes/ 路由模块
 *
 * 用法: node server-core.js
 * 兼容旧 server-modern.js 的端口/认证/中间件
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const urlMod = require('url');

const BASE = __dirname;
const PORT = process.env.PORT || 8005;

// ===== 基础设施初始化 =====
const { json, error: sendError, sendSSE } = require('./lib/response');
const { registerRoute, clearRoutes } = require('./lib/router');
const logger = require('./lib/logger');
const sentry = require('./lib/sentry');
let db = null;

// 尝试初始化 SQLite（better-sqlite3 可选）
try {
  db = require('./lib/database');
  db.initSchema();
  console.log('[DB] SQLite initialized: ' + require('path').join(BASE, 'ecompany-core.db'));
} catch(e) {
  console.log('[DB] SQLite unavailable:', e.message);
}

// 初始化 Sentry（可选，DSN 未配置则跳过）
try {
  sentry.init();
} catch(e) {
  console.log('[Sentry] Init failed:', e.message);
}

// ===== 声明式路由加载 =====
clearRoutes();

// 加载所有路由模块
const routeModules = [
  'health', 'auth', 'team', 'tasks', 'notifications', 'workspace',
  'scheduler', 'knowledge', 'admin', 'mcp', 'monitoring'
];

for (const name of routeModules) {
  try {
    const mod = require('./routes/' + name);
    mod(registerRoute, json, sendError, sendSSE, db, logger);
    console.log('[Routes] Loaded: ' + name);
  } catch(e) {
    console.log('[Routes] Failed: ' + name + ' - ' + e.message);
  }
}

// ===== SSE / Chat 核心路由（仍内联，因逻辑复杂）=====
require('./routes/sse-chat')(registerRoute, json, sendError, sendSSE, db, logger);

// ===== HTTP 服务器 =====
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const method = req.method;
  const pathname = url.pathname;

  // CORS
  const allowedOrigins = ['http://127.0.0.1:'+PORT,'http://localhost:'+PORT,'http://127.0.0.1:8002','http://localhost:8002','http://127.0.0.1:18789','http://localhost:18789','http://127.0.0.1','http://localhost'];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:' + PORT);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // 路由派发
  const matched = require('./lib/router').matchRoute(method, pathname);
  if (matched) {
    try {
      await matched.handler(req, res, url, matched.params);
    } catch(e) {
      logger.error('Route handler error: ' + e.message, { path: pathname, method, error: e.stack });
      sentry.captureError(e, { path: pathname, method });
      sendError(res, 'Internal server error: ' + e.message);
    }
    return;
  }

  // 未匹配——fallback
  sendError(res, 'Not found: ' + pathname, 404);
});

server.listen(PORT, () => {
  console.log('\n========================================');
  console.log('  eCompany Core Server v2.0');
  console.log('  Port: ' + PORT);
  console.log('  Routes: ' + require('./lib/router').matchRoute.toString().length + ' registered');
  console.log('  DB: ' + (db ? 'SQLite' : 'JSON-fallback'));
  console.log('  Sentry: ' + (sentry.initialized ? 'active' : 'skipped'));
  console.log('  Logger: Winston');
  console.log('========================================\n');
});
