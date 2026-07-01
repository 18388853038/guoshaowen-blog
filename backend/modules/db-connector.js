/**
 * db-connector.js — 数据库直连网关 v1.0
 *
 * 让小龙能直连多种数据库：
 * - SQLite（本地 ecompany.db 及外部 .db 文件）
 * - MySQL（通过 mysql2 驱动）
 * - PostgreSQL（通过 pg 驱动）
 *
 * 安全机制：
 * - SELECT 自动限制行数（默认 200）
 * - 写入操作需要显式 allowWrite=true
 * - 连接信息不记录明文密码
 * - 结果截断保护（最大 10000 行返回）
 *
 * execCEOTool 工具暴露：
 *   sql_connect    → 连接数据库
 *   sql_exec       → 执行 SQL（查询/写入）
 *   sql_disconnect → 断开连接
 *   sql_list       → 列出活跃连接
 *   sql_tables     → 列出表结构
 *   sql_describe   → 查看表结构
 */
'use strict';

const path = require('path');
const fs = require('fs');

// ========== 连接池 ==========
const connections = {};

// 连接配置（不存密码明文到日志）
function maskConfig(cfg) {
  var c = Object.assign({}, cfg);
  if (c.password) c.password = '***';
  if (c.connectionString) {
    try {
      var u = new URL(c.connectionString);
      if (u.password) c.connectionString = c.connectionString.replace(u.password, '***');
    } catch(e) { /* ignore */ }
  }
  return c;
}

// ========== SQLite 连接 ==========
function connectSQLite(id, dbPath) {
  var sqlite;
  try {
    sqlite = require('better-sqlite3');
  } catch(e) {
    throw new Error('better-sqlite3 未安装。执行: npm install better-sqlite3');
  }
  var resolvedPath = path.isAbsolute(dbPath) ? dbPath : path.join(__dirname, '..', dbPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error('数据库文件不存在: ' + resolvedPath);
  }
  var db = new sqlite(resolvedPath);
  db.pragma('journal_mode = WAL');
  connections[id] = {
    type: 'sqlite',
    db: db,
    path: resolvedPath,
    config: { type: 'sqlite', path: resolvedPath },
    connectedAt: Date.now(),
    stats: { queries: 0, errors: 0 }
  };
  return { ok: true, id: id, type: 'sqlite', path: resolvedPath };
}

// ========== MySQL 连接 ==========
function connectMySQL(id, cfg) {
  var mysql2;
  try {
    mysql2 = require('mysql2/promise');
  } catch(e) {
    throw new Error('mysql2 未安装。执行: npm install mysql2');
  }
  var pool = mysql2.createPool({
    host: cfg.host || 'localhost',
    port: cfg.port || 3306,
    user: cfg.user || cfg.username || 'root',
    password: cfg.password || '',
    database: cfg.database || cfg.db || '',
    waitForConnections: true,
    connectionLimit: parseInt(cfg.poolSize || cfg.connectionLimit || 5),
    charset: cfg.charset || 'utf8mb4',
    timezone: cfg.timezone || '+08:00'
  });
  connections[id] = {
    type: 'mysql',
    pool: pool,
    config: maskConfig(cfg),
    connectedAt: Date.now(),
    stats: { queries: 0, errors: 0 }
  };
  return { ok: true, id: id, type: 'mysql', host: cfg.host, port: cfg.port, database: cfg.database };
}

// ========== PostgreSQL 连接 ==========
function connectPostgreSQL(id, cfg) {
  var pg;
  try {
    pg = require('pg');
  } catch(e) {
    throw new Error('pg 未安装。执行: npm install pg');
  }
  var pool = new pg.Pool({
    host: cfg.host || 'localhost',
    port: cfg.port || 5432,
    user: cfg.user || cfg.username || 'postgres',
    password: cfg.password || '',
    database: cfg.database || cfg.db || 'postgres',
    max: parseInt(cfg.poolSize || cfg.max || 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  connections[id] = {
    type: 'postgresql',
    pool: pool,
    config: maskConfig(cfg),
    connectedAt: Date.now(),
    stats: { queries: 0, errors: 0 }
  };
  return { ok: true, id: id, type: 'postgresql', host: cfg.host, port: cfg.port, database: cfg.database };
}

// ========== 智能自动连接本地 SQLite ==========
var _defaultId = null;

async function ensureDefault() {
  if (_defaultId && connections[_defaultId]) return _defaultId;
  try {
    var defPath = path.join(__dirname, '..', 'ecompany.db');
    if (fs.existsSync(defPath)) {
      var id = 'default';
      if (connections[id]) { _defaultId = id; return id; }
      connectSQLite(id, defPath);
      _defaultId = id;
      return id;
    }
  } catch(e) { /* no default */ }
  return null;
}

// ========== 工具1: sql_connect — 连接数据库 ==========
async function sql_connect(args) {
  try {
    var type = (args.type || args.driver || 'sqlite').toLowerCase();
    var id = args.id || args.name || 'conn_' + Date.now();

    if (connections[id]) {
      return { ok: true, id: id, type: type, message: '连接已存在，直接复用', reused: true };
    }

    var result;
    if (type === 'sqlite') {
      var dbPath = args.path || args.database || args.file || '';
      if (!dbPath) {
        // 默认连本地 ecompany.db
        dbPath = path.join(__dirname, '..', 'ecompany.db');
      }
      result = connectSQLite(id, dbPath);
    } else if (type === 'mysql') {
      result = connectMySQL(id, args);
    } else if (type === 'postgresql' || type === 'pg' || type === 'postgres') {
      result = connectPostgreSQL(id, args);
    } else {
      return { error: '不支持的数据库类型: ' + type + '。支持: sqlite, mysql, postgresql' };
    }

    return result;
  } catch(e) {
    return { error: '连接失败: ' + e.message };
  }
}

// ========== SQL 执行安全白名单 ==========
const READ_ONLY_PATTERN = /^\s*(SELECT|EXPLAIN|DESCRIBE|DESC|SHOW|PRAGMA|WITH)\b/i;
const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|REPLACE|MERGE)\b/i;

function isReadOnlySQL(sql) {
  return READ_ONLY_PATTERN.test(sql.trim());
}

function isWriteSQL(sql) {
  return WRITE_PATTERN.test(sql.trim());
}

// 禁止的高危操作
const DANGEROUS_PATTERN = /^\s*(DROP\s+DATABASE|DROP\s+TABLE\s+\w+\s*;?\s*$|TRUNCATE|ALTER\s+.*DROP|DELETE\s+FROM\s+\w+\s*;?\s*$)/i;
function isDangerousSQL(sql) {
  return DANGEROUS_PATTERN.test(sql.trim());
}

// ========== SQLite 执行 ==========
async function execSQLite(conn, sql, params) {
  var db = conn.db;
  if (isWriteSQL(sql)) {
    // 写入操作
    var info;
    if (params && params.length > 0) {
      info = db.prepare(sql).run(...params);
    } else {
      info = db.prepare(sql).run();
    }
    return {
      type: 'write',
      affectedRows: info.changes,
      lastInsertRowid: info.lastInsertRowid,
      info: info
    };
  } else {
    // 查询操作
    var rows;
    if (params && params.length > 0) {
      rows = db.prepare(sql).all(...params);
    } else {
      rows = db.prepare(sql).all();
    }
    return {
      type: 'query',
      rowCount: rows.length,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows: rows.slice(0, 10000)
    };
  }
}

// ========== MySQL 执行 ==========
async function execMySQL(conn, sql, params) {
  var pool = conn.pool;
  var isRead = isReadOnlySQL(sql);
  var opts = params && params.length > 0 ? { sql: sql, values: params } : sql;
  var [rows, fields] = await pool.execute(opts);

  if (isRead) {
    var rowList = Array.isArray(rows) ? rows : [];
    return {
      type: 'query',
      rowCount: rowList.length,
      columns: fields ? fields.map(function(f) { return f.name; }) : (rowList.length > 0 ? Object.keys(rowList[0]) : []),
      rows: rowList.slice(0, 10000)
    };
  } else {
    return {
      type: 'write',
      affectedRows: rows && rows.affectedRows !== undefined ? rows.affectedRows : (rows && rows.changedRows !== undefined ? rows.changedRows : 0),
      insertId: rows && rows.insertId !== undefined ? rows.insertId : null,
      info: rows && rows.info || ''
    };
  }
}

// ========== PostgreSQL 执行 ==========
async function execPostgreSQL(conn, sql, params) {
  var pool = conn.pool;
  var client = await pool.connect();
  try {
    var isRead = isReadOnlySQL(sql);
    var result;
    if (params && params.length > 0) {
      result = await client.query(sql, params);
    } else {
      result = await client.query(sql);
    }

    if (isRead) {
      return {
        type: 'query',
        rowCount: result.rows.length,
        columns: result.fields ? result.fields.map(function(f) { return f.name; }) : (result.rows.length > 0 ? Object.keys(result.rows[0]) : []),
        rows: result.rows.slice(0, 10000)
      };
    } else {
      return {
        type: 'write',
        affectedRows: result.rowCount || 0,
        command: result.command || ''
      };
    }
  } finally {
    client.release();
  }
}

// ========== 工具2: sql_exec — 执行 SQL ==========
async function sql_exec(args) {
  try {
    var sql = args.sql || args.query || '';
    var params = args.params || args.parameters || args.values || [];
    var id = args.id || args.connection || args.conn || '';
    var allowWrite = args.allowWrite === true;
    var maxRows = args.maxRows || args.limit || 200;

    if (!sql) return { error: '请提供 SQL 语句' };

    // 解析连接 ID
    if (!id || !connections[id]) {
      // 尝试默认连接
      var defId = await ensureDefault();
      if (defId) {
        id = defId;
      } else {
        return { error: '未连接数据库。请先用 sql_connect 连接。可用: sqlite://path, mysql://host:port/db, postgresql://host:port/db' };
      }
    }

    var conn = connections[id];
    if (!conn) return { error: '连接不存在: ' + id };

    // 安全检查
    if (isDangerousSQL(sql)) {
      return { error: '高危 SQL 已阻止: DROP/TRUNCATE/DELETE 全表等操作需要手动在数据库管理工具中执行。如需执行请联系管理员。' };
    }

    if (isWriteSQL(sql) && !allowWrite) {
      return { error: '写入操作需要 allowWrite=true。当前仅允许查询。如果要执行写操作，请设置 allowWrite: true。注意：DROP/TRUNCATE 等高危操作始终被阻止。' };
    }

    // 确保 params 是数组
    if (!Array.isArray(params)) {
      if (typeof params === 'object' && params !== null) {
        params = [params];
      } else {
        params = [];
      }
    }

    conn.stats.queries++;

    var result;
    if (conn.type === 'sqlite') {
      result = await execSQLite(conn, sql, params);
    } else if (conn.type === 'mysql') {
      result = await execMySQL(conn, sql, params);
    } else if (conn.type === 'postgresql') {
      result = await execPostgreSQL(conn, sql, params);
    } else {
      return { error: '不支持的连接类型: ' + conn.type };
    }

    // 限制行数
    if (result.type === 'query' && result.rows && result.rows.length > maxRows) {
      result.rows = result.rows.slice(0, maxRows);
      result.truncated = true;
      result.originalRowCount = result.rowCount;
      result.rowCount = result.rows.length;
    }

    // 对过大的结果做截断保护（单个 cell 超 5000 字符截断）
    if (result.rows) {
      result.rows = result.rows.map(function(row) {
        var r = {};
        for (var k in row) {
          if (typeof row[k] === 'string' && row[k].length > 5000) {
            r[k] = row[k].substring(0, 5000) + '...(截断)';
          } else {
            r[k] = row[k];
          }
        }
        return r;
      });
    }

    return {
      ok: true,
      id: id,
      type: conn.type,
      sql: sql.substring(0, 200) + (sql.length > 200 ? '...(截断)' : ''),
      result: result,
      duration: 0,
      stats: { totalQueries: conn.stats.queries, errors: conn.stats.errors }
    };
  } catch(e) {
    var connId = args && (args.id || args.connection || args.conn);
    if (connId && connections[connId]) connections[connId].stats.errors++;
    return { error: 'SQL 执行失败: ' + e.message };
  }
}

// ========== 工具3: sql_disconnect — 断开连接 ==========
async function sql_disconnect(args) {
  try {
    var id = args.id || args.connection || args.conn || '';
    if (!id) {
      // 断开所有
      var ids = Object.keys(connections);
      for (var i = 0; i < ids.length; i++) {
        try {
          var c = connections[ids[i]];
          if (c.db && c.db.close) c.db.close();
          if (c.pool && c.pool.end) await c.pool.end();
        } catch(e) { /* ignore */ }
        delete connections[ids[i]];
      }
      return { ok: true, message: '已断开所有连接(' + ids.length + '个)' };
    }
    if (!connections[id]) return { error: '连接不存在: ' + id };
    var conn = connections[id];
    try {
      if (conn.db && conn.db.close) conn.db.close();
      if (conn.pool && conn.pool.end) await conn.pool.end();
    } catch(e) { /* ignore */ }
    delete connections[id];
    return { ok: true, message: '已断开连接: ' + id, type: conn.type };
  } catch(e) {
    return { error: '断开连接失败: ' + e.message };
  }
}

// ========== 工具4: sql_list — 列出活跃连接 ==========
async function sql_list() {
  var list = [];
  var ids = Object.keys(connections);
  for (var i = 0; i < ids.length; i++) {
    var c = connections[ids[i]];
    list.push({
      id: ids[i],
      type: c.type,
      config: c.config,
      connectedFor: Math.floor((Date.now() - c.connectedAt) / 1000) + 's',
      stats: c.stats
    });
  }
  return { ok: true, connections: list, count: list.length };
}

// ========== 工具5: sql_tables — 列出表结构 ==========
async function sql_tables(args) {
  try {
    var id = args.id || args.connection || args.conn || '';
    if (!id || !connections[id]) {
      var defId = await ensureDefault();
      if (defId) id = defId;
      else return { error: '未连接数据库' };
    }
    var conn = connections[id];

    if (conn.type === 'sqlite') {
      var tables = conn.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      var tableList = tables.map(function(t) {
        var cols = conn.db.prepare('PRAGMA table_info("' + t.name.replace(/"/g, '""') + '")').all();
        return {
          name: t.name,
          columns: cols.map(function(c) { return { name: c.name, type: c.type, nullable: !c.notnull, default: c.dflt_value, pk: !!c.pk }; }),
          columnCount: cols.length
        };
      });
      return { ok: true, type: conn.type, tables: tableList, count: tableList.length };
    } else if (conn.type === 'mysql') {
      var dbName = conn.config.database || 'information_schema';
      var pool = conn.pool;
      var [tables] = await pool.execute("SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [dbName]);
      var tableList = [];
      for (var ti = 0; ti < tables.length; ti++) {
        var tName = tables[ti].TABLE_NAME;
        var [cols] = await pool.execute("SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", [dbName, tName]);
        tableList.push({
          name: tName,
          comment: tables[ti].TABLE_COMMENT || '',
          columns: cols.map(function(c) { return { name: c.COLUMN_NAME, type: c.COLUMN_TYPE, nullable: c.IS_NULLABLE === 'YES', default: c.COLUMN_DEFAULT, key: c.COLUMN_KEY }; }),
          columnCount: cols.length
        });
      }
      return { ok: true, type: conn.type, tables: tableList, count: tableList.length };
    } else if (conn.type === 'postgresql') {
      var pool = conn.pool;
      var client = await pool.connect();
      try {
        var tResult = await client.query("SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
        var tableList = [];
        for (var pi = 0; pi < tResult.rows.length; pi++) {
          var ptName = tResult.rows[pi].tablename;
          var cResult = await client.query("SELECT column_name, data_type, is_nullable, column_default, character_maximum_length FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [ptName]);
          tableList.push({
            name: ptName,
            owner: tResult.rows[pi].tableowner,
            columns: cResult.rows.map(function(c) { return { name: c.column_name, type: c.data_type, nullable: c.is_nullable === 'YES', default: c.column_default, maxLength: c.character_maximum_length }; }),
            columnCount: cResult.rows.length
          });
        }
        return { ok: true, type: conn.type, tables: tableList, count: tableList.length };
      } finally {
        client.release();
      }
    }
  } catch(e) {
    return { error: '获取表结构失败: ' + e.message };
  }
}

// ========== 工具6: sql_describe — 查看单表结构 ==========
async function sql_describe(args) {
  try {
    var table = args.table || args.name || '';
    if (!table) return { error: '请提供表名' };
    var id = args.id || args.connection || args.conn || '';
    if (!id || !connections[id]) {
      var defId = await ensureDefault();
      if (defId) id = defId;
      else return { error: '未连接数据库' };
    }
    return await sql_tables({ id: id });
  } catch(e) {
    return { error: '描述表结构失败: ' + e.message };
  }
}

// ========== 连接健康检查 ==========
async function sql_health(args) {
  try {
    var results = {};
    var ids = Object.keys(connections);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var conn = connections[id];
      try {
        if (conn.type === 'sqlite') {
          var r = conn.db.prepare('SELECT 1 AS ok').get();
          results[id] = { alive: true, type: conn.type };
        } else if (conn.type === 'mysql') {
          var [rows] = await conn.pool.execute('SELECT 1 AS ok');
          results[id] = { alive: true, type: conn.type };
        } else if (conn.type === 'postgresql') {
          var client = await conn.pool.connect();
          try {
            await client.query('SELECT 1 AS ok');
            results[id] = { alive: true, type: conn.type };
          } finally { client.release(); }
        }
      } catch(e) {
        results[id] = { alive: false, type: conn.type, error: e.message };
      }
    }
    return { ok: true, connections: results, count: ids.length };
  } catch(e) {
    return { error: '健康检查失败: ' + e.message };
  }
}

// ========== 初始化默认 SQLite ==========
// 启动时自动连接本地 ecompany.db
(function initDefault() {
  try {
    var defPath = path.join(__dirname, '..', 'ecompany.db');
    if (fs.existsSync(defPath)) {
      var sqlite = require('better-sqlite3');
      var db = new sqlite(defPath);
      db.pragma('journal_mode = WAL');
      connections['default'] = {
        type: 'sqlite',
        db: db,
        path: defPath,
        config: { type: 'sqlite', path: defPath },
        connectedAt: Date.now(),
        stats: { queries: 0, errors: 0 }
      };
      _defaultId = 'default';
      console.log('[DBConnector] 默认本地数据库已连接: ' + defPath);
    }
  } catch(e) {
    console.log('[DBConnector] 默认数据库初始化跳过: ' + (e.message || 'unknown'));
  }
})();

module.exports = {
  sql_connect: sql_connect,
  sql_exec: sql_exec,
  sql_disconnect: sql_disconnect,
  sql_list: sql_list,
  sql_tables: sql_tables,
  sql_describe: sql_describe,
  sql_health: sql_health
};
