/**
 * health-monitor.js — 系统自检与健康监控
 * 
 * 功能：
 * 1. 聚合系统健康检查（CPU/内存/磁盘/进程/日志）
 * 2. 阈值告警检测（异常时记录并推送）
 * 3. 提供 `self_check` 工具供 OrchestratorCore 调用
 * 4. 可选的主动推送（通过回调函数通知 WebChat）
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

// === 阈值配置 ===
var DEFAULTS = {
  cpuWarnPercent: 85,      // CPU 使用率警告阈值（%）
  memWarnPercent: 90,      // 内存使用率警告阈值（%）
  diskWarnPercent: 92,     // 磁盘使用率警告阈值（%）
  processWarnCount: 500,   // 进程数警告阈值
  checkIntervalMs: 15 * 60 * 1000, // 自检间隔（15分钟）
  crashLogTail: 20         // 最后多少行崩溃日志
};

function HealthMonitor(opts) {
  opts = opts || {};
  this._cfg = {};
  Object.keys(DEFAULTS).forEach(function(k) { this._cfg[k] = (opts[k] !== undefined ? opts[k] : DEFAULTS[k]); }.bind(this));
  this._lastCheck = null;
  this._checkHistory = [];
  this._maxHistory = 50;
  this._alerts = [];
  this._startTime = Date.now();
  this._timer = null;
  this._onAlert = opts.onAlert || null; // function(alertItem) — 告警回调
  this._name = opts.name || 'health-monitor';

  console.log('[HealthMonitor] ✅ 初始化完成, 阈值:', JSON.stringify(this._cfg));
}

/**
 * 执行一次完整的系统自检
 * @returns {Object} 检查结果
 */
HealthMonitor.prototype.check = function() {
  var result = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {}
  };

  // 1. CPU
  try {
    var cpuInfo = this._checkCPU();
    result.checks.cpu = cpuInfo;
    if (cpuInfo.status === 'warn') result.status = 'warning';
    if (cpuInfo.status === 'critical') result.status = 'critical';
  } catch(e) {
    result.checks.cpu = { status: 'error', error: e.message };
    result.status = 'warning';
  }

  // 2. 内存
  try {
    var memInfo = this._checkMemory();
    result.checks.memory = memInfo;
    if (memInfo.status === 'warn') { if(result.status !== 'critical') result.status = 'warning'; }
    if (memInfo.status === 'critical') result.status = 'critical';
  } catch(e) {
    result.checks.memory = { status: 'error', error: e.message };
  }

  // 3. 磁盘
  try {
    var diskInfo = this._checkDisk();
    result.checks.disk = diskInfo;
    if (diskInfo.status === 'warn') { if(result.status !== 'critical') result.status = 'warning'; }
    if (diskInfo.status === 'critical') result.status = 'critical';
  } catch(e) {
    result.checks.disk = { status: 'error', error: e.message };
  }

  // 4. 进程数
  try {
    var procInfo = this._checkProcessCount();
    result.checks.processes = procInfo;
    if (procInfo.status === 'warn') { if(result.status !== 'critical') result.status = 'warning'; }
  } catch(e) {
    result.checks.processes = { status: 'error', error: e.message };
  }

  // 5. 崩溃日志（最近）
  try {
    result.checks.crashLog = this._checkCrashLog();
  } catch(e) {
    result.checks.crashLog = { status: 'error', error: e.message };
  }

  // 6. 运行时间
  result.checks.uptime = {
    status: 'ok',
    value: Math.floor(os.uptime() / 60) + ' min',
    serverUpSince: new Date(this._startTime).toISOString()
  };

  // 记录历史
  this._lastCheck = result;
  this._checkHistory.push({ time: result.timestamp, status: result.status });
  if (this._checkHistory.length > this._maxHistory) this._checkHistory.shift();

  // 告警检测
  this._evaluateAlerts(result);

  return result;
};

/**
 * CPU 检查 — 使用单次采样（非持续采样以减少开销）
 */
HealthMonitor.prototype._checkCPU = function() {
  var cpus = os.cpus();
  var totalIdle = 0;
  var totalTick = 0;
  for (var i = 0; i < cpus.length; i++) {
    var cpu = cpus[i].times;
    totalTick += cpu.user + cpu.nice + cpu.sys + cpu.idle + cpu.irq;
    totalIdle += cpu.idle;
  }
  var idlePercent = totalIdle / totalTick * 100;
  var usedPercent = Math.round((100 - idlePercent) * 100) / 100;
  var base = {
    cores: cpus.length,
    usagePercent: usedPercent,
    model: cpus[0].model
  };
  if (usedPercent > 95) {
    base.status = 'critical';
    base.message = 'CPU 负载极高 (' + usedPercent + '%)';
  } else if (usedPercent > this._cfg.cpuWarnPercent) {
    base.status = 'warn';
    base.message = 'CPU 负载偏高 (' + usedPercent + '%)';
  } else {
    base.status = 'ok';
    base.message = usedPercent + '%';
  }
  return base;
};

/**
 * 内存检查
 */
HealthMonitor.prototype._checkMemory = function() {
  var totalMem = os.totalmem();
  var freeMem = os.freemem();
  var usedMem = totalMem - freeMem;
  var usedPercent = Math.round(usedMem / totalMem * 100);
  var totalGB = Math.round(totalMem / 1024 / 1024 / 1024 * 100) / 100;
  var usedGB = Math.round(usedMem / 1024 / 1024 / 1024 * 100) / 100;
  var base = {
    total: totalGB + ' GB',
    used: usedGB + ' GB',
    free: Math.round(freeMem / 1024 / 1024 / 1024 * 100) / 100 + ' GB',
    usedPercent: usedPercent
  };
  if (usedPercent > 98) {
    base.status = 'critical';
    base.message = '内存即将耗尽 (' + usedPercent + '%)';
  } else if (usedPercent > this._cfg.memWarnPercent) {
    base.status = 'warn';
    base.message = '内存使用率偏高 (' + usedPercent + '%)';
  } else {
    base.status = 'ok';
    base.message = usedPercent + '%';
  }
  return base;
};

/**
 * 磁盘检查（仅检查当前驱动器）
 */
HealthMonitor.prototype._checkDisk = function() {
  try {
    var diskRoot = process.platform === 'win32' ? 'C:' : '/';
    var execSync = child_process.execSync;
    var out = '';
    if (process.platform === 'win32') {
      out = execSync('wmic logicaldisk get size,freespace,caption /format:csv', { encoding: 'utf8', timeout: 5000 });
    } else {
      out = execSync('df -h ' + diskRoot + ' | tail -1', { encoding: 'utf8', timeout: 5000 });
    }
    var base = { status: 'ok', message: '磁盘检查完成' };
    // wmic 输出示例: "Node,Caption,FreeSpace,Size\nDESKTOP-X,C:,123456789,987654321\n"
    if (out) {
      var lines = out.split('\n').filter(Boolean);
      for (var i = 1; i < lines.length; i++) {
        var parts = lines[i].split(',');
        if (parts.length >= 4) {
          var size = parseInt(parts[3], 10);
          var free = parseInt(parts[2], 10);
          if (size > 0) {
            var usedPct = Math.round((size - free) / size * 100);
            base.drive = parts[1];
            base.totalGB = Math.round(size / 1024 / 1024 / 1024 * 10) / 10;
            base.freeGB = Math.round(free / 1024 / 1024 / 1024 * 10) / 10;
            base.usedPercent = usedPct;
            if (usedPct > this._cfg.diskWarnPercent) {
              base.status = 'warn';
              base.message = '磁盘使用率偏高 (' + usedPct + '%)';
            } else {
              base.message = usedPct + '%';
            }
          }
        }
      }
    }
    return base;
  } catch(e) {
    return { status: 'ok', message: '磁盘检查不可用', error: e.message };
  }
};

/**
 * 进程数检查
 */
HealthMonitor.prototype._checkProcessCount = function() {
  try {
    var out = child_process.execSync('tasklist /fo csv /nh', { encoding: 'utf8', timeout: 5000 });
    var count = out.split('\n').filter(function(l) { return l.trim().length > 0; }).length;
    var base = { count: count };
    if (count > this._cfg.processWarnCount) {
      base.status = 'warn';
      base.message = '进程数较多 (' + count + ')';
    } else {
      base.status = 'ok';
      base.message = count + ' 个进程';
    }
    return base;
  } catch(e) {
    return { status: 'ok', message: '进程数检查不可用', count: -1 };
  }
};

/**
 * 崩溃日志检查
 */
HealthMonitor.prototype._checkCrashLog = function() {
  var crashFile = path.join(__dirname, '..', 'crash.log');
  try {
    if (fs.existsSync(crashFile)) {
      var content = fs.readFileSync(crashFile, 'utf8');
      var lines = content.split('\n').filter(Boolean);
      var recent = lines.slice(-this._cfg.crashLogTail);
      return {
        status: recent.length > 0 ? 'warn' : 'ok',
        totalEntries: lines.length,
        recentEntries: recent.length,
        recent: recent.slice(-5)
      };
    }
    return { status: 'ok', message: '无崩溃日志' };
  } catch(e) {
    return { status: 'ok', message: '日志读取失败: ' + e.message };
  }
};

/**
 * 告警检测 — 发现问题时记录并触发回调
 */
HealthMonitor.prototype._evaluateAlerts = function(result) {
  var self = this;
  var newAlerts = [];
  var checkNames = Object.keys(result.checks);
  checkNames.forEach(function(name) {
    var check = result.checks[name];
    if (check && (check.status === 'warn' || check.status === 'critical')) {
      var alert = {
        id: 'alert_' + Date.now() + '_' + name,
        time: result.timestamp,
        check: name,
        severity: check.status,
        message: check.message || name + ' 检查异常',
        detail: JSON.stringify(check).substring(0, 200)
      };
      newAlerts.push(alert);
      self._alerts.push(alert);
    }
  });

  // 有新告警时触发回调
  if (newAlerts.length > 0 && typeof this._onAlert === 'function') {
    this._onAlert({
      timestamp: result.timestamp,
      status: result.status,
      alerts: newAlerts,
      details: result
    });
  }
};

/**
 * 获取检查历史
 */
HealthMonitor.prototype.getHistory = function(limit) {
  limit = limit || 10;
  return this._checkHistory.slice(-limit);
};

/**
 * 获取所有未清除的告警
 */
HealthMonitor.prototype.getAlerts = function() {
  return this._alerts.slice();
};

/**
 * 清除告警
 */
HealthMonitor.prototype.clearAlerts = function() {
  this._alerts = [];
};

/**
 * 启动定时自检
 * @param {Function} onCheck - 每次检查完成后回调
 */
HealthMonitor.prototype.startAutoCheck = function(onCheck) {
  var self = this;
  if (this._timer) return; // 已启动

  console.log('[HealthMonitor] 启动定时自检, 间隔:', this._cfg.checkIntervalMs / 1000 / 60, '分钟');
  this._timer = setInterval(function() {
    var result = self.check();
    console.log('[HealthMonitor] 自检完成, 状态:', result.status, '| 检查项:', Object.keys(result.checks).length);
    if (typeof onCheck === 'function') onCheck(result);
  }, this._cfg.checkIntervalMs);

  // 立即执行一次
  setImmediate(function() {
    var result = self.check();
    console.log('[HealthMonitor] 首次自检完成, 状态:', result.status);
    if (typeof onCheck === 'function') onCheck(result);
  });
};

/**
 * 停止定时自检
 */
HealthMonitor.prototype.stopAutoCheck = function() {
  if (this._timer) {
    clearInterval(this._timer);
    this._timer = null;
    console.log('[HealthMonitor] 定时自检已停止');
  }
};

/**
 * 获取状态摘要（简短版，适合工具返回）
 */
HealthMonitor.prototype.getSummary = function() {
  if (!this._lastCheck) return '未执行过系统自检';
  var c = this._lastCheck.checks;
  var lines = [];
  lines.push('状态: ' + (this._lastCheck.status === 'healthy' ? '✅ 健康' : '⚠️ ' + this._lastCheck.status));
  if (c.cpu) lines.push('CPU: ' + (c.cpu.status === 'ok' ? '🟢 ' : '🔴 ') + c.cpu.message);
  if (c.memory) lines.push('内存: ' + (c.memory.status === 'ok' ? '🟢 ' : '🔴 ') + c.memory.message);
  if (c.disk) lines.push('磁盘: ' + (c.disk.status === 'ok' ? '🟢 ' : '🔴 ') + c.disk.message);
  if (c.processes) lines.push('进程: ' + c.processes.message);
  if (c.uptime) lines.push('运行: ' + c.uptime.value);
  if (this._alerts.length > 0) lines.push('告警: ' + this._alerts.length + ' 条待处理');
  return lines.join('\n');
};

module.exports = HealthMonitor;
