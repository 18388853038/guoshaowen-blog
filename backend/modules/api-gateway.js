/**
 * API 网关模块 — 动态路由注册与管理
 * 
 * 让小龙能主动创建/管理/测试 RESTful API 端点
 * 路由持久化到 SQLite，重启自动重载
 */
'use strict';
var path = require('path');
var fs = require('fs');

// 缓存的动态路由
var dynamicRoutes = {};

// 数据库模块
var db;
try { db = require('./route-registry'); } catch(e) { db = null; }

// SQLite 数据库
var sqlite;
try {
  var dbPath = path.join(__dirname, '..', 'ecompany-core.db');
  sqlite = require('better-sqlite3')(dbPath);
  // 确保路由表存在
  sqlite.exec('CREATE TABLE IF NOT EXISTS api_routes (id TEXT PRIMARY KEY, method TEXT, path TEXT, description TEXT, handlerCode TEXT, enabled INTEGER DEFAULT 1, created TEXT)');
} catch(e) { sqlite = null; }

// 注册外部 registerRoute 函数
var _registerRoute = null;
function setRouteRegistrar(fn) { _registerRoute = fn; }

// ===== 工具1: api_create_route — 创建新路由 =====
async function api_create_route(args) {
  try {
    var method = (args.method || 'GET').toUpperCase();
    var routePath = args.path || args.route || '';
    var description = args.description || args.desc || '';
    var handlerCode = args.handler || args.code || args.script || '';
    var id = args.id || 'api_' + Date.now();
    
    if (!routePath) return { error: '请指定路由路径（如 /api/report/team）' };
    if (!handlerCode) return { error: '请提供 handler 函数代码' };
    // 确保以 / 开头
    if (!routePath.startsWith('/')) routePath = '/' + routePath;
    
    // 构建 handler 函数
    var fn;
    try {
      fn = new Function('req', 'res', 'json', 'error', handlerCode);
    } catch(e) {
      return { error: 'handler 代码语法错误: ' + (e.message || '').substring(0, 200) };
    }
    
    // 如果已有 registerRoute，注册到系统
    var registration = null;
    if (_registerRoute) {
      try {
        var regMethods = method === 'ANY' ? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] : [method];
        // Wrap 防止 handler 崩溃
        var wrappedFn = async function(req, res) {
          try {
            // 提供 json/error 工具函数给 handler
            var sendJson = function(data, code) {
              if (code) res.statusCode = code;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
            };
            var sendError = function(msg, code) {
              res.statusCode = code || 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: msg }));
            };
            await fn(req, res, sendJson, sendError);
          } catch(e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'handler error: ' + (e.message || String(e)).substring(0,200) }));
          }
        };
        _registerRoute(regMethods, new RegExp('^' + routePath.replace(/:[a-zA-Z_]+/g, '([^/]+)').replace(/\//g, '\\/') + '$'), wrappedFn);
        registration = { methods: regMethods, path: routePath, pattern: '^' + routePath.replace(/:[a-zA-Z_]+/g, '([^/]+)').replace(/\//g, '\\/') + '$' };
      } catch(regErr) {
        registration = { error: regErr.message };
      }
    }
    
    // 持久化到 SQLite
    if (sqlite) {
      try {
        sqlite.prepare('INSERT OR REPLACE INTO api_routes (id, method, path, description, handlerCode, enabled, created) VALUES (?, ?, ?, ?, ?, 1, ?)').run(id, method, routePath, description, handlerCode, new Date().toISOString());
      } catch(sqErr) { /* ignore */ }
    }
    
    // 缓存到内存
    dynamicRoutes[id] = { id: id, method: method, path: routePath, description: description, handlerCode: handlerCode };
    
    return { ok: true, routeId: id, method: method, path: routePath, description: description, registration: registration, message: '路由注册成功' };
  } catch(e) {
    return { error: '创建路由失败: ' + (e.message || String(e)).substring(0, 300) };
  }
}

// ===== 工具2: api_list_routes — 列出所有动态路由 =====
async function api_list_routes(args) {
  var routes = [];
  var ids = Object.keys(dynamicRoutes);
  for (var i = 0; i < ids.length; i++) {
    routes.push({ id: ids[i], method: dynamicRoutes[ids[i]].method, path: dynamicRoutes[ids[i]].path, description: dynamicRoutes[ids[i]].description });
  }
  // 从 SQLite 加载未缓存的
  if (sqlite) {
    try {
      var dbRoutes = sqlite.prepare('SELECT id, method, path, description, enabled FROM api_routes WHERE enabled = 1').all();
      for (var di = 0; di < dbRoutes.length; di++) {
        if (!dynamicRoutes[dbRoutes[di].id]) {
          routes.push({ id: dbRoutes[di].id, method: dbRoutes[di].method, path: dbRoutes[di].path, description: dbRoutes[di].description, fromDB: true });
        }
      }
    } catch(e) { /* ignore */ }
  }
  return { ok: true, routes: routes, count: routes.length };
}

// ===== 工具3: api_remove_route — 删除路由 =====
async function api_remove_route(args) {
  try {
    var id = args.id || args.routeId || '';
    if (!id) return { error: '请指定 routeId' };
    if (!dynamicRoutes[id]) return { error: '未找到路由: ' + id };
    delete dynamicRoutes[id];
    if (sqlite) {
      try { sqlite.prepare('UPDATE api_routes SET enabled = 0 WHERE id = ?').run(id); } catch(e) { /* ignore */ }
    }
    return { ok: true, message: '已删除路由: ' + id };
  } catch(e) {
    return { error: '删除失败: ' + (e.message || String(e)).substring(0, 200) };
  }
}

// ===== 工具4: api_test_route — 测试路由 =====
async function api_test_route(args) {
  try {
    var id = args.id || args.routeId || '';
    if (!id || !dynamicRoutes[id]) return { error: '未找到路由，请先创建或指定有效 routeId' };
    var route = dynamicRoutes[id];
    var http = require('http');
    var baseUrl = 'http://localhost:' + (process.env.PORT || 8005);
    return new Promise(function(resolve) {
      var body = args.body ? JSON.stringify(args.body) : '';
      var opts = {
        hostname: 'localhost',
        port: parseInt(process.env.PORT || 8005),
        path: route.path,
        method: route.method,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}
      };
      var req = http.request(opts, function(res) {
        var d = '';
        res.on('data', function(c) { d += c; });
        res.on('end', function() {
          resolve({ ok: true, statusCode: res.statusCode, body: d.substring(0, 3000), tested: true });
        });
      });
      req.on('error', function(e) { resolve({ error: '请求失败: ' + e.message }); });
      if (body) req.write(body);
      req.end();
    });
  } catch(e) {
    return { error: '测试失败: ' + (e.message || String(e)).substring(0, 200) };
  }
}

// ===== 启动时加载持久化路由 =====
function loadPersistedRoutes() {
  if (!sqlite) return;
  try {
    var rows = sqlite.prepare('SELECT * FROM api_routes WHERE enabled = 1').all();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!dynamicRoutes[r.id]) {
        dynamicRoutes[r.id] = { id: r.id, method: r.method, path: r.path, description: r.description, handlerCode: r.handlerCode };
        // 如果有 registerRoute，重新注册
        if (_registerRoute) {
          try {
            var fn = new Function('req', 'res', 'json', 'error', r.handlerCode);
            var methods = r.method === 'ANY' ? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] : [r.method];
            var wrappedFn = async function(req, res) {
              try { await fn(req, res, function(d,c){if(c)res.statusCode=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(d));}, function(m,c){res.statusCode=c||500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:m}));}); }
              catch(e) { res.statusCode = 500; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:e.message})); }
            };
            _registerRoute(methods, new RegExp('^' + r.path.replace(/:[a-zA-Z_]+/g, '([^/]+)').replace(/\//g, '\\/') + '$'), wrappedFn);
          } catch(e) { /* ignore bad route */ }
        }
      }
    }
  } catch(e) { /* ignore */ }
}

module.exports = {
  api_create_route: api_create_route,
  api_list_routes: api_list_routes,
  api_remove_route: api_remove_route,
  api_test_route: api_test_route,
  setRouteRegistrar: setRouteRegistrar,
  loadPersistedRoutes: loadPersistedRoutes
};
