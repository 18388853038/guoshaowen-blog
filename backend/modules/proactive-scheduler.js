// proactive-scheduler.js — 被动模式版
// 不再自动拉取！由工作台 CEO 通过 requestPull('ceo') 触发
// 禁止 Harness/自检/定时器调用 AI
// 保留所有兼容方法（静默返回，不做实际 AI 调用）

const EventEmitter = require('events');
const path = require('path');

class ProactiveScheduler extends EventEmitter {
  constructor() {
    super();
    this.agents = [];
    this.tasks = [];
    this.running = false;
    this.cycleCount = 0;
    this.totalDispatched = 0;
    this.totalCompleted = 0;
    this.lastRequestTime = 0;
    this.execInProgressCooldown = {};
  }

  async initialize() {
    try {
      var tasksPath = path.resolve(__dirname, '..', 'tasks.json');
      if (require('fs').existsSync(tasksPath)) {
        var data = require('fs').readFileSync(tasksPath, 'utf-8');
        this.tasks = JSON.parse(data);
        console.log('[Scheduler] 加载 ' + this.tasks.length + ' 个现有任务');
        this._log('初始化完成，任务数: ' + this.tasks.length);
      }
    } catch (e) {
      console.error('[Scheduler] 初始化失败:', e.message);
    }
  }

  registerAgent(agent) {
    this.agents.push(agent);
  }

  getStatus() {
    var stats = {};
    this.tasks.forEach(function(t) {
      stats[t.status] = (stats[t.status] || 0) + 1;
    });
    return {
      enabled: false,
      cycleCount: this.cycleCount,
      totalDispatched: this.totalDispatched,
      totalCompleted: this.totalCompleted,
      agentCount: this.agents.length,
      taskStats: stats,
      totalTasks: this.tasks.length,
      mode: 'passive'
    };
  }

  _log(msg) {
    console.log('[Scheduler] ' + msg);
  }

  // === 唯一对外接口：由工作台 CEO 调用 ===
  async requestPull(requester) {
    if (requester !== 'ceo' && requester !== 'user') {
      this._log('拒绝拉取请求: 来源 "' + requester + '" 不被允许');
      return { pulled: 0, skipped: 0, reason: 'unauthorized_caller' };
    }
    this.cycleCount++;
    var now = Date.now();
    if (now - this.lastRequestTime < 30000) {
      return { pulled: 0, skipped: 0, reason: 'rate_limited' };
    }
    this.lastRequestTime = now;
    this._log('[requestPull] 来源: ' + requester + ', 调用 cycle #' + this.cycleCount);
    this.emit('request', requester);
    return { pulled: 0, skipped: 0, reason: 'accepted' };
  }

  // === 执行任务 ===
  async executeAgentTask(agentId, task) {
    try {
      var aePath = path.resolve(__dirname, '..', 'modules', 'agent-executor.js');
      if (!require('fs').existsSync(aePath)) {
        this._log('agent-executor 不存在:', agentId);
        return;
      }
      var ae = require(aePath);
      if (!ae || !ae.executeAgent) {
        this._log('agent-executor 未正确加载');
        return;
      }
      this._log('执行任务: ' + agentId + ' -> ' + (task.title || task.description || ''));
      this.execInProgressCooldown[task.id] = Date.now();
      await ae.executeAgent(agentId, task.description || task.title, task);
      this.totalDispatched++;
    } catch (e) {
      this._log('执行任务失败: ' + (e.message || e));
    }
  }

  async _execInProgressTasks(tasks) {
    var nowExec = Date.now();
    var inProgress = tasks.filter(function(t) {
      if (this.execInProgressCooldown && this.execInProgressCooldown[t.id]) {
        if (nowExec - this.execInProgressCooldown[t.id] < 300000) {
          return false;
        }
      }
      return t.status === 'in_progress';
    }.bind(this));
    if (!inProgress || inProgress.length === 0) return;
    this._log('发现 ' + inProgress.length + ' 个 in_progress 任务待重试');
    var executed = 0;
    for (var t of inProgress) {
      if (!this.running) break;
      try {
        await this.executeAgentTask(t.assignedTo, t);
        if (this.execInProgressCooldown) {
          this.execInProgressCooldown[t.id] = Date.now();
        }
        executed++;
      } catch (e) {
        this._log('重试失败: ' + (e.message || e));
      }
    }
    this._log('已重试 ' + executed + '/' + inProgress.length + ' 个任务');
  }

  // === 兼容方法（静默返回，不做实际 AI 调用） ===
  start(interval) {
    this._log('start() 被调用但已禁用');
    this.running = true;
    return { ok: true, mode: 'passive' };
  }

  stop() {
    this._log('stop() 被调用');
    this.running = false;
    return { ok: true };
  }

  async cycle() {
    this._log('cycle() 被调用但已禁用');
    return { pulled: 0, skipped: 0, reason: 'auto_disabled' };
  }

  reportHeartbeat(agentId, data) {
    this._log('[heartbeat] 收到: ' + agentId + ' (已记录，不触发拉取)');
    return { ok: true, recorded: true };
  }

  getHeartbeatStatus() {
    return { agents: [], lastHeartbeat: null, status: 'passive' };
  }

  getPriorityStats() {
    return { priority: 'none', mode: 'passive' };
  }

  createWorkflow(name, steps, priority) {
    this._log('createWorkflow 已禁用: ' + name);
    return { ok: false, error: 'auto_disabled' };
  }

  loadTasks() {
    return this.tasks || [];
  }

  saveTasks(tasks) {
    try {
      var tasksPath = path.resolve(__dirname, '..', 'tasks.json');
      require('fs').writeFileSync(tasksPath, JSON.stringify(tasks, null, 2), 'utf-8');
      this.tasks = tasks;
    } catch (e) {
      this._log('saveTasks 失败: ' + e.message);
    }
  }

  listJobs() {
    return [];
  }

  addJob() {
    this._log('addJob 已禁用');
    return { ok: false, error: 'auto_disabled' };
  }

  removeJob(id) {
    this._log('removeJob 已禁用: ' + id);
    return { ok: false, error: 'auto_disabled' };
  }

  pauseJob(id) {
    return { ok: false, error: 'auto_disabled' };
  }

  resumeJob(id) {
    return { ok: false, error: 'auto_disabled' };
  }

  setSessionManager(sm) {
    this._sessionManager = sm;
    this._log('sessionManager 已注入');
  }
}

// 导出单例
var scheduler = new ProactiveScheduler();

module.exports = { ProactiveScheduler, scheduler };
console.log('[ProactiveScheduler] 已启动（被动模式，仅响应 CEO requestPull）');
