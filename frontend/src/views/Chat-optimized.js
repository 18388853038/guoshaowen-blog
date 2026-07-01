// eCompanyClaw 对话窗口优化 - 消息处理逻辑
// 模仿QClaw的对话窗口风格

/**
 * 优化后的消息格式化函数
 * 将原始消息转换为QClaw风格的显示格式
 */
function formatMessageForDisplay(msg, agentInfo = {}) {
  const formatted = {
    id: msg.id || generateMessageId(),
    role: msg.role || 'user',
    type: msg.type || 'text',
    content: msg.content || '',
    time: formatTimestamp(msg.time || new Date().toISOString()),
    timestamp: msg.time || new Date().toISOString(),
    status: msg.status || 'done',
    _expanded: msg._expanded !== false
  };

  // 添加Agent信息
  if (msg.role === 'assistant' || msg.role === 'agent') {
    formatted.avatar = agentInfo.icon || '🤖';
    formatted.name = agentInfo.name_cn || agentInfo.name || 'AI助手';
    formatted.title = agentInfo.title || '';
  }

  // 处理特殊消息类型
  if (msg.type === 'tool_call') {
    formatted.toolName = msg.toolName || '未知工具';
    formatted.args = msg.args || {};
    formatted.summary = msg.summary || '';
    formatted.result = msg.result || null;
    formatted.status = msg.status || 'pending';
  }

  // 处理系统消息
  if (msg.role === 'system') {
    formatted.avatar = '📡';
    formatted.name = '系统';
  }

  return formatted;
}

/**
 * 时间戳格式化 - QClaw风格
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 1分钟内
  if (diff < 60000) {
    return '刚刚';
  }

  // 1小时内
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  }

  // 今天
  if (isSameDay(date, now)) {
    return formatTime(date, 'HH:mm');
  }

  // 昨天
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return `昨天 ${formatTime(date, 'HH:mm')}`;
  }

  // 今年
  if (date.getFullYear() === now.getFullYear()) {
    return formatTime(date, 'MM-DD HH:mm');
  }

  // 其他年份
  return formatTime(date, 'YYYY-MM-DD HH:mm');
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

function formatTime(date, pattern) {
  const map = {
    'YYYY': date.getFullYear(),
    'MM': String(date.getMonth() + 1).padStart(2, '0'),
    'DD': String(date.getDate()).padStart(2, '0'),
    'HH': String(date.getHours()).padStart(2, '0'),
    'mm': String(date.getMinutes()).padStart(2, '0'),
    'ss': String(date.getSeconds()).padStart(2, '0')
  };

  let result = pattern;
  for (const [key, value] of Object.entries(map)) {
    result = result.replace(key, value);
  }
  return result;
}

function generateMessageId() {
  return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Agent工作逻辑优化
 */
class AgentWorkOptimizer {
  constructor() {
    this.agents = new Map();
    this.currentAgent = null;
    this.workQueue = [];
  }

  /**
   * 注册Agent
   */
  registerAgent(agentId, agentInfo) {
    this.agents.set(agentId, {
      id: agentId,
      name: agentInfo.name_cn || agentInfo.name,
      icon: agentInfo.icon || '🤖',
      title: agentInfo.title || '',
      status: 'idle',
      currentTask: null,
      completedTasks: 0,
      skills: agentInfo.skills || []
    });
  }

  /**
   * 切换当前Agent
   */
  switchAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      console.error(`Agent ${agentId} not found`);
      return false;
    }

    this.currentAgent = agent;
    return true;
  }

  /**
   * 执行任务
   */
  async executeTask(task, context = {}) {
    if (!this.currentAgent) {
      throw new Error('No agent selected');
    }

    const taskId = generateMessageId();
    const startTime = Date.now();

    // 创建任务消息
    const taskMsg = {
      id: taskId,
      type: 'tool_call',
      toolName: task.tool || '任务',
      summary: task.description || task.query,
      args: task.args || {},
      status: 'running',
      time: new Date().toISOString(),
      agent: this.currentAgent.id
    };

    // 更新Agent状态
    this.currentAgent.status = 'working';
    this.currentAgent.currentTask = taskId;

    try {
      // 执行任务逻辑
      const result = await this.performTask(task, context);

      // 更新任务状态
      taskMsg.status = 'done';
      taskMsg.result = result;
      taskMsg.duration = Date.now() - startTime;

      // 更新Agent统计
      this.currentAgent.completedTasks++;
      this.currentAgent.status = 'idle';
      this.currentAgent.currentTask = null;

      return taskMsg;
    } catch (error) {
      taskMsg.status = 'error';
      taskMsg.result = error.message;
      taskMsg.duration = Date.now() - startTime;

      this.currentAgent.status = 'error';
      this.currentAgent.currentTask = null;

      throw error;
    }
  }

  /**
   * 实际执行任务
   */
  async performTask(task, context) {
    // 这里应该调用实际的API
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true, data: 'Task completed' });
      }, 1000);
    });
  }

  /**
   * 获取Agent状态
   */
  getAgentStatus(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    return {
      id: agent.id,
      name: agent.name,
      icon: agent.icon,
      status: agent.status,
      currentTask: agent.currentTask,
      completedTasks: agent.completedTasks
    };
  }

  /**
   * 批量处理消息
   */
  batchProcessMessages(messages, agentMap = {}) {
    return messages.map(msg => {
      const agentInfo = agentMap[msg.agentId] || {};
      return formatMessageForDisplay(msg, agentInfo);
    });
  }
}

/**
 * 打字动画效果
 */
class TypingAnimation {
  constructor() {
    this.isTyping = false;
    this.timeout = null;
  }

  start(text = '正在输入') {
    this.isTyping = true;
    this.text = text;
  }

  stop() {
    this.isTyping = false;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  getState() {
    return {
      isTyping: this.isTyping,
      text: this.isTyping ? this.text : ''
    };
  }
}

/**
 * 消息缓存管理
 */
class MessageCache {
  constructor(maxSize = 1000) {
    this.messages = [];
    this.maxSize = maxSize;
    this.compressedCount = 0;
  }

  add(message) {
    // 检查是否需要压缩
    if (this.messages.length >= this.maxSize) {
      this.compress();
    }

    this.messages.push(message);
  }

  compress() {
    const keepCount = 50;
    const toCompress = this.messages.slice(0, -keepCount);

    toCompress.forEach(msg => {
      if (!msg._compressed && msg.content && msg.content.length > 200) {
        msg._originalContent = msg.content;
        msg.content = msg.content.substring(0, 150) + '... [已压缩]';
        msg._compressed = true;
        this.compressedCount++;
      }
    });
  }

  getAll() {
    return this.messages;
  }

  clear() {
    this.messages = [];
    this.compressedCount = 0;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatMessageForDisplay,
    formatTimestamp,
    AgentWorkOptimizer,
    TypingAnimation,
    MessageCache
  };
}
