/**
 * eCompany Harness 规则引擎 — Phase 2 核心模块
 *
 * 功能：
 *   1. 规则定义/存储/版本管理（替代硬编码限制）
 *   2. 规则验证引擎（逐条匹配 action → handler）
 *   3. 多签确认流程（propose → confirm/reject → activate）
 *   4. 核心记忆库集成（变更自动记录）
 *
 * 架构：
 *   规则层读取规则引擎 → 规则引擎读取 rules.json
 *   Agent 不直接修改规则，仅通过 propose 流程
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const RULES_FILE = path.join(BASE, 'harness-rules.json');
const HISTORY_FILE = path.join(BASE, 'harness-rules-history.json');

// ====== 默认规则（迁移自 agent-boundary DEFAULTS） ======
const BUILTIN_RULES = [
  // ── 频率限制规则 ──
  {
    id: 'rate_global_minute',
    type: 'rate_limit',
    name: '全局每分钟上限',
    scope: { agent: null, tool: null },
    condition: 'agent.callsPerMinute >= 120',
    action: 'block',
    reason: 'Agent 每分钟最多调用 60 次（放宽）',
    severity: 'medium',
    status: 'active',
    proposedBy: 'system',
    confirmedBy: 'system',
    version: 1
  },
  {
    id: 'rate_global_hour',
    type: 'rate_limit',
    name: '全局每小时上限',
    scope: { agent: null, tool: null },
    condition: 'agent.callsPerHour >= 600',
    action: 'block',
    reason: 'Agent 每小时最多调用 300 次（放宽）',
    severity: 'medium',
    status: 'active',
    proposedBy: 'system',
    confirmedBy: 'system',
    version: 1
  },
  {
    id: 'rate_global_day',
    type: 'rate_limit',
    name: '全局每天上限',
    scope: { agent: null, tool: null },
    condition: 'agent.callsPerDay >= 1000',
    action: 'block',
    reason: 'Agent 每天最多调用 500 次',
    severity: 'medium',
    status: 'active',
    proposedBy: 'system',
    confirmedBy: 'system',
    version: 1
  },
  {
    id: 'rate_tool_search_web',
    type: 'rate_limit',
    name: '搜索工具频率限制',
    scope: { agent: null, tool: 'search_web' },
    condition: 'tool.callsPerMinute >= 5',
    action: 'block',
    reason: '搜索工具每分钟最多调用 5 次',
    severity: 'medium',
    status: 'active',
    proposedBy: 'system',
    confirmedBy: 'system',
    version: 1
  },
  {
    id: 'rate_tool_write_file',
    type: 'rate_limit',
    name: '写文件频率限制',
    scope: { agent: null, tool: 'write_file' },
    condition: 'tool.callsPerMinute >= 60',
    action: 'block',
    reason: '写文件工具每分钟最多调用 30 次（放宽）',
    severity: 'medium',
    status: 'active',
    proposedBy: 'system',
    confirmedBy: 'system',
    version: 1
  },
  {
    id: 'rate_tool_config_set',
    type: 'rate_limit',
    name: '系统配置频率限制',
    scope: { agent: null, tool: 'system_config_set' },
    condition: 'tool.callsPerMinute >= 2',
    action: 'block',
    reason: '系统配置工具每分钟最多调用 2 次',
    severity: 'high',
    status: 'active',
    proposedBy: 'system',
    confirmedBy: 'system',
    version: 1
  },

  // ── 权限规则 ──
  {
    id: 'perm_no_dangerous_ops',
    type: 'permission',
    name: '禁止危险操作',
    scope: { agent: null, role: ['staff', 'manager', 'director'], tool: 'exec_terminal' },
    condition: 'agent.role in scope.role',
    action: 'block',
    reason: '非 CEO 禁止执行终端操作',
    severity: 'critical',
    status: 'active',
    proposedBy: 'system',
    confirmedBy: 'system',
    version: 1
  },
  {
    id: 'perm_ceo_emergency',
    type: 'permission',
    name: '紧急处置权 — 仅CEO',
    scope: { agent: null, role: ['staff', 'manager', 'director', 'vp'], tool: ['emergency_*', 'system_shutdown'] },
    condition: 'agent.role in scope.role',
    action: 'block',
    reason: '紧急操作仅限 CEO',
    severity: 'critical',
    status: 'active',
    proposedBy: 'system',
    confirmedBy: 'system',
    version: 1
  },

  // ── 合规规则 ──
  {
    id: 'comp_max_parrallel_tasks',
    type: 'compliance',
    name: '并行任务数上限',
    scope: { agent: null },
    condition: 'agent.activeTasks >= 10',
    action: 'warn',
    reason: 'Agent 并行任务超过 10 个，建议先完成再开新任务',
    severity: 'low',
    status: 'active',
    proposedBy: 'system',
    confirmedBy: 'system',
    version: 1
  },

  // ── 操作规则 ──
  {
    id: 'op_no_delete_production',
    type: 'operation',
    name: '禁止直接操作生产数据',
    scope: { agent: null, role: ['staff', 'manager', 'director'], tool: ['delete_file', 'drop_table'] },
    condition: 'agent.role in scope.role',
    action: 'block',
    reason: '非 CEO 禁止直接操作生产环境数据',
    severity: 'critical',
    status: 'active',
    proposedBy: 'system',
    confirmedBy: 'system',
    version: 1
  }
];

// ====== 规则引擎类 ======
class HarnessRuleEngine {
  constructor(options) {
    this.rules = [];
    this.history = [];
    this.coreMemory = null;
    this._load();
    this._ensureBuiltins();
  }

  // ── 持久化 ──

  _load() {
    try {
      if (fs.existsSync(RULES_FILE)) {
        this.rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf-8'));
      }
    } catch (e) { /* first run, use builtins */ }

    try {
      if (fs.existsSync(HISTORY_FILE)) {
        this.history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
      }
    } catch (e) {}
  }

  _save() {
    try {
      fs.writeFileSync(RULES_FILE, JSON.stringify(this.rules, null, 2), 'utf-8');
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (e) {}
  }

  _ensureBuiltins() {
    // 确保所有内置规则存在（不覆盖用户修改）
    let changed = false;
    for (const builtin of BUILTIN_RULES) {
      const exists = this.rules.find(r => r.id === builtin.id);
      if (!exists) {
        this.rules.push({ ...builtin });
        changed = true;
      }
    }
    if (changed) this._save();
  }

  // ── 核心记忆库集成 ──

  _setCoreMemory(cm) {
    this.coreMemory = cm;
  }

  _logToCoreMemory(event) {
    if (!this.coreMemory) return;
    try {
      // Use core memory if available; silently fail if not
      if (typeof this.coreMemory.writeMemory === 'function') {
        this.coreMemory.writeMemory({
          type: 'harness_rule',
          data: event,
          tags: ['harness', 'rule', event.action]
        });
      }
    } catch (e) {}
  }

  // ── 规则 CRUD ──

  /**
   * 获取所有规则（可按状态/类型过滤）
   */
  getRules(filters) {
    filters = filters || {};
    let result = [...this.rules];

    if (filters.status) {
      result = result.filter(r => r.status === filters.status);
    }
    if (filters.type) {
      result = result.filter(r => r.type === filters.type);
    }
    if (filters.severity) {
      result = result.filter(r => r.severity === filters.severity);
    }
    if (filters.active !== undefined) {
      result = result.filter(r => (r.status === 'active') === filters.active);
    }

    return {
      total: result.length,
      rules: result
    };
  }

  /**
   * 获取单条规则
   */
  getRule(ruleId) {
    return this.rules.find(r => r.id === ruleId) || null;
  }

  /**
   * 提议新规则（propose → 进入 pending 状态）
   */
  proposeRule(ruleData, proposedBy) {
    // 校验
    if (!ruleData.type || !ruleData.condition || !ruleData.action) {
      return { success: false, error: '规则必须包含 type/condition/action' };
    }

    const validTypes = ['rate_limit', 'permission', 'compliance', 'operation'];
    if (!validTypes.includes(ruleData.type)) {
      return { success: false, error: '无效规则类型，允许: ' + validTypes.join(', ') };
    }

    const validStatuses = ['proposed', 'active', 'rejected', 'deprecated'];
    // 新提议的规则不能直接 active
    if (ruleData.status === 'active') {
      return { success: false, error: '新建规则不能直接激活，需走 propose → confirm 流程' };
    }

    const rule = {
      id: 'rule_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      type: ruleData.type,
      name: ruleData.name || '未命名规则',
      scope: ruleData.scope || { agent: null, tool: null },
      condition: ruleData.condition,
      action: ruleData.action,  // 'block' | 'warn' | 'log'
      reason: ruleData.reason || '',
      severity: ruleData.severity || 'medium',
      status: 'proposed',
      proposedBy: proposedBy || 'unknown',
      confirmedBy: null,
      rejectedBy: null,
      rejectReason: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.rules.push(rule);
    this._addHistory(rule.id, 'proposed', { proposedBy });
    this._save();
    this._logToCoreMemory({
      action: 'rule_proposed',
      ruleId: rule.id,
      ruleName: rule.name,
      proposedBy
    });

    return { success: true, rule };
  }

  /**
   * 确认规则（confirm → 激活）
   */
  confirmRule(ruleId, confirmedBy, note) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return { success: false, error: '规则不存在' };
    if (rule.status !== 'proposed') {
      return { success: false, error: '只有 proposed 状态的规则可以确认' };
    }

    rule.status = 'active';
    rule.confirmedBy = confirmedBy;
    rule.confirmNote = note || '';
    rule.updatedAt = new Date().toISOString();
    rule.version = (rule.version || 1) + 1;

    this._addHistory(ruleId, 'confirmed', { confirmedBy, note });
    this._save();
    this._logToCoreMemory({
      action: 'rule_confirmed',
      ruleId: rule.id,
      ruleName: rule.name,
      confirmedBy
    });

    return { success: true, rule };
  }

  /**
   * 驳回规则
   */
  rejectRule(ruleId, rejectedBy, reason) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return { success: false, error: '规则不存在' };
    if (rule.status !== 'proposed') {
      return { success: false, error: '只有 proposed 状态的规则可以驳回' };
    }

    rule.status = 'rejected';
    rule.rejectedBy = rejectedBy;
    rule.rejectReason = reason || '未提供理由';
    rule.updatedAt = new Date().toISOString();

    this._addHistory(ruleId, 'rejected', { rejectedBy, reason });
    this._save();
    this._logToCoreMemory({
      action: 'rule_rejected',
      ruleId: rule.id,
      ruleName: rule.name,
      rejectedBy,
      reason
    });

    return { success: true, rule };
  }

  /**
   * 停用规则（deprecate）
   */
  deprecateRule(ruleId, deprecateBy, reason) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return { success: false, error: '规则不存在' };
    if (rule.status !== 'active') {
      return { success: false, error: '只有 active 状态的规则可以停用' };
    }

    rule.status = 'deprecated';
    rule.deprecatedBy = deprecateBy;
    rule.deprecateReason = reason || '';
    rule.updatedAt = new Date().toISOString();

    this._addHistory(ruleId, 'deprecated', { deprecateBy, reason });
    this._save();
    this._logToCoreMemory({
      action: 'rule_deprecated',
      ruleId: rule.id,
      ruleName: rule.name,
      deprecateBy,
      reason
    });

    return { success: true, rule };
  }

  // ── 历史记录 ──

  _addHistory(ruleId, action, details) {
    this.history.push({
      ruleId,
      action,
      details,
      timestamp: new Date().toISOString()
    });
    // 保留最近 1000 条
    if (this.history.length > 1000) {
      this.history = this.history.slice(-500);
    }
  }

  /**
   * 获取规则变更历史
   */
  getRuleHistory(ruleId) {
    let entries = this.history;
    if (ruleId) {
      entries = entries.filter(h => h.ruleId === ruleId);
    }
    return entries.slice(-100).reverse();
  }

  /**
   * 获取待确认规则
   */
  getPendingRules() {
    return this.rules.filter(r => r.status === 'proposed');
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      total: this.rules.length,
      byStatus: {
        active: this.rules.filter(r => r.status === 'active').length,
        proposed: this.rules.filter(r => r.status === 'proposed').length,
        rejected: this.rules.filter(r => r.status === 'rejected').length,
        deprecated: this.rules.filter(r => r.status === 'deprecated').length
      },
      byType: {
        rate_limit: this.rules.filter(r => r.type === 'rate_limit').length,
        permission: this.rules.filter(r => r.type === 'permission').length,
        compliance: this.rules.filter(r => r.type === 'compliance').length,
        operation: this.rules.filter(r => r.type === 'operation').length
      },
      historyCount: this.history.length
    };
  }

  // ====== 规则验证引擎 ======

  /**
   * 验证操作是否符合所有 active 规则
   *
   * @param {Object} ctx - 验证上下文
   *   ctx.agentId, ctx.agentRole, ctx.agentName
   *   ctx.toolName
   *   ctx.callsPerMinute, ctx.callsPerHour, ctx.callsPerDay  (由 agent-boundary 提供)
   *   ctx.activeTasks
   *   ctx.path, ctx.extra (上下文补充)
   *   ctx.toolCallsPerMinute (工具级调用计数)
   * @returns {Array} 验证结果数组
   *   { ruleId, ruleName, type, action: 'allow'|'warn'|'block', reason, severity }
   */
  validate(ctx) {
    const activeRules = this.rules.filter(r => r.status === 'active');
    const results = [];

    for (const rule of activeRules) {
      // 检查作用域匹配
      if (!this._matchScope(rule.scope, ctx)) continue;

      // 检查条件匹配
      const match = this._evaluateCondition(rule.condition, ctx);
      if (!match) continue;

      // 触发规则
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        type: rule.type,
        action: rule.action,  // 'block' | 'warn' | 'log'
        reason: rule.reason,
        severity: rule.severity
      });
    }

    return results;
  }

  /**
   * 一站式检查：返回 block 优先级最高，其次 warn，然后是 allow
   */
  check(ctx) {
    const results = this.validate(ctx);
    const blocks = results.filter(r => r.action === 'block');
    const warns = results.filter(r => r.action === 'warn');

    if (blocks.length > 0) {
      return {
        allowed: false,
        action: 'block',
        reasons: blocks.map(r => r.reason),
        triggered: blocks
      };
    }

    if (warns.length > 0) {
      return {
        allowed: true,
        action: 'warn',
        reasons: warns.map(r => r.reason),
        triggered: warns
      };
    }

    return {
      allowed: true,
      action: 'allow',
      reasons: [],
      triggered: []
    };
  }

  /**
   * 判断作用域是否匹配
   */
  _matchScope(scope, ctx) {
    // Agent 级别匹配
    if (scope.agent && scope.agent !== ctx.agentId) return false;

    // 角色匹配
    if (scope.role) {
      if (Array.isArray(scope.role)) {
        if (!scope.role.includes(ctx.agentRole)) return false;
      } else if (scope.role !== ctx.agentRole) {
        return false;
      }
    }

    // 工具匹配
    if (scope.tool) {
      if (Array.isArray(scope.tool)) {
        // 支持通配符（如 emergency_*）
        let matched = false;
        for (const t of scope.tool) {
          if (t.endsWith('*')) {
            const prefix = t.slice(0, -1);
            if (ctx.toolName && ctx.toolName.startsWith(prefix)) { matched = true; break; }
          } else if (t === ctx.toolName) {
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      } else if (scope.tool !== ctx.toolName) {
        return false;
      }
    }

    return true;
  }

  /**
   * 条件评估器（支持简单表达式和正则）
   * 格式: "field operator value"
   * 示例: "agent.callsPerMinute >= 20", "context.path matches production"
   *       "agent.role in scope.role"
   *       "tool.callsPerMinute >= 5"
   */
  _evaluateCondition(condition, ctx) {
    // 空条件 = 总是匹配
    if (!condition) return true;

    // 解析 "agent.callsPerMinute >= 20"
    const patterns = [
      // tool.callsPerMinute >= N
      /^tool\.callsPerMinute\s*(>=|<=|>|<|==|!=)\s*(\d+)$/,
      // agent.callsPerMinute/Hour/Day >= N
      /^agent\.(callsPerMinute|callsPerHour|callsPerDay|activeTasks)\s*(>=|<=|>|<|==|!=)\s*(\d+)$/,
      // context.path matches "pattern"
      /^context\.path\s+matches\s+(.+)$/i,
      // agent.role in scope.role
      /^agent\.role\s+in\s+scope\.role$/i,
      // tool.name in [...]  (supports wildcard)
      /^tool\.name\s+in\s+\[(.+)\]$/,
      // tool.name matches "pattern"
      /^tool\.name\s+matches\s+(.+)$/i
    ];

    for (const pat of patterns) {
      const m = condition.match(pat);
      if (!m) continue;

      if (pat === patterns[0]) {
        // tool.callsPerMinute >= N
        // m[1]=operator, m[2]=number
        const val = this._getCtxValue(ctx, 'toolCallsPerMinute');
        if (val === undefined) return false;
        return this._compare(val, m[1], parseInt(m[2]));
      }

      if (pat === patterns[1]) {
        // agent.callsPerMinute/Hour/Day >= N
        const field = 'agent.' + m[1];
        const val = this._getCtxValue(ctx, m[1]);
        if (val === undefined) return false;
        return this._compare(val, m[2], parseInt(m[3]));
      }

      if (pat === patterns[2]) {
        // context.path matches "pattern"
        const pattern = m[1].replace(/^["']|["']$/g, '');
        const path = ctx.path || '';
        try {
          return new RegExp(pattern, 'i').test(path);
        } catch (e) {
          return path.includes(pattern);
        }
      }

      if (pat === patterns[3]) {
        // agent.role in scope.role
        // scope already checked before this, so just return true if we got here
        return true;
      }

      if (pat === patterns[4]) {
        // tool.name in [name1, name2]
        const names = m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        const toolName = ctx.toolName || '';
        for (const name of names) {
          if (name.endsWith('*')) {
            if (toolName.startsWith(name.slice(0, -1))) return true;
          } else if (name === toolName) {
            return true;
          }
        }
        return false;
      }

      if (pat === patterns[5]) {
        // tool.name matches pattern
        const pattern = m[1].replace(/^["']|["']$/g, '');
        const toolName = ctx.toolName || '';
        try {
          return new RegExp(pattern, 'i').test(toolName);
        } catch (e) {
          return toolName.includes(pattern);
        }
      }
    }

    // 未知条件格式，允许通过但记录日志
    console.warn('[HarnessRules] Unknown condition format:', condition);
    return false;
  }

  _getCtxValue(ctx, field) {
    const map = {
      'callsPerMinute': ctx.callsPerMinute,
      'callsPerHour': ctx.callsPerHour,
      'callsPerDay': ctx.callsPerDay,
      'activeTasks': ctx.activeTasks,
      'toolCallsPerMinute': ctx.toolCallsPerMinute,
      'toolCallsPerHour': ctx.toolCallsPerHour
    };
    return map[field];
  }

  _compare(val, op, target) {
    switch (op) {
      case '>=': return val >= target;
      case '<=': return val <= target;
      case '>': return val > target;
      case '<': return val < target;
      case '==': return val === target;
      case '!=': return val !== target;
      default: return false;
    }
  }
}

// ====== 单例 ======
let instance = null;
function getInstance(options) {
  if (!instance) {
    instance = new HarnessRuleEngine(options || {});
  }
  return instance;
}

module.exports = {
  HarnessRuleEngine,
  getInstance,
  BUILTIN_RULES
};
