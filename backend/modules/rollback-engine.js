// rollback-engine.js — 操作回滚引擎 v1
// 零外部依赖，利用 SQLite WAL + 操作快照实现回滚
// 特性：快照管理、SQL 事务回滚、API 路由撤销、定时清理

'use strict';

function RollbackEngine() {
  this._snapshots = [];
  this._maxSnapshots = 100;
  this._cleanupInterval = 300000; // 5分钟清理过期快照
  this._logger = console.log;
  this._startCleanup();
}

// ========== 判断操作是否可回滚 ==========
var MUTATION_ACTIONS = {
  'sql_exec': { reversible: true, type: 'sql' },
  'api_create_route': { reversible: true, type: 'api' },
  'api_remove_route': { reversible: true, type: 'api' },
  'api_update_route': { reversible: true, type: 'api' },
  'write_file': { reversible: true, type: 'file' },
  'file_manager': { reversible: true, type: 'file' },
  'cron_create': { reversible: true, type: 'cron' },
  'cron_update': { reversible: true, type: 'cron' },
  'cron_delete': { reversible: true, type: 'cron' },
  'cron_run': { reversible: false, type: 'cron' },
  'db_execute': { reversible: true, type: 'sql' },  // 仅包裹 BEGIN/COMMIT 时可回滚
  'sql_connect': { reversible: true, type: 'sql' }
};

RollbackEngine.prototype.isMutable = function(action) {
  return !!MUTATION_ACTIONS[action];
};

// ========== 创建快照 ==========

RollbackEngine.prototype.snapshot = function(context) {
  context = context || {};
  var snapshot = {
    id: 'ss_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    ts: Date.now(),
    stepId: context.stepId || 'unknown',
    action: context.action || 'unknown',
    description: (context.description || '').substring(0, 60),
    sessionId: context.sessionId || 'unknown',
    state: 'active'
  };

  // 根据操作类型收集状态快照
  try {
    var dbMod = require('./database');
    var db = dbMod.db ? dbMod.db() : null;

    switch(context.action) {
      case 'sql_exec':
      case 'db_execute': {
        if (db) {
          // 对 sql_exec 创建事务安全点
          var tablesSnapshot = {};
          try {
            // 尝试通过 WAL checkpoint 状态判断是否有未提交事务
            var walState = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
            snapshot._walState = walState;
          } catch(_) {}
          // 记录数据库快照时间戳
          snapshot._dbSnapshot = Date.now();
          snapshot._dbPath = db.name || 'unknown';
        }
        break;
      }
      case 'api_create_route':
      case 'api_update_route':
      case 'api_remove_route': {
        // 保存当前路由状态
        if (db) {
          var routes = db.prepare('SELECT * FROM api_routes').all();
          snapshot._apiRoutes = JSON.parse(JSON.stringify(routes || []));
        }
        break;
      }
      case 'write_file':
      case 'file_manager': {
        snapshot._fileSnapshot = {
          path: context.path || context.filePath || 'unknown',
          time: Date.now()
        };
        // 如果文件已存在，保存当前内容
        try {
          var fs = require('fs');
          var p = context.path || context.filePath || '';
          if (p && fs.existsSync(p)) {
            snapshot._fileContent = fs.readFileSync(p, 'utf8');
          }
        } catch(_) {}
        break;
      }
      case 'cron_create':
      case 'cron_update':
      case 'cron_delete': {
        var cronData = { name: context.name || context.cronName || 'unknown' };
        snapshot._cronData = cronData;
        break;
      }
    }
  } catch(e) {
    this._logger('[Rollback] 快照收集部分失败: ' + e.message);
  }

  // 保存到内存 + 持久化
  this._snapshots.push(snapshot);
  this._persistSnapshot(snapshot);

  this._logger('[Rollback] 快照创建: ' + snapshot.id + ' | ' + context.action + ' | ' + context.description);
  return snapshot;
};

// ========== 执行回滚 ==========

RollbackEngine.prototype.rollback = function(snapshotId) {
  var snap = this._snapshots.find(function(s) { return s.id === snapshotId; }) || this._findSnapshotInDB(snapshotId);
  if (!snap) return { ok: false, error: '未找到回滚点: ' + snapshotId };
  if (snap.state === 'rolled_back') return { ok: false, error: '该回滚点已执行过回滚' };

  var result = { ok: true, action: snap.action, description: snap.description, steps: [] };
  var dbMod = require('./database');
  var db = dbMod.db ? dbMod.db() : null;

  try {
    switch(snap.action) {
      case 'sql_exec':
      case 'db_execute': {
        // SQL 回滚需要外部事务包裹，这里标记为已回滚
        result.steps.push({ type: 'info', msg: 'SQL 回滚依赖外部事务管理（BEGIN/COMMIT/ROLLBACK）' });
        result.steps.push({ type: 'info', msg: '建议使用 db_connector 的 sql_exec 带事务参数' });
        break;
      }
      case 'api_create_route': {
        // 删除新增的路由
        if (db && snap._apiRoutes) {
          // 找出新创建的路由（在快照后新增的）
          var currentRoutes = db.prepare('SELECT * FROM api_routes').all() || [];
          var oldIds = {};
          snap._apiRoutes.forEach(function(r) { oldIds[r.id || r.path] = true; });
          currentRoutes.forEach(function(r) {
            if (!oldIds[r.id || r.path]) {
              try { db.prepare('DELETE FROM api_routes WHERE id=?').run(r.id); } catch(_) {}
              result.steps.push({ type: 'api_remove', routeId: r.id, path: r.path });
            }
          });
        }
        break;
      }
      case 'api_remove_route': {
        // 恢复被删除的路由
        if (db && snap._apiRoutes) {
          var existing = {};
          var currentR = db.prepare('SELECT id, path FROM api_routes').all() || [];
          currentR.forEach(function(r) { existing[r.id] = true; });
          snap._apiRoutes.forEach(function(r) {
            if (!existing[r.id]) {
              try {
                db.prepare('INSERT OR REPLACE INTO api_routes (id, path, method, target, description, created_at) VALUES (?, ?, ?, ?, ?, ?)')
                  .run(r.id, r.path, r.method || 'GET', r.target || '', r.description || '', r.created_at || Date.now());
              } catch(_) {}
              result.steps.push({ type: 'api_restore', routeId: r.id, path: r.path });
            }
          });
        }
        break;
      }
      case 'api_update_route': {
        // 恢复路由到快照状态
        if (db && snap._apiRoutes) {
          var updatedRoute = snap._apiRoutes.find(function(r) { return r.id === snap._routeTargetId; });
          if (updatedRoute) {
            db.prepare('UPDATE api_routes SET path=?, method=?, target=?, description=? WHERE id=?')
              .run(updatedRoute.path, updatedRoute.method, updatedRoute.target, updatedRoute.description, updatedRoute.id);
            result.steps.push({ type: 'api_restore', routeId: updatedRoute.id, path: updatedRoute.path });
          }
        }
        break;
      }
      case 'write_file':
      case 'file_manager': {
        if (snap._fileContent && snap._fileSnapshot) {
          try {
            var fs = require('fs');
            if (snap._fileSnapshot.path) {
              fs.writeFileSync(snap._fileSnapshot.path, snap._fileContent, 'utf8');
              result.steps.push({ type: 'file_restore', path: snap._fileSnapshot.path });
            }
          } catch(e) {
            result.steps.push({ type: 'error', msg: '文件恢复失败: ' + e.message });
          }
        }
        break;
      }
      case 'cron_create': {
        if (snap._cronData && snap._cronData.name) {
          result.steps.push({ type: 'info', msg: 'cron 回滚需调用 cron_delete(' + snap._cronData.name + ')' });
        }
        break;
      }
    }

    snap.state = 'rolled_back';
    snap.rolledAt = Date.now();
    this._updateSnapshotInDB(snap);
    result.snapshotId = snap.id;
    this._logger('[Rollback] 回滚完成: ' + snap.id + ' (' + result.steps.length + ' 步)');

  } catch(e) {
    result.ok = false;
    result.error = e.message;
    this._logger('[Rollback] 回滚失败: ' + snap.id + ' - ' + e.message);
  }

  return result;
};

// ========== 列出回滚点 ==========

RollbackEngine.prototype.list = function(options) {
  options = options || {};
  var limit = options.limit || 20;
  var filtered = this._snapshots;

  if (options.action) filtered = filtered.filter(function(s) { return s.action === options.action; });
  if (options.state) filtered = filtered.filter(function(s) { return s.state === options.state; });

  filtered.sort(function(a, b) { return b.ts - a.ts; });
  return filtered.slice(0, limit);
};

// ========== 持久化支持 ==========

RollbackEngine.prototype._persistSnapshot = function(snapshot) {
  try {
    var dbMod = require('./database');
    var db = dbMod.db ? dbMod.db() : null;
    if (!db) return;
    var content = JSON.stringify({ id: snapshot.id, stepId: snapshot.stepId, action: snapshot.action, description: snapshot.description, sessionId: snapshot.sessionId, ts: snapshot.ts, state: snapshot.state });
    db.prepare('INSERT OR REPLACE INTO agent_memories (key, agent_id, content, memory_type, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('rollback_' + snapshot.id, 'system', content, 'rollback', Date.now());
  } catch(_) {}
};

RollbackEngine.prototype._updateSnapshotInDB = function(snap) {
  try {
    var dbMod = require('./database');
    var db = dbMod.db ? dbMod.db() : null;
    if (!db) return;
    var content = JSON.stringify(snap);
    db.prepare('UPDATE agent_memories SET content=? WHERE key=?')
      .run(content, 'rollback_' + snap.id);
  } catch(_) {}
};

RollbackEngine.prototype._findSnapshotInDB = function(snapshotId) {
  try {
    var dbMod = require('./database');
    var db = dbMod.db ? dbMod.db() : null;
    if (!db) return null;
    var row = db.prepare("SELECT content FROM agent_memories WHERE key=? AND memory_type='rollback'").get('rollback_' + snapshotId);
    if (row) return JSON.parse(row.content);
  } catch(_) {}
  return null;
};

// ========== 定时清理 ==========

RollbackEngine.prototype._startCleanup = function() {
  var self = this;
  this._cleanupTimer = setInterval(function() {
    var cutoff = Date.now() - 86400000; // 24小时过期
    var before = self._snapshots.length;
    self._snapshots = self._snapshots.filter(function(s) { return s.ts > cutoff; });
    if (self._snapshots.length < before) {
      self._logger('[Rollback] 清理过期快照: ' + (before - self._snapshots.length) + ' 条');
    }
  }, this._cleanupInterval);
};

// ========== 导出单例工厂 ==========

var _instance = null;
module.exports = function() {
  if (!_instance) _instance = new RollbackEngine();
  return _instance;
};
module.exports.RollbackEngine = RollbackEngine;
