/**
 * agent-brain.js — eCompany Agent 自主状态机 v1.0
 *
 * 核心设计：
 * - 每个 Agent 实例持有独立的状态机（内存中运行）
 * - 状态循环：IDLE → SENSING → REASONING → PLANNING → EXECUTING → REFLECTING → IDLE
 * - 内部定时心跳：空闲时每 60s 触发一次自省（极低成本，<100 tokens）
 * - LLM 每次调用必须输出 <thinking> 推理过程，让"意识"可见
 * - 工具调度从"用户触发"变为"AI 自主决策"
 *
 * 使用方式：
 *   const brain = require('./agent-brain');
 *   brain.init(agentId, agentInfo);
 *   brain.activate(agentId, userMessage);
 *   const result = await brain.tick(agentId, options);
 */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');

// ======================== 状态常量 ========================
const STATE = {
  IDLE:       'idle',        // 空闲/休眠
  SENSING:    'sensing',     // 感知：发生了什么？
  REASONING:  'reasoning',   // 推理：这意味着什么？我需要做什么？
  PLANNING:   'planning',    // 规划：具体怎么做？分几步？
  EXECUTING:  'executing',   // 执行：调用工具一步步做
  REFLECTING: 'reflecting',  // 反思：做完了吗？结果对吗？下一步？
};

// ======================== Agent 大脑实例池 ========================
// 每个 Agent 持有一个大脑实例，进程存活期间持续存在
const brains = {};

// ======================== 辅助函数 ========================
function loadMemory(agentId) {
  try {
    var f = path.join(BASE, 'memory', 'agent-' + agentId + '.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch(e) {}
  return { decisions: [], notes: [], status: 'idle', currentTask: null, lastActive: null, conversations: [] };
}

function saveMemory(agentId, mem) {
  try {
    var f = path.join(BASE, 'memory', 'agent-' + agentId + '.json');
    if (mem.conversations && mem.conversations.length > 200) mem.conversations = mem.conversations.slice(-200);
    fs.writeFileSync(f, JSON.stringify(mem, null, 2), 'utf-8');
  } catch(e) {}
}

// ======================== 大脑工厂 ========================
function createBrain(agentId, agentInfo) {
  var brain = {
    agentId: agentId,
    agentInfo: agentInfo || null,
    
    // === 状态 ===
    state: STATE.IDLE,
    previousState: STATE.IDLE,
    stateChangedAt: Date.now(),
    
    // === 工作存储 ===
    workingMemory: {
      currentThought: '',     // 当前思考内容
      actionPlan: [],         // 行动计划
      planIndex: 0,           // 执行到第几步
      toolResults: [],        // 工具执行结果
      conclusions: [],        // 反思结论
    },
    
    // === 持久上下文（每次tick都会回顾） ===
    persistentContext: {
      identity: '',           // 我是谁
      ongoingTasks: '',       // 我当前在做什么
      environment: '',        // 当前环境状况
    },
    
    // === 外部刺激队列 ===
    stimulations: [],         // 外部消息队列（用户消息、系统通知等）
    
    // === 定时自省 ===
    lastSelfCheck: 0,         // 上次自省时间戳
    selfCheckInterval: 60000, // 自省间隔(60s)
    
    // === 统计 ===
    stats: {
      totalTicks: 0,
      totalToolCalls: 0,
      lastActivity: null,
      activeTime: 0,
    },
  };
  _initBrainMethods(brain);
  return brain;
}

// ======================== 公共 API ========================

/**
 * 初始化 Agent 大脑
 */
function init(agentId, agentInfo) {
  if (!brains[agentId]) {
    brains[agentId] = createBrain(agentId, agentInfo);
    _initBrainMethods(brains[agentId]);
    // 加载持久记忆
    var mem = loadMemory(agentId);
    brains[agentId].persistentContext.ongoingTasks = mem.currentTask || '无';
    // 更新身份信息
    if (agentInfo) {
      brains[agentId].persistentContext.identity = 
        agentInfo.name_cn || agentInfo.name || agentId + 
        ' - ' + (agentInfo.title || '员工');
    }
    console.log('[AgentBrain] ' + agentId + ' 大脑初始化完成');
  }
  return brains[agentId];
}

/**
 * 获取大脑实例（自动初始化）
 */
function getBrain(agentId) {
  if (!brains[agentId]) {
    // 尝试获取 agent 信息
    var agentInfo = null;
    try {
      var raw = fs.readFileSync(path.join(BASE, 'agents.json'), 'utf-8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
      var agents = JSON.parse(raw);
      if (agents.agents) agents = agents.agents;
      for (var i = 0; i < agents.length; i++) {
        if (agents[i].id === agentId) { agentInfo = agents[i]; break; }
      }
    } catch(e) {}
    return init(agentId, agentInfo);
  }
  return brains[agentId];
}

/**
 * 向 Agent 大脑注入外部刺激（用户消息、系统通知等）
 */
function stimulate(agentId, message, source) {
  var brain = getBrain(agentId);
  brain.stimulations.push({
    message: message,
    source: source || 'user',
    time: Date.now(),
    processed: false,
  });
  // 自动唤醒（如果是空闲状态）
  if (brain.state === STATE.IDLE) {
    brain.state = STATE.SENSING;
    brain.stateChangedAt = Date.now();
    brain.previousState = STATE.IDLE;
  }
  return true;
}

/**
 * 大脑滴答——一个完整的思考-行动循环
 * 每次调用走一次状态转换
 * 返回：{ done, state, consciousness, output, toolCalls }
 */
async function tick(agentId, callAI, callAIWithTools, availableTools, options) {
  var brain = getBrain(agentId);
  if (!brain) throw new Error('Agent ' + agentId + ' 大脑未初始化');
  
  brain.stats.totalTicks++;
  brain.agentInfo = brain.agentInfo || (options && options.agentInfo) || null;
  brain.stats.lastActivity = Date.now();
  
  var mem = loadMemory(agentId);
  var result = {
    done: false,
    state: brain.state,
    consciousness: '',  // 思维过程文本
    output: '',         // 输出内容（回复/报告）
    toolCalls: [],      // 本轮调用的工具
    nextState: '',
  };

  switch (brain.state) {
    
    // ============== IDLE — 空闲检查 ==============
    case STATE.IDLE:
      // 检查外部刺激
      if (brain.stimulations.length > 0) {
        // 有未处理的消息，进入感知
        brain._transitionTo(STATE.SENSING);
        result.nextState = STATE.SENSING;
      } else {
        // 无刺激：执行自省定时检查
        var now = Date.now();
        if (now - brain.lastSelfCheck > brain.selfCheckInterval) {
          brain.lastSelfCheck = now;
          // 极低成本自省
          brain._transitionTo(STATE.SENSING);
          result.nextState = STATE.SENSING;
          // 注入自省提示
          brain.stimulations.unshift({
            message: '[系统自动唤醒] 自省时刻到了。简要检查当前状态，确认是否有工作需要主动处理。如果一切正常，保持空闲。',
            source: 'system',
            time: now,
            processed: false,
          });
        } else {
          // 真正的空闲
          result.done = true;
          result.output = '[idle]';
      try { fs.writeFileSync('F:\\eCompanyClaw\\backend\\brain-debug.log', '[Brain DEBUG] Output: ' + (result.output || 'null').substring(0, 80) + '\n', {flag:'a'}); } catch(e){}        }
      }
      break;

    // ============== SENSING — 感知 ==============
    case STATE.SENSING: {
      // 收集所有未处理的刺激
      var pendingStims = brain.stimulations.filter(function(s) { return !s.processed; });
      
      // 构建感知 prompt
      var sensePrompt = '';
      if (pendingStims.length > 0) {
        sensePrompt = '## 📡 外部感知输入\n\n';
        pendingStims.forEach(function(s, i) {
          sensePrompt += '[' + (i + 1) + '] 来源: ' + s.source + '\n';
          sensePrompt += '消息: ' + (typeof s.message === 'string' ? s.message : JSON.stringify(s.message)) + '\n\n';
        });
      }
            sensePrompt += '\n请完成以下感知任务：\n';
      sensePrompt += '1. 输出 <thinking> 思考：用户发这条消息是什么意思？是日常聊天、提问、还是在下达指令？\n';
      sensePrompt += '2. 输出 [感知结论]：一句话总结你的判断\n';
      sensePrompt += '3. 输出 [行动判断]：ignore | reply | act\n';
      sensePrompt += '   - **ignore**：无需回复（系统消息/废话）\n';
      sensePrompt += '   - **reply**：需要回复但不需要工具（日常聊天、提问、讨论等）\n';
      sensePrompt += '   - **act**：用户明确要你做事（写代码、查资料、改配置等）\n';
      sensePrompt += '\n';
      sensePrompt += '**【严苛规则】**\n';
      sensePrompt += '- 纯聊天（哈喽、在吗、没事、你好、hi、随便看看）→ 选 **reply**\n';
      sensePrompt += '- 只有消息包含明确动作指令（帮、查、写、改、做、看、检查、执行）才选 **act**\n';
      sensePrompt += '- 其他一切→选 **reply**\n';
      sensePrompt += '严格来说，只有出现了"帮、查、写、改、做、看、检查、执行"这些动词时，才选 **act**。其他都是 reply。\n';      sensePrompt += '4. 输出 [最终回复]：如果判断为 reply，直接在这里写出给用户的简短回复（一句话足够）。如果判断为 act，不用写最终回复。\n';      var senseMessages = _buildSenseMessages(brain, mem, sensePrompt);
      
      var senseResult;
      try {
        senseResult = await callAI(senseMessages, options);
      } catch(e) {
        senseResult = '<thinking>感知失败: ' + e.message + '</thinking>\n[感知结论] 感知异常\n[行动判断] reply';
      }
      
      // 存储思考
      brain.workingMemory.currentThought = senseResult;
      result.consciousness = senseResult;
      
      // 标记刺激为已处理
      pendingStims.forEach(function(s) { s.processed = true; });
      
      // 根据感知判断决定下一步
      var actionJudgment = '';
      // 支持中文冒号和英文冒号: 【行动判断】：reply 或 [行动判断] reply
      var actMatch = senseResult.match(/\[行动判断\]\s*[：:]\s*(\w+)/);
      if (actMatch) actionJudgment = actMatch[1];
      // 也匹配不带冒号的格式
      if (!actionJudgment) {
        actMatch = senseResult.match(/\[行动判断\]\s*(\w+)/);
        if (actMatch) actionJudgment = actMatch[1];
      }
      
      // DEBUG: 记录感知结果
      try { fs.writeFileSync('F:\\eCompanyClaw\\backend\\brain-debug.log', '[Brain DEBUG] SENSE actionJudgment: ' + actionJudgment + '\n', {flag:'a'}); } catch(e){}
      try { fs.writeFileSync('F:\\eCompanyClaw\\backend\\brain-debug.log', '[Brain DEBUG] SENSE raw (first 300): ' + (senseResult || '').substring(0, 300) + '\n', {flag:'a'}); } catch(e){}
      
      if (actionJudgment === 'act') {
        // act 分支：标记为需要继续到旧模式处理（带工具），返回简短确认
        brain._transitionTo(STATE.IDLE);
        result.nextState = STATE.IDLE;
        result.done = true;
        result.actRequired = true;  // 标记需要旧模式实际执行
        // 从 options 中提取用户消息用于后续工具调用
        if (brain.currentInput) brain.workingMemory.actMessage = brain.currentInput;
        result.output = '';  // 空 output 让 _brainFinalOutput 为空，触发旧模式
      } else if (actionJudgment === 'reply') {
        // —— 日常对话/简单问答：直接从感知结果中提取回复，不走 REFLECTING ——
        // 感知结果中可能已经带了 finalReply，或者需要再调用一次 LLM 生成简短回复
        var finalSenseReply = '';
        var replyInSense = senseResult.match(/\[最终回复\]\s*[：:]\s*([\s\S]*?)(?=\[|$)/);
        if (!replyInSense) {
          replyInSense = senseResult.match(/\[最终回复\]\s*([\s\S]*?)(?=\[|$)/);
        }
        if (replyInSense) {
          finalSenseReply = replyInSense[1].trim();
          try { fs.writeFileSync('F:\\eCompanyClaw\\backend\\brain-debug.log', '[Brain] FINAL REPLY FROM SENSE: ' + finalSenseReply + '\n', {flag:'a'}); } catch(e){}
        } else {
          // 感知中没有最终回复，调一次 LLM 用自然简短风格回复
          var quickReplyMessages = _buildBaseMessages(brain, mem, '回复');
          quickReplyMessages.push({ role: 'user', content: '根据前面的判断，用户只是在日常聊天或简单提问。直接给一个简短、自然、像正常人一样的回复。一句话足够，不要列清单、不要长篇分析、不要汇报系统状态。' });
          try {
            var quickResult = await callAI(quickReplyMessages, options);
            // 去掉可能的 thinking 标签
            var thinkEnd = quickResult.lastIndexOf('</thinking>');
            finalSenseReply = thinkEnd >= 0 ? quickResult.substring(thinkEnd + 12).trim() : quickResult.trim();
            if (!finalSenseReply) finalSenseReply = quickResult.trim();
          } catch(e) {
            finalSenseReply = '收到';
          }
        }
        
        if (!finalSenseReply) finalSenseReply = '收到';
        
        result.output = finalSenseReply;
        result.consciousness = senseResult;
        brain.workingMemory.lastOutput = finalSenseReply;
        
        // 保存记忆
        mem.conversations.push({
          role: 'assistant',
          content: finalSenseReply,
          type: 'final_response',
          time: new Date().toISOString()
        });
        mem.lastActive = new Date().toISOString();
        saveMemory(agentId, mem);
        
        try { fs.writeFileSync('F:\\eCompanyClaw\\backend\\brain-debug.log', '[Brain] REPLY BRANCH: going to IDLE, output=' + (result.output || '').substring(0, 100) + '\n', {flag:'a'}); } catch(e){}
        brain._transitionTo(STATE.IDLE);
        result.nextState = STATE.IDLE;
        result.done = true;
      } else {
        // ignore：回到空闲
        brain._transitionTo(STATE.IDLE);
        result.nextState = STATE.IDLE;
        result.done = true;
      }
      
      // 写入记忆
      mem.conversations.push({
        role: 'assistant',
        content: senseResult,
        type: 'thinking_sense',
        time: new Date().toISOString()
      });
      if (mem.conversations.length > 200) mem.conversations = mem.conversations.slice(-200);
      mem.lastActive = new Date().toISOString();
      saveMemory(agentId, mem);
      
      result.done = true;
      break;
    }

    // ============== REASONING — 推理 ==============
    case STATE.REASONING: {
      // 基于感知进行深度推理
      var reasonPrompt = '## 🧠 深度推理\n\n';
      reasonPrompt += '上一步感知结果：\n';
      reasonPrompt += brain.workingMemory.currentThought;
      reasonPrompt += '\n\n现在进入深度推理阶段：\n';
      reasonPrompt += '1. 输出 <thinking> 深入思考：\n';
      reasonPrompt += '   - 用户真正需要什么？背后的意图是什么？\n';
      reasonPrompt += '   - 当前系统环境和上下文是什么？\n';
      reasonPrompt += '   - 有哪些可能的行动方案？各自的利弊？\n';
      reasonPrompt += '   - 我是否需要调工具？调哪些工具？顺序是什么？\n';
      reasonPrompt += '2. 输出 [推理结论]：你对当前情况的核心判断\n';
      reasonPrompt += '3. 输出 [需要规划]：true/false — 如果需要多步执行选true，简单回复选false\n';
      
      var reasonMessages = _buildReasonMessages(brain, mem, reasonPrompt);
      
      var reasonResult;
      try {
        reasonResult = await callAI(reasonMessages, options);
      } catch(e) {
        reasonResult = '<thinking>推理失败: ' + e.message + '</thinking>\n[推理结论] 默认处理\n[需要规划] false';
      }
      
      brain.workingMemory.currentThought = reasonResult;
      result.consciousness = reasonResult;
      
      var needPlan = reasonResult.indexOf('[需要规划] true') >= 0;
      
      if (needPlan) {
        brain._transitionTo(STATE.PLANNING);
        result.nextState = STATE.PLANNING;
      } else {
        brain._transitionTo(STATE.REFLECTING);
        result.nextState = STATE.REFLECTING;
        brain.workingMemory.conclusions = [reasonResult];
      }
      
      mem.conversations.push({
        role: 'assistant',
        content: reasonResult,
        type: 'thinking_reason',
        time: new Date().toISOString()
      });
      if (mem.conversations.length > 200) mem.conversations = mem.conversations.slice(-200);
      saveMemory(agentId, mem);
      
      result.done = true;
      break;
    }

    // ============== PLANNING — 规划 ==============
    case STATE.PLANNING: {
      // 生成行动计划
      var planPrompt = '## 📋 行动计划制定\n\n';
      planPrompt += '上一步推理结果：\n';
      planPrompt += brain.workingMemory.currentThought;
      planPrompt += '\n\n现在制定具体的行动计划：\n';
      if (availableTools && availableTools.length) {
        planPrompt += '\n可用工具列表：\n';
        availableTools.forEach(function(t) {
          planPrompt += '- ' + (t.name || t.id) + ': ' + (t.description || '').substring(0, 100) + '\n';
        });
      }
      planPrompt += '\n请输出：\n';
      planPrompt += '1. <thinking> 规划思考：分几步完成？每步用什么工具？预期结果是什么？\n';
      planPrompt += '2. [计划步骤]：按顺序列出每一步，格式为：\n';
      planPrompt += '  步骤1: { "工具名": "参数说明", "预期": "预期结果" }\n';
      planPrompt += '  步骤2: ...\n';
      planPrompt += '3. [计划总结]：一句话总结这个行动计划';
      
      var planMessages = _buildReasonMessages(brain, mem, planPrompt);
      
      var planResult;
      try {
        planResult = await callAI(planMessages, options);
      } catch(e) {
        planResult = '<thinking>规划失败: ' + e.message + '</thinking>\n[计划步骤] 无\n[计划总结] 规划异常';
      }
      
      brain.workingMemory.currentThought = planResult;
      brain.workingMemory.actionPlan = [planResult]; // 存储计划
      brain.workingMemory.planIndex = 0;
      result.consciousness = planResult;
      
      // 生成对用户友好的最终回复：从计划结果中提取关键内容，清理 thinking 标签
      var thinkEnd = planResult.lastIndexOf('</thinking>');
      var planBody = thinkEnd >= 0 ? planResult.substring(thinkEnd + 12).trim() : planResult.trim();
      // 如果清理后为空就用原始内容
      if (!planBody) planBody = planResult.trim();
      result.output = planBody;
      
      brain._transitionTo(STATE.EXECUTING);
      result.nextState = STATE.EXECUTING;
      
      mem.conversations.push({
        role: 'assistant',
        content: planResult,
        type: 'thinking_plan',
        time: new Date().toISOString()
      });
      if (mem.conversations.length > 200) mem.conversations = mem.conversations.slice(-200);
      saveMemory(agentId, mem);
      
      result.done = true;
      break;
    }

    // ============== EXECUTING — 执行 ==============
    case STATE.EXECUTING: {
      // 带工具调用的执行
      var execPrompt = '## 🛠️ 执行阶段\n\n';
      execPrompt += '当前计划回顾：\n';
      execPrompt += brain.workingMemory.currentThought;
      execPrompt += '\n\n上一步工具执行结果回顾：\n';
      if (brain.workingMemory.toolResults.length > 0) {
        brain.workingMemory.toolResults.slice(-3).forEach(function(r) {
          execPrompt += '- 工具: ' + r.name + ', 结果: ' + JSON.stringify(r.result).substring(0, 200) + '\n';
        });
      } else {
        execPrompt += '- 尚无工具调用\n';
      }
      
      execPrompt += '\n现在进入执行阶段：\n';
      execPrompt += '1. <thinking> 思考：现在需要做什么？当前进度如何？\n';
      execPrompt += '2. 如果需要调用工具，使用 tool_calls 格式调用\n';
      execPrompt += '3. 如果所有步骤都已完成，在回复中标注 [执行完毕] true\n';
      execPrompt += '4. 如果遇到无法解决的问题，标注 [执行阻塞] true 并说明原因\n';
      
      var execMessages = _buildExecMessages(brain, mem, execPrompt);
      
      var execResult;
      try {
        if (availableTools && availableTools.length) {
          execResult = await callAIWithTools(execMessages, availableTools, options);
        } else {
          var text = await callAI(execMessages, options);
          execResult = { content: text, tool_calls: [] };
        }
      } catch(e) {
        execResult = { content: '<thinking>执行失败: ' + e.message + '</thinking>\n[执行完毕] true\n[结果摘要] 执行过程中发生错误', tool_calls: [] };
      }
      
      result.consciousness = execResult.content || '';
      result.toolCalls = execResult.tool_calls || [];
      
      // 记录工具调用
      if (execResult.tool_calls && execResult.tool_calls.length) {
        brain.stats.totalToolCalls += execResult.tool_calls.length;
      }
      
      // 判断是否执行完毕
      var isDone = (execResult.content && execResult.content.indexOf('[执行完毕] true') >= 0) || 
                    !execResult.tool_calls || execResult.tool_calls.length === 0;
      
      if (isDone) {
        // 执行完毕或无需继续调工具
        brain.workingMemory.executionOutput = execResult;
        brain._transitionTo(STATE.REFLECTING);
        result.nextState = STATE.REFLECTING;
      } else {
        // 还有工具要调
        result.done = true;
      }
      
      break;
    }

    // ============== REFLECTING — 反思 ==============
    case STATE.REFLECTING: {

try { fs.writeFileSync('F:\\eCompanyClaw\\backend\\brain-debug.log', '[Brain DEBUG] ENTERED REFLECTING\n', {flag:'a'}); } catch(e){}
      // 反思与总结
      var reflectPrompt = '## 🔍 反思与总结\n\n';
      reflectPrompt += '刚刚完成的工作回顾：\n';
      
      var thoughtContent = brain.workingMemory.currentThought || '';
      reflectPrompt += '思考过程：' + thoughtContent.substring(0, 500) + '\n\n';
      
      if (brain.workingMemory.executionOutput) {
        reflectPrompt += '执行输出：' + JSON.stringify(brain.workingMemory.executionOutput).substring(0, 500) + '\n\n';
      }
      if (brain.workingMemory.toolResults.length > 0) {
        reflectPrompt += '工具执行结果：\n';
        brain.workingMemory.toolResults.slice(-5).forEach(function(r) {
          reflectPrompt += '- ' + r.name + ': ' + (r.result.success !== false ? '✅' : '❌') + ' ' + (r.result.message || r.result.content || '').substring(0, 100) + '\n';
        });
      }
      
      reflectPrompt += '\n现在进入反思阶段：\n';
      reflectPrompt += '1. <thinking> 反思：我完成得怎么样？用户的需求满足了吗？\n';
      reflectPrompt += '2. [反思结论]：对本次执行的整体评价\n';
      reflectPrompt += '3. [最终回复]：给用户/系统的最终回复内容\n';
      reflectPrompt += '4. [下一步建议]：应该继续做什么、等待还是回到空闲';
      
      var reflectMessages = _buildReasonMessages(brain, mem, reflectPrompt);
      
      var reflectResult;
      try {
        reflectResult = await callAI(reflectMessages, options);
      } catch(e) {
        reflectResult = '<thinking>反思异常: ' + e.message + '</thinking>\n[反思结论] 系统异常\n[最终回复] 抱歉，处理过程中遇到了技术问题\n[下一步建议] idle';
      }
      
      // 提取最终回复
      var finalReply = '';
      var replyMatch = reflectResult.match(/\[最终回复\]\s*([\s\S]*?)(?=\[下一步建议\]|$)/);
      if (replyMatch) finalReply = replyMatch[1].trim();
      if (!finalReply) finalReply = reflectResult;
      
      result.consciousness = reflectResult;
      result.output = finalReply;
      brain.workingMemory.lastOutput = finalReply;
      
      // 保存到记忆
      mem.conversations.push({
        role: 'assistant',
        content: finalReply,
        type: 'final_response',
        time: new Date().toISOString()
      });
      if (!mem.summary) mem.summary = '';
      mem.summary = '最后输出: ' + finalReply.substring(0, 100);
      mem.lastActive = new Date().toISOString();
      saveMemory(agentId, mem);
      
      // 回到空闲
      brain.workingMemory.currentThought = '';
      brain.workingMemory.executionOutput = null;
      brain._transitionTo(STATE.IDLE);
      result.nextState = STATE.IDLE;
      result.done = true;
      break;
    }
  }
  
  return result;
}

/**
 * 获取大脑当前状态和思考内容
 */
function getState(agentId) {
  var brain = brains[agentId];
  if (!brain) return { state: 'uninitialized' };
  return {
    agentId: agentId,
    state: brain.state,
    previousState: brain.previousState,
    stateChangedAt: brain.stateChangedAt,
    pendingStimulations: brain.stimulations.filter(function(s) { return !s.processed; }).length,
    totalTicks: brain.stats.totalTicks,
    totalToolCalls: brain.stats.totalToolCalls,
    lastActivity: brain.stats.lastActivity,
    identity: brain.persistentContext.identity,
    ongoingTasks: brain.persistentContext.ongoingTasks,
  };
}

/**
 * 强制重置大脑状态
 */
function reset(agentId) {
  var brain = brains[agentId];
  if (brain) {
    brain.state = STATE.IDLE;
    brain.previousState = STATE.IDLE;
    brain.stateChangedAt = Date.now();
    brain.workingMemory = {
      currentThought: '',
      actionPlan: [],
      planIndex: 0,
      toolResults: [],
      conclusions: [],
      executionOutput: null,
      lastOutput: '',
    };
    brain.stimulations = [];
    brain.stats.totalTicks = 0;
    brain.stats.totalToolCalls = 0;
  }
}

// ======================== 内部辅助方法 ========================
// （挂载到 brain 实例上）

function _initBrainMethods(brain) {
  brain._transitionTo = function(newState) {
    this.previousState = this.state;
    this.state = newState;
    this.stateChangedAt = Date.now();
  };
}

// ======================== 构建消息列表（各阶段专用） ========================

function _buildSenseMessages(brain, mem, prompt) {
  // 感知阶段也用极简 prompt（日常聊天模式），避免 LLM 被"工作上下文"影响
  var messages = _buildBaseMessages(brain, mem, '回复');
  messages.push({ role: 'user', content: prompt });
  return messages;
}function _buildReasonMessages(brain, mem, prompt) {
  var messages = _buildBaseMessages(brain, mem, '推理');
  messages.push({ role: 'user', content: prompt });
  return messages;
}

function _buildExecMessages(brain, mem, prompt) {
  var messages = _buildBaseMessages(brain, mem, '执行');
  messages.push({ role: 'user', content: prompt });
  return messages;
}

function _buildBaseMessages(brain, mem, stage) {
  var messages = [];
  
  // 系统角色定义
      // ----- 日常聊天用极简 prompt -----
  if (stage === '回复') {
    var chatPersona = (brain.persistentContext.identity || brain.agentId || 'AI').replace(/\s*[\-—]\s*.*$/, '');
    var chatPrompt = '你是' + chatPersona + '。\n';
    chatPrompt += '不用太正式，像朋友聊天那样回复就行。\n';
    chatPrompt += '规则：\n';
    chatPrompt += '- 🗣 聊天：简短回复就行。\n';
    chatPrompt += '- ❓ 提问：直接回答。\n';
    chatPrompt += '- 🔧 办事：先调用工具再做。\n';
    chatPrompt += '\n';
    chatPrompt += '**不要汇报系统状态，不要列能力清单。用户不问你就不说。**\n';
    chatPrompt += '\n当前时间: ' + new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}) + ' Asia/Shanghai';    messages.push({ role: 'system', content: chatPrompt });
    return messages;
  }
  
  // ----- 工作模式用完整 prompt -----
  var sysPrompt = '你是 ' + (brain.persistentContext.identity || brain.agentId || '一个AI助手') + '。\n';
  sysPrompt += '你是一个有正常判断力的 AI。能聊天、能回答问题、也能干活。\n';
  sysPrompt += '\n';
  sysPrompt += '## 判断规则\n';
  sysPrompt += '- 用户说"哈喽""在吗""没事""随便看看"之类的话 → 正常回复一句就好。\n';
  sysPrompt += '- 用户问问题（"今天几号""天气如何""这个方案怎么样"） → 用你的知识回答。\n';
  sysPrompt += '- 用户明确吩咐做事（"帮我看一下""写个代码""查一下端口"） → 想办法完成。\n';
  sysPrompt += '\n';
  sysPrompt += '## 最重要的两条\n';
  sysPrompt += '1. **不要汇报系统状态除非用户问**。用户说"哈喽"，你回"哈喽"就行，不用加"一切正常待命中"。\n';
  sysPrompt += '2. **不要主动展示能力清单**。用户没说"你能干嘛"，你就不用列你会什么。\n';
  sysPrompt += '\n';
  sysPrompt += '## 回复风格\n';
  sysPrompt += '- 日常聊天：简短、自然。像微信聊天的回复。\n';
  sysPrompt += '- 回答问题：直接回答，不要铺垫"让我查一下"。\n';
  sysPrompt += '- 干正事：认真分析、给出方案。\n';
  sysPrompt += '\n';
  sysPrompt += '## ⏰ 当前时间\n';
  sysPrompt += new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}) + ' Asia/Shanghai';
  
  // 仅在有任务上下文时才加
  if (brain.persistentContext.ongoingTasks && brain.persistentContext.ongoingTasks !== '无') {
    messages.push({ role: 'system', content: '【正在进行中的任务】' + brain.persistentContext.ongoingTasks });
  }
  
  // 对话历史（最近8条，限制上下文大小）
  var recentConvs = (mem.conversations || []).slice(-8);
  for (var i = 0; i < recentConvs.length; i++) {
    var c = recentConvs[i];
    if (c.role && c.content) {
      // 过滤掉思考类型的记录（只保留最终的 input/output）
      if (c.type === 'thinking_sense' || c.type === 'thinking_reason' || 
          c.type === 'thinking_plan') continue;
      messages.push({ role: c.role, content: String(c.content).substring(0, 2000) });
    }
  }
  
  return messages;
}
// ======================== 初始化所有大脑 ========================

function initAll() {
  try {
    var raw = fs.readFileSync(path.join(BASE, 'agents.json'), 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    var agents = JSON.parse(raw);
    if (agents.agents) agents = agents.agents;
    agents.forEach(function(a) {
      init(a.id, a);
    });
    console.log('[AgentBrain] 已初始化 ' + Object.keys(brains).length + ' 个 Agent 大脑');
  } catch(e) {
    console.error('[AgentBrain] 初始化失败:', e.message);
  }
}

// ======================== 模块导出 ========================

module.exports = {
  STATE: STATE,
  init: init,
  getBrain: getBrain,
  stimulate: stimulate,
  tick: tick,
  getState: getState,
  reset: reset,
  initAll: initAll,
};
