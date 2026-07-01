'use strict';
/**
 * routes/loader.js — 加载所有 routes/ 模块
 * 
 * 导出函数：function(registerRoute, json, error, sendSSE) 
 * 由 server-modern.js 末尾注入，传入 server-modern.js 中的全局函数。
 */

var path = require('path');
var MODULES_DIR = path.join(__dirname);
var excluded = ['loader.js', 'sse-chat.js'];

module.exports = function(registerRoute, json, error, sendSSE) {
  try {
    var fs = require('fs');
    var files = fs.readdirSync(MODULES_DIR);
    var loaded = 0;

    files.forEach(function(file) {
      if (!file.endsWith('.js')) return;
      if (excluded.indexOf(file) !== -1) return;

      try {
        var mod = require('./' + file.replace('.js', ''));
        if (typeof mod === 'function') {
          mod(registerRoute, json, error, sendSSE, null, null);
          loaded++;
        }
      } catch(e) {
        // 静默跳过
      }
    });

    console.log('[RouteLoader] ' + loaded + ' route modules loaded from routes/');
  } catch(e) {
    console.log('[RouteLoader] Error:', e.message);
  }
};
