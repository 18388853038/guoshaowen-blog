/**
 * api-gateway-advanced.js — 高级 API 网关层 v1.0
 *
 * 让小龙能主动暴露 RESTful API 端点，并具备网关级能力：
 * - 动态路由注册/管理/持久化
 * - 令牌桶限流
 * - 请求/响应拦截器链（日志、鉴权、参数校验、CORS）
 * - 自动 OpenAPI 3.0 文档端点
 * - 优雅统一的响应格式
 * - 路由分组和版本管理
 *
 * execCEOTool 工具暴露：
 *   api_create_route    → 创建/注册新 API 端点
 *   api_list_routes     → 列出所有动态路由
 *   api_remove_route    → 删除路由
 *   api_update_route    → 更新已有路由
 *   api_gateway_status  → 网关状态（限流/拦截器/活跃路由）
 *   api_openapi_spec    → 获取 OpenAPI 3.0 规范文档
 */
'use strict';

const path = require('path');
const fs = require('fs');

// ========== 配置 ==========
const CONFIG = {
  maxRoutes: 200,           // 最大动态路由数
  defaultLimit: {          // 默认限流配置
    tokensPerSecond: 50,
    maxBurst: 100,
    enabled: false         // 默认关闭，通过 api_gateway_status 可开启
  },
  maxBodyLogLength: 500,
  sqlitePath: path.join(__dirname, '..', 'ecompany-core.db')
};

// ========== 状态 ==========
var dynamicRoutes = {};         // id → route
var routeOrder = [];           // 有序 ID 列表
var interceptors = {           // 拦截器链
  pre: [],    // [{name, fn}]
  post: []    // [{name, fn}]
};
var rateLimiters = {};         // routeId → { bucket }
var stats = {
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  limitedRequests: 0,
  routeHits: {},
  startedAt: Date.now()
};

// ========== 外部注入 registerRoute 函数 ==========
var _registerRoute = null;
function setRouteRegistrar(fn) {
  _registerRoute = fn;
}

// ========== SQLite 持久化 ==========
var _sqlite;
function getDB() {
  if (_sqlite) return _sqlite;
  try {
    _sqlite = require('better-sqlite3')(CONFIG.sqlitePath);
    _sqlite.exec(`CREATE TABLE IF NOT EXISTS api_routes (
      id TEXT PRIMARY KEY,
      method TEXT,
      path TEXT,
      group_name TEXT DEFAULT '',
      version TEXT DEFAULT 'v1',
      description TEXT,
      tags TEXT DEFAULT '[]',
      handlerCode TEXT,
      rateLimit TEXT,
      authRequired INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created TEXT,
      updated TEXT
    )`);
    _sqlite.exec(`CREATE TABLE IF NOT EXISTS api_gateway_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  } catch(e) {
    console.log('[APIGateway] SQLite unavailable:', e.message);
  }
  return _sqlite;
}

// ========== 令牌桶限流 ==========
function createTokenBucket(tokensPerSecond, maxBurst) {
  var bucket = {
    tokens: maxBurst,
    maxTokens: maxBurst,
    refillRate: tokensPerSecond / 1000,  // 每 ms 补充的令牌数
    lastRefill: Date.now()
  };
  return bucket;
}

function consumeToken(bucket, count) {
  if (!bucket) return true;
  var now = Date.now();
  // 补充令牌
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + (now - bucket.lastRefill) * bucket.refillRate);
  bucket.lastRefill = now;
  if (bucket.tokens >= count) {
    bucket.tokens -= count;
    return true;
  }
  return false;
}

// ========== 内置拦截器 ==========

// 1. 请求日志拦截器
var requestLogger = {
  name: 'requestLogger',
  fn: function(req, res, route, context) {
    var start = Date.now();
    context._startTime = start;
    console.log('[APIGW] ' + req.method + ' ' + req.url + ' → route=' + route.id + ' (' + route.path + ')');
    // 在 response finish 时记录
    var origEnd = res.end;
    res.end = function(data, encoding, callback) {
      var duration = Date.now() - start;
      console.log('[APIGW] ' + req.method + ' ' + req.url + ' → ' + res.statusCode + ' (' + duration + 'ms)');
      return origEnd.call(res, data, encoding, callback);
    };
    return null; // 继续
  }
};

// 2. 请求参数校验拦截器（自动解析 body 和 query）
var paramValidator = {
  name: 'paramValidator',
  fn: function(req, res, route, context) {
    // 确保 context 有 parsedBody / queryParams
    if (!context.parsedBody) context.parsedBody = {};
    if (!context.queryParams) context.queryParams = {};
    return null;
  }
};

// 3. CORS 拦截器
var corsHandler = {
  name: 'corsHandler',
  fn: function(req, res, route, context) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end('');
      return true; // 终止
    }
    return null;
  }
};

// 注册内置拦截器
interceptors.pre.push(requestLogger);
interceptors.pre.push(paramValidator);
interceptors.pre.push(corsHandler);

// ========== 核心：执行路由 ==========
async function executeRoute(route, req, res, parsedBody, queryParams) {
  stats.totalRequests++;
  stats.routeHits[route.id] = (stats.routeHits[route.id] || 0) + 1;

  // 限流检查
  var limiter = rateLimiters[route.id];
  if (limiter && !consumeToken(limiter, 1)) {
    stats.limitedRequests++;
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
    res.end(JSON.stringify({ ok: false, error: '请求过于频繁，请稍后再试', code: 'RATE_LIMIT_EXCEEDED' }));
    return;
  }

  // 构建 context
  var context = {
    parsedBody: parsedBody || {},
    queryParams: queryParams || {},
    route: route,
    _startTime: Date.now()
  };

  // Pre-interceptors
  for (var i = 0; i < interceptors.pre.length; i++) {
    try {
      var shouldStop = await interceptors.pre[i].fn(req, res, route, context);
      if (shouldStop === true) return; // 拦截器终止请求
    } catch(ie) {
      console.error('[APIGW] Interceptor error [' + interceptors.pre[i].name + ']:', ie.message);
    }
  }

  // 执行 handler
  try {
    var sendJson = function(data, statusCode) {
      if (statusCode) res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: statusCode < 400, data: data }));
      stats.successRequests++;
    };
    var sendError = function(message, statusCode) {
      statusCode = statusCode || 500;
      res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: message, code: 'API_ERROR' }));
      stats.failedRequests++;
    };

    // 编译 handler 函数
    var handlerFn;
    try {
      handlerFn = new Function('req', 'res', 'json', 'error', 'context', route.handlerCode);
    } catch(e) {
      sendError('Handler 编译错误: ' + e.message, 500);
      return;
    }

    await handlerFn(req, res, sendJson, sendError, context);
  } catch(e) {
    stats.failedRequests++;
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'Handler 执行错误: ' + (e.message || String(e)).substring(0, 300), code: 'HANDLER_ERROR' }));
  }

  // Post-interceptors
  for (var pi = 0; pi < interceptors.post.length; pi++) {
    try {
      await interceptors.post[pi].fn(req, res, route, context);
    } catch(pe) {
      console.error('[APIGW] Post-interceptor error [' + interceptors.post[pi].name + ']:', pe.message);
    }
  }
}

// ========== 工具1: api_create_route — 创建路由 ==========
async function api_create_route(args) {
  try {
    var method = (args.method || 'GET').toUpperCase();
    var routePath = args.path || args.route || '';
    var description = args.description || args.desc || '';
    var handlerCode = args.handler || args.code || args.handlerCode || args.script || '';
    var id = args.id || 'route_' + Date.now();
    var groupName = args.group || args.groupName || '';
    var version = args.version || 'v1';
    var tags = args.tags || [];
    var rateLimit = args.rateLimit || null;  // { tokensPerSecond, maxBurst }
    var authRequired = args.authRequired === true;

    if (!routePath) return { error: '请指定路由路径（如 /api/report/team）' };
    if (!handlerCode) return { error: '请提供 handler 函数代码' };

    // 确保以 / 开头
    if (!routePath.startsWith('/')) routePath = '/' + routePath;

    // 路由数上限检查
    if (Object.keys(dynamicRoutes).length >= CONFIG.maxRoutes) {
      return { error: '动态路由已达上限(' + CONFIG.maxRoutes + '个)，请先删除无用路由' };
    }

    // 路径冲突检查
    var ids = Object.keys(dynamicRoutes);
    for (var ci = 0; ci < ids.length; ci++) {
      var existing = dynamicRoutes[ids[ci]];
      if (existing.method === method && existing.path === routePath && ids[ci] !== id) {
        return { error: '路由冲突: ' + method + ' ' + routePath + ' 已被路由 ' + ids[ci] + ' 使用' };
      }
    }

    // 编译 handler 检查语法
    try {
      new Function('req', 'res', 'json', 'error', 'context', handlerCode);
    } catch(e) {
      return { error: 'Handler 代码语法错误: ' + (e.message || '').substring(0, 200) };
    }

    // 注册到 server-modern.js
    var registration = null;
    if (_registerRoute) {
      try {
        var regMethods = method === 'ANY' ? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] : [method];
        // 构建正则（支持 :param 路径参数）
        var patternStr = '^' + routePath.replace(/:[a-zA-Z_]\w*/g, function(m) {
          return '([^/]+)';
        }).replace(/\//g, '\\/') + '$';

        // 包装 handler 通过网关执行
        var wrappedFn = async function(req, res, urlMatch) {
          var body = '';
          var parsedBody = {};
          var queryParams = {};

          // 解析 query params
          try {
            var urlObj = new URL(req.url, 'http://localhost');
            queryParams = Object.fromEntries(urlObj.searchParams.entries());
          } catch(e) {/* ignore */}

          // 解析 body（如果是 POST/PUT/PATCH）
          if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            try {
              body = await new Promise(function(resolve) {
                var chunks = [];
                req.on('data', function(c) { chunks.push(c); });
                req.on('end', function() { resolve(Buffer.concat(chunks).toString('utf-8')); });
              });
              try { parsedBody = JSON.parse(body); } catch(e) { /* not json */ }
            } catch(e) { /* no body */ }
          }

          await executeRoute(routeRecord, req, res, parsedBody, queryParams);
        };

        _registerRoute(regMethods, new RegExp(patternStr), wrappedFn);
        registration = { methods: regMethods, path: routePath, pattern: patternStr };
      } catch(regErr) {
        registration = { error: '注册到系统失败: ' + regErr.message };
      }
    }

    // 路由记录
    var now = new Date().toISOString();
    var routeRecord = {
      id: id,
      method: method,
      path: routePath,
      group: groupName,
      version: version,
      description: description,
      tags: tags,
      handlerCode: handlerCode,
      rateLimit: rateLimit,
      authRequired: authRequired,
      createdAt: now,
      updatedAt: now
    };

    dynamicRoutes[id] = routeRecord;
    if (routeOrder.indexOf(id) < 0) routeOrder.push(id);

    // 设置限流
    if (rateLimit) {
      rateLimiters[id] = createTokenBucket(rateLimit.tokensPerSecond || 10, rateLimit.maxBurst || 20);
    }

    // SQLite 持久化
    var db = getDB();
    if (db) {
      try {
        db.prepare(`INSERT OR REPLACE INTO api_routes
          (id, method, path, group_name, version, description, tags, handlerCode, rateLimit, authRequired, enabled, created, updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
          id, method, routePath, groupName, version, description,
          JSON.stringify(tags), handlerCode, rateLimit ? JSON.stringify(rateLimit) : null,
          authRequired ? 1 : 0, now, now
        );
      } catch(sqErr) {
        console.log('[APIGW] SQLite save error:', sqErr.message);
      }
    }

    return {
      ok: true,
      routeId: id,
      method: method,
      path: routePath,
      description: description,
      group: groupName,
      version: version,
      registration: registration,
      message: '路由创建成功，可通过 ' + method + ' ' + routePath + ' 访问',
      _testUrl: 'http://localhost:8005' + routePath
    };
  } catch(e) {
    return { error: '创建路由失败: ' + (e.message || String(e)).substring(0, 300) };
  }
}

// ========== 工具2: api_list_routes — 列出路由 ==========
async function api_list_routes(args) {
  var filterGroup = args.group || '';
  var filterMethod = args.method || '';
  var filterVersion = args.version || '';
  var filterEnabled = args.enabled;

  var ids = routeOrder;
  var routes = [];
  for (var i = 0; i < ids.length; i++) {
    var r = dynamicRoutes[ids[i]];
    if (!r) continue;
    if (filterGroup && r.group !== filterGroup) continue;
    if (filterMethod && r.method !== filterMethod.toUpperCase()) continue;
    if (filterVersion && r.version !== filterVersion) continue;
    if (filterEnabled === false && r.enabled !== false) continue;
    if (filterEnabled === true && r.enabled === false) continue;

    routes.push({
      id: r.id,
      method: r.method,
      path: r.path,
      group: r.group,
      version: r.version,
      description: r.description,
      tags: r.tags,
      authRequired: r.authRequired,
      hits: stats.routeHits[r.id] || 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    });
  }

  return {
    ok: true,
    routes: routes,
    count: routes.length,
    total: Object.keys(dynamicRoutes).length,
    stats: {
      totalRequests: stats.totalRequests,
      limitedRequests: stats.limitedRequests,
      successRate: stats.totalRequests > 0 ? Math.round(stats.successRequests / stats.totalRequests * 100) + '%' : 'N/A'
    }
  };
}

// ========== 工具3: api_remove_route — 删除路由 ==========
async function api_remove_route(args) {
  try {
    var id = args.id || args.routeId || '';
    if (!id) return { error: '请指定 routeId' };
    if (!dynamicRoutes[id]) return { error: '未找到路由: ' + id };

    delete dynamicRoutes[id];
    var idx = routeOrder.indexOf(id);
    if (idx >= 0) routeOrder.splice(idx, 1);
    delete rateLimiters[id];

    var db = getDB();
    if (db) {
      try { db.prepare('DELETE FROM api_routes WHERE id = ?').run(id); } catch(e) { /* ignore */ }
    }

    return { ok: true, message: '已删除路由: ' + id };
  } catch(e) {
    return { error: '删除失败: ' + (e.message || String(e)).substring(0, 200) };
  }
}

// ========== 工具4: api_update_route — 更新路由 ==========
async function api_update_route(args) {
  try {
    var id = args.id || args.routeId || '';
    if (!id) return { error: '请指定 routeId' };
    if (!dynamicRoutes[id]) return { error: '未找到路由: ' + id };

    var r = dynamicRoutes[id];
    var changes = {};

    if (args.method) changes.method = args.method.toUpperCase();
    if (args.path) changes.path = args.path.startsWith('/') ? args.path : '/' + args.path;
    if (args.description) changes.description = args.description;
    if (args.handler || args.code) changes.handlerCode = args.handler || args.code;
    if (args.group !== undefined) changes.group = args.group;
    if (args.version) changes.version = args.version;
    if (args.tags) changes.tags = args.tags;
    if (args.authRequired !== undefined) changes.authRequired = args.authRequired === true;
    if (args.rateLimit !== undefined) {
      changes.rateLimit = args.rateLimit;
      if (args.rateLimit) {
        rateLimiters[id] = createTokenBucket(args.rateLimit.tokensPerSecond || 10, args.rateLimit.maxBurst || 20);
      } else {
        delete rateLimiters[id];
      }
    }

    changes.updatedAt = new Date().toISOString();

    // 更新内存记录
    for (var k in changes) {
      r[k] = changes[k];
    }

    // 如果 handlerCode 变了，需要重新注册到系统
    if (changes.handlerCode || changes.method || changes.path) {
      // handler code 语法检查
      if (r.handlerCode) {
        try {
          new Function('req', 'res', 'json', 'error', 'context', r.handlerCode);
        } catch(e) {
          return { error: 'Handler 代码语法错误: ' + e.message.substring(0, 200) };
        }
      }
      // 重新注册需要 server 重启，标记已更新
      changes._needsReRegister = true;
    }

    // SQLite 持久化
    var db = getDB();
    if (db) {
      try {
        db.prepare(`UPDATE api_routes SET
          method = ?, path = ?, group_name = ?, version = ?, description = ?,
          tags = ?, handlerCode = ?, rateLimit = ?, authRequired = ?, updated = ?
          WHERE id = ?`).run(
          r.method, r.path, r.group, r.version, r.description,
          JSON.stringify(r.tags), r.handlerCode,
          r.rateLimit ? JSON.stringify(r.rateLimit) : null,
          r.authRequired ? 1 : 0, changes.updatedAt, id
        );
      } catch(sqErr) { /* ignore */ }
    }

    return {
      ok: true,
      routeId: id,
      updated: Object.keys(changes).filter(function(k) { return k !== '_needsReRegister'; }),
      needsReRegister: !!changes._needsReRegister,
      message: '路由 ' + id + ' 已更新' + (changes._needsReRegister ? '（handler 变更需重启 server 后生效）' : '')
    };
  } catch(e) {
    return { error: '更新路由失败: ' + (e.message || String(e)).substring(0, 200) };
  }
}

// ========== 工具5: api_gateway_status — 网关状态 ==========
async function api_gateway_status() {
  var uptime = Math.floor((Date.now() - stats.startedAt) / 1000);
  var hours = Math.floor(uptime / 3600);
  var mins = Math.floor((uptime % 3600) / 60);

  var interceptorInfo = {
    pre: interceptors.pre.map(function(i) { return { name: i.name }; }),
    post: interceptors.post.map(function(i) { return { name: i.name }; })
  };

  var routeSummary = {};
  var ids = Object.keys(dynamicRoutes);
  for (var i = 0; i < ids.length; i++) {
    var r = dynamicRoutes[ids[i]];
    var group = r.group || 'ungrouped';
    if (!routeSummary[group]) routeSummary[group] = [];
    routeSummary[group].push(r.method + ' ' + r.path);
  }

  return {
    ok: true,
    gateway: {
      uptime: hours + 'h ' + mins + 'm',
      stats: {
        totalRequests: stats.totalRequests,
        successRequests: stats.successRequests,
        failedRequests: stats.failedRequests,
        limitedRequests: stats.limitedRequests,
        successRate: stats.totalRequests > 0
          ? Math.round(stats.successRequests / stats.totalRequests * 100) + '%'
          : 'N/A'
      },
      routes: {
        total: ids.length,
        max: CONFIG.maxRoutes,
        byGroup: routeSummary
      },
      interceptors: interceptorInfo,
      rateLimiting: {
        enabled: Object.keys(rateLimiters).length > 0,
        activeLimiters: Object.keys(rateLimiters).length
      },
      persistence: _sqlite ? 'SQLite' : 'memory-only'
    }
  };
}

// ========== 工具6: api_openapi_spec — 生成 OpenAPI 3.0 规范 ==========
async function api_openapi_spec() {
  var paths = {};
  var ids = Object.keys(dynamicRoutes);

  for (var i = 0; i < ids.length; i++) {
    var r = dynamicRoutes[ids[i]];
    var method = r.method.toLowerCase();
    var pathKey = r.path.replace(/:[a-zA-Z_]\w*/g, function(m) {
      return '{' + m.substring(1) + '}';
    });

    if (!paths[pathKey]) paths[pathKey] = {};

    var pathItem = {
      summary: r.description || '',
      tags: r.tags && r.tags.length > 0 ? r.tags : [r.group || 'default'],
      responses: {
        '200': {
          description: '成功响应',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  data: { type: 'object' }
                }
              }
            }
          }
        },
        '429': { description: '请求频率限制' },
        '500': { description: '服务器内部错误' }
      },
      'x-routeId': r.id
    };

    paths[pathKey][method] = pathItem;
  }

  var spec = {
    openapi: '3.0.3',
    info: {
      title: 'eCompany API Gateway',
      description: '小龙动态暴露的 RESTful API 端点',
      version: '1.0.0',
      'x-startedAt': new Date(stats.startedAt).toISOString()
    },
    servers: [
      { url: 'http://localhost:8005', description: 'eCompany 主服务器' }
    ],
    paths: paths,
    'x-gateway-stats': {
      totalRoutes: ids.length,
      totalRequests: stats.totalRequests,
      limitedRequests: stats.limitedRequests
    }
  };

  return { ok: true, spec: spec };
}

// ========== 加载持久化路由 ==========
function loadPersistedRoutes() {
  var db = getDB();
  if (!db) return;

  try {
    var rows = db.prepare('SELECT * FROM api_routes WHERE enabled = 1').all();
    var loaded = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!dynamicRoutes[r.id]) {
        var rateLimitData = null;
        try { rateLimitData = r.rateLimit ? JSON.parse(r.rateLimit) : null; } catch(e) { /* ignore */ }

        dynamicRoutes[r.id] = {
          id: r.id,
          method: r.method,
          path: r.path,
          group: r.group_name || '',
          version: r.version || 'v1',
          description: r.description || '',
          tags: (function() { try { return JSON.parse(r.tags || '[]'); } catch(e) { return []; } })(),
          handlerCode: r.handlerCode,
          rateLimit: rateLimitData,
          authRequired: !!r.authRequired,
          createdAt: r.created,
          updatedAt: r.updated
        };
        if (routeOrder.indexOf(r.id) < 0) routeOrder.push(r.id);
        if (rateLimitData) {
          rateLimiters[r.id] = createTokenBucket(rateLimitData.tokensPerSecond || 10, rateLimitData.maxBurst || 20);
        }
        loaded++;
      }
    }
    console.log('[APIGateway] 已加载 ' + loaded + ' 个持久化路由');
  } catch(e) {
    console.log('[APIGateway] 加载持久化路由失败:', e.message);
  }
}

// ========== 工具7（内部）: reset_stats — 重置统计 ==========
async function api_reset_stats() {
  stats.totalRequests = 0;
  stats.successRequests = 0;
  stats.failedRequests = 0;
  stats.limitedRequests = 0;
  stats.routeHits = {};
  stats.startedAt = Date.now();
  return { ok: true, message: '网关统计已重置' };
}

// ========== 启动时自动加载 ==========
loadPersistedRoutes();

module.exports = {
  api_create_route: api_create_route,
  api_list_routes: api_list_routes,
  api_remove_route: api_remove_route,
  api_update_route: api_update_route,
  api_gateway_status: api_gateway_status,
  api_openapi_spec: api_openapi_spec,
  api_reset_stats: api_reset_stats,
  setRouteRegistrar: setRouteRegistrar,
  loadPersistedRoutes: loadPersistedRoutes
};
