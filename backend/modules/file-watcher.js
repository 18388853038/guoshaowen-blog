/**
 * file-watcher.js — 文件系统监听工具
 * 
 * 提供：
 * - watchDir: 递归监听目录变化（增删改）
 * - watchFile: 监听单个文件变化
 * - watchPattern: glob 模式监听
 * - file_event 工具：AI 可调用查看监听状态/结果
 * 
 * 监听事件通过 WS 广播给前端实时通知
 */

var fs = require('fs');
var path = require('path');
var EventEmitter = require('events');

// 活动监听器
var _watchers = {};
var _watchEvents = [];
var _maxEvents = 500;
var _wsServer = null;
var _watching = false;

/**
 * 设置 WS 广播对象
 */
function setWsServer(ws) {
  _wsServer = ws;
}

/**
 * 发起广播
 */
function _broadcast(type, data) {
  if (_wsServer && typeof _wsServer.broadcast === 'function') {
    try {
      _wsServer.broadcast('filewatch', Object.assign({ type: type, time: new Date().toISOString() }, data));
    } catch(e) {}
  }
}

/**
 * 记录事件到环形缓冲区
 */
function _recordEvent(type, filePath, extra) {
  var ev = { type: type, path: filePath, time: new Date().toISOString(), extra: extra || '' };
  _watchEvents.push(ev);
  if (_watchEvents.length > _maxEvents) _watchEvents.splice(0, _watchEvents.length - _maxEvents);
}

/**
 * 启动目录监听（递归）
 * @param {string} dirPath - 目录路径
 * @param {object} options - { recursive: true, ignoreDotFiles: true }
 * @returns {string} watcherId
 */
function watchDir(dirPath, options) {
  options = options || {};
  var recursive = options.recursive !== false;
  var ignoreDotFiles = options.ignoreDotFiles !== false;
  var ignorePattern = options.ignore || null;
  
  if (!fs.existsSync(dirPath)) {
    throw new Error('目录不存在: ' + dirPath);
  }
  
  var watcherId = 'watch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  
  try {
    var watcher = fs.watch(dirPath, { recursive: recursive }, function(eventType, filename) {
      if (!filename) return;
      var fullPath = path.join(dirPath, filename);
      
      // 过滤
      if (ignoreDotFiles && filename.startsWith('.')) return;
      if (ignorePattern && ignorePattern.test(filename)) return;
      
      var exists = fs.existsSync(fullPath);
      var isDir = exists ? fs.statSync(fullPath).isDirectory() : false;
      var suffix = isDir ? '/' : '';
      
      _recordEvent(eventType, fullPath + suffix, '');
      _broadcast('file_event', {
        event: eventType,
        path: fullPath + suffix,
        isDir: isDir,
        watcherId: watcherId
      });
    });
    
    _watchers[watcherId] = {
      target: dirPath,
      type: 'directory',
      watcher: watcher,
      options: options,
      created: new Date().toISOString()
    };
    
    _watching = true;
    _recordEvent('watch_started', dirPath, 'recursive=' + recursive);
    _broadcast('watch_status', { watcherId: watcherId, target: dirPath, action: 'started' });
    
    return watcherId;
  } catch(e) {
    throw new Error('监听启动失败: ' + dirPath + ' - ' + e.message);
  }
}

/**
 * 启动单文件监听
 */
function watchFile(filePath, options) {
  options = options || {};
  if (!fs.existsSync(filePath)) {
    throw new Error('文件不存在: ' + filePath);
  }
  
  var watcherId = 'watch_file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  var _prevMtime = fs.statSync(filePath).mtimeMs;
  
  // fs.watchFile 有轮询延迟，但跨平台稳定
  var watcher = fs.watchFile(filePath, { interval: options.interval || 500 }, function(curr, prev) {
    if (curr.mtimeMs === prev.mtimeMs) return;
    var eventType = curr.mtimeMs > _prevMtime ? 'change' : 'delete';
    _prevMtime = curr.mtimeMs;
    
    _recordEvent(eventType, filePath, (curr.size - prev.size) + ' bytes');
    _broadcast('file_event', {
      event: eventType,
      path: filePath,
      isDir: false,
      watcherId: watcherId,
      detail: (curr.size - prev.size) + ' bytes'
    });
  });
  
  _watchers[watcherId] = {
    target: filePath,
    type: 'file',
    watcher: watcher,
    options: options,
    created: new Date().toISOString()
  };
  
  _watching = true;
  _recordEvent('watch_started', filePath, 'file');
  _broadcast('watch_status', { watcherId: watcherId, target: filePath, action: 'started' });
  
  return watcherId;
}

/**
 * 停止监听
 */
function stopWatch(watcherId) {
  var w = _watchers[watcherId];
  if (!w) return false;
  
  if (w.type === 'directory') {
    w.watcher.close();
  } else if (w.type === 'file') {
    fs.unwatchFile(w.target, w.watcher);
  }
  
  _recordEvent('watch_stopped', w.target, watcherId);
  _broadcast('watch_status', { watcherId: watcherId, target: w.target, action: 'stopped' });
  delete _watchers[watcherId];
  
  if (Object.keys(_watchers).length === 0) _watching = false;
  return true;
}

/**
 * 停止所有监听
 */
function stopAll() {
  Object.keys(_watchers).forEach(stopWatch);
}

/**
 * 获取监听状态
 */
function getStatus() {
  return {
    watching: _watching,
    watcherCount: Object.keys(_watchers).length,
    watchers: Object.keys(_watchers).map(function(id) {
      return { id: id, target: _watchers[id].target, type: _watchers[id].type, created: _watchers[id].created };
    }),
    recentEvents: _watchEvents.slice(-20).reverse()
  };
}

/**
 * AI 可调用的文件监听工具
 */
function executeFileWatchTool(funcName, funcArgs) {
  var action = funcArgs.action || 'status';
  var target = funcArgs.target || '';
  var recursive = funcArgs.recursive !== false;
  var ignore = funcArgs.ignore || '';
  
  try {
    switch (action) {
      case 'watch_dir':
        var wid = watchDir(target, { recursive: recursive, ignore: ignore ? new RegExp(ignore) : null });
        return { success: true, watcherId: wid, message: '已开始监听: ' + target };
      
      case 'watch_file':
        var wid2 = watchFile(target, { interval: funcArgs.interval || 500 });
        return { success: true, watcherId: wid2, message: '已开始监听: ' + target };
      
      case 'stop':
        if (funcArgs.watcherId) {
          var ok = stopWatch(funcArgs.watcherId);
          return { success: ok, message: ok ? '已停止监听: ' + funcArgs.watcherId : '监听器未找到: ' + funcArgs.watcherId };
        }
        stopAll();
        return { success: true, message: '已停止所有监听' };
      
      case 'stop_all':
        stopAll();
        return { success: true, message: '已停止所有监听' };
      
      case 'status':
      default:
        return { success: true, data: getStatus() };
    }
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// 进程退出时清理
process.on('exit', stopAll);
process.on('SIGINT', function() { stopAll(); process.exit(); });
process.on('SIGTERM', function() { stopAll(); process.exit(); });

module.exports = {
  setWsServer: setWsServer,
  watchDir: watchDir,
  watchFile: watchFile,
  stopWatch: stopWatch,
  stopAll: stopAll,
  getStatus: getStatus,
  executeFileWatchTool: executeFileWatchTool
};
