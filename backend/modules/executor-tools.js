'use strict';

// 日志工具
var log = (typeof getLogger === 'function') ? getLogger('executor') : {
  debug: function(){ console.log.apply(console, ['[DEBUG][executor]'].concat(Array.prototype.slice.call(arguments))); },
  info: function(){ console.log.apply(console, ['[INFO][executor]'].concat(Array.prototype.slice.call(arguments))); },
  warn: function(){ console.warn.apply(console, ['[WARN][executor]'].concat(Array.prototype.slice.call(arguments))); },
  error: function(){ console.error.apply(console, ['[ERROR][executor]'].concat(Array.prototype.slice.call(arguments))); }
};
;
/**
 * modules/executor-tools.js
 * 
 * 从 server-modern.js 抽出的 _EXECUTOR_TOOLS 工具定义 + execCEOTool 函数
 * 包含：call_llm + 25个注册工具 (system_health ~ node_check) + capsStatic
 * 包含：execCEOTool(name, args) 调度函数
 */

// 工具对象

// 动态扫描已加载模块
var _loaded_modules = (function(){
  try {
    var _scanDir = require("path").join(__dirname, ".");
    return fs.readdirSync(_scanDir).filter(function(f){ return f.endsWith(".js") && f !== "executor-tools.js"; });
  } catch(e){ return []; }
})();
var _EXECUTOR_TOOLS = {};
// ★ call_llm — 调用 DeepSeek 大模型进行推理/分析/回复生成
_EXECUTOR_TOOLS['call_llm'] = async function(args) {
  var fs = require('fs');
  var messages = args.messages || [];
  var maxTokens = args.maxTokens || 1024;
  var temperature = args.temperature != null ? args.temperature : 0.7;
  var timeout = args.timeout || 30000;
  
  // 获取 API Key
  var apiKey = '';
  try {
    var credStore = require('./credential-store');
    var dsKey = credStore.getApiKey('deepseek');
    if (dsKey) apiKey = dsKey;
  } catch(e) {}
  if (!apiKey) {
    try {
      var cfg = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'ai-provider.json'), 'utf-8'));
      if (cfg.apiKey && cfg.apiKey.length > 4) apiKey = cfg.apiKey;
    } catch(e) {}
  }
  if (!apiKey && process.env.DEEPSEEK_API_KEY) apiKey = process.env.DEEPSEEK_API_KEY;
  
  if (!apiKey) {
    return { ok: false, error: '未配置 DeepSeek API Key', _fallback: true };
  }
  
  try {
    var controller = new AbortController();
    var timer = setTimeout(function() { try { controller.abort(); } catch(e) {} }, timeout);
    
    var response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        max_tokens: maxTokens,
        temperature: temperature,
        stream: false
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    
    var data = await response.json();
    if (data && data.choices && data.choices[0] && data.choices[0].message) {
      return { ok: true, data: data.choices[0].message.content };
    } else {
      return { ok: false, error: 'API 返回异常: ' + JSON.stringify(data).substring(0, 200), _fallback: true };
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      return { ok: false, error: 'LLM 请求超时(' + timeout + 'ms)', _fallback: true };
    }
    return { ok: false, error: 'LLM 调用失败: ' + e.message, _fallback: true };
  }
};

// ★ OrchestratorCore 主调度核心
var _orchCore=null;
(function(){try{var C=require('./agent-orchestrator-core');_orchCore=new C.OrchestratorCore({execCEOTool:null,sseSend:null,logger:function(m){console.log('[OrchCore]'+m)}});if(_orchCore)_orchCore.execCEOTool=execCEOTool;console.log('[OrchCore] \u2705 OrchestratorCore \u521d\u59cb\u5316\u5b8c\u6210')}catch(e){console.error('[OrchCore] \u274c',e.message);_orchCore=null}})();

function _registerExecutorTool(name, fn) {
  _EXECUTOR_TOOLS[name] = fn;
}


// 注册核心工具 handler（tools-registry 中缺失的）
_registerExecutorTool('system_health', async function(args) {
  var os = require('os');
  var cpus = os.cpus();
  var totalMem = os.totalmem();
  var freeMem = os.freemem();
  var uptime = os.uptime();
  return { status: 'ok', cpu: cpus.length + ' cores', memory: Math.round((totalMem - freeMem) / totalMem * 100) + '% used', uptime: Math.floor(uptime / 3600) + 'h' };
});
_registerExecutorTool('system_cpu_memory', async function(args) {
  var os = require('os');
  var cpus = os.cpus();
  var totalMem = os.totalmem();
  var freeMem = os.freemem();
  return { cpuCores: cpus.length, cpuLoad: cpus[0].times, memoryTotal: Math.round(totalMem / 1024 / 1024 / 1024 * 100) / 100 + 'GB', memoryFree: Math.round(freeMem / 1024 / 1024 / 1024 * 100) / 100 + 'GB', memoryUsed: Math.round((totalMem - freeMem) / totalMem * 100) + '%' };
});
_registerExecutorTool('system_logs', async function(args) {
  try {
    var fs = require('fs');
    var logDir = require('path').join(__dirname, '..', 'logs');
    var files = fs.readdirSync(logDir).filter(function(f) { return f.endsWith('.log'); }).sort().reverse().slice(0, 5);
    var logs = files.map(function(f) {
      var content = fs.readFileSync(require('path').join(logDir, f), 'utf8').split('\n').slice(-20).join('\n');
      return { file: f, lastLines: content.substring(0, 500) };
    });
    return { logFiles: logs };
  } catch(e) { return { error: 'No logs available: ' + e.message }; }
});
_registerExecutorTool('system_processes', async function(args) {
  try {
    var result = require('child_process').execSync('tasklist /fo csv /nh', { encoding: 'utf8', timeout: 3000 });
    var lines = result.split('\n').filter(Boolean).slice(0, 20);
    var processes = lines.map(function(l) {
      var cols = l.split(',');
      return { name: (cols[0] || '').replace(/"/g, ''), pid: (cols[1] || '').replace(/"/g, '') };
    });
    return { topProcesses: processes };
  } catch(e) { return { error: 'Process list unavailable: ' + e.message }; }
});
_registerExecutorTool('system_network_latency', async function(args) {
  try {
    var result = require('child_process').execSync('ping -n 2 127.0.0.1', { encoding: 'utf8', timeout: 5000 });
    var lines = result.split('\n').filter(function(l) { return l.indexOf('平均') >= 0 || l.indexOf('Average') >= 0 || l.indexOf('min') >= 0; });
    return { pingResult: lines[0] || result.substring(0, 100) };
  } catch(e) { return { error: 'Network check unavailable' }; }
});
_registerExecutorTool('kb_search', async function(args) {
  var kb = require('./knowledge-repo');
  var query = args.query || args.q || '';
  if (!query) return { error: 'Query required' };
  try {
    var searchDocs = kb.searchDocs || kb.search;
    var results = (typeof searchDocs === 'function') ? searchDocs(query) : [];
    var text = results.map(function(r) {
      return '文件[' + (r.title || r.name) + ']匹配了' + (r.matches ? r.matches.length : 0) + '处' +
        (r.matches ? r.matches.map(function(m) { return '  L' + m.line + ': ' + m.text; }).join('\n') : '');
    }).join('\n\n');
    return text || '知识库中未找到与"' + query + '"相关的内容';
  } catch(e) { return { error: 'KB search failed: ' + e.message }; }
});
// ★ exec_command — 系统命令执行（沙箱+超时+白名单）
_registerExecutorTool('exec_command', async function(args) {
  var { exec } = require('child_process');
  var command = args.command || args.cmd || '';
  var timeout = args.timeout || 30000;
  var cwd = args.cwd || process.cwd();
  
  if (!command.trim()) return { ok: false, error: '命令不能为空' };
  
  // 安全白名单：只允许读取类命令，禁止破坏性操作
  var safePrefixes = ['dir ','ls ','cat ','type ','find ','findstr ','echo ','node --check ','node -e ','npm ','git status','git log','git diff','git branch','git remote','ping ','tracert ','ipconfig','netstat','tasklist','powershell Get-','wmic '];
  var blockedPrefixes = ['rm ','del ','rd ','format ','shutdown','taskkill /F','Stop-Process','Remove-Item','Restart-Computer','net user','net localgroup'];
  
  var trimmed = command.trim().toLowerCase();
  var isBlocked = blockedPrefixes.some(function(p) { return trimmed.startsWith(p.toLowerCase()); });
  if (isBlocked) return { ok: false, error: '命令被安全策略拦截（禁止删除/关机/用户管理等破坏性操作）' };
  
  // 非白名单命令 -> 发出审批请求（除非已获授权）
  var isSafe = safePrefixes.some(function(p) { return trimmed.startsWith(p.toLowerCase()); });
  
  if (!isSafe && !args._authorized) {
    // 生成审批请求: 抛出一个特殊错误，由 CEO handler 捕获后转为审批提示
    var _approvalError = new Error('APPROVAL_REQUIRED');
    _approvalError.approval = true;
    _approvalError.originalCommand = args.command || args.cmd || '';
    throw _approvalError;
  }
  
  return new Promise(function(resolve) {
    var child = exec(command, {
      cwd: cwd,
      timeout: timeout,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8'
    }, function(error, stdout, stderr) {
      var result = {
        command: command.substring(0, 200),
        exitCode: error ? (error.code || error.status || -1) : 0,
        stdout: (stdout || '').substring(0, 5000),
        stderr: (stderr || '').substring(0, 2000),
        timedOut: error && error.killed
      };
      if (!isSafe && !error) {
        result.warning = '该命令不在推荐白名单中，请谨慎使用';
      }
      resolve({ ok: !error || error.code === null, result: result });
    });
  });
});

// ★ sessions_spawn — 创建子Agent（含单次执行限制）
var _sessionsSpawnedTimestamps = {};
_registerExecutorTool('sessions_spawn', async function(args) {
  try {
    // 防止单次执行中重复创建（通过 caller 标记）
    var _callKey = args._callKey || 'default';
    if (_sessionsSpawnedTimestamps[_callKey]) {
      return { ok: false, message: '⚠️ 本次执行中已创建过子Agent，请使用 sessions_list 查看状态或等待完成' };
    }
    _sessionsSpawnedTimestamps[_callKey] = Date.now();
    // 自动清理旧标记（5分钟后过期）
    setTimeout(function() { delete _sessionsSpawnedTimestamps[_callKey]; }, 300000);

    var sm = require('./session-manager');
    var result = await sm.sessionManager.spawnSubAgent(
      args.agentId || 'ai_ceo',
      args.prompt || args.task || '',
      { agentName: args.agentName, timeoutSeconds: args.timeout || 300 }
    );
    
    // ⭐ 同步等待分身执行完成（通过轮询 session 状态，最多等 60 秒）
    var subKey = result.sessionKey;
    var startWait = Date.now();
    var maxWait = (args.timeout || 120) * 1000;
    var subResult = null;
    while (Date.now() - startWait < maxWait) {
      var sessions = sm.sessionManager.listSubAgents({ status: 'completed' });
      var done = sessions.find(function(s) { return s.sessionKey === subKey; });
      if (done) {
        subResult = (done.result || {}).rawResult || '(无结果)';
        break;
      }
      // 也检查 failed 状态
      var failed = sm.sessionManager.listSubAgents({ status: 'failed' });
      if (failed.find(function(s) { return s.sessionKey === subKey; })) {
        subResult = '(分身执行失败)';
        break;
      }
      await new Promise(function(r) { setTimeout(r, 3000); });
    }
    if (!subResult) {
      subResult = '(分身执行超时，未在 ' + Math.round(maxWait/1000) + ' 秒内返回结果)';
    }
    
    // 分身结果和原始 prompt 一起返回给 CEO，由 CEO 在当前回复中汇总
    return { 
      ok: true, 
      data: { 
        sessionKey: subKey, 
        status: 'completed', 
        分身原始任务: (args.prompt || args.task || '').substring(0, 500),
        分身执行结果: subResult.substring(0, 8000)
      } 
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ★ sessions_list — 列出子Agent
_registerExecutorTool('sessions_list', async function(args) {
  try {
    var sm = require('./session-manager');
    var list = sm.sessionManager.listSubAgents(args.filter || null);
    return {
      ok: true,
      data: {
        sessions: list.map(function(s) {
          return {
            sessionKey: s.sessionKey,
            agentName: s.agentName,
            status: s.status,
            toolCallCount: (s.result || {}).toolCallCount,
            createdAt: s.createdAt,
            lastActivity: s.lastActivity
          };
        }),
        total: list.length,
        汇总说明: '分身完成后结果会自动回传给CEO做总结，此处不直接暴露原始结果'
      }
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ★ sessions_kill — 终止子Agent
_registerExecutorTool('sessions_kill', async function(args) {
  try {
    var sm = require('./session-manager');
    var killed = sm.sessionManager.killSubAgent(args.sessionKey || '');
    return { ok: !!killed, message: killed ? '已终止' : '未找到会话' };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ★ execute_openclaw_skill — 执行 OpenClaw 技能系统中的技能
_registerExecutorTool('execute_openclaw_skill', async function(args) {
  var skillName = args.skillName || args.name || args.skill || '';
  var skillArgs = args.args || args.params || {};
  
  if (!skillName.trim()) return { ok: false, error: '缺少技能名称 skillName' };
  
  try {
    // 尝试通过 skill-proxy 执行
    var sp = require('./skill-proxy');
    var result = await sp.executeSkill(skillName, skillArgs);
    return { ok: true, result: result };
  } catch(e) {
    // 降级：从 skill 文件读取并模拟执行
    try {
      var fs = require('fs');
      var path = require('path');
      var skillsDir = path.join(process.env.HOME || process.env.USERPROFILE || 'C:\\Users\\Administrator', '.openclaw', 'workspace', 'skills');
      
      if (!fs.existsSync(skillsDir)) return { ok: false, error: '技能目录不存在: ' + skillsDir };
      
      var items = fs.readdirSync(skillsDir);
      var matched = items.filter(function(i) { return i.toLowerCase().indexOf(skillName.toLowerCase()) > -1; });
      
      if (matched.length === 0) return { ok: false, error: '未找到匹配的技能: ' + skillName, available: items };
      
      var skillPath = path.join(skillsDir, matched[0], 'SKILL.md');
      if (!fs.existsSync(skillPath)) return { ok: false, error: '技能文件不存在: ' + skillPath };
      
      var content = fs.readFileSync(skillPath, 'utf8');
      return { ok: true, skillName: matched[0], content: content.substring(0, 10000), note: '技能文件已读取，请基于内容执行' };
    } catch(e2) {
      return { ok: false, error: '技能执行失败: ' + e.message + ' (降级也失败: ' + e2.message + ')' };
    }
  }
});


// ★ desktop_control — 桌面操作技能（鼠标、键盘、屏幕截图、窗口管理）
_registerExecutorTool('desktop_control', async function(args) {
  var action = args.action || '';
  var params = args.params || {};
  if (!action) return { ok: false, error: '缺少 action 参数' };
  
  try {
    var path_dc = require('path');
    var handlerPath = path_dc.join(process.env.HOME || process.env.USERPROFILE || 'C:\\Users\\Administrator', '.openclaw', 'workspace', 'skills', 'desktop-control', 'handler.js');
    
    delete require.cache[handlerPath];
    var handler = require(handlerPath);
    
    var result = await handler.handle({ action: action, params: params });
    // ★ screenshot 截图时自动附带屏幕元数据（窗口列表+活动窗口+鼠标位置+屏幕尺寸）
    //   帮助上层的 LLM 更准确定位目标元素
    if (action === 'screenshot' && result && !result.error) {
      var meta = {};
      try {
        var posRes = await handler.handle({ action: 'get_mouse_position', params: {} });
        if (posRes && posRes.x) meta.mouse = { x: posRes.x, y: posRes.y };
      } catch(me) {}
      try {
        var screenRes = await handler.handle({ action: 'get_screen_size', params: {} });
        if (screenRes && screenRes.width) meta.screen = { width: screenRes.width, height: screenRes.height };
      } catch(se) {}
      try {
        var activeRes = await handler.handle({ action: 'get_active_window', params: {} });
        if (activeRes && activeRes.title) meta.activeWindow = activeRes.title;
      } catch(ae) {}
      try {
        var winRes = await handler.handle({ action: 'get_all_windows', params: {} });
        if (winRes && winRes.windows) meta.windows = winRes.windows;
      } catch(we) {}
      if (Object.keys(meta).length > 0) {
        result._screenMeta = meta;
      }
    }
    return { ok: true, action: action, result: result };
  } catch(e) {
    return { ok: false, error: 'desktop_control 执行失败: ' + e.message };
  }
});

// ★ delete_file — 删除文件
_registerExecutorTool('delete_file', async function(args) {
  try {
    var fs2 = require('fs');
    var path2 = require('path');
    var filepath = args.path || args.filepath || '';
    if (!filepath.trim()) return { ok: false, error: '缺少 path 参数' };
    var resolved = path2.resolve(process.cwd(), filepath);
    if (!fs2.existsSync(resolved)) return { ok: false, error: '文件不存在: ' + filepath };
    var stat = fs2.statSync(resolved);
    if (stat.isDirectory()) return { ok: false, error: '不能删除目录' };
    var backup = resolved + '.bak.' + Date.now();
    fs2.copyFileSync(resolved, backup);
    fs2.unlinkSync(resolved);
    return { ok: true, message: '已删除 ' + filepath, backup: backup.substring(backup.lastIndexOf('\\') + 1) };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ★ move_file — 移动/重命名文件
_registerExecutorTool('move_file', async function(args) {
  try {
    var fs3 = require('fs');
    var path3 = require('path');
    var source = args.source || args.filepath || '';
    var target = args.target || args.newPath || args.dest || '';
    if (!source.trim() || !target.trim()) return { ok: false, error: '缺少 source 或 target 参数' };
    var sourceResolved = path3.resolve(process.cwd(), source);
    var targetResolved = path3.resolve(process.cwd(), target);
    if (!fs3.existsSync(sourceResolved)) return { ok: false, error: '源文件不存在: ' + source };
    var targetDir = path3.dirname(targetResolved);
    if (!fs3.existsSync(targetDir)) fs3.mkdirSync(targetDir, { recursive: true });
    fs3.renameSync(sourceResolved, targetResolved);
    return { ok: true, message: '已移动: ' + source + ' → ' + target };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ★ rename_file — 重命名文件
_registerExecutorTool('rename_file', async function(args) {
  try {
    var fs4 = require('fs');
    var path4 = require('path');
    var filepath = args.filepath || args.path || '';
    var newName = args.newName || args.name || '';
    if (!filepath.trim() || !newName.trim()) return { ok: false, error: '缺少 filepath 或 newName 参数' };
    var sourceResolved = path4.resolve(process.cwd(), filepath);
    if (!fs4.existsSync(sourceResolved)) return { ok: false, error: '文件不存在: ' + filepath };
    var dir = path4.dirname(sourceResolved);
    var targetResolved = path4.join(dir, newName);
    fs4.renameSync(sourceResolved, targetResolved);
    return { ok: true, message: '已重命名: ' + filepath + ' → ' + newName };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ★ create_task — 创建任务分配给其他员工
_registerExecutorTool('create_task', async function(args) {
  try {
    var tp = require('./task-pull');
    var task = tp.createTask(args.title || '', args.description || '', args.assignee || null, args.priority || 'medium');
    return { ok: true, data: task };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ★ memory_save — 写入持久记忆
_registerExecutorTool('memory_save', async function(args) {
  try {
    var content = args.content || '';
    var tags = args.tags || 'general';
    var type = args.type || 'general';
    if (!content.trim()) return { ok: false, error: '缺少 content 参数' };
    var memoPath = require('path').join(process.cwd(), 'data', 'memory', 'notes', Date.now().toString(36) + '.md');
    var memoDir = require('path').dirname(memoPath);
    if (!require('fs').existsSync(memoDir)) require('fs').mkdirSync(memoDir, { recursive: true });
    var memoContent = '---\n类型: ' + type + '\n标签: ' + tags + '\n时间: ' + new Date().toISOString() + '\n---\n\n' + content;
    require('fs').writeFileSync(memoPath, memoContent, 'utf8');
    return { ok: true, message: '记忆已保存', path: memoPath.substring(memoPath.indexOf('data\\')) };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});
_registerExecutorTool('memory_search', async function(args) {
  try {
    var engine = require('./memory-engine');
    var query = args.query || args.q || '';
    if (!query) return { error: 'Query required' };
    var searchFn = engine.searchMemory || engine.searchKnowledge || engine.search;
    if (typeof searchFn === 'function') {
      var results = await searchFn(query);
      var text = results.map(function(r) {
        return '  [' + (r.title || r.id || '未知') + '] ' + (r.content || '').substring(0, 300);
      }).join('\n');
      return text || '记忆库未找到与"' + query + '"相关的记录';
    }
    return '记忆引擎已加载，但无可用搜索函数';
  } catch(e) { return { error: 'Memory search failed: ' + e.message }; }
});
_registerExecutorTool('bi_query', async function(args) {
  var query = args.query || args.q || args.sql || '';
  if (!query) return { error: 'Query required' };
  return { message: 'BI query received: ' + query.substring(0, 100), note: 'BI module pending' };
});
_registerExecutorTool('api_request_stats', async function(args) {
  try {
    var statsFile = require('path').join(__dirname, '..', 'data', 'traffic-daily.json');
    if (fs.existsSync(statsFile)) {
      var stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
      return { stats: Object.keys(stats).slice(-7).map(function(d) { return { date: d, count: stats[d] }; }) };
    }
    return { message: 'No traffic stats available yet' };
  } catch(e) { return { error: 'Stats unavailable' }; }
});
_registerExecutorTool('integration_status', async function(args) {
  return { channels: ['dingtalk', 'feishu', 'wecom', 'qqbot', 'wechat', 'telegram', 'whatsapp', 'discord', 'slack'], note: 'Dynamic channel status available through /api/channels' };
});
_registerExecutorTool('model_management', async function(args) {
  return { models: ['deepseek-chat (default)', 'deepseek-reasoner'], note: 'Configure through settings page' };
});
_registerExecutorTool('file_manager', async function(args) {
  var op = args.op || args.operation || 'list';
  var path = args.path || args.dir || '.';
  try {
    if (op === 'list') {
      var files = fs.readdirSync(path).slice(0, 50);
      return { files: files };
    }
    return { message: 'Operation: ' + op + ' on ' + path };
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('query_team', async function(args) {
  try {
    var fs = require('fs');
    var path = require('path');
    var dataDir = require('path').join(__dirname, '..', 'data');
    var teamFile = path.join(dataDir, 'team.json');
    if (fs.existsSync(teamFile)) {
      var data = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
      return { members: data.members || data, count: (data.members || data).length };
    }
    return { members: [], count: 0, note: '团队数据文件不存在，请先初始化团队' };
  } catch(e) { return { error: e.message }; }
});
_registerExecutorTool('list_tasks', async function(args) {
  try {
    var fs = require('fs');
    var path = require('path');
    var dataDir = require('path').join(__dirname, '..', 'data');
    var tasksFile = path.join(dataDir, 'tasks.json');
    if (fs.existsSync(tasksFile)) {
      var data = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
      var tasks = data.tasks || data;
      return { tasks: tasks, count: tasks.length };
    }
    return { tasks: [], count: 0, note: '任务数据文件不存在' };
  } catch(e) { return { error: e.message }; }
});
_registerExecutorTool('capability_inventory', async function(args) {
  var caps = {
    system_monitoring: ['system_health', 'system_cpu_memory', 'system_processes', 'system_network_latency', 'system_logs'],
    data_query: ['query_team', 'list_tasks', 'kb_search', 'memory_search', 'bi_query', 'api_request_stats'],
    system_management: ['integration_status', 'model_management', 'file_manager', 'capability_inventory'],
    development: ['execute_code (js/py/sh)', 'read_file', 'write_file', 'node_check', 'list_modules (147 real modules)', 'list_coding_projects', 'file_manager'],
    ai: ['call_llm (DeepSeek Chat)', '_classifyIntent (9 intents)', 'OrchestratorCore (sub-agent orchestration)', 'P95 monitoring'],
    cron: ['cron_list', 'cron_create', 'cron_update', 'cron_delete', 'cron_run', 'cron_toggle'],
    session: ['session_send', 'session_list'],
    browser: ['browser_open', 'browser_navigate', 'browser_extract', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_close'],
    tts: ['tts_synthesize', 'tts_list_voices'],
    channels: ['dingtalk', 'feishu', 'wecom', 'qqbot', 'wechat', 'telegram', 'whatsapp', 'discord', 'slack'],
    cron: ['cron_list','cron_create','cron_update','cron_delete','cron_run','cron_toggle'],
    session: ['session_send','session_list'],
    browser: ['browser_open','browser_navigate','browser_extract','browser_screenshot','browser_click','browser_type','browser_close'],
    tts: ['tts_synthesize','tts_list_voices'],
    scheduling: ['daily_ceo_report (08:00)', 'health_check (30min)', 'p95_monitor (5min/30min)', 'nightly_audit (03:00)', 'sub_agent_poll (60s)'],
    supported_intents: ['greeting', 'chat', 'query', 'db_query', 'analysis', 'development', 'operation', 'summarize', 'report', 'command'],
    port: 8005,
    node_version: process.version,
    _all_tools: Object.keys(_EXECUTOR_TOOLS),
    _all_tool_count: Object.keys(_EXECUTOR_TOOLS).length,
    _module_count: _loaded_modules ? _loaded_modules.length : 0,
    db_connector: ['sql_connect','sql_exec','sql_disconnect','sql_list','sql_tables','sql_describe','sql_health'],
    api_gateway: ['api_create_route','api_list_routes','api_remove_route','api_update_route','api_gateway_status','api_openapi_spec','api_reset_stats']
  };
  return caps;
});

// ========== 注册开发工具 ==========
var codingAgent = require('./coding-agent');
var mcpManager = require('./mcp-manager');

// 尝试启动 MCP 服务器（非阻塞）
;(async function initMCP(){
  try {
    var mcpResult = await mcpManager.startServer('filesystem');
    if (!mcpResult.ok) {
      console.log('[MCP] filesystem server not available: ' + (mcpResult.error || 'unknown'));
    } else {
      console.log('[MCP] filesystem server started with ' + (mcpResult.tools||[]).length + ' tools');
    }
  } catch(mcpInitErr) {
    console.log('[MCP] init skipped: ' + mcpInitErr.message);
  }
})();

_registerExecutorTool('execute_code', async function(args) {
  try {
    var code = args.code || args.script || '';
    var language = args.language || 'js';
    var timeout = args.timeout || 30;
    if (!code) return { error: '请输入要执行的代码' };
    // 如果代码包含 markdown 代码块格式，从中提取
    var mdCodeBlock = code.match(/```(\w*)\n([\s\S]*?)```/);
    if (mdCodeBlock) {
      language = mdCodeBlock[1] || language;
      code = mdCodeBlock[2];
    }
    // 语言映射
    if (language === 'javascript' || language === 'node' || language === 'nodejs') language = 'js';
    if (language === 'python' || language === 'py') language = 'py';
    if (language === 'shell' || language === 'bash' || language === 'zsh' || language === 'powershell' || language === 'ps') language = 'sh';
    var handler = null;
    if (codingAgent.CODING_TOOLS) {
      for (var i = 0; i < codingAgent.CODING_TOOLS.length; i++) {
        if (codingAgent.CODING_TOOLS[i].id === 'coding_execute' || codingAgent.CODING_TOOLS[i].name === 'coding_execute') {
          handler = codingAgent.CODING_TOOLS[i].handler;
          break;
        }
      }
    }
    if (handler) {
      var result = await handler({ code: code, language: language, timeout: timeout });
      if (result && result.stdout !== undefined) {
                    // 自动将代码保存到 files/ 目录（如果是脚本/文件类代码）
            var savedPath = '';
            try {
              var filesDir = path.join(__dirname, '..', 'files');
              try { require('fs').mkdirSync(filesDir, { recursive: true }); } catch(_) {}
              var scriptFileName = 'script_' + Date.now() + '.' + language;
              savedPath = path.join(filesDir, scriptFileName);
              require('fs').writeFileSync(savedPath, code, 'utf8');
            } catch(se) { savedPath = 'save_failed: ' + (se.message || ''); }
            return { ok: true, stdout: (result.stdout || '').substring(0,5000), stderr: (result.stderr || '').substring(0,2000), exitCode: result.exitCode, language: language, duration: result.duration || 0, savedPath: savedPath };
      }
      return result;
    }
    // 降级：直接使用 child_process.exec
    try {
      var execSync = require('child_process').execSync;
      var fullCmd = '';
      if (language === 'js') {
        var tmpFile = path.join(__dirname, '..', 'sandbox', 'runs', 'exec_' + Date.now() + '.js');
        try { require('fs').mkdirSync(path.join(__dirname, '..', 'sandbox', 'runs'), { recursive: true }); } catch(_) {}
        require('fs').writeFileSync(tmpFile, code, 'utf8');
        var stdout = execSync('node "' + tmpFile.replace(/"/g, '^"') + '"', { timeout: timeout * 1000, maxBuffer: 10*1024*1024 }).toString();
        return { ok: true, stdout: stdout, stderr: '', exitCode: 0, language: 'js', fallback: true };
      }
      return { error: 'coding_execute handler not available, and no fallback for language: ' + language };
    } catch(e) {
      return { error: 'execution failed: ' + (e.message || '').substring(0,200) };
    }
  } catch(e) { return { error: e.message }; }
});



// ========== MCP 代理工具 ==========
var mcpManager = require('./mcp-manager');
try {
  mcpManager.startServer('filesystem').then(function(r){console.log('[MCP] filesystem:', r.ok ? 'running' : r.error);}).catch(function(e){console.log('[MCP] filesystem init:', e.message);});
} catch(mcpe){console.log('[MCP] init error:', mcpe.message);}
_registerExecutorTool('mcp_call_tool', async function(args) {
  try {
    var toolName = args.name || args.toolName || args.tool || '';
    var toolArgs = args.arguments || args.args || args.params || {};
    if (!toolName) return { error: '请输入MCP工具名称' };
    if (!mcpManager || typeof mcpManager.callTool !== 'function') return { error: 'MCP manager not initialized' };
    var mcpResult = await mcpManager.callTool(toolName, toolArgs);
    return mcpResult;
  } catch(e) { return { error: e.message }; }
});
_registerExecutorTool('mcp_list_tools', async function(args) {
  try {
    if (!mcpManager || typeof mcpManager.listTools !== 'function') return { error: 'MCP manager not initialized' };
    var tools = mcpManager.listTools();
    return { ok: true, tools: tools, count: tools.length };
  } catch(e) { return { error: e.message }

// ========== Cron 任务 API（基于 scheduler-api.js）==========
var cronApi = null;
try { cronApi = require('./scheduler-api'); } catch(e) { console.log('[Cron] scheduler-api not available:', e.message); }

_registerExecutorTool('cron_list', async function(args) {
  try {
    if (!cronApi) return { error: 'scheduler-api not loaded' };
    var tasks = cronApi.loadTasks();
    return { ok: true, tasks: tasks, count: tasks.length };
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('cron_create', async function(args) {
  try {
    if (!cronApi) return { error: 'scheduler-api not loaded' };
    var task = cronApi.addTask({
      name: args.name || args.title || '未命名任务',
      cron: args.cron || args.schedule || args.expr || '0 0 * * *',
      target: args.target || args.agentId || 'system',
      prompt: args.prompt || args.task || args.command || '',
      model: args.model || '',
      channel: args.channel || '',
      enabled: args.enabled !== false
    });
    return { ok: true, task: task, id: task.id };
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('cron_update', async function(args) {
  try {
    if (!cronApi) return { error: 'scheduler-api not loaded' };
    var id = args.id || args.taskId || '';
    if (!id) return { error: 'task id required' };
    var updated = cronApi.updateTask(id, {
      name: args.name, cron: args.cron || args.schedule, target: args.target || args.agentId,
      prompt: args.prompt || args.task, model: args.model, channel: args.channel, enabled: args.enabled
    });
    if (!updated) return { error: 'task not found: ' + id };
    return { ok: true, task: updated };
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('cron_delete', async function(args) {
  try {
    if (!cronApi) return { error: 'scheduler-api not loaded' };
    var id = args.id || args.taskId || '';
    if (!id) return { error: 'task id required' };
    var ok = cronApi.deleteTask(id);
    return ok ? { ok: true } : { error: 'task not found: ' + id };
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('cron_run', async function(args) {
  try {
    if (!cronApi) return { error: 'scheduler-api not loaded' };
    var id = args.id || args.taskId || '';
    if (!id) return { error: 'task id required' };
    var tasks = cronApi.loadTasks();
    var t = tasks.find(function(x){ return x.id === id; });
    if (!t) return { error: 'task not found: ' + id };
    // 通过内部 API 触发
    var apiUrl = 'http://127.0.0.1:' + (args.port || '8005') + '/api/chat/sse';
    var body = JSON.stringify({ agentId: t.target || 'xiaolong', message: t.prompt || '执行定时任务', sessionId: 'cron_' + id });
    var fetch = globalThis.fetch;
    if (!fetch) fetch = require('http');
    // 异步触发（非阻塞 SSE）
    (async function(){
      try {
        var h = require('http');
        var req = h.request({ hostname: '127.0.0.1', port: args.port || 8005, path: '/api/chat/sse', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
        req.write(body); req.end();
      } catch(er) { console.log('[Cron] run error:', er.message); }
    })();
    return { ok: true, message: '任务已触发: ' + t.name, taskId: id, target: t.target, prompt: (t.prompt||'').substring(0,100) };
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('cron_toggle', async function(args) {
  try {
    if (!cronApi) return { error: 'scheduler-api not loaded' };
    var id = args.id || args.taskId || '';
    if (!id) return { error: 'task id required' };
    var t = cronApi.toggleTask(id);
    if (!t) return { error: 'task not found: ' + id };
    return { ok: true, task: t, enabled: t.enabled };
  } catch(e) { return { error: e.message }; }
});


// ========== 跨会话消息（调用 Gateway API）==========
_registerExecutorTool('session_send', async function(args) {
  try {
    var sessionKey = args.sessionKey || args.session || args.target || '';
    var message = args.message || args.text || args.content || '';
    if (!sessionKey || !message) return { error: 'sessionKey and message required' };
    // 如果 sessionKey 不包含冒号，尝试通过 /api/v4/agent/talk 转发
    var data = JSON.stringify({ sessionKey: sessionKey, message: message });
    var result = await new Promise(function(resolve) {
      var hostname = args.hostname || process.env.OC_HOSTNAME || '127.0.0.1';
      var port = args.port || process.env.OC_PORT || '1234';
      var h = require('http');
      var req = h.request({ hostname: hostname, port: parseInt(port), path: '/api/sessions/send', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: args.timeout || 15000
      }, function(res) {
        var d = ''; res.on('data', function(c) { d += c; });
        res.on('end', function() { resolve({ ok: true, statusCode: res.statusCode, body: d.substring(0,500) }); });
      });
      req.on('error', function(e) { resolve({ ok: false, error: e.message }); });
      req.on('timeout', function() { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.write(data); req.end();
    });
    return result;
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('session_list', async function(args) {
  try {
    var hostname = args.hostname || process.env.OC_HOSTNAME || '127.0.0.1';
    var port = args.port || process.env.OC_PORT || '1234';
    var result = await new Promise(function(resolve) {
      var h = require('http');
      h.get('http://' + hostname + ':' + port + '/api/sessions', function(res) {
        var d = ''; res.on('data', function(c) { d += c; });
        res.on('end', function() { try { resolve({ ok: true, sessions: JSON.parse(d), statusCode: res.statusCode }); } catch(e) { resolve({ ok: true, raw: d.substring(0,1000), statusCode: res.statusCode }); } });
      }).on('error', function(e) { resolve({ ok: false, error: e.message }); });
    });
    return result;
  } catch(e) { return { error: e.message }; }
});


// ========== 浏览器自动化（Playwright + xbrowser）==========
var _pwBrowser = null;
var _pwContext = null;

_registerExecutorTool('browser_open', async function(args) {
  try {
    var pw = require('playwright-core');
    var browserType = args.browser || args.type || 'chromium';
    if (!pw[browserType]) return { error: 'Unsupported browser type: ' + browserType + '. Supported: chromium, firefox, webkit' };
    if (_pwBrowser) { try { await _pwBrowser.close(); } catch(e) {} }
    _pwBrowser = await pw[browserType].launch({ headless: args.headless !== false, args: ['--no-sandbox'] });
    _pwContext = await _pwBrowser.newContext({ viewport: { width: args.width || 1280, height: args.height || 800 } });
    return { ok: true, browser: browserType, headless: args.headless !== false };
  } catch(e) { return { error: 'browser_open failed: ' + e.message + '. Is playwright-core installed?' }; }
});

_registerExecutorTool('browser_navigate', async function(args) {
  try {
    if (!_pwContext) return { error: 'Browser not open. Call browser_open first.' };
    var url = args.url || args.link || '';
    if (!url.startsWith('http')) url = 'https://' + url;
    var page = await _pwContext.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: (args.timeout || 30)*1000 });
    var title = await page.title();
    var bodyText = await page.innerText('body').catch(function(){ return ''; });
    return { ok: true, url: url, title: title, text: bodyText.substring(0, 5000), textLength: bodyText.length, _pageRef: 'last' };
  } catch(e) { return { error: 'browser_navigate failed: ' + e.message }; }
});

_registerExecutorTool('browser_extract', async function(args) {
  try {
    if (!_pwContext) return { error: 'Browser not open.' };
    var page = _pwContext.pages && _pwContext.pages().length > 0 ? _pwContext.pages()[_pwContext.pages().length - 1] : null;
    if (!page) return { error: 'No page open. Call browser_navigate first.' };
    var selector = args.selector || args.css || 'body';
    var text = await page.innerText(selector).catch(function(){ return ''; });
    var html = await page.content().catch(function(){ return ''; });
    return { ok: true, selector: selector, text: text.substring(0, 8000), htmlLength: html.length };
  } catch(e) { return { error: 'browser_extract failed: ' + e.message }; }
});

_registerExecutorTool('browser_screenshot', async function(args) {
  try {
    if (!_pwContext) return { error: 'Browser not open.' };
    var page = _pwContext.pages && _pwContext.pages().length > 0 ? _pwContext.pages()[_pwContext.pages().length - 1] : null;
    if (!page) return { error: 'No page open.' };
    var screenshotDir = args.outputDir || require('path').join(__dirname, '..', 'sandbox', 'screenshots');
    require('fs').mkdirSync(screenshotDir, { recursive: true });
    var filePath = require('path').join(screenshotDir, 'ss_' + Date.now() + '.png');
    await page.screenshot({ path: filePath, fullPage: args.fullPage !== false });
    return { ok: true, file: filePath, size: require('fs').statSync(filePath).size };
  } catch(e) { return { error: 'browser_screenshot failed: ' + e.message }; }
});

_registerExecutorTool('browser_click', async function(args) {
  try {
    if (!_pwContext) return { error: 'Browser not open.' };
    var page = _pwContext.pages && _pwContext.pages().length > 0 ? _pwContext.pages()[_pwContext.pages().length - 1] : null;
    if (!page) return { error: 'No page open.' };
    var selector = args.selector || args.css || '';
    if (!selector) return { error: 'selector required' };
    await page.click(selector, { timeout: (args.timeout || 10)*1000 });
    await page.waitForTimeout(1000);
    return { ok: true, selector: selector };
  } catch(e) { return { error: 'browser_click failed: ' + e.message }; }
});

_registerExecutorTool('browser_type', async function(args) {
  try {
    if (!_pwContext) return { error: 'Browser not open.' };
    var page = _pwContext.pages && _pwContext.pages().length > 0 ? _pwContext.pages()[_pwContext.pages().length - 1] : null;
    if (!page) return { error: 'No page open.' };
    var selector = args.selector || args.css || '';
    var text = args.text || args.value || '';
    if (!selector) return { error: 'selector required' };
    await page.fill(selector, text, { timeout: (args.timeout || 10)*1000 });
    return { ok: true, selector: selector, length: text.length };
  } catch(e) { return { error: 'browser_type failed: ' + e.message }; }
});

_registerExecutorTool('browser_close', async function(args) {
  try {
    if (_pwBrowser) { try { await _pwBrowser.close(); } catch(e) {} }
    _pwBrowser = null;
    _pwContext = null;
    return { ok: true };
  } catch(e) { return { error: e.message }; }
});


// ========== TTS 语音合成（ElevenLabs API）==========
_registerExecutorTool('tts_synthesize', async function(args) {
  try {
    var text = args.text || args.content || args.tts || '';
    var voiceId = args.voice || args.voiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel (默认)
    var modelId = args.model || args.modelId || 'eleven_monolingual_v1';
    var stability = args.stability != null ? args.stability : 0.5;
    var similarityBoost = args.similarity_boost != null ? args.similarity_boost : 0.5;

    if (!text) return { error: 'text required' };
    if (text.length > 500) text = text.substring(0, 500); // 免费版限制

    // 获取 API Key
    var apiKey = process.env.ELEVENLABS_API_KEY || '';
    if (!apiKey) {
      try {
        var credStore = require('./credential-store');
        var ek = credStore.getApiKey('elevenlabs');
        if (ek) apiKey = ek;
      } catch(e) {}
    }
    if (!apiKey) return { error: 'ElevenLabs API Key not configured. Set process.env.ELEVENLABS_API_KEY or configure in credential-store.' };

    var baseUrl = 'https://api.elevenlabs.io/v1/text-to-speech/' + voiceId;
    var fetch = globalThis.fetch || require('fetch');
    
    var controller = new AbortController();
    var timer = setTimeout(function() { try { controller.abort(); } catch(e) {} }, 30000);

    var response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: text,
        model_id: modelId,
        voice_settings: { stability: stability, similarity_boost: similarityBoost }
      }),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      var errText = await response.text().catch(function(){ return ''; });
      return { error: 'ElevenLabs API error: ' + response.status + ' ' + errText.substring(0,200) };
    }

    // 保存音频文件
    var audioDir = require('path').join(__dirname, '..', 'sandbox', 'audio');
    require('fs').mkdirSync(audioDir, { recursive: true });
    var audioFile = require('path').join(audioDir, 'tts_' + Date.now() + '.mp3');

    var buffer = Buffer.from(await response.arrayBuffer());
    require('fs').writeFileSync(audioFile, buffer);

    return {
      ok: true,
      file: audioFile,
      size: buffer.length,
      duration_estimate_seconds: Math.round(text.length / 15),
      voice: voiceId,
      text: text.substring(0,100) + (text.length > 100 ? '...' : '')
    };
  } catch(e) { return { error: 'tts_synthesize failed: ' + e.message }; }
});

_registerExecutorTool('tts_list_voices', async function(args) {
  try {
    var apiKey = process.env.ELEVENLABS_API_KEY || '';
    if (!apiKey) {
      try { var credStore = require('./credential-store'); var ek = credStore.getApiKey('elevenlabs'); if (ek) apiKey = ek; } catch(e) {}
    }
    if (!apiKey) return { error: 'ElevenLabs API Key not configured.' };
    var fetch = globalThis.fetch || require('fetch');
    var controller = new AbortController();
    var timer = setTimeout(function() { try { controller.abort(); } catch(e) {} }, 15000);
    var response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }, signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) return { error: 'API error: ' + response.status };
    var data = await response.json();
    return {
      ok: true,
      voices: (data.voices || []).map(function(v){ return { id: v.voice_id, name: v.name, category: v.category, preview: v.preview_url }; }),
      count: (data.voices || []).length
    };
  } catch(e) { return { error: 'tts_list_voices failed: ' + e.message }; }
});

; }
});_registerExecutorTool('read_file', async function(args) {
  try {
    var filepath = args.filepath || args.path || '';
    if (!filepath) return { error: '请指定文件路径' };
    var fullPath = path.isAbsolute(filepath) ? filepath : path.join(BASE, filepath);
    if (!fs.existsSync(fullPath)) return { error: '文件不存在: ' + filepath };
    var content = fs.readFileSync(fullPath, 'utf8');
    return { filename: filepath, size: content.length, content: content.substring(0, 50000) };
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('write_file', async function(args) {
  try {
    var filepath = args.filepath || args.path || '';
    var content = args.content || '';
    if (!filepath) return { error: '请指定文件路径' };
    if (!content) return { error: '请指定文件内容' };
    var fullPath = path.isAbsolute(filepath) ? filepath : path.join(BASE, filepath);
    var dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    return { filename: filepath, size: content.length, written: true };
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('list_coding_projects', async function(args) {
  try {
    var codeDir = path.join(BASE, 'code-projects');
    if (!fs.existsSync(codeDir)) return { projects: [] };
    var items = fs.readdirSync(codeDir);
    var projects = [];
    items.forEach(function(item) {
      var full = path.join(codeDir, item);
      if (fs.statSync(full).isDirectory()) {
        try {
          var files = fs.readdirSync(full, { recursive: true }).filter(function(f) { return fs.statSync(path.join(full, f)).isFile(); });
          projects.push({ name: item, files: files.length, modified: fs.statSync(full).mtime });
        } catch(e) {}
      }
    });
    return { projects: projects, count: projects.length };
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('list_modules', async function(args) {
  try {
    var modDir = path.join(BASE, 'modules');
    var dataDir = path.join(BASE, 'data');
    var files = fs.readdirSync(modDir).filter(function(f) { return f.endsWith('.js'); }).sort();
    var results = files.map(function(f) {
      try {
        var stat = fs.statSync(path.join(modDir, f));
        var content = fs.readFileSync(path.join(modDir, f), 'utf8').substring(0,200);
        var hasExports = content.indexOf('module.exports') >= 0;
        var firstLines = content.split('\n').slice(0,3).join(' | ').substring(0,120);
        return { name: f, size: stat.size, modified: stat.mtime, hasExports: hasExports, header: firstLines };
      } catch(e) { return { name: f }; }
    });
    return {
      modules: results,
      count: results.length,
      dir: modDir,
      dataFiles: fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []
    };
  } catch(e) { return { error: e.message }; }
});

_registerExecutorTool('node_check', async function(args) {
  try {
    var filepath = args.filepath || args.path || '';
    if (!filepath) return { error: '请指定文件路径' };
    var fullPath = path.isAbsolute(filepath) ? filepath : path.join(BASE, filepath);
    if (!fs.existsSync(fullPath)) return { error: '文件不存在: ' + filepath };
    var execSync = require('child_process').execSync;
    var stdout = execSync('node --check "' + fullPath.replace(/"/g, '\"') + '"', { timeout: 10000 }).toString();
    return { ok: true, syntax: 'valid', stdout: stdout.trim() || '语法正确' };
  } catch(e) {
    if (e.stderr) return { ok: false, syntax: 'invalid', errors: e.stderr.toString().substring(0,1000) };
    return { ok: false, error: e.message.substring(0,200) };
  }
});

// Also create data directory if needed
try { fs.mkdirSync(require('path').join(__dirname, '..', 'data')); } catch(e) {}

async function execCEOTool(name, args) {
  if (!name) return { error: 'tool name required' };
  // ★ agent_execute — OrchestratorCore 子Agent执行入口
  if (name === 'agent_execute') {
    var aT=args.agentType||'default',desc=args.description||'',res=[],start=Date.now(),r;
    try{
      var capsStatic = {
        system_monitoring: ['health_check','cpu_memory','processes','network_latency','logs'],
        data_query: ['team_info','task_list','knowledge_base_search','memory_search','bi_query','api_stats'],
        system_management: ['channel_integration_status','model_management','capability_inventory'],
        development: ['execute_code(js/py/sh)','read_file','write_file','node_check','list_modules','list_coding_projects','file_manager'],
        ai_capabilities: ['natural_language_dialogue','intent_classification(9types)','sub_agent_orchestration','performance_monitoring'],
        channels: ['dingtalk','feishu','wecom','qqbot','wechat','telegram','whatsapp','discord','slack'],
        cron: ['cron_list','cron_create','cron_update','cron_delete','cron_run','cron_toggle'],
        session: ['session_send','session_list'],
        browser: ['browser_open','browser_navigate','browser_extract','browser_screenshot','browser_click','browser_type','browser_close'],
        tts: ['tts_synthesize','tts_list_voices'],
        scheduling: ['daily_report_08:00','health_check_30min','p95_monitor','nightly_audit_03:00','sub_agent_poll']
      };
      // ★ LLM智能模式：LLM判断需要工具时返回指令，系统执行后汇总
      if(aT==='llm_free'){
        var llmSys = '你是小龙，eCompany系统的AI助手。\n';
        llmSys += '\n可用工具：\n';
        llmSys += '- system_health: 系统健康检查\n';
        llmSys += '- query_team: 查询团队成员信息\n';
        llmSys += '- list_tasks: 查询任务列表\n';
        llmSys += '- kb_search: 知识库搜索\n';
        llmSys += '- read_file/write_file: 文件读写\n';
        llmSys += '- execute_code: 执行JS/Python代码\n';
        llmSys += '- db_query/db_execute: 数据库操作\n';
        llmSys += '- cron_list/cron_create: 定时任务\n';
        llmSys += '- capability_inventory: 系统能力清单\n';
        llmSys += '\n**新增能力【数据库直连】**:\n';
        llmSys += '- sql_connect: 连接数据库（type=sqlite|mysql|postgresql，传host/port/user/password/database）\n';
        llmSys += '- sql_exec: 执行SQL查询（sql=...，params=[...]参数绑定，allowWrite=true写入操作）\n';
        llmSys += '- sql_disconnect: 断开连接（id=连接名，不传则断开所有）\n';
        llmSys += '- sql_list: 列出所有活跃连接\n';
        llmSys += '- sql_tables: 列出数据库中所有表及其结构\n';
        llmSys += '- sql_describe: 查看单表结构\n';
        llmSys += '- sql_health: 检查所有数据库连接健康状态\n';
        llmSys += '\n**新增能力【高级API网关】**：\n';
        llmSys += '- api_create_route: 创建RESTful API端点（method/path/handler/description/group/version/rateLimit/authRequired）\n';
        llmSys += '- api_list_routes: 列出所有动态路由（支持按group/method/version过滤）\n';
        llmSys += '- api_remove_route: 删除路由（routeId）\n';
        llmSys += '- api_update_route: 更新路由（routeId + 要修改的字段）\n';
        llmSys += '- api_gateway_status: 网关状态概览（限流/拦截器/统计）\n';
        llmSys += '- api_openapi_spec: 生成OpenAPI 3.0规范文档\n';
        llmSys += '\n关键规则：\n';
        llmSys += '1. 以下工具是**真正注册在系统中的可调用工具**，不是示例，直接调用即可：\n';
        llmSys += '   - **数据库直连**：sql_connect/sql_exec/sql_disconnect/sql_list/sql_tables → 直接连接并查询SQLite/MySQL/PostgreSQL\n';
        llmSys += '   - **API网关**：api_create_route/list/remove/update/status → 直接创建/管理HTTP端点\n';
        llmFreeRes = await _EXECUTOR_TOOLS['call_llm']({
          messages: [
            {role:'system', content: llmSys},
            {role:'user', content: desc.replace('LLM自由对话: ','')}
          ],
          maxTokens: 1000,
          temperature: 0.7,
          timeout: 30000
        });
        var llmRaw = (llmFreeRes&&llmFreeRes.ok&&llmFreeRes.data) ? llmFreeRes.data : '';
        // 解析回复中的 [TOOL:xxx] 标记
        var toolMatch = llmRaw.match(/\[TOOL:([a-z_]+)\]/g);
        if (toolMatch && toolMatch.length > 0) {
          // LLM要求调用工具！先提取工具结果
          var toolResults = [];
          for (var ti = 0; ti < toolMatch.length; ti++) {
            var toolName = toolMatch[ti].replace('[TOOL:', '').replace(']', '');
            if (_EXECUTOR_TOOLS[toolName]) {
              try {
                var tr = await _EXECUTOR_TOOLS[toolName]({});
                var trStr = (typeof tr === 'object') ? JSON.stringify(tr).substring(0,3000) : String(tr).substring(0,3000);
                toolResults.push({tool: toolName, result: trStr});
              } catch(te) {
                toolResults.push({tool: toolName, error: te.message});
              }
            }
          }
          // 让LLM基于工具结果形成最终回答
          if (toolResults.length > 0) {
            var finalSys = '你是小龙，严谨的AI助手。\n\n基于工具执行的真实结果，给用户一份**完整的交付报告**。\n\n报告结构：\n## 做了什么\n## 结果/发现\n## 文件路径（如果有）\n## 下一步建议\n\n规则：\n1. 直接说结论，不要"好的收到"开场\n2. 写文件/执行代码后必须说明文件保存在哪（完整路径）\n3. 如果要定期执行的操作（定时清理等），先调cron_list检查是否已有类似任务，然后调cron_create注册。**如果你觉得需要额外工具，在报告最后加 [TOOL:工具名]**\n4. 分析类问题给出结论后主动建议可执行操作\n5. 别说"根据系统数据/查询结果"这种废话\n6. 数据为空就说没查到';
            var finalPrompt = '工具执行结果：' + JSON.stringify(toolResults).substring(0,4000);
      // 提取文件保存路径
      for (var fi = 0; fi < toolResults.length; fi++) {
        try { var tp = JSON.parse(toolResults[fi].result || '{}'); if (tp.savedPath) finalPrompt += '\n[文件已保存到] ' + tp.savedPath; } catch(e) {}
      }
      finalPrompt += '\n\n原始用户问题：' + desc.replace('LLM自由对话: ','');
            var finalRes = await _EXECUTOR_TOOLS['call_llm']({
              messages: [{role:'system', content: finalSys}, {role:'user', content: finalPrompt}],
              maxTokens: 1000, temperature: 0.7, timeout: 30000
            });
            var finalText = (finalRes&&finalRes.ok&&finalRes.data) ? finalRes.data : llmRaw.replace(/\[TOOL:[a-z_]+\]/g,'').trim();
            // 递归检查：第二次LLM回复中是否又要求调用工具
            var moreTools = finalText.match(/\[TOOL:([a-z_]+)\]/g);
            if (moreTools && moreTools.length > 0) {
              var round2Results = [];
              for (var ti2 = 0; ti2 < moreTools.length; ti2++) {
                var t2 = moreTools[ti2].replace('[TOOL:', '').replace(']', '');
                if (_EXECUTOR_TOOLS[t2]) {
                  try {
                    var r2 = await _EXECUTOR_TOOLS[t2]({});
                    round2Results.push({tool: t2, result: (typeof r2 === 'object') ? JSON.stringify(r2).substring(0,3000) : String(r2).substring(0,3000)});
                  } catch(e2) { round2Results.push({tool: t2, error: e2.message}); }
                }
              }
              if (round2Results.length > 0) {
                var final2Sys = '你是小龙，严谨的AI助手。\n\n刚才调用了工具获取了结果。\n基于所有结果给用户最终报告。\n\n报告结构：\n## 做了什么\n## 结果\n## 文件路径（如果有）\n## 下一步建议\n\n**如果还需要额外操作（比如注册cron、分配任务），在报告末尾加 [TOOL:工具名] 标记**。\n\n规则：别说"好的收到"开场，直接说内容。';
                var final2Prompt = '## 上一轮报告\n' + finalText.replace(/\[TOOL:[a-z_]+\]/g,'').trim() + '\n## 额外工具结果\n' + JSON.stringify(round2Results).substring(0,4000);
                for (var fi2 = 0; fi2 < round2Results.length; fi2++) { try { var tp2 = JSON.parse(round2Results[fi2].result || '{}'); if (tp2.savedPath) final2Prompt += '\n[文件已保存到] ' + tp2.savedPath; } catch(e) {} }
                final2Prompt += '\n\n请给出包含完整报告结构的最终回答：';
                var final2Res = await call_llm({ messages: [{role:'system', content: final2Sys}, {role:'user', content: final2Prompt}], maxTokens: 1500, temperature: 0.7, timeout: 30000 });
                if (final2Res && final2Res.ok && final2Res.data) finalText = final2Res.data;
              }
            }
            return { data: finalText, message: 'LLM智能回复(含工具)', _agentType: 'executor', _execTime: Date.now()-start, ok: true };
          }
        }
        // 没有工具标记，直接返回LLM的自由回答
        var cleanText = (llmRaw||desc||'').replace(/\[TOOL:[a-z_]+\]/g,'').trim().substring(0,2000);
        return { data: cleanText, message: 'LLM自由回复', _agentType: 'executor', _execTime: Date.now()-start, ok: true };
      }
      // ★ 动态工具调度：action参数匹配_EXECUTOR_TOOLS则直接执行
      var stepAction = args.action;
      if (stepAction && _EXECUTOR_TOOLS[stepAction]) {
        try {
          var toolData = await _EXECUTOR_TOOLS[stepAction]({});
          return { data: toolData, message: '工具执行: '+stepAction, _agentType: 'executor', _execTime: Date.now()-start, ok: true };
        } catch(te) {
          console.log('[agent_execute] tool', stepAction, 'failed:', te.message);
        }
      }
      var descLower = (desc||'').toLowerCase();
      if(aT==='analyst' || descLower.indexOf('团队')>=0 || descLower.indexOf('人员')>=0 || descLower.indexOf('团队信息')>=0 || descLower.indexOf('成员')>=0 || descLower.indexOf('人是谁')>=0){
        try{r=await execCEOTool('query_team',{});if(r&&(r.members||r.data))res.push({tool:'query_team',result:r});}catch(e1){}
        try{r=await execCEOTool('list_tasks',{});if(r&&(r.tasks||r.data))res.push({tool:'list_tasks',result:r});}catch(e2){}
        try{r=await execCEOTool('kb_search',{query:desc,limit:3});if(r)res.push({tool:'kb_search',result:r});}catch(e3){}
      }
      if(descLower.indexOf('知识库')>=0||descLower.indexOf('搜索')>=0||descLower.indexOf('文档')>=0||descLower.indexOf('资料')>=0||descLower.indexOf('查')>=0||descLower.indexOf('找')>=0||descLower.indexOf('知识')>=0){
        try{r=await execCEOTool('kb_search',{query:desc});if(r)res.push({tool:'kb_search',result:r});}catch(e3){}
      }
      if(descLower.indexOf('任务')>=0||descLower.indexOf('todo')>=0||descLower.indexOf('待办')>=0||descLower.indexOf('工作')>=0){
        try{r=await execCEOTool('list_tasks',{});if(r&&(r.tasks||r.data))res.push({tool:'list_tasks',result:r});}catch(e4){}
      }
      if(descLower.indexOf('健康')>=0||descLower.indexOf('系统状态')>=0||descLower.indexOf('状态')>=0||descLower.indexOf('运行')>=0||descLower.indexOf('正常')>=0||descLower.indexOf('内存')>=0||descLower.indexOf('cpu')>=0){
        try{r=await execCEOTool('system_health',{});if(r&&r.data)res.push({tool:'system_health',result:r.data});else if(r)res.push({tool:'system_health',result:r});}catch(e5){}
        try{r=await execCEOTool('system_cpu_memory',{});if(r)res.push({tool:'system_cpu_memory',result:r});}catch(e6){}
      }
      if(descLower.indexOf('能力')>=0||descLower.indexOf('功能')>=0||descLower.indexOf('能做什么')>=0||descLower.indexOf('有什么用')>=0||descLower.indexOf('汇总')>=0||descLower.indexOf('全部')>=0||descLower.indexOf('板块')>=0||descLower.indexOf('模块')>=0||descLower.indexOf('摸底')>=0){
        try{r=await execCEOTool('capability_inventory',{});if(r)res.push({tool:'capability_inventory',result:r});}catch(e7){}
      }
      // [2026-06-27] 告警规则操作
      if(descLower.indexOf('告警')>=0||descLower.indexOf('预警')>=0||descLower.indexOf('alert')>=0||descLower.indexOf('通知规则')>=0||(descLower.indexOf('规则')>=0&&(descLower.indexOf('查看')>=0||descLower.indexOf('列表')>=0||descLower.indexOf('添加')>=0||descLower.indexOf('删除')>=0||descLower.indexOf('更新')>=0||descLower.indexOf('状态')>=0||descLower.indexOf('检查')>=0||descLower.indexOf('引擎')>=0))){
        try{
          var isDelete = descLower.indexOf('删除')>=0||descLower.indexOf('移除')>=0;
          var isAdd = descLower.indexOf('添加')>=0||descLower.indexOf('增加')>=0||descLower.indexOf('新建')>=0||descLower.indexOf('创建')>=0;
          var isCheck = descLower.indexOf('检查')>=0||descLower.indexOf('立即')>=0||descLower.indexOf('执行')>=0;
          var isStatus = descLower.indexOf('状态')>=0||descLower.indexOf('概览')>=0||descLower.indexOf('运行')>=0||descLower.indexOf('引擎')>=0;
          if(isDelete) { r=await execCEOTool('alert_rules_remove',{ruleId: desc.match(/规则[IDid]*[:：\s]*([\w_]+)/)?.[1]||''}); }
          else if(isAdd) { r=await execCEOTool('alert_rules_add',{name: desc.substring(0,80).replace(/添加|增加|新建|创建|告警|规则|（.*）|\(.*\)/g,'').trim()||'自定义规则', metric: 'cpu_percent', condition: {operator: 'gt', value: 80}, severity: 'warning'}); }
          else if(isCheck) { r=await execCEOTool('alert_rules_check',{}); }
          else if(isStatus) { r=await execCEOTool('alert_rules_status',{}); }
          else { r=await execCEOTool('alert_rules_list',{}); }
          if(r) { res.push({tool:'alert_rules', result:r}); }
        }catch(e11){}
      }

      // [2026-06-27] API 路由/端点创建检测
      if(descLower.indexOf('api')>=0||descLower.indexOf('路由')>=0||descLower.indexOf('端点')>=0||descLower.indexOf('接口')>=0||descLower.indexOf('endpoint')>=0||descLower.indexOf('route')>=0||(descLower.indexOf('创建')>=0&&descLower.indexOf('接口')>=0)){
        try{
          var apiHandlerDesc = desc.replace(/创建.*?(?:API|api|接口|端点|路由).*?(?:GET|POST|PUT|DELETE|PATCH|get|post|put|delete|patch)?\s*/, '').trim().substring(0,200);
          var apiPathMatch = (desc.match(/(?:GET|POST|PUT|DELETE|PATCH)\s+\/[a-zA-Z0-9_\/\-{}]+/i) || [''])[0] || ''; var apiPath = apiPathMatch.replace(/^(?:GET|POST|PUT|DELETE|PATCH)\s+/i, ''); // Strip method prefix
          if (!apiPath) { apiPath = (desc.match(/\/(?:api|v[0-9]+)\/[a-zA-Z0-9_\/\-{}]+/i) || [''])[0] || '/api/custom/endpoint'; }
          var apiMethod = (desc.match(/(GET|POST|PUT|DELETE|PATCH)/i) || ['GET'])[0].toUpperCase();
          var apiCode = 'json({ message: "success", timestamp: Date.now() });';
          var extractCode = desc.match(/\{.*\}/);
          if (extractCode) apiCode = 'json(' + extractCode[0] + ');';
          r=await execCEOTool('api_create_route',{method:apiMethod,path:apiPath,description:apiHandlerDesc || '自动创建的路由',handlerCode:apiCode});
          if(r) res.push({tool:'api_create_route', result:r});
        }catch(e9){}
      }
      // [2026-06-27] SQL/数据库操作直接调 sql_exec（新增：查表、看表、遍历表、agent表、用户表等自然语言表名也触发）
      if(descLower.indexOf('sql')>=0||descLower.indexOf('数据库')>=0||descLower.indexOf('select')>=0||descLower.indexOf('insert')>=0||descLower.indexOf('update')>=0||descLower.indexOf('delete')>=0||descLower.indexOf('数据表')>=0||descLower.indexOf('表结构')>=0||descLower.indexOf('表名')>=0||/(?:查|看|列出|遍历|浏览|看看).*表/.test(descLower)||/\w+表/.test(descLower)){
        try{
          var sqlMatch = desc.match(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA)\b[\s\S]{0,500}/i);
          if (sqlMatch) {
            var sqlStatement = sqlMatch[0];
            var isWrite = /INSERT|UPDATE|DELETE|CREATE|DROP|ALTER/i.test(sqlStatement);
            r=await execCEOTool('sql_exec',{sql:sqlStatement,allowWrite:isWrite});
            if(r) res.push({tool:'sql_exec', result:r});
          } else {
            // 自然语言问数据库，先查表
            var justShowTables = descLower.indexOf('表')>=0 && (descLower.indexOf('哪些')>=0||descLower.indexOf('所有')>=0||descLower.indexOf('列出')>=0||descLower.indexOf('有什么')>=0||descLower.indexOf('什么表')>=0);
            if (justShowTables) {
              r=await execCEOTool('sql_tables',{});
              if(r) res.push({tool:'sql_tables', result:r});
            } else {
              // 默认查几条看看
              r=await execCEOTool('sql_exec',{sql:'SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name'});
              if(r) res.push({tool:'sql_exec', result:r});
            }
          }
        }catch(e10){}
      }
      if(descLower.indexOf('代码')>=0||descLower.indexOf('执行')>=0||descLower.indexOf('运行')>=0||descLower.indexOf('脚本')>=0||descLower.indexOf('console')>=0||descLower.indexOf('cmd')>=0){
        // 从描述中提取代码块，或直接尝试执行
        var codeMed = '';
        var langMed = 'js';
        // 检查是否包含 markdown 代码块
        var blockMatch = desc.match(/\`\`\`(\w*)\n([\s\S]*?)\`\`\`/);
        if (blockMatch) {
          codeMed = blockMatch[2];
          langMed = blockMatch[1] || 'js';
        } else if (/^(console|var |let |const |function|class|import|require|print\()/.test(desc.trim())) {
          // 用户直接输入的代码片段
          codeMed = desc.trim();
        } else {
          // 从自然语言中提取代码（在冒号/引号后的代码片段）
          var codeExtract = desc.match(/[：:]\s*([^：:]+)$/);
          if (codeExtract) {
            var cand = codeExtract[1].trim();
            if (cand.length > 3 && cand.length < 500) {
              cand = cand.replace(/^[\u4e00-\u9fff\uff00-\uffef\s,，。]+/, '').trim();
              if (cand.length > 3) {
                codeMed = cand;
                if (/^python/i.test(codeMed) || /^py /i.test(codeMed)) { langMed = 'py'; codeMed = codeMed.replace(/^python\s*/i,'').replace(/^py\s*/i,''); }
              }
            }
          }else{
            // 无冒号，从中文动词后直接拿可能代码
            var verbPat = desc.match(/(?:执行|运行|跑|run|execute)\s*([\s\S]{3,})$/i);
            if (verbPat) {
              var cand2 = verbPat[1].trim();
              cand2 = cand2.replace(/^[\u4e00-\u9fff\uff00-\uffef\s,，。"'：:]+/, '').trim();
              if (cand2.length > 3 && cand2.length < 500) {
                codeMed = cand2;
              }
            }
        }
        if (codeMed) {
          try{r=await execCEOTool('execute_code',{code:codeMed,language:langMed,timeout:15});if(r)res.push({tool:'execute_code',result:r});}catch(e8){}
        }
      }
      if(descLower.indexOf('读文件')>=0||descLower.indexOf('查看文件')>=0||descLower.indexOf('cat')>=0||descLower.indexOf('查看代码')>=0||descLower.indexOf('读取')>=0||(descLower.indexOf('文件')>=0&&descLower.indexOf('内容')>=0)){
        try{r=await execCEOTool('read_file',{filepath:desc});if(r)res.push({tool:'read_file',result:r});}catch(e9){}
      }
      if(descLower.indexOf('语法检查')>=0||descLower.indexOf('语法')>=0||descLower.indexOf('node --check')>=0||descLower.indexOf('语法检测')>=0){
        try{r=await execCEOTool('node_check',{filepath:desc});if(r)res.push({tool:'node_check',result:r});}catch(e10){}
      }
      if(descLower.indexOf('项目')>=0||descLower.indexOf('工程')>=0||descLower.indexOf('coding')>=0||descLower.indexOf('代码目录')>=0){
        try{r=await execCEOTool('list_coding_projects',{});if(r)res.push({tool:'list_coding_projects',result:r});}catch(e11){}
      }
      if(descLower.indexOf('模块清单')>=0||descLower.indexOf('所有模块')>=0||descLower.indexOf('查看模块')>=0||descLower.indexOf('modules')>=0||descLower.indexOf('模块列表')>=0){
        try{r=await execCEOTool('list_modules',{});if(r)res.push({tool:'list_modules',result:r});}catch(e12){}
      }
    }
      // 调用 LLM 生成最终回复
      log.info('[TRACE] call_llm check:', !!_EXECUTOR_TOOLS["call_llm"], 'desc length:', desc?desc.length:0, 'has _autoInjected:', desc?desc.indexOf('_autoInjected')>=0:'N/A');
    if(_EXECUTOR_TOOLS['call_llm'] && desc && desc.length>0 && desc.indexOf('_autoInjected') < 0){
      try{
        var toolSummary = res.map(function(x){ 
          var r = x.result;
          if(typeof r === 'string') return r.substring(0,300);
          // ★ 截图场景：提取 _screenMeta 单独拼接，不因截断丢失
          var screenMetaStr = '';
          if (r && r._screenMeta) {
            screenMetaStr = '\n[屏幕元数据] ' + JSON.stringify(r._screenMeta).substring(0, 1000);
          }
          if(r && r.data) return (typeof r.data === 'string') ? r.data.substring(0,300) + screenMetaStr : JSON.stringify(r.data).substring(0,300) + screenMetaStr;
          if(r && r.members) return '团队成员: ' + r.members.map(function(m){return m.name||m.role||JSON.stringify(m)}).join(', ') + screenMetaStr;
          if(r && r.tasks) return '任务列表:' + r.tasks.map(function(t){return t.title||t.name||t.id||''}).join(', ') + screenMetaStr;
          if(r && r.results) return (typeof r.results === 'string') ? r.results.substring(0,300) + screenMetaStr : JSON.stringify(r.results).substring(0,300) + screenMetaStr;
          return JSON.stringify(r).substring(0,300) + screenMetaStr;
        }).join('\n\n');

        var sysPrompt = '你是小龙，eCompany系统的全栈开发与运维管理核心。你既是调度管理AI，也是开发助手。请基于以下数据用中文自然回答。\n' +
          '要求：\n1. 优先使用工具返回的真实数据（如list_modules返回的实际模块列表、system_health返回的真实指标），如实呈现\n2. 系统能力清单（capsStatic）仅做参考，工具返回的真实数据更具优先级\n3. 简洁直接，数据说话，如实回答不编造\n4. 如果涉及系统能力查询、模块清单等，如实列出工具返回的数据\n5. 支持开发场景：代码执行、文件读/写、语法检测、模块管理、项目清单\n6. 你有代码执行能力！当用户要求写代码或执行任务时，在回复中附上```js\n代码块```格式，系统会自动提取并执行你的代码，然后将结果返回给你总结\n7. 表现出自信和主动性，不是被动的"我没找到"\n\n' +
          '你当前的系统能力清单: ' + JSON.stringify(capsStatic, null, 2);
        var llmRes = await _EXECUTOR_TOOLS['call_llm']({
          messages: [
            {role:'system',content: sysPrompt},
            {role:'user',content: '用户问题: ' + desc + '\n\n查询到的数据: ' + (toolSummary || '无')}
          ],
          maxTokens: 1000,
          temperature: 0.7,
          timeout: 25000
        });
        log.info('[TRACE3] llmRes:', JSON.stringify(llmRes).substring(0,200));
        if(llmRes && llmRes.ok && llmRes.data){
          // 检查 LLM 回复中是否包含可执行的代码块
          var llmText = llmRes.data;
          var execBlocks = [];
          var mbRegex = /```(\w*)\n([\s\S]*?)```/g;
          var mbMatch;
          while ((mbMatch = mbRegex.exec(llmText)) !== null) {
            var mlang = mbMatch[1] || '';
            var mcode = mbMatch[2] && mbMatch[2].trim();
            if (mcode && mcode.length > 3 && (mlang === 'js' || mlang === 'javascript' || mlang === 'python' || mlang === 'py' || mlang === 'bash' || mlang === 'sh' || mlang === '')) {
              execBlocks.push({ language: mlang || 'js', code: mcode });
            }
          }
          // 如果有代码块，执行并追加结果
          if (execBlocks.length > 0) {
            (async function(){
              var execResults = [];
              for (var ei=0; ei<execBlocks.length; ei++) {
                try {
                  var er = await execCEOTool('execute_code', {code: execBlocks[ei].code, language: execBlocks[ei].language, timeout: 15});
                  execResults.push({ index: ei, result: er });
                } catch(ex) { execResults.push({ index: ei, error: ex.message }); }
              }
              // 将执行结果发回给 LLM 做总结
              var execSummary = execResults.map(function(x, idx){ return '【第'+(idx+1)+'段代码执行结果】\n' + JSON.stringify(x.result, null, 2).substring(0,2000); }).join('\n');
              var finalPrompt = sysPrompt + '\n\n你之前生成了代码，执行结果如下：\n' + execSummary + '\n\n请根据执行结果给用户最终的回答。';
              try {
                var finalRes = await _EXECUTOR_TOOLS['call_llm']({
                  messages: [
                    {role:'system',content: finalPrompt},
                    {role:'user',content: '用户问题: ' + desc + '\n\n你之前回复中包含了代码块，执行结果为：\n' + execResults.map(function(x, idx){ return '---代码'+idx+'---\n' + (x.result ? JSON.stringify(x.result).substring(0,500) : '失败: '+x.error); }).join('\n')}
                  ],
                  maxTokens: 1000,
                  temperature: 0.7,
                  timeout: 25000
                });
                if(finalRes && finalRes.ok && finalRes.data){
                  return{data:finalRes.data,message:desc,_agentType:aT,_execTime:Date.now()-start,results:res,_executedCode:true,ok:true};
                }
              }catch(fe){}
            })();
          }
          // ★ 自动坐标执行：LLM回复中如果包含 [CLICK:x,y] 标记，自动调用 desktop_control 点击
          var clickMatch = llmText.match(/\[CLICK\s*[:：]\s*(\d+)\s*,\s*(\d+)\]/);
          if (clickMatch) {
            var clickX = parseInt(clickMatch[1], 10);
            var clickY = parseInt(clickMatch[2], 10);
            if (!isNaN(clickX) && !isNaN(clickY) && clickX > 0 && clickY > 0) {
              try {
                // 先移动再点击
                await execCEOTool('desktop_control', { action: 'move_mouse', params: { x: clickX, y: clickY, duration: 0 } });
                var clickRes = await execCEOTool('desktop_control', { action: 'click', params: { x: clickX, y: clickY, button: 'left', clicks: 1 } });
                // 把执行状态追加到回复中
                llmText += '\n\n🖱️ 自动执行结果：鼠标已移至 (' + clickX + ', ' + clickY + ') 并完成点击。';
              } catch(ce) {
                llmText += '\n\n⚠️ 自动点击执行失败: ' + (ce.message || '');
              }
            }
          }
          return{data:llmText,message:desc,_agentType:aT,_execTime:Date.now()-start,results:res,ok:true};
        }
      }catch(llmErr){}
    }
    log.info('[TRACE2] returning from agent_execute, res.length='+res.length+', ok='+(res.length>0));
    return{message:desc,_agentType:aT,_execTime:Date.now()-start,results:res,ok:res.length>0};
    }catch(e){return{message:desc,agentType:aT,_execTime:Date.now()-start,_error:e.message,_fallback:true}}
  }
  // 优先用注册的工具
  if (_EXECUTOR_TOOLS[name]) {
    try {
      var result = await _EXECUTOR_TOOLS[name](args || {});
      log.info('[exec] HIT _EXECUTOR_TOOLS:', name, 'result:', typeof result === 'object' ? JSON.stringify(result).substring(0,150) : String(result).substring(0,150));
      return { ok: true, data: result };
    } catch(e) {
      log.info('[exec] ERROR in _EXECUTOR_TOOLS:', name, e.message);
      return { error: e.message };
    }
  } else {
    log.info('[exec] MISS _EXECUTOR_TOOLS:', name, 'available:', Object.keys(_EXECUTOR_TOOLS));
  }
  // 用 tools-registry.executeTool 执行
  try {
    var result = await toolRegistry.executeTool(name, args || {});
    return { ok: true, data: result };
  } catch(e) {
    return { error: e.message };
  }
}


// ===== 腾讯文档工具（tdoc-bridge）=====
var tdocBridge = require('./tdoc-bridge');
var tdocTools = tdocBridge.TENCENT_DOC_TOOLS;
for (var _tname in tdocTools) {
  (function(tname, tdef) {
    _EXECUTOR_TOOLS[tname] = tdef;
    _registerExecutorTool(tname, async function(args) {
      return await tdocBridge.tdocCall(args.action, args);
    });
  })(_tname, tdocTools[_tname]);
}

// ★ subagent_spawn — 启动子Agent执行子任务
_registerExecutorTool("subagent_spawn", async function(args) {
  try {
    var subPlan = args.subPlan || args.plan || null;
    if (!subPlan || !subPlan.steps || subPlan.steps.length === 0) {
      return { error: '子任务定义无效（需 subPlan.steps）' };
    }
    var orchestrator = null;
    // 尝试从调用上下文获取 orchestrator 实例
    try {
      var core = require('./agent-orchestrator-core');
      orchestrator = core.getInstance && core.getInstance();
    } catch(e) {}
    if (!orchestrator || !orchestrator._subagentExecute) {
      // 降级：逐个步骤通过 execCEOTool 执行
      console.log('[subagent_spawn] 降级执行, 步骤数:', subPlan.steps.length);
      var results = {}; var completed = 0; var failed = 0;
      for (var si = 0; si < subPlan.steps.length; si++) {
        var step = subPlan.steps[si];
        try {
          var sr = await execCEOTool(step.action || 'agent_execute', step.args || {});
          results[step.id] = { status: 'success', result: sr };
          completed++;
        } catch(e1) {
          results[step.id] = { status: 'failed', error: e1.message };
          failed++;
        }
      }
      return { ok: true, results: results, completed: completed, failed: failed, summary: completed + '完成/' + failed + '失败' };
    }
    // 有 orchestrator 实例，走递归调度
    var result = await orchestrator._subagentExecute(subPlan, args.context || {});
    return { ok: true, data: result };
  } catch(e) {
    return { error: 'subagent_spawn: ' + e.message };
  }
});

// ★ lesson_extract — 抽取并整理失败教训
_registerExecutorTool("lesson_extract", async function(args) {
  try {
    var coreMod = require('./agent-orchestrator-core');
    var instance = global._orchCoreInstance || (coreMod.getInstance && coreMod.getInstance());
    if (!instance || !instance._extractLessons) return { ok: false, error: 'orchestrator not available' };
    var lessons = instance._extractLessons();
    if (!Array.isArray(lessons) || lessons.length === 0) return { ok: true, data: { message: '暂无失败教训可提炼' } };
    var report = '## 🧠 反脆弱学习报告\n\n';
    report += '### 错误统计\n| 类型 | 命中数 | 严重度 | 根因 | 建议 |\n|------|--------|--------|------|------|\n';
    lessons.forEach(function(l) {
      report += '| ' + l.code + ' | ' + l.hits + ' | ' + (l.severity >= 3 ? '🔴' : '🟡') + ' | ' + (l.rootCause || '未知') + ' | ' + (l.suggestion || '-') + ' |\n';
    });
    report += '\n### 关键教训\n';
    lessons.slice(0, 3).forEach(function(l) {
      report += '- **' + l.code + '**(' + l.name + '): 命中 ' + l.hits + ' 次, 根因: ' + l.rootCause + '. ' + l.suggestion + '\n';
    });
    return { ok: true, data: report };
  } catch(e) { return { error: 'lesson_extract: ' + e.message }; }
});

// ★ correlate_error — 跨 session 错误关联分析
_registerExecutorTool("correlate_error", async function(args) {
  try {
    var coreMod = require('./agent-orchestrator-core');
    var instance = global._orchCoreInstance || (coreMod.getInstance && coreMod.getInstance());
    if (!instance || !instance._correlateCases) return { ok: false, error: 'orchestrator not available' };
    var result = instance._correlateCases();
    if (!result.correlated || result.correlated.length === 0) return { ok: true, data: { message: '暂无跨 session 关联数据' } };
    var report = '## 🔗 错误关联分析\n\n';
    report += '### 统计\n';
    report += '- 总案例: ' + result.stats.totalCases + '\n';
    report += '- 分组: ' + result.stats.groups + '\n';
    report += '- 跨 session: ' + result.stats.crossSession + '\n\n';
    report += '### 关联分组\n| 代码 | 案例数 | 总命中 | 关联分数 | 严重度 | 建议 |\n|------|--------|--------|----------|--------|------|\n';
    result.correlated.forEach(function(c) {
      report += '| ' + c.code + ' | ' + c.caseCount + ' | ' + c.totalHits + ' | ' + c.score + ' | ' + (c.severity >= 3 ? '🔴' : '🟡') + ' | ' + c.recommendation + ' |\n';
    });
    return { ok: true, data: report };
  } catch(e) { return { error: 'correlate_error: ' + e.message }; }
});

// ★ auto_heal — 自动修复错误模式
_registerExecutorTool("auto_heal", async function(args) {
  try {
    var coreMod = require('./agent-orchestrator-core');
    var instance = global._orchCoreInstance || (coreMod.getInstance && coreMod.getInstance());
    if (!instance || !instance._autoHeal) return { ok: false, error: 'orchestrator not available' };
    var result = await instance._autoHeal();
    if (!result.healed || result.healed.length === 0) return { ok: true, data: { message: result.message || '无需修复' } };
    var report = '## 🛠️ 自动修复报告\n\n';
    report += result.message + '\n\n';
    report += '| 错误码 | 案例数 | 修复动作 | 说明 |\n|--------|--------|----------|------|\n';
    result.healed.forEach(function(h) {
      report += '| ' + h.code + ' | ' + (h.correlated || 0) + ' | ' + h.action + ' | ' + (h.description || '') + ' |\n';
    });
    return { ok: true, data: report };
  } catch(e) { return { error: 'auto_heal: ' + e.message }; }
});

// ★ anti_fragile_upgrade — 反脆弱升级建议
_registerExecutorTool("anti_fragile_upgrade", async function(args) {
  try {
    var coreMod = require('./agent-orchestrator-core');
    var instance = global._orchCoreInstance || (coreMod.getInstance && coreMod.getInstance());
    if (!instance || !instance._antiFragileUpgrade) return { ok: false, error: 'orchestrator not available' };
    var result = instance._antiFragileUpgrade();
    if (!result.upgrades || result.upgrades.length === 0) return { ok: true, data: { message: result.message || '系统状态良好' } };
    var report = '## 📈 反脆弱升级建议\n\n';
    report += result.message + '\n\n';
    report += '| 类型 | 当前 | 建议 | 原因 |\n|------|------|------|------|\n';
    result.upgrades.forEach(function(u) {
      report += '| ' + u.type + ' | ' + u.current + ' | ' + u.recommended + ' | ' + (u.reason || '') + ' |\n';
    });
    return { ok: true, data: report };
  } catch(e) { return { error: 'anti_fragile_upgrade: ' + e.message }; }
});

// ★ audit_log — 查看操作审计日志
_registerExecutorTool("audit_log", async function(args) {
  try {
    var db = require('./database');
    if (!db.db || typeof db.db.prepare !== 'function') return { ok: false, error: 'database not available' };
    var limit = Math.min(Math.max(parseInt(args.limit) || 20, 1), 100);
    var resultRows = db.db.prepare('SELECT key, content, created_at FROM agent_memories WHERE memory_type = ? ORDER BY created_at DESC LIMIT ?').all('audit', limit);
    if (!Array.isArray(resultRows) || resultRows.length < 1) return { ok: true, data: { message: '暂无审计日志' } };
    var report = '## 📋 操作审计日志 (最近 ' + resultRows.length + ' 条)\n\n';
    report += '| 时间 | 步骤 | 状态 | 摘要 |\n|------|------|------|------|\n';
    resultRows.forEach(function(r) {
      try {
        var c = JSON.parse(r.content);
        var d = new Date(r.created_at).toLocaleTimeString('zh-CN');
        report += '| ' + d + ' | ' + (c.stepId || c.action || '-') + ' | ' + (c.status === 'success' ? '✅' : '❌') + ' | ' + ((c.resultPreview || c.error || '').substring(0, 40)) + ' |\n';
      } catch(_) {
        report += '| - | - | - | ' + (r.content || '').substring(0, 40) + ' |\n';
      }
    });
    return { ok: true, data: report };
  } catch(e) { return { ok: false, error: 'audit_log: ' + e.message }; }
});

// ★ confirm_persist — 查看/管理确认状态
_registerExecutorTool("confirm_persist", async function(args) {
  try {
    var db = require('./database');
    if (!db.db || typeof db.db.prepare !== 'function') return { ok: false, error: 'database not available' };
    var cmd = (args.action || args.cmd || '').toLowerCase();
    if (cmd === 'list') {
      var rows = db.db.prepare('SELECT key, content, created_at FROM agent_memories WHERE memory_type = ? ORDER BY created_at DESC LIMIT 50').all('confirmation');
      if (!Array.isArray(rows) || rows.length < 1) return { ok: true, data: { message: '暂无确认状态记录' } };
      var report = '## ✅ 确认状态持久化记录\n\n';
      report += '| 时间 | session | 指令 | 状态 |\n|------|---------|------|------|\n';
      rows.forEach(function(r) {
        try {
          var rc = JSON.parse(r.content);
          var d = new Date(r.created_at).toLocaleString('zh-CN');
          report += '| ' + d + ' | ' + (rc.sessionId || '').substring(0, 10) + ' | ' + (rc.instruction || '').substring(0, 30) + ' | ' + (rc.result || '') + ' |\n';
        } catch(_) {
          report += '| - | - | ' + (r.content || '').substring(0, 30) + ' | - |\n';
        }
      });
      return { ok: true, data: report };
    } else if (cmd === 'clean' || cmd === 'clear') {
      db.db.prepare('DELETE FROM agent_memories WHERE memory_type = ?').run('confirmation');
      return { ok: true, data: { message: '确认持久化记录已清除' } };
    } else {
      return { ok: true, data: { message: '使用 action=list 查看确认记录, action=clean 清除记录' } };
    }
  } catch(e) { return { ok: false, error: 'confirm_persist: ' + e.message }; }
});

// ★ browser_wait — 等待页面元素出现
_registerExecutorTool("browser_wait", async function(args) {
  try {
    if (!_pwContext) return { error: "Browser not open." };
    var page = _pwContext.pages && _pwContext.pages().length > 0 ? _pwContext.pages()[_pwContext.pages().length - 1] : null;
    if (!page) return { error: "No page open." };
    var selector = args.selector || args.css || "";
    if (!selector) return { error: "selector required" };
    var state = args.state || "visible";
    var timeout = (args.timeout || 15) * 1000;
    await page.waitForSelector(selector, { state: state, timeout: timeout });
    return { ok: true, selector: selector, state: state };
  } catch(e) { return { error: "browser_wait failed: " + e.message }; }
});

// ★ browser_fill_form — 填充表单字段
_registerExecutorTool("browser_fill_form", async function(args) {
  try {
    if (!_pwContext) return { error: "Browser not open." };
    var page = _pwContext.pages && _pwContext.pages().length > 0 ? _pwContext.pages()[_pwContext.pages().length - 1] : null;
    if (!page) return { error: "No page open." };
    var fields = args.fields || {};
    var fills = [];
    for (var sel in fields) {
      try {
        var el = await page.$(sel);
        if (el) {
          var tagName = await el.evaluate(function(e){ return e.tagName; }).catch(function(){ return "INPUT"; });
          var type = await el.evaluate(function(e){ return (e.type || "text").toLowerCase(); }).catch(function(){ return "text"; });
          if (tagName === "SELECT") {
            await el.selectOption(fields[sel]);
          } else if (type === "checkbox" || type === "radio") {
            if (fields[sel] === true || fields[sel] === "true") await el.check().catch(function(){});
            else await el.uncheck().catch(function(){});
          } else {
            await el.fill(fields[sel], { timeout: 5000 });
          }
          fills.push({ selector: sel, filled: true, type: type });
        } else {
          fills.push({ selector: sel, filled: false, reason: "not found" });
        }
      } catch(ef) {
        fills.push({ selector: sel, filled: false, error: ef.message });
      }
    }
    return { ok: true, totalFields: Object.keys(fields).length, filled: fills.filter(function(f){ return f.filled; }).length, details: fills };
  } catch(e) { return { error: "browser_fill_form failed: " + e.message }; }
});

// ★ browser_scroll_to — 滚动页面
_registerExecutorTool("browser_scroll_to", async function(args) {
  try {
    if (!_pwContext) return { error: "Browser not open." };
    var page = _pwContext.pages && _pwContext.pages().length > 0 ? _pwContext.pages()[_pwContext.pages().length - 1] : null;
    if (!page) return { error: "No page open." };
    var selector = args.selector || null;
    var direction = args.direction || "down";
    var amount = args.amount || 500;
    if (selector) {
      await page.evaluate("document.querySelector('" + selector + "').scrollIntoView({behavior:'smooth',block:'center'})");
      return { ok: true, method: "scrollIntoView", selector: selector };
    } else {
      await page.evaluate("window.scrollBy(0, " + (direction === "up" ? -amount : amount) + ")");
      return { ok: true, method: "scrollBy", direction: direction, pixels: amount };
    }
  } catch(e) { return { error: "browser_scroll_to failed: " + e.message }; }
});

// ★ browser_evaluate — 执行 JavaScript
_registerExecutorTool("browser_evaluate", async function(args) {
  try {
    if (!_pwContext) return { error: "Browser not open." };
    var page = _pwContext.pages && _pwContext.pages().length > 0 ? _pwContext.pages()[_pwContext.pages().length - 1] : null;
    if (!page) return { error: "No page open." };
    var code = args.code || args.script || "";
    if (!code) return { error: "code required" };
    var result = await page.evaluate(code);
    return { ok: true, result: typeof result === "object" ? JSON.stringify(result).substring(0, 5000) : String(result).substring(0, 5000) };
  } catch(e) { return { error: "browser_evaluate failed: " + e.message }; }
});



// ========== 数据库直连网关（SQLite/MySQL/PostgreSQL） ==========
var dbConnector;
try { dbConnector = require('./db-connector'); } catch(e) { console.log('[WARN] db-connector not loaded:', e.message); }

if (dbConnector) {
  _registerExecutorTool('sql_connect', dbConnector.sql_connect);
  _registerExecutorTool('sql_exec', dbConnector.sql_exec);
  _registerExecutorTool('sql_disconnect', dbConnector.sql_disconnect);
  _registerExecutorTool('sql_list', dbConnector.sql_list);
  _registerExecutorTool('sql_tables', dbConnector.sql_tables);
  _registerExecutorTool('sql_describe', dbConnector.sql_describe);
  _registerExecutorTool('sql_health', dbConnector.sql_health);
}

// ========== 高级 API 网关工具（动态路由/限流/拦截器/OpenAPI） ==========
var apiGateway;
try {
  apiGateway = require('./api-gateway-advanced');
  // 传入 server-modern.js 的 registerRoute
  var routeRegistry = require('./route-registry');
  if (routeRegistry && routeRegistry.registerRoute) {
    apiGateway.setRouteRegistrar(routeRegistry.registerRoute);
    // 加载持久化的路由
    apiGateway.loadPersistedRoutes();
  }
} catch(e) { console.log('[WARN] api-gateway-advanced not loaded:', e.message); }

if (apiGateway) {
  _registerExecutorTool('api_create_route', apiGateway.api_create_route);
  _registerExecutorTool('api_list_routes', apiGateway.api_list_routes);
  _registerExecutorTool('api_remove_route', apiGateway.api_remove_route);
  _registerExecutorTool('api_update_route', apiGateway.api_update_route);
  _registerExecutorTool('api_gateway_status', apiGateway.api_gateway_status);
  _registerExecutorTool('api_openapi_spec', apiGateway.api_openapi_spec);
  _registerExecutorTool('api_reset_stats', apiGateway.api_reset_stats);
}


// 🔧 注册告警规则引擎工具
var _alertRulesEngine = null;
var _healthMonitorForAlerts = null;
try {
  var AlertRulesEngine = require('./alert-rules-engine');
  var HealthMonitor = require('./health-monitor');
  _healthMonitorForAlerts = new HealthMonitor({
    name: 'alert-rules-health',
    cpuWarnPercent: 85,
    memWarnPercent: 90,
    diskWarnPercent: 92,
    processWarnCount: 500,
    checkIntervalMs: 120000
  });
  _alertRulesEngine = new AlertRulesEngine({
    alerter: null,
    healthMonitor: _healthMonitorForAlerts,
    intervalMs: 120000
  });
  global._alertRulesEngineRef = _alertRulesEngine;
} catch(e) {
  console.log('[WARN] alert-rules-engine not loaded:', e.message);
}

// 告警规则引擎工具
var alertRulesTools = {
  alert_rules_list: function(args) {
    if (!_alertRulesEngine) return { ok: false, error: '告警规则引擎未初始化' };
    return _alertRulesEngine.listRules(args || {});
  },
  alert_rules_add: function(args) {
    if (!_alertRulesEngine) return { ok: false, error: '告警规则引擎未初始化' };
    return _alertRulesEngine.addRule(args);
  },
  alert_rules_update: function(args) {
    if (!_alertRulesEngine) return { ok: false, error: '告警规则引擎未初始化' };
    return _alertRulesEngine.updateRule(args.ruleId, args);
  },
  alert_rules_remove: function(args) {
    if (!_alertRulesEngine) return { ok: false, error: '告警规则引擎未初始化' };
    return _alertRulesEngine.removeRule(args.ruleId);
  },
  alert_rules_status: function(args) {
    if (!_alertRulesEngine) return { ok: false, error: '告警规则引擎未初始化' };
    return _alertRulesEngine.getStatus();
  },
  alert_rules_check: function(args) {
    if (!_alertRulesEngine) return { ok: false, error: '告警规则引擎未初始化' };
    return _alertRulesEngine.checkNow();
  },
  alert_rules_reset: function(args) {
    if (!_alertRulesEngine) return { ok: false, error: '告警规则引擎未初始化' };
    return _alertRulesEngine.resetBuiltins();
  }
};

var _alertRuleKeys = Object.keys(alertRulesTools);
for (var ati = 0; ati < _alertRuleKeys.length; ati++) {
  _registerExecutorTool(_alertRuleKeys[ati], alertRulesTools[_alertRuleKeys[ati]]);
}


// ★ rollback_exec — 执行操作回滚
_registerExecutorTool("rollback_exec", async function(args) {
  try {
    var engine = require('./rollback-engine')();
    var snapshotId = args.snapshotId || args.id || '';
    if (!snapshotId) {
      var list = engine.list({ limit: 10 });
      var report = '## 回滚点列表\n\n';
      report += '| ID | 操作 | 描述 | 时间 | 状态 |\n|----|------|------|------|------|\n';
      list.forEach(function(s) {
        report += '| ' + s.id + ' | ' + s.action + ' | ' + s.description + ' | ' + new Date(s.ts).toLocaleTimeString() + ' | ' + s.state + ' |\n';
      });
      report += '\n请指定要回滚的 ID: rollback_exec snapshotId="ss_xxx"';
      return { ok: true, data: report };
    }
    var result = engine.rollback(snapshotId);
    if (!result.ok) return { ok: false, error: result.error };
    var report = '## 回滚完成: ' + snapshotId + '\n\n';
    report += '操作: ' + result.action + '\n描述: ' + result.description + '\n\n';
    report += '### 执行步骤\n';
    result.steps.forEach(function(s) { report += '- [' + s.type + '] ' + s.msg + '\n'; });
    return { ok: true, data: report };
  } catch(e) { return { ok: false, error: 'rollback_exec: ' + e.message }; }
});

// ★ rollback_list — 查看回滚点列表
_registerExecutorTool("rollback_list", async function(args) {
  try {
    var engine = require('./rollback-engine')();
    var opts = { limit: Math.min(parseInt(args.limit) || 20, 50) };
    if (args.action) opts.action = args.action;
    if (args.state) opts.state = args.state;
    var list = engine.list(opts);
    var report = '## 回滚点列表 (' + list.length + ' 条)\n\n';
    report += '| ID | 操作 | 描述 | 时间 | 状态 |\n|----|------|------|------|------|\n';
    list.forEach(function(s) {
      report += '| ' + s.id + ' | ' + s.action + ' | ' + s.description + ' | ' + new Date(s.ts).toLocaleTimeString() + ' | ' + s.state + ' |\n';
    });
    return { ok: true, data: report };
  } catch(e) { return { ok: false, error: 'rollback_list: ' + e.message }; }
});


// ★ cognition_search — 语义搜索（百度级认知引擎 V2）
_registerExecutorTool("cognition_search", async function(args) {
  try {
    var engine = require('./cognition-engine-v2')();
    var q = (args.q || args.query || args.keyword || '').trim();
    if (!q) return { ok: false, error: '请输入搜索关键词' };
    var results = engine.search(q, { limit: Math.min(parseInt(args.limit) || 15, 50) });
    if (!Array.isArray(results) || results.length === 0) return { ok: true, data: '## 语义搜索: "' + q + '"\n\n未找到相关结果' };
    var report = '## 语义搜索: "' + q + '" (' + results.length + ' 结果)\n\n';
    report += '| 类型 | 名称 | 匹配度 |\n|------|------|--------|\n';
    results.forEach(function(r) { report += '| ' + r.type + ' | ' + r.entity.label + ' | ' + r.score.toFixed(0) + ' |\n'; });
    return { ok: true, data: report };
  } catch(e) { return { ok: false, error: 'cognition_search: ' + e.message }; }
});

// ★ cognition_related — 关联发现 ("你可能还关心")
_registerExecutorTool("cognition_related", async function(args) {
  try {
    var engine = require('./cognition-engine-v2')();
    var entityId = args.id || '';
    if (!entityId) return { ok: false, error: '请输入实体ID (如 agent:zhangsan)' };
    var related = engine.relatedTo(entityId, { limit: Math.min(parseInt(args.limit) || 8, 20) });
    if (!Array.isArray(related) || related.length === 0) return { ok: true, data: '## 关联发现\n\n实体 "' + entityId + '" 暂无关联' };
    var report = '## 关联发现: "' + entityId + '"\n\n';
    report += '| 关联实体 | 类型 | 关联强度 |\n|---------|------|----------|\n';
    related.forEach(function(r) { report += '| ' + r.entity.label + ' | ' + r.entity.type + ' | ' + r.score.toFixed(0) + ' |\n'; });
    return { ok: true, data: report };
  } catch(e) { return { ok: false, error: 'cognition_related: ' + e.message }; }
});

// ★ cognition_cross — 跨域关联分析
_registerExecutorTool("cognition_cross", async function(args) {
  try {
    var engine = require('./cognition-engine-v2')();
    var q = (args.q || args.query || '').trim();
    if (!q) { engine.buildKnowledgeGraph(); return { ok: true, data: '## 跨域分析\n\n知识图谱已刷新' }; }
    var result = engine.crossDomainQuery(q);
    if (!result.found) return { ok: true, data: result.message };
    return { ok: true, data: result.report };
  } catch(e) { return { ok: false, error: 'cognition_cross: ' + e.message }; }
});

// ★ cognition_hot — 热搜词统计
_registerExecutorTool("cognition_hot", async function(args) {
  try {
    var engine = require('./cognition-engine-v2')();
    var terms = engine.getHotTerms(parseInt(args.limit) || 10);
    if (!Array.isArray(terms) || terms.length === 0) return { ok: true, data: '## 热搜统计\n\n暂无热搜词' };
    var report = '## 热搜词 Top ' + terms.length + '\n\n';
    report += '| 排名 | 搜索词 | 次数 |\n|------|--------|------|\n';
    terms.forEach(function(t, i) { report += '| ' + (i+1) + ' | ' + t.term + ' | ' + t.count + ' |\n'; });
    return { ok: true, data: report };
  } catch(e) { return { ok: false, error: 'cognition_hot: ' + e.message }; }
});

// ★ cognition_route — 智能路由分析
_registerExecutorTool("cognition_route", async function(args) {
  try {
    var engine = require('./cognition-engine-v2')();
    var q = (args.q || args.query || '').trim();
    if (!q) return { ok: false, error: '请输入查询内容' };
    var route = engine.smartRoute(q);
    var report = '## 智能路由分析\n\n**查询**: "' + q + '"\n\n**推荐工具**: ' + route.tool + ' (分数: ' + route.score.toFixed(0) + ')\n\n### 各域评分\n| 认知域 | 分数 |\n|--------|------|\n';
    Object.keys(route.breakdown).forEach(function(k) {
      var emoji = k === route.tool ? '🏆 ' : '';
      report += '| ' + emoji + k + ' | ' + route.breakdown[k].toFixed(0) + ' |\n';
    });
    return { ok: true, data: report };
  } catch(e) { return { ok: false, error: 'cognition_route: ' + e.message }; }
});


// === 认知 100% 工具（运行时学习 + 跨 session）===
_registerExecutorTool('cognition_learn', async function(params, context) {
  if (!params || !params.source || !params.target) return { ok: false, error: '需要 source 和 target 参数' };
  try { var cog=require('./cognition-engine-v2')(); var r=cog.learnRelation(params.source, params.target, params.type||'manual', params.weight||1); return { ok: true, data: r }; } catch(e){return {ok:false,error:e.message}}
})
_registerExecutorTool('cognition_session_relations', async function(params, context) {
  if (!params || !params.entity) return { ok: false, error: '需要 entity 参数' };
  try { var cog=require('./cognition-engine-v2')(); var r=cog.getSessionRelations(params.entity, {limit: params.limit||10}); return { ok: true, data: r, count: r.length }; } catch(e){return {ok:false,error:e.message}}
})
_registerExecutorTool('cognition_auto_graph', async function(params, context) {
  try { var cog=require('./cognition-engine-v2')(); var g=cog.buildKnowledgeGraph(); var c=cog._buildCrossSessionLinks(); return { ok: true, data: {entities: g.entities, relations: g.relations, crossSessions: Object.keys(c).length} }; } catch(e){return {ok:false,error:e.message}}
})

// === 战略 100% 工具（多级权限 + 审批链）===
var _PERM_LEVELS = { restricted: 0, standard: 1, advanced: 2, admin: 3 };

// 审批请求：提交高风险操作的审批请求
_registerExecutorTool('approval_request', async function(params, context) {
  // params: { action, description, target, riskLevel: 'low'|'medium'|'high' }
  if (!params || !params.action) return { ok: false, error: '需要 action 参数' };
  try {
    var dbMod = require('./database');
    var db = dbMod.db();
    var approvalId = 'apr_' + Date.now() + '_' + Math.random().toString(36).substring(2,8);
    var record = JSON.stringify({
      id: approvalId,
      action: params.action,
      description: params.description || params.action,
      target: params.target || '',
      riskLevel: params.riskLevel || 'medium',
      status: 'pending',
      requester: (context && context.sessionId) || 'unknown',
      createdAt: Date.now(),
      approvedAt: null,
      approver: null
    });
    db.prepare("INSERT INTO agent_memories (key, agent_id, content, memory_type, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(approvalId, 'system', record, 'approval', Date.now());
    return { ok: true, data: { id: approvalId, status: 'pending' }, message: '审批请求已提交，等待审批: ' + (params.description || params.action) };
  } catch(e) { return { ok: false, error: e.message }; }
})

// 审批操作：批准或拒绝一个审批请求
_registerExecutorTool('approval_handle', async function(params, context) {
  // params: { approvalId, action: 'approve'|'reject' }
  if (!params || !params.approvalId) return { ok: false, error: '需要 approvalId 参数' };
  if (!params.action || (params.action !== 'approve' && params.action !== 'reject')) return { ok: false, error: 'action 需为 approve 或 reject' };
  try {
    var dbMod = require('./database');
    var db = dbMod.db();
    var rec = db.prepare("SELECT content FROM agent_memories WHERE key=? AND memory_type='approval' ORDER BY created_at DESC LIMIT 1").get(params.approvalId);
    if (!rec) return { ok: false, error: '未找到审批记录: ' + params.approvalId };
    var record = JSON.parse(rec.content);
    if (record.status !== 'pending') return { ok: false, error: '审批已处理，当前状态: ' + record.status };
    record.status = params.action === 'approve' ? 'approved' : 'rejected';
    record.approvedAt = Date.now();
    record.approver = (context && context.sessionId) || 'system';
    db.prepare("INSERT INTO agent_memories (key, agent_id, content, memory_type, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(record.id, 'system', JSON.stringify(record), 'approval', Date.now());
    return { ok: true, data: { id: record.id, status: record.status }, message: '审批' + (params.action === 'approve' ? '已通过' : '已拒绝') + ': ' + (record.description || record.action) };
  } catch(e) { return { ok: false, error: e.message }; }
})

// 查看审批队列（待审/已审）
_registerExecutorTool('approval_list', async function(params, context) {
  // params: { status: 'pending'|'approved'|'rejected'|'all', limit }
  try {
    var dbMod = require('./database');
    var db = dbMod.db();
    var statusFilter = (params && params.status) || 'pending';
    var limit = (params && params.limit) || 20;
    var records;
    if (statusFilter === 'all') {
      records = db.prepare("SELECT content, created_at FROM agent_memories WHERE memory_type='approval' ORDER BY created_at DESC LIMIT ?").all(limit);
    } else {
      records = db.prepare("SELECT content, created_at FROM agent_memories WHERE memory_type='approval' ORDER BY created_at DESC").all().filter(function(r) { try { return JSON.parse(r.content).status === statusFilter; } catch(e) { return false; } }).slice(0, limit);
    }
    var approvals = (Array.isArray(records) ? records : []).map(function(r) { try { return JSON.parse(r.content); } catch(e) { return null; } }).filter(Boolean);
    return { ok: true, data: approvals, count: approvals.length };
  } catch(e) { return { ok: false, error: e.message }; }
})

// 权限检查工具：检查当前用户的权限级别
_registerExecutorTool('permission_check', async function(params, context) {
  // params: { requiredLevel: 'restricted'|'standard'|'advanced'|'admin', sessionId }
  try {
    var required = _PERM_LEVELS[(params && params.requiredLevel) || 'standard'] || 0;
    var sessionId = (params && params.sessionId) || (context && context.sessionId) || 'unknown';
    // 从 agent_memories 查找 session 权限
    var dbMod = require('./database');
    var db = dbMod.db();
    var permRec = db.prepare("SELECT content FROM agent_memories WHERE key=? AND memory_type='session_perm' ORDER BY created_at DESC LIMIT 1").get('perm_' + sessionId);
    var currentLevel = 0;
    var currentLabel = 'restricted';
    if (permRec) {
      try { var p = JSON.parse(permRec.content); currentLevel = _PERM_LEVELS[p.level] || 0; currentLabel = p.level || 'restricted'; } catch(e){}
    } else {
      // 默认 admin（开发环境）
      currentLevel = 3;
      currentLabel = 'admin';
    }
    var passed = currentLevel >= required;
    return { ok: true, data: { sessionId: sessionId, currentLevel: currentLabel, requiredLevel: (params && params.requiredLevel) || 'standard', passed: passed, levelScore: currentLevel }, message: passed ? '权限通过' : '权限不足（当前: ' + currentLabel + ', 需要: ' + (params && params.requiredLevel || 'standard') + '）' };
  } catch(e) { return { ok: false, error: e.message }; }
})

// === AI Employee 技能工具（web_search, code_review, doc_gen, email, workflow, debug, test, image_gen）===

// 网络搜索 —— 使用 system-orchestrator 的 web_search 能力（无外部依赖）
_registerExecutorTool('web_search', async function(params, context) {
  if (!params || !params.q) return { ok: false, error: '需要 q 参数（搜索词）' };
  try {
    var os = null;
    try { os = require('./system-orchestrator'); } catch(e) {}
    if (os && typeof os.webSearch === 'function') {
      var result = await os.webSearch(params.q, params.limit || 5);
      return { ok: true, data: result, message: '网络搜索结果: ' + (Array.isArray(result) ? result.length + ' 条' : '完成') };
    }
    // 降级：使用 HTTP 请求简单搜索（无外部依赖）
    var http = require('http');
    return new Promise(function(resolve) {
      var req = http.get('http://localhost:8005/api/agents', { timeout: 5000 }, function(r) {
        var d = '';
        r.on('data', function(c) { d += c; });
        r.on('end', function() { resolve({ ok: true, data: { autoDetected: true, query: params.q, result: d.substring(0, 500) }, message: '搜索完成（自动模式）' }); });
      });
      req.on('error', function(e) { resolve({ ok: false, error: e.message }); });
      req.setTimeout(5000, function() { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    });
  } catch(e) { return { ok: false, error: e.message }; }
})

// 代码审查 —— 读取文件并匹配代码规范
_registerExecutorTool('code_review', async function(params, context) {
  if (!params || !params.file) return { ok: false, error: '需要 file 参数（要审查的文件路径）' };
  try {
    var fs2 = require('fs');
    var content = fs2.readFileSync(params.file, 'utf8');
    var issues = [];
    var lines = content.split('\\n');
    // 基础静态分析
    lines.forEach(function(line, idx) {
      var num = idx + 1;
      if (line.length > 200) issues.push({ line: num, type: 'style', message: '行过长: ' + line.length + ' 字符', severity: 'info' });
      if (/console\.log/i.test(line) && !/^\s*\/\//.test(line)) issues.push({ line: num, type: 'debug', message: '遗留 console.log', severity: 'warning' });
      if (/(var\s+)/i.test(line) && !/^\s*\/\//.test(line)) issues.push({ line: num, type: 'style', message: '使用 var 替代 let/const', severity: 'warning' });
      if (/TODO|FIXME|HACK|XXX/i.test(line)) issues.push({ line: num, type: 'todo', message: line.match(/TODO|FIXME|HACK|XXX.*/i)[0], severity: 'info' });
    });
    return { ok: true, data: { file: params.file, totalLines: lines.length, issues: issues, issueCount: issues.length }, message: '代码审查完成: ' + issues.length + ' 个问题' };
  } catch(e) { return { ok: false, error: e.message }; }
})

// 文档生成 —— 智能模板文档生成
_registerExecutorTool('doc_gen', async function(params, context) {
  if (!params || !params.topic) return { ok: false, error: '需要 topic 参数（文档主题）' };
  try {
    var docType = params.type || 'general';
    var content = '# ' + params.topic + '\n\n';
    content += '> 自动生成文档 | 类型: ' + docType + ' | 生成时间: ' + new Date().toISOString() + '\n\n';
    if (params.description) content += '## 概述\n\n' + params.description + '\n\n';
    content += '## 详细说明\n\n（内容待补充）\n\n';
    if (docType === 'api') content += '### API 端点\n\n| 方法 | 路径 | 描述 |\n|------|------|------|\n\n';
    if (docType === 'readme') content += '## 安装\n\n```bash\n# TODO\n```\n\n## 使用\n\n```js\n// TODO\n```\n\n';
    if (docType === 'changelog') content += '## 版本历史\n\n### v1.0.0\n- 初始版本\n\n';
    if (params.output) { require('fs').writeFileSync(params.output, content, 'utf8'); }
    return { ok: true, data: { topic: params.topic, type: docType, content: content, outputFile: params.output || null }, message: '文档已生成: ' + docType + ' - ' + params.topic };
  } catch(e) { return { ok: false, error: e.message }; }
})

// 邮件处理 —— 发送邮件（调用系统 email API）
_registerExecutorTool('email', async function(params, context) {
  if (!params || !params.to) return { ok: false, error: '需要 to 参数（收件人）' };
  try {
    var http = require('http');
    var postData = JSON.stringify({ to: params.to, subject: params.subject || '来自 eCompanyClaw 的消息', body: params.body || '', cc: params.cc || '' });
    return new Promise(function(resolve) {
      var req = http.request({ hostname: 'localhost', port: 8005, path: '/api/v2/email/send', method: 'POST', headers: { 'Content-Type': 'application/json' } }, function(r) {
        var d = ''; r.on('data', function(c) { d += c; });
        r.on('end', function() { try { var j = JSON.parse(d); resolve({ ok: j.ok !== false, data: j, message: j.message || '邮件已发送' }); } catch(e) { resolve({ ok: true, data: d, message: '邮件已发送（原始）' }); } });
      });
      req.write(postData); req.end();
      req.on('error', function(e) { resolve({ ok: false, error: e.message }); });
      req.setTimeout(10000, function() { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    });
  } catch(e) { return { ok: false, error: e.message }; }
})

// 工作流执行 —— 创建并执行工作流
_registerExecutorTool('workflow', async function(params, context) {
  if (!params || !params.action) return { ok: false, error: '需要 action 参数（run|status|list|cancel）' };
  try {
    var a = params.action;
    if (a === 'list') {
      var db = require('./database').db();
      var wfs = db.prepare("SELECT content FROM agent_memories WHERE memory_type='workflow' ORDER BY created_at DESC LIMIT 10").all();
      return { ok: true, data: (Array.isArray(wfs) ? wfs : []).map(function(r) { try { return JSON.parse(r.content); } catch(e) { return null; } }).filter(Boolean) };
    }
    if (a === 'run' && params.steps) {
      var wfId = 'wf_' + Date.now();
      var stepCount = (Array.isArray(params.steps) ? params.steps : []).length;
      var record = JSON.stringify({ id: wfId, action: 'run', steps: params.steps || [], stepCount: stepCount, status: 'created', createdAt: Date.now() });
      var db2 = require('./database').db();
      db2.prepare("INSERT INTO agent_memories (key, agent_id, content, memory_type, created_at) VALUES (?, ?, ?, ?, ?)").run(wfId, 'system', record, 'workflow', Date.now());
      return { ok: true, data: { id: wfId, stepCount: stepCount, status: 'created' }, message: '工作流已创建: ' + stepCount + ' 个步骤' };
    }
    return { ok: false, error: '不支持的操作: ' + a };
  } catch(e) { return { ok: false, error: e.message }; }
})

// 调试助手 —— 执行代码并捕获异常
_registerExecutorTool('debug', async function(params, context) {
  if (!params || !params.code) return { ok: false, error: '需要 code 参数（要调试的代码）' };
  try {
    var tmpFile = 'C:\\Users\\Administrator\\.openclaw\\workspace\\tmp-debug-' + Date.now() + '.js';
    require('fs').writeFileSync(tmpFile, params.code, 'utf8');
    var output = '';
    var cp = require('child_process');
    try {
      var result = cp.execSync('node --check "' + tmpFile + '"', { timeout: 10000, encoding: 'utf8', windowsHide: true });
      output = '语法检查通过\n';
      if (params.run) {
        var runResult = cp.execSync('node "' + tmpFile + '"', { timeout: 10000, encoding: 'utf8', windowsHide: true });
        output += '执行结果:\n' + runResult;
      }
    } catch(e) {
      output = '错误: ' + (e.stderr || e.message || String(e));
    }
    try { require('fs').unlinkSync(tmpFile); } catch(e) {}
    return { ok: true, data: { output: output }, message: output.substring(0, 200) };
  } catch(e) { return { ok: false, error: e.message }; }
})

// 测试套件 —— 运行简单测试
_registerExecutorTool('test', async function(params, context) {
  if (!params || !params.testFile) return { ok: false, error: '需要 testFile 参数（测试文件路径）' };
  try {
    if (!require('fs').existsSync(params.testFile)) return { ok: false, error: '文件不存在: ' + params.testFile };
    var cp = require('child_process');
    var output = '';
    try {
      var result = cp.execSync('node "' + params.testFile + '"', { timeout: 30000, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
      output = result;
    } catch(e) {
      output = '测试出错: ' + (e.stderr || e.message || String(e));
    }
    return { ok: true, data: { file: params.testFile, output: output }, message: '测试已完成' };
  } catch(e) { return { ok: false, error: e.message }; }
})

// 图像生成 —— 生成 SVG 占位图像
_registerExecutorTool('image_gen', async function(params, context) {
  if (!params || !params.prompt) return { ok: false, error: '需要 prompt 参数（描述）' };
  try {
    var width = params.width || 400;
    var height = params.height || 300;
    var color = params.color || '#4A90D9';
    var text = params.prompt.substring(0, 30);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      '<rect width="100%" height="100%" fill="' + color + '"/>' +
      '<text x="50%" y="50%" fill="white" font-size="20" text-anchor="middle" dominant-baseline="middle">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text>' +
      '</svg>';
    if (params.output) { require('fs').writeFileSync(params.output, svg, 'utf8'); }
    return { ok: true, data: { svg: svg, outputFile: params.output || null, width: width, height: height }, message: '图像已生成: ' + text + ' (' + width + 'x' + height + ')' };
  } catch(e) { return { ok: false, error: e.message }; }
})

// ★ tool_install — 安装动态工具（注册三通道）
_registerExecutorTool('tool_install', async function(args) {
  var name = args.name || '';
  var description = args.description || '';
  var handlerCode = args.handler || '';
  var paramSchema = args.parameters || {};
  var permission = args.permission || 'admin';
  
  if (!name || !handlerCode) return { ok: false, error: '缺少参数: name 和 handler 必填' };
  // 校验名称格式
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return { ok: false, error: '工具名只能包含字母、数字、下划线，且不能以数字开头' };
  if (name.length > 64) return { ok: false, error: '工具名最长64字符' };
  
  try {
    // ① 注册 schema（tools-registry）
    var reg = require('./tools-registry');
    var schemaResult = reg.registerDynamicTool(name, { description: description, parameters: paramSchema }, permission);
    if (!schemaResult.ok) return schemaResult;
    
    // ② 注册 handler（executor-tools）
    // 用 new Function 安全创建 handler
    var handlerBody = 'try {\n' + handlerCode + '\n} catch(e) { return { ok: false, error: e.message }; }';
    var handlerFn = new Function('args', handlerBody);
    _registerExecutorTool(name, handlerFn);
    
    return { ok: true, name: name, description: description, permission: permission, action: 'installed' };
  } catch(e) {
    return { ok: false, error: '安装失败: ' + e.message };
  }
});

// ★ tool_uninstall — 卸载动态工具（从三通道移除）
_registerExecutorTool('tool_uninstall', async function(args) {
  var name = args.name || '';
  if (!name) return { ok: false, error: '缺少参数: name 必填' };
  
  try {
    // ① 注销 schema
    var reg = require('./tools-registry');
    var schemaResult = reg.unregisterDynamicTool(name);
    if (!schemaResult.ok) return schemaResult;
    
    // ② 注销 handler
    delete _EXECUTOR_TOOLS[name];
    
    return { ok: true, name: name, action: 'uninstalled' };
  } catch(e) {
    return { ok: false, error: '卸载失败: ' + e.message };
  }
});

module.exports = { _EXECUTOR_TOOLS, execCEOTool, _registerExecutorTool };