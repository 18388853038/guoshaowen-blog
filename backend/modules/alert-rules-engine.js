/**
 * modules/alert-rules-engine.js — 自动告警规则引擎 v1.0
 *
 * 功能：
 * 1. 告警规则注册/持久化（JSON 文件）
 * 2. 内置预置规则：CPU/内存/磁盘/错误率/路由错误/数据库健康/进程数
 * 3. 定时检查调度（启动时自动开始，可配置间隔）
 * 4. 打通 health-monitor → alerter → 通知通道
 * 5. 通过 executor-tools 暴露给小龙调用
 *
 * 使用方式：
 *   var rulesEngine = new AlertRulesEngine({ alerter, healthMonitor, intervalMs });
 *   rulesEngine.start();  // 自动开始定时检查
 *   rulesEngine.listRules();     // 查看所有规则
 *   rulesEngine.addRule({...});  // 添加自定义规则
 *   rulesEngine.setRuleEnabled('rule_cpu_high', false); // 禁用规则
 *
 * 依赖：
 *   - health-monitor.js（系统健康检查）
 *   - alerter.js（告警发送）
 *   - database.js（可选，用于查询错误统计）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============ 规则持久化路径 ============
const RULES_FILE = path.join(__dirname, '..', 'alert-rules.json');

// ============ 默认内置规则 ============
const BUILTIN_RULES = [
  {
    id: 'rule_cpu_high',
    name: 'CPU 使用率过高',
    metric: 'cpu_percent',
    condition: { operator: 'gt', value: 85 },
    severity: 'warning',
    description: 'CPU 使用率超过 85% 时告警',
    builtin: true,
    enabled: true,
    cooldownMs: 300000  // 5 分钟冷却
  },
  {
    id: 'rule_cpu_critical',
    name: 'CPU 使用率极高',
    metric: 'cpu_percent',
    condition: { operator: 'gt', value: 95 },
    severity: 'critical',
    description: 'CPU 使用率超过 95% 时紧急告警',
    builtin: true,
    enabled: true,
    cooldownMs: 60000
  },
  {
    id: 'rule_mem_high',
    name: '内存使用率过高',
    metric: 'mem_percent',
    condition: { operator: 'gt', value: 90 },
    severity: 'warning',
    description: '内存使用率超过 90% 时告警',
    builtin: true,
    enabled: true,
    cooldownMs: 300000
  },
  {
    id: 'rule_mem_critical',
    name: '内存使用率极高',
    metric: 'mem_percent',
    condition: { operator: 'gt', value: 97 },
    severity: 'critical',
    description: '内存使用率超过 97% 时紧急告警',
    builtin: true,
    enabled: true,
    cooldownMs: 60000
  },
  {
    id: 'rule_disk_full',
    name: '磁盘使用率过高',
    metric: 'disk_percent',
    condition: { operator: 'gt', value: 92 },
    severity: 'warning',
    description: '磁盘使用率超过 92% 时告警',
    builtin: true,
    enabled: true,
    cooldownMs: 600000  // 10 分钟
  },
  {
    id: 'rule_disk_critical',
    name: '磁盘即将写满',
    metric: 'disk_percent',
    condition: { operator: 'gt', value: 97 },
    severity: 'critical',
    description: '磁盘使用率超过 97% 时紧急告警',
    builtin: true,
    enabled: true,
    cooldownMs: 120000
  },
  {
    id: 'rule_process_high',
    name: '进程数过多',
    metric: 'process_count',
    condition: { operator: 'gt', value: 500 },
    severity: 'warning',
    description: '系统进程数超过 500 时告警',
    builtin: true,
    enabled: true,
    cooldownMs: 600000
  },
  {
    id: 'rule_health_status',
    name: '系统健康状态异常',
    metric: 'health_status',
    condition: { operator: 'ne', value: 'healthy' },
    severity: 'critical',
    description: '系统健康检查状态不为 healthy 时告警',
    builtin: true,
    enabled: true,
    cooldownMs: 60000
  }
];

/**
 * AlertRulesEngine — 告警规则引擎
 */
class AlertRulesEngine {
  /**
   * @param {Object} opts
   * @param {Object} opts.alerter  - 已初始化的 Alerter 实例
   * @param {Object} opts.healthMonitor - 已初始化的 HealthMonitor 实例
   * @param {number} opts.intervalMs - 检查间隔（默认 120 秒）
   * @param {Function} opts.getDatabase - 可选，返回 database 实例的函数
   * @param {Function} opts.getLogger - 可选，返回 logger 的函数
   */
  constructor(opts) {
    opts = opts || {};
    this._alerter = opts.alerter;
    this._healthMonitor = opts.healthMonitor;
    this._getDatabase = opts.getDatabase || null;
    this._getLogger = opts.getLogger || null;
    this._intervalMs = opts.intervalMs || 120000;  // 默认 2 分钟
    this._timer = null;
    this._lastFired = {};       // rule_id → last fired timestamp
    this._checkCount = 0;
    this._totalFired = 0;
    this._startTime = Date.now();
    this._isRunning = false;

    // 加载规则（合并内置 + 持久化自定义规则）
    this._rules = [];
    this._loadRules();

    // 合并内置规则（持久化中的自定义规则优先）
    this._mergeBuiltins();

    this._log('[AlertRulesEngine] ✅ 初始化完成, 规则数: ' + this._rules.length + ', 启用: ' + this._rules.filter(function(r){return r.enabled}).length);
  }

  // ==================== 内部日志 ====================
  _log(msg) {
    if (this._getLogger) {
      try { this._getLogger().log('[ARE] ' + msg); return; } catch(e) {}
    }
    console.log('[ARE] ' + msg);
  }

  // ==================== 规则持久化 ====================
  _loadRules() {
    try {
      var raw = fs.readFileSync(RULES_FILE, 'utf-8');
      var data = JSON.parse(raw);
      this._rules = data.rules || [];
      this._customRules = data.customRules || [];
      this._lastFired = data.lastFired || {};
      // 标记内置规则
      this._rules.forEach(function(r) {
        if (r.builtin === undefined) r.builtin = false;
      });
    } catch(e) {
      this._rules = [];
      this._customRules = [];
      this._lastFired = {};
    }
  }

  _saveRules() {
    try {
      fs.writeFileSync(RULES_FILE, JSON.stringify({
        rules: this._rules,
        customRules: this._customRules,
        lastFired: this._lastFired,
        updatedAt: new Date().toISOString()
      }, null, 2), 'utf-8');
    } catch(e) {
      this._log('⚠️ 规则持久化失败: ' + e.message);
    }
  }

  _mergeBuiltins() {
    // 对每个内置规则，如果用户没有自定义覆盖，则使用内置
    var existingIds = {};
    this._rules.forEach(function(r) { existingIds[r.id] = true; });

    BUILTIN_RULES.forEach(function(br) {
      if (!existingIds[br.id]) {
        this._rules.push(JSON.parse(JSON.stringify(br)));
      }
    }.bind(this));
  }

  /**
   * 重置内置规则到默认状态（但保留自定义规则）
   */
  resetBuiltins() {
    // 删除现有的内置规则
    this._rules = this._rules.filter(function(r) { return !r.builtin; });
    // 重新添加内置规则
    BUILTIN_RULES.forEach(function(br) {
      this._rules.push(JSON.parse(JSON.stringify(br)));
    }.bind(this));
    this._saveRules();
    this._log('🔄 内置规则已重置');
    return { ok: true, count: BUILTIN_RULES.length, message: '内置规则已重置' };
  }

  // ==================== 规则 CRUD ====================

  /**
   * 列出所有规则
   * @param {Object} filter - { enabled: true/false, severity: 'warning'|'critical' }
   */
  listRules(filter) {
    filter = filter || {};
    var rules = this._rules.map(function(r) {
      return {
        id: r.id,
        name: r.name,
        metric: r.metric,
        condition: r.condition,
        severity: r.severity,
        enabled: r.enabled,
        builtin: !!r.builtin,
        cooldownMs: r.cooldownMs,
        description: r.description,
        lastFired: this._lastFired[r.id] || null
      };
    }.bind(this));

    if (filter.enabled !== undefined) {
      rules = rules.filter(function(r) { return r.enabled === filter.enabled; });
    }
    if (filter.severity) {
      rules = rules.filter(function(r) { return r.severity === filter.severity; });
    }
    if (filter.metric) {
      rules = rules.filter(function(r) { return r.metric === filter.metric; });
    }

    return { ok: true, rules: rules, total: this._rules.length, enabled: this._rules.filter(function(r){return r.enabled}).length, disabled: this._rules.filter(function(r){return !r.enabled}).length };
  }

  /**
   * 添加自定义规则
   * @param {Object} rule
   * @param {string} rule.name - 规则名称
   * @param {string} rule.metric - 指标名（cpu_percent/mem_percent/disk_percent/process_count/health_status 等）
   * @param {Object} rule.condition - { operator: 'gt'|'lt'|'eq'|'ne', value: number|string }
   * @param {string} rule.severity - 'warning'|'critical'
   * @param {string} [rule.description] - 描述
   * @param {number} [rule.cooldownMs=300000] - 冷却时间
   */
  addRule(rule) {
    if (!rule.name || !rule.metric || !rule.condition) {
      return { ok: false, error: '缺少必填字段: name, metric, condition' };
    }
    if (['gt','lt','eq','ne'].indexOf(rule.condition.operator) < 0) {
      return { ok: false, error: 'condition.operator 必须为 gt/lt/eq/ne' };
    }

    var id = 'rule_custom_' + Date.now();
    var newRule = {
      id: id,
      name: rule.name,
      metric: rule.metric,
      condition: { operator: rule.condition.operator, value: rule.condition.value },
      severity: rule.severity || 'warning',
      builtin: false,
      enabled: rule.enabled !== false,
      cooldownMs: rule.cooldownMs || 300000,
      description: rule.description || rule.name,
      createdAt: new Date().toISOString()
    };

    this._rules.push(newRule);
    this._customRules.push(id);
    this._saveRules();
    this._log('➕ 自定义规则已添加: ' + id + ' (' + rule.name + ')');
    return { ok: true, rule: newRule };
  }

  /**
   * 更新规则（启用/禁用/修改参数）
   * @param {string} ruleId
   * @param {Object} patch - 要修改的字段
   */
  updateRule(ruleId, patch) {
    var rule = null;
    for (var i = 0; i < this._rules.length; i++) {
      if (this._rules[i].id === ruleId) { rule = this._rules[i]; break; }
    }
    if (!rule) return { ok: false, error: '规则不存在: ' + ruleId };

    var allowedFields = ['enabled', 'name', 'condition', 'severity', 'cooldownMs', 'description'];
    var changed = [];
    allowedFields.forEach(function(f) {
      if (patch[f] !== undefined) {
        rule[f] = patch[f];
        changed.push(f);
      }
    });

    this._saveRules();
    this._log('✏️ 规则已更新: ' + ruleId + ' (' + changed.join(', ') + ')');
    return { ok: true, changes: changed, rule: {
      id: rule.id, name: rule.name, enabled: rule.enabled,
      severity: rule.severity, metric: rule.metric
    }};
  }

  /**
   * 启用/禁用规则
   */
  setRuleEnabled(ruleId, enabled) {
    return this.updateRule(ruleId, { enabled: enabled });
  }

  /**
   * 删除规则（仅删除自定义规则）
   */
  removeRule(ruleId) {
    var idx = -1;
    for (var i = 0; i < this._rules.length; i++) {
      if (this._rules[i].id === ruleId) { idx = i; break; }
    }
    if (idx < 0) return { ok: false, error: '规则不存在: ' + ruleId };
    if (this._rules[idx].builtin) return { ok: false, error: '不能删除内置规则，请禁用它' };

    this._rules.splice(idx, 1);
    this._customRules = this._customRules.filter(function(id) { return id !== ruleId; });
    delete this._lastFired[ruleId];
    this._saveRules();
    this._log('🗑️ 规则已删除: ' + ruleId);
    return { ok: true, ruleId: ruleId, message: '规则已删除' };
  }

  // ==================== 引擎控制 ====================

  /**
   * 启动告警检查循环
   */
  start() {
    if (this._isRunning) return { ok: true, message: '引擎已在运行' };
    if (!this._alerter) return { ok: false, error: 'Alerter 未注入，无法启动' };

    this._isRunning = true;
    this._log('▶️ 启动告警规则引擎 (间隔: ' + (this._intervalMs / 1000) + 's)');

    // 立即执行一次
    setImmediate(function() {
      this._checkAllRules();
    }.bind(this));

    // 定时检查
    this._timer = setInterval(function() {
      this._checkAllRules();
    }.bind(this), this._intervalMs);

    return { ok: true, message: '告警规则引擎已启动', interval: this._intervalMs };
  }

  /**
   * 停止检查循环
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._isRunning = false;
    this._log('⏹️ 告警规则引擎已停止');
    return { ok: true, message: '引擎已停止' };
  }

  /**
   * 立即触发一次规则检查
   */
  checkNow() {
    return this._checkAllRules(true);
  }

  // ==================== 核心检查逻辑 ====================

  _checkAllRules(force) {
    this._checkCount++;
    var results = [];
    var fireCount = 0;
    var enabledRules = this._rules.filter(function(r) { return r.enabled; });

    // 收集当前系统数据
    var systemData = this._gatherSystemData();

    // 对每条规则执行检查
    enabledRules.forEach(function(rule) {
      var result = this._evaluateRule(rule, systemData);
      if (result.fired) {
        fireCount++;
        // 发送告警
        this._fireAlert(rule, result.currentValue, systemData);
      }
      results.push(result);
    }.bind(this));

    this._totalFired += fireCount;

    if (fireCount > 0) {
      this._log('🔔 检查完成: ' + enabledRules.length + ' 规则, ' + fireCount + ' 条触发');
    }

    return {
      ok: true,
      checked: enabledRules.length,
      fired: fireCount,
      totalFired: this._totalFired,
      checkId: this._checkCount,
      timestamp: new Date().toISOString(),
      results: results
    };
  }

  /**
   * 收集系统运行数据
   */
  _gatherSystemData() {
    var data = {
      cpu_percent: 0,
      mem_percent: 0,
      disk_percent: 0,
      process_count: 0,
      health_status: 'unknown',
      memory_free: 0,
      memory_total: 0,
      uptime_seconds: 0,
      error_rate: 0,
      db_healthy: true,
      timestamp: Date.now()
    };

    // 1. 从 health-monitor 获取数据
    try {
      if (this._healthMonitor && typeof this._healthMonitor.check === 'function') {
        var health = this._healthMonitor.check();

        // CPU
        if (health.checks && health.checks.cpu) {
          data.cpu_percent = health.checks.cpu.usagePercent || 0;
        }

        // 内存
        if (health.checks && health.checks.memory) {
          data.mem_percent = health.checks.memory.usagePercent || 0;
          data.memory_free = health.checks.memory.freeGB || 0;
          data.memory_total = health.checks.memory.totalGB || 0;
        }

        // 磁盘
        if (health.checks && health.checks.disk) {
          data.disk_percent = health.checks.disk.usagePercent || 0;
        }

        // 进程数
        if (health.checks && health.checks.processes) {
          data.process_count = health.checks.processes.count || 0;
        }

        // 整体状态
        data.health_status = health.status || 'unknown';
      }
    } catch(e) {
      this._log('⚠️ health-monitor 取数失败: ' + e.message);
    }

    // 2. 手动获取 OS 数据（保险，防止 health-monitor 返回空）
    try {
      var totalMem = os.totalmem();
      var freeMem = os.freemem();
      if (!data.mem_percent) {
        data.mem_percent = Math.round((1 - freeMem / totalMem) * 10000) / 100;
      }
      data.uptime_seconds = os.uptime();
    } catch(e) {}

    // 3. 数据库健康检查（如果有传入）
    if (this._getDatabase) {
      try {
        var db = this._getDatabase();
        if (db && typeof db.execute === 'function') {
          db.execute("SELECT 1 AS ping");
          data.db_healthy = true;
        }
      } catch(e) {
        data.db_healthy = false;
      }
    }

    return data;
  }

  /**
   * 评估单条规则
   */
  _evaluateRule(rule, systemData) {
    var currentValue = systemData[rule.metric];
    if (currentValue === undefined) {
      return { ruleId: rule.id, name: rule.name, evaluated: false, reason: '指标不可用: ' + rule.metric };
    }

    var cond = rule.condition;
    var isTriggered = false;

    switch (cond.operator) {
      case 'gt':
        isTriggered = currentValue > cond.value;
        break;
      case 'lt':
        isTriggered = currentValue < cond.value;
        break;
      case 'eq':
        isTriggered = currentValue === cond.value;
        break;
      case 'ne':
        isTriggered = currentValue !== cond.value;
        break;
      default:
        return { ruleId: rule.id, name: rule.name, evaluated: false, reason: '未知操作符: ' + cond.operator };
    }

    if (!isTriggered) {
      return { ruleId: rule.id, name: rule.name, evaluated: true, fired: false, currentValue: currentValue, operator: cond.operator, threshold: cond.value };
    }

    // 检查冷却期
    var lastFired = this._lastFired[rule.id] || 0;
    var now = Date.now();
    if (!isTriggered) {} // Keep variable used
    if (lastFired > 0 && (now - lastFired) < rule.cooldownMs) {
      return { ruleId: rule.id, name: rule.name, evaluated: true, fired: false, cooldown: true, remainingMs: rule.cooldownMs - (now - lastFired), currentValue: currentValue, operator: cond.operator, threshold: cond.value };
    }

    // 触发告警
    this._lastFired[rule.id] = now;
    this._saveRules();

    return {
      ruleId: rule.id,
      name: rule.name,
      evaluated: true,
      fired: true,
      currentValue: currentValue,
      operator: cond.operator,
      threshold: cond.value,
      severity: rule.severity,
      timestamp: now
    };
  }

  /**
   * 通过 Alerter 发送告警
   */
  _fireAlert(rule, currentValue, systemData) {
    if (!this._alerter || typeof this._alerter.sendAlert !== 'function') return;

    var valueStr = typeof currentValue === 'number' ? currentValue.toFixed(1) : String(currentValue);
    var thresholdStr = typeof rule.condition.value === 'number' ? rule.condition.value.toFixed(0) : String(rule.condition.value);

    var title = '🔔 ' + rule.name;
    var message = rule.description + ' | 当前值: ' + valueStr + ' (阈值: ' + thresholdStr + ')';
    if (!rule.description) {
      message = rule.metric + ' ' + this._operatorLabel(rule.condition.operator) + ' ' + thresholdStr + '，当前: ' + valueStr;
    }

    this._alerter.sendAlert({
      type: rule.id,
      severity: rule.severity,
      title: title,
      message: message,
      data: {
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        currentValue: currentValue,
        threshold: rule.condition.value,
        operator: rule.condition.operator,
        system: systemData
      }
    });

    this._log('🚨 [' + rule.severity.toUpperCase() + '] ' + title + ' → ' + message);
  }

  _operatorLabel(op) {
    var map = { gt: '>', lt: '<', eq: '=', ne: '!=' };
    return map[op] || op;
  }

  // ==================== 统计与状态 ====================

  /**
   * 获取引擎状态概览
   */
  getStatus() {
    var ruleSummary = { total: this._rules.length, enabled: 0, disabled: 0, builtin: 0, custom: 0 };
    this._rules.forEach(function(r) {
      if (r.enabled) ruleSummary.enabled++; else ruleSummary.disabled++;
      if (r.builtin) ruleSummary.builtin++; else ruleSummary.custom++;
    });

    return {
      ok: true,
      running: this._isRunning,
      intervalMs: this._intervalMs,
      uptime: Math.floor((Date.now() - this._startTime) / 1000) + 's',
      checkCount: this._checkCount,
      totalFired: this._totalFired,
      rules: ruleSummary,
      recentFired: this._getRecentFired(5)
    };
  }

  /**
   * 获取最近触发记录
   */
  _getRecentFired(limit) {
    if (!this._alerter) return [];
    try {
      var history = this._alerter.getHistory ? this._alerter.getHistory(limit) : [];
      return history.slice(0, limit).map(function(h) {
        return { id: h.id, type: h.type, severity: h.severity, title: h.title, ts: h.ts, delivered: h.delivered };
      });
    } catch(e) {
      return [];
    }
  }
}

module.exports = AlertRulesEngine;
module.exports.BUILTIN_RULES = BUILTIN_RULES;
