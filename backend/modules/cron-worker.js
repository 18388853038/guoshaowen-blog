/**
 * cron-worker.js — 精简版定时任务执行器
 *
 * 定位：只做定时重复的脏活（备份/巡检/日报），不碰任务分发。
 * 所有任务分发归CEO assign_task直派，cron-worker 只执行注册好的重复性定时任务。
 *
 * 启动：CEO 通过 /api/cron-worker/start 拉起
 * 停止：CEO 通过 /api/cron-worker/stop 停止
 * 注册：CEO 通过 /api/cron-worker/register 注册定时任务
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG = {
  port: 8005,           // 与主服务器同端口，通过路由区分
  cronFile: path.join(__dirname, '..', 'cron-jobs.json'),
  statusFile: path.join(__dirname, '..', 'cron-worker-status.json'),
  logFile: path.join(__dirname, '..', 'logs', 'cron-worker.log'),
};

// ========== 日志 ==========
function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(CONFIG.logFile, line + '\n', 'utf-8'); } catch(e) {}
}

// ========== CronWorker 类 ==========
class CronWorker {
  constructor() {
    this.interval = null;
    this.intervalMs = 30000;        // 每30秒检查一次任务
    this.running = false;
    this.stats = {
      startedAt: null,
      lastCheckAt: null,
      totalExecuted: 0,
      totalSkipped: 0,
      totalErrors: 0,
    };
    this.cycleCount = 0;
    this.jobs = [];
    this.loadJobs();
    this.loadStatus();
  }

  // ---- 持久化 ----
  loadJobs() {
    try {
      if (fs.existsSync(CONFIG.cronFile)) {
        this.jobs = JSON.parse(fs.readFileSync(CONFIG.cronFile, 'utf-8'));
      }
    } catch(e) {
      this.jobs = [];
    }
  }

  saveJobs() {
    try {
      fs.writeFileSync(CONFIG.cronFile, JSON.stringify(this.jobs, null, 2));
    } catch(e) {
      log('ERROR', '保存cron任务失败: ' + e.message);
    }
  }

  loadStatus() {
    try {
      if (fs.existsSync(CONFIG.statusFile)) {
        const s = JSON.parse(fs.readFileSync(CONFIG.statusFile, 'utf-8'));
        this.stats = s.stats || this.stats;
        this.cycleCount = s.cycleCount || 0;
      }
    } catch(e) {}
  }

  saveStatus() {
    try {
      fs.writeFileSync(CONFIG.statusFile, JSON.stringify({
        running: this.running,
        cycleCount: this.cycleCount,
        stats: this.stats,
      }, null, 2));
    } catch(e) {}
  }

  // ---- 启动/停止 ----
  start(intervalMs) {
    if (this.running) {
      log('WARN', 'cron-worker 已在运行');
      return false;
    }
    if (intervalMs) this.intervalMs = intervalMs;
    this.running = true;
    this.stats.startedAt = new Date().toISOString();
    this.saveStatus();

    // 立即检查一次
    this.cycle();

    // 定时检查
    this.interval = setInterval(() => this.cycle(), this.intervalMs);
    log('INFO', `cron-worker 已启动，检查间隔 ${this.intervalMs}ms，共 ${this.jobs.length} 个定时任务`);
    return true;
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
    this.saveStatus();
    log('INFO', 'cron-worker 已停止');
    return true;
  }

  getStatus() {
    return {
      running: this.running,
      cycleCount: this.cycleCount,
      stats: this.stats,
      jobs: this.jobs.map(j => ({
        id: j.id,
        name: j.name,
        schedule: j.schedule || j.cronExpr,
        enabled: j.enabled !== false,
        lastRun: j.lastRun || null,
        nextRun: j.nextRun || null,
        runCount: j.runCount || 0,
      })),
    };
  }

  // ---- Cron 解析（简易） ----
  getNextRunTime(cronExpr) {
    if (!cronExpr || typeof cronExpr !== 'string') return null;
    const now = new Date();
    const next = new Date(now);
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length < 2) return null;

    const minute = parts[0];
    const hour = parts[1];

    // 处理 "*/N" 模式
    if (minute.startsWith('*/')) {
      const iv = parseInt(minute.slice(2));
      if (iv > 0) {
        const r = now.getMinutes() % iv;
        next.setMinutes(now.getMinutes() + (iv - r));
        next.setSeconds(0);
        next.setMilliseconds(0);
        if (next <= now) next.setMinutes(next.getMinutes() + iv);
        return next.toISOString();
      }
    }

    // 固定分钟+小时模式: "M H * * *"
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
      const m = parseInt(minute), h = parseInt(hour);
      const dayMatch = parts[2] || '*';
      const monthMatch = parts[3] || '*';
      const dowMatch = parts[4] || '*';
      if (dayMatch === '*' && monthMatch === '*' && dowMatch === '*') {
        next.setHours(h, m, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        return next.toISOString();
      }
    }

    // 兜底：每30分钟
    const r2 = now.getMinutes() % 30;
    next.setMinutes(now.getMinutes() + (30 - r2));
    next.setSeconds(0);
    next.setMilliseconds(0);
    if (next <= now) next.setMinutes(next.getMinutes() + 30);
    return next.toISOString();
  }

  // ---- 检查并执行到时任务 ----
  cycle() {
    this.cycleCount++;
    this.stats.lastCheckAt = new Date().toISOString();
    const now = new Date();
    const triggered = [];

    for (const job of this.jobs) {
      if (job.enabled === false) continue;
      if (!job.nextRun) {
        job.nextRun = this.getNextRunTime(job.cronExpr || job.schedule);
        if (!job.nextRun) continue;
      }
      if (new Date(job.nextRun) <= now) {
        triggered.push(job);
        job.lastRun = now.toISOString();
        job.runCount = (job.runCount || 0) + 1;
        job.nextRun = this.getNextRunTime(job.cronExpr || job.schedule);
        this._executeJob(job);
      }
    }

    if (triggered.length > 0) {
      this.saveJobs();
      this.saveStatus();
    }
  }

  _executeJob(job) {
    const action = job.action || job.taskTemplate;

    // 内置动作
    if (typeof action === 'string' && (action === 'backup' || action === 'daily_report' || action === 'health_check')) {
      log('INFO', `执行定时任务 [${job.name}] action=${action}`);
      this._executeBuiltin(action, job).then(success => {
        if (success) {
          this.stats.totalExecuted++;
          log('INFO', `定时任务 [${job.name}] 执行成功`);
        } else {
          this.stats.totalErrors++;
          log('WARN', `定时任务 [${job.name}] 执行失败`);
        }
        this.saveStatus();
      });
      return;
    }

    // 自定义 HTTP 调用
    if (action && action.type === 'http') {
      log('INFO', `执行定时任务 [${job.name}] HTTP=>${action.url}`);
      this._executeHttp(action).then(success => {
        if (success) {
          this.stats.totalExecuted++;
          log('INFO', `定时任务 [${job.name}] HTTP执行成功`);
        } else {
          this.stats.totalErrors++;
          log('WARN', `定时任务 [${job.name}] HTTP执行失败`);
        }
        this.saveStatus();
      });
      return;
    }

    // 创建任务（旧格式兼容）：在 tasks.json 中插入一条待办，由 CEO 自己决定是否处理
    if (action && action.title) {
      log('INFO', `定时任务 [${job.name}] 创建待办: ${action.title}`);
      try {
        const tasksFile = path.join(__dirname, '..', 'tasks.json');
        let tasks = [];
        if (fs.existsSync(tasksFile)) {
          tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
        }
        const task = {
          id: 'cron_' + job.id + '_' + Date.now().toString(36),
          title: action.title,
          description: action.description || '',
          priority: action.priority || 'medium',
          tags: ['cron', 'auto'],
          source: 'cron',
          cronJobId: job.id,
          status: 'todo',
          createdAt: new Date().toISOString(),
        };
        tasks.push(task);
        fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
        this.stats.totalExecuted++;
        log('INFO', `定时任务 [${job.name}] 已创建待办: ${task.id}`);
      } catch(e) {
        this.stats.totalErrors++;
        log('ERROR', `定时任务 [${job.name}] 创建待办失败: ${e.message}`);
      }
      this.saveStatus();
      return;
    }

    // 未知类型，记日志
    log('WARN', `定时任务 [${job.name}] 未知动作类型，跳过`);
    this.stats.totalSkipped++;
  }

  // 内置动作执行
  async _executeBuiltin(action, job) {
    try {
      const url = `http://127.0.0.1:${CONFIG.port}`;
      const actions = {
        backup: `${url}/api/backup`,
        daily_report: `${url}/api/bi/report?type=daily`,
        health_check: `${url}/api/health`,
      };
      const targetUrl = actions[action];
      if (!targetUrl) return false;

      const res = await fetch(targetUrl, { timeout: 60000 });
      return res.ok;
    } catch(e) {
      log('ERROR', `内置动作 [${action}] 失败: ${e.message}`);
      return false;
    }
  }

  // HTTP 动作执行
  async _executeHttp(action) {
    try {
      const opts = {
        method: action.method || 'GET',
        headers: action.headers || { 'Content-Type': 'application/json' },
        timeout: action.timeout || 60000,
        body: action.body ? JSON.stringify(action.body) : undefined,
      };
      const res = await fetch(action.url, opts);
      return res.ok;
    } catch(e) {
      log('ERROR', `HTTP动作失败: ${e.message}`);
      return false;
    }
  }

  // ---- 注册/取消任务 ----
  registerJob(name, schedule, action, params) {
    const id = name.replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + Date.now().toString(36);
    const job = {
      id,
      name,
      cronExpr: schedule,
      enabled: true,
      action: action || {},
      params: params || {},
      runCount: 0,
      createdAt: new Date().toISOString(),
      nextRun: this.getNextRunTime(schedule),
    };
    this.jobs.push(job);
    this.saveJobs();
    log('INFO', `注册定时任务: ${name} (${schedule})`);
    return job;
  }

  removeJob(jobId) {
    const idx = this.jobs.findIndex(j => j.id === jobId);
    if (idx < 0) return false;
    this.jobs.splice(idx, 1);
    this.saveJobs();
    log('INFO', `删除定时任务: ${jobId}`);
    return true;
  }
}

// ========== 兼容层：旧的 _ps.scheduler API（proactive-scheduler 兼容接口）==========
// 旧代码通过 _ps.scheduler.listJobs / addJob / removeJob / loadTasks / saveTasks 等
// 调用下面的兼容对象，保证不破坏现有路由

const _compatScheduler = {
  // --- 任务管理 ---
  loadTasks() {
    try {
      const p = path.join(__dirname, '..', 'tasks.json');
      if (!require('fs').existsSync(p)) return [];
      return JSON.parse(require('fs').readFileSync(p, 'utf-8'));
    } catch(e) { return []; }
  },
  saveTasks(tasks) {
    try {
      require('fs').writeFileSync(
        path.join(__dirname, '..', 'tasks.json'),
        JSON.stringify(tasks, null, 2)
      );
    } catch(e) {
      log('ERROR', 'saveTasks兼容失败: ' + e.message);
    }
  },

  // --- Cron 任务 CRUD ---
  listJobs() {
    return cronWorker.jobs.map(j => ({
      id: j.id,
      name: j.name,
      cronExpr: j.cronExpr || j.schedule,
      enabled: j.enabled !== false,
      lastRun: j.lastRun || null,
      nextRun: j.nextRun || null,
      runCount: j.runCount || 0,
      createdAt: j.createdAt,
    }));
  },
  addJob(name, cronExpr, agentId, taskTemplate, options) {
    const job = cronWorker.registerJob(name, cronExpr, taskTemplate || { title: name }, options || {});
    return job;
  },
  removeJob(jobId) {
    return cronWorker.removeJob(jobId);
  },
  pauseJob(jobId) {
    const idx = cronWorker.jobs.findIndex(j => j.id === jobId);
    if (idx < 0) return false;
    cronWorker.jobs[idx].enabled = false;
    cronWorker.saveJobs();
    return true;
  },
  resumeJob(jobId) {
    const idx = cronWorker.jobs.findIndex(j => j.id === jobId);
    if (idx < 0) return false;
    cronWorker.jobs[idx].enabled = true;
    cronWorker.jobs[idx].nextRun = cronWorker.getNextRunTime(cronWorker.jobs[idx].cronExpr);
    cronWorker.saveJobs();
    return true;
  },

  // --- 状态 ---
  getStatus() {
    const s = cronWorker.getStatus();
    return {
      ...s,
      running: s.running,
      lastCycleAt: s.stats.lastCheckAt,
      totalDispatched: s.stats.totalExecuted,
      totalCompleted: s.stats.totalExecuted,
      totalFailed: s.stats.totalErrors,
      startedAt: s.stats.startedAt,
    };
  },

  // --- Heartbeat（旧接口，直接返回 OK）---
  reportHeartbeat(agentId, data) {
    return { ok: true, time: new Date().toISOString() };
  },
  getHeartbeatStatus() {
    return { onlineAgents: 0, totalTracked: 0, byStatus: {} };
  },
  getPriorityStats() {
    return { low: 0, medium: 0, high: 0, emergency: 0 };
  },

  // --- Workflow（已禁用）---
  createWorkflow(name, steps, priority) {
    return { tasks: [] };
  },
};

// 单例
const cronWorker = new CronWorker();

module.exports = {
  CronWorker,
  cronWorker,
  scheduler: _compatScheduler,  // 兼容旧代码 _ps.scheduler.*
};
