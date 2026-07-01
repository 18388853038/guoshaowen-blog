'use strict';
/**
 * server-bridge.js — 双引擎启动入口（过渡期用）
 * 
 * 同时运行：
 * 1. server-core.js 的新架构（lib/ + routes/ 声明式路由）
 * 2. server-modern.js 的原有全部功能（通过委派调用）
 * 
 * 端口分配：
 * - 新架构：8005（主端口，对外服务）
 * - 旧架构：8006（仅内部可用）
 * 
 * 迁移完成后，移除 8006 启动即可。
 */

const http = require('http');
const { fork } = require('child_process');
const path = require('path');
const BASE = __dirname;

const PRIMARY_PORT = parseInt(process.env.PORT || '8005', 10);
const LEGACY_PORT = parseInt(process.env.LEGACY_PORT || '8006', 10);

console.log('========================================');
console.log('  eCompany Dual Engine Bridge');
console.log('  Primary (new):  0.0.0.0:' + PRIMARY_PORT);
console.log('  Legacy (old):   0.0.0.0:' + LEGACY_PORT);
console.log('========================================');

// ===== 启动新引擎（主） =====
try {
  const serverCore = require('./server-core');
  console.log('[Bridge] Server-core loaded (primary on port ' + PRIMARY_PORT + ')');
} catch(e) {
  console.log('[Bridge] Server-core not available:', e.message);
}

// ===== 启动旧引擎（辅，端口偏移） =====
const legacyPort = LEGACY_PORT;
const child = fork(path.join(BASE, 'server-modern.js'), [], {
  env: { ...process.env, PORT: String(legacyPort) },
  stdio: 'inherit',
  detached: false
});

child.on('error', (err) => {
  console.error('[Bridge] Legacy server error:', err.message);
});

child.on('exit', (code) => {
  console.log('[Bridge] Legacy server exited with code:', code);
  // 不重启——迁移完成后不再需要
});

console.log('[Bridge] Legacy server PID:', child.pid, 'on port', legacyPort);

// 健康检查：定期确认两个服务都在运行
setInterval(() => {
  if (!child || !child.connected || child.killed) {
    console.error('[Bridge] Legacy server is down!');
  }
}, 30000).unref();

console.log('[Bridge] Dual engine running. Migrate routes from 8006 → 8005 as completed.\n');
