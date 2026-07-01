/**
 * 数据库直连工具（MySQL/PostgreSQL 连接管理与查询）
 * 
 * 提供：连接管理、SQL 查询执行、连接断开，加密存储连接配置
 */
'use strict';
var path = require('path');
var fs = require('fs');

// 加密存储
var vault;
try { vault = require('./credential-vault'); } catch(e) { vault = null; }

// 连接池缓存
var activeConnections = {};

// 数据源配置文件路径
var configPath = path.join(__dirname, '..', 'data', 'datasources.enc.json');

// ===== 工具1: datasource_connect — 连接数据库 =====
async function datasource_connect(args) {
  try {
    var name = args.name || args.datasource || 'default';
    var config = args;
    
    // 如果只传了 name，从配置文件读取
    if (!config.host && !config.connectionString) {
      var stored = loadConfig();
      if (!stored[name]) return { error: '数据源 "' + name + '" 未配置。请先使用 datasource_configure 添加配置' };
      config = stored[name];
    }
    
    // 检测已存在的连接
    if (activeConnections[name]) {
      return { ok: true, connectionId: name, message: '已存在连接，直接复用', pool: true };
    }
    
    var dbType = (config.type || config.dbType || 'mysql').toLowerCase();
    var conn;
    
    if (dbType === 'mysql' || dbType === 'mariadb') {
      var mysql2;
      try { mysql2 = require('mysql2/promise'); } catch(e) { return { error: 'mysql2 模块未安装。请运行: npm install mysql2' }; }
      
      if (config.connectionString) {
        conn = await mysql2.createConnection(config.connectionString);
      } else {
        conn = await mysql2.createConnection({
          host: config.host || 'localhost',
          port: parseInt(config.port) || 3306,
          user: config.user || config.username || 'root',
          password: config.password || '',
          database: config.database || config.db || '',
          connectTimeout: (config.timeout || 10) * 1000
        });
      }
      activeConnections[name] = { type: dbType, conn: conn, connected: Date.now() };
      return { ok: true, connectionId: name, type: dbType, message: 'MySQL 连接成功', server: config.host || 'connectionString' };
      
    } else if (dbType === 'postgresql' || dbType === 'pg' || dbType === 'postgres') {
      var pg;
      try { pg = require('pg'); } catch(e) { return { error: 'pg 模块未安装。请运行: npm install pg' }; }
      
      if (config.connectionString) {
        conn = new pg.Client(config.connectionString);
      } else {
        conn = new pg.Client({
          host: config.host || 'localhost',
          port: parseInt(config.port) || 5432,
          user: config.user || config.username || 'postgres',
          password: config.password || '',
          database: config.database || config.db || 'postgres'
        });
      }
      await conn.connect();
      activeConnections[name] = { type: dbType, conn: conn, connected: Date.now() };
      return { ok: true, connectionId: name, type: dbType, message: 'PostgreSQL 连接成功', server: config.host || 'connectionString' };
      
    } else {
      return { error: '不支持的数据库类型: ' + dbType + '。支持: mysql, mariadb, postgresql, pg' };
    }
  } catch(e) {
    return { error: '连接失败: ' + (e.message || String(e)).substring(0, 300) };
  }
}

// ===== 工具2: datasource_query — 执行SQL查询 =====
async function datasource_query(args) {
  try {
    var name = args.connectionId || args.datasource || 'default';
    var sql = args.sql || args.query || '';
    var params = args.params || args.parameters || [];
    
    if (!sql) return { error: '请输入SQL语句' };
    if (!activeConnections[name]) return { error: '未找到连接 "' + name + '"，请先调用 datasource_connect' };
    
    var info = activeConnections[name];
    var result;
    
    if (info.type === 'mysql' || info.type === 'mariadb') {
      var rows = await info.conn.query(sql, params);
      result = { ok: true, rows: rows[0] || [], fields: rows[1] || [], rowCount: (rows[0] || []).length, affectedRows: rows[0] && rows[0].affectedRows || 0 };
    } else {
      var res = await info.conn.query(sql, params);
      result = { ok: true, rows: res.rows || [], fields: res.fields || [], rowCount: (res.rows || []).length, command: res.command };
    }
    
    // 限制返回行数
    if (result.rows && result.rows.length > 100) {
      result.rows = result.rows.slice(0, 100);
      result.truncated = true;
      result.totalRows = result.rowCount;
      result.rowCount = 100;
    }
    return result;
  } catch(e) {
    return { error: '查询失败: ' + (e.message || String(e)).substring(0, 500) };
  }
}

// ===== 工具3: datasource_execute — 执行写操作 =====
async function datasource_execute(args) {
  try {
    var name = args.connectionId || args.datasource || 'default';
    var sql = args.sql || args.command || '';
    var params = args.params || args.parameters || [];
    
    if (!sql) return { error: '请输入SQL语句' };
    if (!activeConnections[name]) return { error: '未找到连接 "' + name + '"，请先调用 datasource_connect' };
    
    var info = activeConnections[name];
    var result;
    
    if (info.type === 'mysql' || info.type === 'mariadb') {
      var rows = await info.conn.execute(sql, params);
      result = { ok: true, affectedRows: rows[0] && rows[0].affectedRows || 0, changedRows: rows[0] && rows[0].changedRows || 0, insertId: rows[0] && rows[0].insertId || null, warningCount: rows[0] && rows[0].warningCount || 0 };
    } else {
      var res = await info.conn.query(sql, params);
      result = { ok: true, rowCount: res.rowCount || 0, command: res.command };
    }
    return result;
  } catch(e) {
    return { error: '执行失败: ' + (e.message || String(e)).substring(0, 500) };
  }
}

// ===== 工具4: datasource_disconnect — 断开连接 =====
async function datasource_disconnect(args) {
  try {
    var name = args.connectionId || args.datasource || '';
    if (!name) {
      var count = Object.keys(activeConnections).length;
      // 断开所有
      for (var k in activeConnections) {
        try { await activeConnections[k].conn.end(); } catch(e) {}
      }
      activeConnections = {};
      return { ok: true, message: '已断开所有连接（共 ' + count + ' 个）' };
    }
    if (!activeConnections[name]) return { error: '未找到连接 "' + name + '"' };
    await activeConnections[name].conn.end();
    delete activeConnections[name];
    return { ok: true, message: '已断开连接: ' + name };
  } catch(e) {
    return { error: '断开失败: ' + (e.message || String(e)).substring(0, 300) };
  }
}

// ===== 工具5: datasource_list — 查看连接列表 =====
async function datasource_list() {
  var names = Object.keys(activeConnections);
  if (names.length === 0) return { ok: true, connections: [], message: '当前无活动连接' };
  var list = names.map(function(k){
    var info = activeConnections[k];
    return { connectionId: k, type: info.type, connected: new Date(info.connected).toISOString(), uptime: Math.floor((Date.now() - info.connected) / 1000) + 's' };
  });
  return { ok: true, connections: list, count: list.length };
}

// ===== 配置管理 =====
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      var raw = fs.readFileSync(configPath, 'utf8');
      if (vault) return vault.decrypt(raw);
      return JSON.parse(raw);
    }
  } catch(e) { /* ignore */ }
  return {};
}

function saveConfig(data) {
  try {
    var dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var raw = vault ? vault.encrypt(JSON.stringify(data)) : JSON.stringify(data, null, 2);
    fs.writeFileSync(configPath, raw, 'utf8');
    return true;
  } catch(e) { return false; }
}

async function datasource_configure(args) {
  try {
    var name = args.name || args.datasource || 'default';
    var configs = loadConfig();
    configs[name] = {
      type: (args.type || 'mysql').toLowerCase(),
      host: args.host || 'localhost',
      port: args.port || (args.type === 'postgresql' ? 5432 : 3306),
      user: args.user || args.username || '',
      password: args.password || '',
      database: args.database || args.db || '',
      timeout: args.timeout || 10
    };
    if (args.connectionString) configs[name] = { type: (args.type || 'mysql').toLowerCase(), connectionString: args.connectionString, timeout: args.timeout || 10 };
    if (!saveConfig(configs)) return { error: '保存配置失败' };
    return { ok: true, message: '数据源 "' + name + '" 已保存（加密存储）' };
  } catch(e) {
    return { error: '配置失败: ' + (e.message || String(e)).substring(0, 300) };
  }
}

module.exports = {
  datasource_connect: datasource_connect,
  datasource_query: datasource_query,
  datasource_execute: datasource_execute,
  datasource_disconnect: datasource_disconnect,
  datasource_list: datasource_list,
  datasource_configure: datasource_configure
};
