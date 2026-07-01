/**
 * task-callback-hook.js — 任务完成回调钩子 v1.0
 * 
 * 当AI员工完成任务后，自动触发回调通知CEO。
 * 集成到 agent-executor.js 的 executeAgent 出口。
 * 
 * 回调链：任务完成 → 写通知日志 → 更新记忆库 → 通知CEO
 */

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const NOTIFY_LOG = path.join(BASE, 'logs', 'task-callbacks.log');
const NOTIFY_QUEUE = path.join(BASE, 'logs', 'ceo-notify-queue.json');

// 确保日志目录存在
const LOG_DIR = path.join(BASE, 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 任务完成回调 - 员工完成任务后调用
 * @param {Object} context - 任务上下文
 * @param {string} context.taskId - 任务ID
 * @param {string} context.agentId - 员工ID
 * @param {string} context.agentName - 员工名称
 * @param {string} context.taskTitle - 任务标题
 * @param {string} context.result - 执行结果（摘要）
 * @param {boolean} context.success - 是否成功
 * @param {number} context.durationMs - 执行耗时(毫秒)
 */
function onTaskComplete(context) {
  if (!context || !context.taskId) return;

  const entry = {
    taskId: context.taskId,
    agentId: context.agentId || 'unknown',
    agentName: context.agentName || 'Unknown',
    taskTitle: context.taskTitle || 'Untitled',
    success: context.success !== false,
    durationMs: context.durationMs || 0,
    completedAt: new Date().toISOString(),
    resultSummary: (context.result || '').substring(0, 200)
  };

  // 1. 写回调日志
  writeCallbackLog(entry);

  // 2. 推送CEO通知队列
  pushNotifyQueue(entry);

  // 3. 自动保存产出物到工作成果目录（兜底：不管agent有没有写文件，都保存finalReply）
  try {
    var resultText = context.result || '';
    if (resultText.length > 50) {
      var reportDir = path.join(BASE, '..', 'AI团队', '工作成果');
      if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
      var safeName = (context.taskTitle || 'task').replace(/[\\/:*?"<>|]/g, '_').substring(0, 30);
      var reportFile = path.join(reportDir, context.agentName + '-' + safeName + '-' + (context.taskId || '').substring(0, 8) + '.md');
      fs.writeFileSync(reportFile, '# ' + (context.taskTitle || '任务报告') + '\n\n**执行人：' + context.agentName + '** | **完成时间：' + entry.completedAt + '**\n\n---\n\n' + resultText, 'utf-8');
    }
  } catch(_ae) {}

  // 4. 写入CEO记忆库（简要记录）
  writeCEOMemory(entry);

  // 5. 【自动拉起审阅】如果完成者不是CEO，自动创建审阅任务分配给人CEO
  if (context.agentId && context.agentId !== 'ai_ceo' && context.agentId !== 'xiaolong') {
    autoCreateReviewTask(entry);
  }

  // 6. 自动触发知识进化 — 完成任务后提炼经验
  try {
    evolveFromTask(entry);
  } catch(e) {}

  // 7. WebSocket实时推送（通知CEO+工作台）
  try {
    if (global.__wsServer && global.__wsServer.broadcast) {
      var notifMsg = '【' + (entry.agentName || '员工') + '】完成「' + (entry.taskTitle || '任务') + '」' + (entry.success ? ' ✅' : ' ❌');
      global.__wsServer.broadcast('ceo', { type: 'ceo_message', source: 'task', message: notifMsg, timestamp: new Date().toISOString() });
      global.__wsServer.broadcast('agents', { type: 'agent_activity', agentId: entry.agentId || '', agentName: entry.agentName || '员工', action: '完成: ' + (entry.taskTitle || ''), taskId: entry.taskId });
    }
  } catch(e) {}

  return entry;
}

/**
 * 写回调日志（追加模式）
 */
function writeCallbackLog(entry) {
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(NOTIFY_LOG, line, 'utf-8');
  } catch(e) {
    // 静默失败，不影响主流程
  }
}

/**
 * 推送CEO通知队列
 */
function pushNotifyQueue(entry) {
  try {
    let queue = [];
    if (fs.existsSync(NOTIFY_QUEUE)) {
      const raw = fs.readFileSync(NOTIFY_QUEUE, 'utf-8');
      try { queue = JSON.parse(raw); } catch(e) { queue = []; }
    }
    
    // 去重：同一taskId不重复推送
    if (!queue.some(function(item) { return item.taskId === entry.taskId; })) {
      queue.push({
        type: 'task_completed',
        message: '【' + entry.agentName + '】完成任务「' + entry.taskTitle + '」',
        taskId: entry.taskId,
        agentName: entry.agentName,
        completedAt: entry.completedAt,
        status: 'unread'
      });
    }
    
    // 只保留最近200条
    if (queue.length > 200) queue = queue.slice(-200);
    
    fs.writeFileSync(NOTIFY_QUEUE, JSON.stringify(queue, null, 2), 'utf-8');
  } catch(e) {
    // 静默失败
  }
}

/**
 * 写入CEO记忆库
 */
function writeCEOMemory(entry) {
  try {
    const memPath = path.join(BASE, 'memory-ai_ceo.json');
    let mem = { decisions: [], notes: [], notifications: [] };
    
    if (fs.existsSync(memPath)) {
      const raw = fs.readFileSync(memPath, 'utf-8');
      try { mem = JSON.parse(raw); } catch(e) {}
    }
    
    if (!mem.notifications) mem.notifications = [];
    
    mem.notifications.push({
      type: 'task_completed',
      taskId: entry.taskId,
      agent: entry.agentName,
      title: entry.taskTitle,
      success: entry.success,
      time: entry.completedAt
    });
    
    if (mem.notifications.length > 200) mem.notifications = mem.notifications.slice(-200);
    
    fs.writeFileSync(memPath, JSON.stringify(mem, null, 2), 'utf-8');
  } catch(e) {
    // 静默失败
  }
}

/**
 * 获取待处理的通知队列（供CEO查阅）
 * @returns {Array} 未读通知列表
 */
function getPendingNotifications() {
  try {
    if (!fs.existsSync(NOTIFY_QUEUE)) return [];
    const raw = fs.readFileSync(NOTIFY_QUEUE, 'utf-8');
    const queue = JSON.parse(raw);
    return queue.filter(function(item) { return item.status === 'unread'; });
  } catch(e) {
    return [];
  }
}

/**
 * 标记通知为已读
 */
function markAsRead(taskId) {
  try {
    if (!fs.existsSync(NOTIFY_QUEUE)) return;
    const raw = fs.readFileSync(NOTIFY_QUEUE, 'utf-8');
    const queue = JSON.parse(raw);
    queue.forEach(function(item) {
      if (item.taskId === taskId) item.status = 'read';
    });
    fs.writeFileSync(NOTIFY_QUEUE, JSON.stringify(queue, null, 2), 'utf-8');
  } catch(e) {}
}

/**
 * 自动创建审阅任务
 * 员工完成任务后，自动创建一条审阅任务分配给小龙(CEO)
 */
function autoCreateReviewTask(entry) {
  try {
    var tasksFile = path.join(BASE, 'tasks.json');
    if (!fs.existsSync(tasksFile)) return;
    var tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
    
    var reviewTaskId = 'review_' + entry.taskId;
    
    // 去重：只要任务链上已经有了同源的审阅任务（包括嵌套），就不再创建
    // 检查任一任务 whose title 包含源任务标题，或 id/startsWith review_ + sourceTaskId
    var sourceId = entry.taskId;
    var hasExistingReview = tasks.some(function(t) {
      return (t.dependsOn === sourceId || t.id.indexOf('review_') === 0 && t.description && t.description.indexOf(sourceId) >= 0);
    });
    if (hasExistingReview) return;
    
    var reviewTask = {
      id: reviewTaskId,
      title: '【审阅】' + (entry.taskTitle || '任务'),
      description: '审阅来自 ' + (entry.agentName || entry.agentId) + ' 完成的工作「' + (entry.taskTitle || '') + '」。\n原始任务ID: ' + entry.taskId + '\n完成时间: ' + entry.completedAt + '\n\n审阅要点：\n1. 检查成果质量和完整性\n2. 确认是否符合预期\n3. 通过后归档至知识库\n\n审阅通过回复「审阅通过」，通过后系统自动归档。',
      status: 'pending',
      priority: 'high',
      assigneeId: 'xiaolong',
      dependsOn: entry.taskId,
      creator: 'system_auto_review',
      tags: ['review', 'auto_review'],
      sourceTaskTitle: entry.taskTitle || '',
      sourceAgentName: entry.agentName || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    tasks.push(reviewTask);
    fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), 'utf-8');
    
    // 自动关联任务到目标
    try {
      var sm = require('./shared-memory');
      if (sm && sm.autoMatchAndLinkTask) {
        // 关联审阅任务
        sm.autoMatchAndLinkTask(reviewTaskId, reviewTask.title);
        // 也关联原始任务（如果原始任务有关联价值）
        if (entry.taskId) {
          // 在 tasks.json 中给原始任务标记 goalId
          try {
            var rawTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
            var found = rawTasks.find(function(t) { return t.id === entry.taskId || t.taskId === entry.taskId; });
            if (found && found.title) {
              var gId = sm.autoMatchAndLinkTask(entry.taskId, found.title);
              if (gId) {
                found.goalId = gId;
                fs.writeFileSync(tasksFile, JSON.stringify(rawTasks, null, 2), 'utf8');
              }
            }
          } catch(e) {}
        }
      }
    } catch(e) {}
    
    // 同时写通知日志
    try {
      fs.appendFileSync(NOTIFY_LOG, '[AUTO_REVIEW] created review task ' + reviewTaskId + ' for ' + entry.agentName + '\n', 'utf-8');
    } catch(e) {}
    
    // WebSocket多频道广播：工作台实时通知 + CEO频道兼容
    try {
      if (global.__wsServer && global.__wsServer.broadcast) {
        var reviewMsg = '📋 子代理 ' + (entry.agentName || entry.agentId) + ' 已完成「' + (entry.taskTitle || '任务') + '」，请审阅';
        // 1. tasks频道 → 工作台任务列表更新
        global.__wsServer.broadcast(JSON.stringify({ channel: 'tasks', type: 'task_update', action: 'review_created', reviewTaskId: reviewTaskId, message: reviewMsg }));
        // 2. channel频道 → 工作台消息列表显示为系统消息
        global.__wsServer.broadcast(JSON.stringify({ channel: 'channel', type: 'channel_message', content: reviewMsg, from: '系统', timestamp: new Date().toISOString(), reviewTaskId: reviewTaskId }));
        // 3. notifications频道 → 通知角标闪烁
        global.__wsServer.broadcast(JSON.stringify({ channel: 'notifications', type: 'new_notification', notification: { title: '待审阅', message: reviewMsg, reviewTaskId: reviewTaskId, timestamp: new Date().toISOString() } }));
        // 4. 兼容旧版ceo频道
        global.__wsServer.broadcast('ceo', { type: 'ceo_message', source: 'system', message: reviewMsg, timestamp: new Date().toISOString(), reviewTaskId: reviewTaskId });
      }
    } catch(e) {}
    
    // 5. 同步写入 shared-memory goals（🎯 当前目标面板可见）
    try {
      var sm = require('./shared-memory');
      if (sm && sm.createGoal) {
        var gTitle = '[待审阅] ' + (entry.taskTitle || '任务');
        sm.createGoal(gTitle, '来自 ' + (entry.agentName || entry.agentId) + ' 的工作成果，自动创建审阅目标');
      }
    } catch(e) {}
    
    // 6. 主动推送到 WebChat 消息流
    try {
      var http = require('http');
      var reviewMsg2 = '📋 子代理 ' + (entry.agentName || entry.agentId) + ' 已完成【' + (entry.taskTitle || '任务') + '】，请审阅';
      var notifPayload = JSON.stringify({ content: reviewMsg2, from: '系统', timestamp: new Date().toISOString() });
      var pushReq = http.request({ hostname: '127.0.0.1', port: 8005, path: '/api/v4/channel/incoming', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(notifPayload) }, timeout: 3000 });
      pushReq.on('error', function() {});
      pushReq.write(notifPayload);
      pushReq.end();
    } catch(e) {}
    
  } catch(e) {
    console.error('[AutoReview] 创建审阅任务失败:', e.message);
  }
}

/**
 * 任务完成后的知识进化触发
 * 自动调用 Evolve 知识提炼接口
 */
function evolveFromTask(entry) {
  try {
    var http = require('http');
    var payload = JSON.stringify({
      taskId: entry.taskId,
      agentId: entry.agentId,
      description: entry.taskTitle,
      result: entry.resultSummary || '',
      success: entry.success
    });
    var req = http.request({
      hostname: '127.0.0.1',
      port: 8005,
      path: '/api/evolve/learn',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 5000
    });
    req.on('error', function() {});
    req.write(payload);
    req.end();
    console.log('[Evolve] 任务完成，自动触发知识进化: ' + entry.taskId);
  } catch(e) {
    console.log('[Evolve] 知识进化触发失败:', e.message);
  }
}

module.exports = {
  onTaskComplete: onTaskComplete,
  getPendingNotifications: getPendingNotifications,
  markAsRead: markAsRead
};
