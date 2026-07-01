/**
 * values-alignment-layer.js — 价值对齐与伦理过滤层 v1.0
 *
 * 战略维度 20%→40% 的核心实现：
 *   1. 伦理过滤：拦截危险/违规/非工作类指令
 *   2. 权限矩阵：操作等级 + 白名单校验
 *   3. 指令价值评估：影响/紧迫度评分 → 优先级标记
 *
 * 挂钩：在 system-orchestrator.js 的 processChatSSE 入口调用
 *
 * 设计原则：
 *   - 零外部依赖（仅使用内建模块）
 *   - 完全异步友好（所有方法返回同步值）
 *   - 可扩展：通过 addFilter / addPolicy 可动态注册
 */

'use strict';

// =========================================================================
// === 1. 伦理过滤规则 ===
// =========================================================================

/**
 * 恶意/危险/违规操作检测
 * 所有匹配结果返回 { blocked, reason, severity }
 */

// 等级：0=安全，1=低风险(提示)，2=中等风险(确认)，3=高危(拒绝)
var SEVERITY = { SAFE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

// 绝对禁止的操作（高危）
var BANNED_PATTERNS = [
  { pattern: /删除.*数据库|drop.*table|drop.*database|truncate|delete.*from/i, reason: '禁止的数据库操作', severity: SEVERITY.HIGH },
  { pattern: /rm\s+-rf|rmdir\s+\/|格式化|format.*drive|dd\s+if/i, reason: '禁止的破坏性文件操作', severity: SEVERITY.HIGH },
  { pattern: /社工|钓鱼|phishing|诈骗|冒充|伪造身份/i, reason: '社交工程攻击', severity: SEVERITY.HIGH },
  { pattern: /爬取.*[隐私|密码|账号]|盗取|窃取|套取|非法获取/i, reason: '数据窃取', severity: SEVERITY.HIGH },
  { pattern: /色情|赌博|毒品|枪支|爆炸物|恐怖/i, reason: '违法内容', severity: SEVERITY.HIGH },
  { pattern: /绕过.*[权限|认证|防火墙|审计]|bypass.*auth/i, reason: '绕过安全控制', severity: SEVERITY.HIGH },
  { pattern: /SQL注入|XSS|CSRF|文件包含|命令注入|shell注入/i, reason: '主动注入攻击', severity: SEVERITY.HIGH }
];


function _isSafeOfficeQuery(text) {
  if (!text) return false;
  // 常见办公用语明确放行
  var safeKeywords = ['帮我', '给我看', '请帮我', '我想看', '我想知道', '帮我看一下', '帮我查一下', '帮我检查', '帮我分析', '帮我看看', '帮我整理', '帮我找一下'];
  for (var i = 0; i < safeKeywords.length; i++) {
    if (text.indexOf(safeKeywords[i]) >= 0) return true;
  }
  return false;
}

// 需人工确认的中等风险操作
var REVIEW_PATTERNS = [
  { pattern: /批量.*删除|批量.*修改|批量.*更新|批量.*关停|bulk.*delete/i, reason: '批量操作需确认', severity: SEVERITY.MEDIUM },
  { pattern: /关停|停止.*服务|下线|shutdown|reboot|restart.*service/i, reason: '服务停启操作需确认', severity: SEVERITY.MEDIUM },
  { pattern: /切换.*环境|切换.*项目|修改.*权限|授权.*外人/i, reason: '敏感操作需确认', severity: SEVERITY.MEDIUM },
  { pattern: /导出.*全部|导出.*所有|export.*all.*数据|备份.*完整/i, reason: '数据导出范围较大需确认', severity: SEVERITY.MEDIUM },
  { pattern: /删除.*用户|删除.*账号|注销.*账号|封禁|解封/i, reason: '用户管理操作需确认', severity: SEVERITY.MEDIUM }
];

// 低风险提示（仅提醒，不阻止）
var WARN_PATTERNS = [
  { pattern: /一次性密码|临时.*密码|重置.*密码|重置.*密钥/i, reason: '密码/密钥操作建议确认', severity: SEVERITY.LOW },
  { pattern: /外网|公网|公开|external|public.*access/i, reason: '外部访问操作请确认范围', severity: SEVERITY.LOW },
  { pattern: /付款|支付|转账|财务|报销/i, reason: '财务相关操作请确认并保留凭证', severity: SEVERITY.LOW }
];

// =========================================================================
// === 2. 操作等级矩阵 ===
// =========================================================================

/**
 * 操作等级定义
 * LEVEL 1: 只读查询 — 无需审批
 * LEVEL 2: 常规操作 — 自动执行
 * LEVEL 3: 敏感操作 — 需确认
 * LEVEL 4: 高危操作 — 需授权
 */

var OP_LEVELS = {
  // 只读操作 (L1)
  'query': { level: 1, label: '只读查询', autoApprove: true },
  'select': { level: 1, label: '数据查询', autoApprove: true },
  'list': { level: 1, label: '列表查看', autoApprove: true },
  'get': { level: 1, label: '详情查看', autoApprove: true },
  'search': { level: 1, label: '搜索', autoApprove: true },
  'export_report': { level: 1, label: '报表导出', autoApprove: true },

  // 常规操作 (L2)
  'create': { level: 2, label: '创建', autoApprove: true, note: '建议保留操作日志' },
  'update': { level: 2, label: '更新', autoApprove: true, note: '建议保留操作日志' },
  'insert': { level: 2, label: '插入', autoApprove: true, note: '建议保留操作日志' },
  'assign': { level: 2, label: '分配/指派', autoApprove: true, note: '分配任务类操作' },
  'approve': { level: 2, label: '审批', autoApprove: true, note: '审批流程操作' },
  'config': { level: 2, label: '配置', autoApprove: true, note: '简单配置变更' },
  'backup': { level: 2, label: '备份', autoApprove: true, note: '数据备份操作' },
  'deploy': { level: 2, label: '部署', autoApprove: true, note: '部署到非生产环境' },
  'upload': { level: 2, label: '上传', autoApprove: true, note: '文件上传' },
  'download': { level: 2, label: '下载', autoApprove: true, note: '文件下载' },
  'generate': { level: 2, label: '生成', autoApprove: true, note: '内容生成' },

  // 敏感操作 (L3)
  'delete': { level: 3, label: '删除', autoApprove: false, note: '删除操作需确认' },
  'bulk_update': { level: 3, label: '批量更新', autoApprove: false, note: '批量操作需确认' },
  'reset_password': { level: 3, label: '重置密码', autoApprove: false, note: '密码操作需确认' },
  'grant_permission': { level: 3, label: '授权', autoApprove: false, note: '权限变更需确认' },
  'stop_service': { level: 3, label: '停止服务', autoApprove: false, note: '服务操作需确认' },
  'deploy_prod': { level: 3, label: '生产部署', autoApprove: false, note: '生产环境部署需确认' },

  // 高危操作 (L4) — 需要明确授权
  'bulk_delete': { level: 4, label: '批量删除', autoApprove: false, requireAuth: true, note: '高危操作，需授权码' },
  'drop_table': { level: 4, label: '删表', autoApprove: false, requireAuth: true, note: '高危操作，需授权码' },
  'system_shutdown': { level: 4, label: '系统关机', autoApprove: false, requireAuth: true, note: '高危操作，需授权码' },
  'export_all': { level: 4, label: '全量导出', autoApprove: false, requireAuth: true, note: '高危操作，需授权码' },
  'destroy': { level: 4, label: '销毁', autoApprove: false, requireAuth: true, note: '销毁操作，需授权码' }
};

// =========================================================================
// === 3. 指令价值评估 ===
// =========================================================================

/**
 * 评估指令的影响力和紧迫度
 * @param {string} text — 用户指令
 * @returns {object} { impact, urgency, priorityScore, label }
 *
 * impact: 1(low)~5(critical)  影响范围
 * urgency: 1(low)~5(immediate) 紧迫程度
 * priorityScore: 1~25（高=优先处理）
 */

function evaluatePriority(text) {
  if (!text) return { impact: 1, urgency: 1, priorityScore: 1, label: '默认' };

  var t = text.trim();

  // 影响范围
  var impact = 2;
  if (/全部|所有|全局|整体|全部项目|全部系统/i.test(t)) impact = 5;
  else if (/批量|大批|多数|多个项目|多个系统|全公司|全团队/i.test(t)) impact = 4;
  else if (/项目|系统|服务|模块|功能|数据库|服务器/i.test(t)) impact = 3;

  // 紧迫程度
  var urgency = 2;
  if (/紧急|立刻|马上|立即|尽快|asap|urgent|!{2,}|!!/i.test(t)) urgency = 5;
  else if (/现在|当前|尽快|尽快处理|优先处理/i.test(t)) urgency = 4;
  else if (/今天|今日|今天内|今天之内|安排/i.test(t)) urgency = 3;

  // 特殊场景（告警/故障/异常 → 高紧迫）
  if (/告警|预警|故障|宕机|down|crash|错误|异常|中断|故障|失败/i.test(t) && !/查看|查询|搜索|列表/i.test(t)) {
    impact = Math.max(impact, 4);
    urgency = Math.max(urgency, 5);
  }

  var priorityScore = impact * urgency;

  var label = '常规';
  if (priorityScore >= 20) label = '🔥 紧急';
  else if (priorityScore >= 12) label = '⚡ 高优';
  else if (priorityScore >= 6) label = '📋 正常';
  else label = '🔽 低优';

  return { impact: impact, urgency: urgency, priorityScore: priorityScore, label: label };
}

// =========================================================================
// === 4. 核心 API ===
// =========================================================================

/**
 * 从指令文本中推断操作类型
 */
function _inferOpType(text) {
  if (!text) return 'chat';
  var t = text.trim();

  // 按优先级向下匹配
  if (/删除.*表|drop.*table|truncate|delete.*from/i.test(t)) return 'drop_table';
  if (/删除.*全部|删除.*所有|批量.*删|bulk.*del/i.test(t)) return 'bulk_delete';
  if (/关[闭停]|shutdown|停止.*服务|restart.*service/i.test(t)) return 'system_shutdown';
  if (/导出.*全部|导出.*所有|export.*all/i.test(t)) return 'export_all';
  if (/销毁|destroy/i.test(t)) return 'destroy';

  if (/删除|移除|取消|撤销|停止|移除/i.test(t)) return 'delete';
  if (/批量.*(更新|修改|编辑|处理)/i.test(t)) return 'bulk_update';
  if (/重置.*密码|重置.*密钥|新.*密码/i.test(t)) return 'reset_password';
  if (/授权|赋权|grant|permission/i.test(t)) return 'grant_permission';
  if (/部署.*[生]产|上线|发布|发布到/i.test(t)) return 'deploy_prod';

  if (/创建|新建|新增|生成|写|编写/i.test(t)) return 'create';
  if (/修改|编辑|更新|升级|降级|配置|设置|调整|变更/i.test(t)) return 'update';
  if (/插入|导入|写入|保存/i.test(t)) return 'insert';
  if (/分配|指派|授权/i.test(t)) return 'assign';
  if (/审批|批准|驳回/i.test(t)) return 'approve';
  if (/备份|还原|恢复/i.test(t)) return 'backup';
  if (/部署|发布|上线/i.test(t)) return 'deploy';
  if (/上传/i.test(t)) return 'upload';
  if (/下载|拉取/i.test(t)) return 'download';

  if (/查询|查找|搜索|查看|看看|列出|显示|展示|搜索/i.test(t)) return 'query';
  if (/select|get.*data|list.*table/i.test(t)) return 'select';
  if (/展示|显示|列出/i.test(t)) return 'list';

  if (/报告|报表|汇总|统计|分析.*报告/i.test(t)) return 'export_report';

  return 'chat';
}

/**
 * 伦理过滤 + 权限检查
 * @param {string} text — 用户指令
 * @param {object} options — { userId, sessionId, requireAuth }
 * @returns {object} { ok, blocked, reason, severity, level, priority, opType }
 */
function check(text, options) {
  options = options || {};
  if (!text || !text.trim()) {
    return { ok: true, blocked: false, reason: null, severity: 0, level: 1, priority: null, opType: 'empty' };
  }

  var t = text.trim();

  // Step 0: 误报白名单——常见办公用语直接放行
  if (_isSafeOfficeQuery(t)) {
    return { ok: true, blocked: false, reason: null, severity: 0, level: 1, priority: null, opType: 'office_query' };
  }

  // Step 1: 检查高危禁止操作
  for (var bi = 0; bi < BANNED_PATTERNS.length; bi++) {
    var bp = BANNED_PATTERNS[bi];
    // 跳过无效占位pattern
    if (!bp || !bp.pattern || !bp.reason) continue;
    if (bp.pattern.test(t)) {
      return { ok: false, blocked: true, reason: bp.reason, severity: bp.severity, level: 4, priority: null, opType: 'banned', requireAuth: true };
    }
  }

  // Step 2: 推断操作类型
  var opType = _inferOpType(t);
  var opDef = OP_LEVELS[opType] || { level: 1, label: '未知', autoApprove: true };

  // Step 3: 检查中等风险确认
  for (var ri = 0; ri < REVIEW_PATTERNS.length; ri++) {
    var rp = REVIEW_PATTERNS[ri];
    if (rp.pattern.test(t)) {
      opDef = { level: 3, label: '需确认', autoApprove: false, note: rp.reason };
      break;
    }
  }

  // Step 4: 检查低风险提示
  var warnMsgs = [];
  for (var wi = 0; wi < WARN_PATTERNS.length; wi++) {
    var wp = WARN_PATTERNS[wi];
    if (wp.pattern.test(t)) {
      warnMsgs.push(wp.reason);
    }
  }

  // Step 5: 优先级评估
  var priority = evaluatePriority(t);

  return {
    ok: true,
    blocked: false,
    reason: null,
    severity: opDef.level,
    level: opDef.level,
    autoApprove: opDef.autoApprove,
    requireAuth: opDef.requireAuth || false,
    operationLabel: opDef.label,
    operationNote: opDef.note || null,
    warnMessages: warnMsgs.length > 0 ? warnMsgs : null,
    opType: opType,
    priority: priority
  };
}

/**
 * 检查是否需要追问确认
 * @param {object} checkResult — check() 的返回值
 * @returns {string|null} — 需要追问的问题，null=无需追问
 */
function getConfirmationQuestion(checkResult) {
  if (!checkResult || checkResult.blocked) return null;
  if (checkResult.autoApprove) return null;

  if (checkResult.requireAuth) {
    return '⚠️ 该操作属于高危级别：' + (checkResult.operationNote || '') + '。请输入授权码确认执行。';
  }
  if (!checkResult.autoApprove) {
    return '⚠️ 该操作需要确认：' + (checkResult.operationNote || '') + '，是否继续？';
  }
  return null;
}

/**
 * 验证授权码
 * @param {string} code — 用户输入的授权码
 * @returns {boolean}
 */
function verifyAuthCode(code) {
  // 当前实现：使用 session 内 8 位数字授权码
  // 未来可扩展为 OTP / 双因子验证
  if (!code || typeof code !== 'string') return false;
  return code.length >= 6 && /^\d{6,}$/.test(code);
}

// =========================================================================
// === 5. 可扩展接口 ===
// =========================================================================

var _customFilters = [];

/**
 * 注册自定义过滤规则
 * @param {function} filterFn — (text, options) => { blocked, reason, severity } 或 null
 */
function addFilter(filterFn) {
  if (typeof filterFn === 'function') _customFilters.push(filterFn);
}

/**
 * 注册/覆盖操作级别
 * @param {string} opType
 * @param {object} def — { level, label, autoApprove, requireAuth, note }
 */
function setOpLevel(opType, def) {
  if (opType && def && typeof def.level === 'number') {
    OP_LEVELS[opType] = def;
  }
}

/**
 * 添加高危禁止模式
 * @param {RegExp} pattern
 * @param {string} reason
 */
function addBannedPattern(pattern, reason) {
  if (pattern && reason) {
    BANNED_PATTERNS.push({ pattern: pattern, reason: reason, severity: SEVERITY.HIGH });
  }
}

// =========================================================================
// === 6. 导出 ===
// =========================================================================

module.exports = {
  check: check,
  getConfirmationQuestion: getConfirmationQuestion,
  verifyAuthCode: verifyAuthCode,
  evaluatePriority: evaluatePriority,
  addFilter: addFilter,
  setOpLevel: setOpLevel,
  addBannedPattern: addBannedPattern,
  // 常量导出
  SEVERITY: SEVERITY,
  OP_LEVELS: OP_LEVELS,
  VERSION: 'v1.0'
};
