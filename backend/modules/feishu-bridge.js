/**
 * feishu-bridge.js — 独立飞书桥接 v2
 *
 * 使用官方 @larksuiteoapi/node-sdk 直连飞书，不依赖 OpenClaw 网关。
 * 消息 → eCompany CEO → 回复飞书 + 同步工作台
 *
 * 飞书协议：SDK WSClient（WebSocket 事件订阅）
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG = {
  healthPort: 28002,
  eCompanyHost: '127.0.0.1',
  eCompanyPort: 8005,
  apiBase: 'https://open.feishu.cn/open-apis',
  logFile: path.join(__dirname, '..', 'logs', 'feishu-bridge.log'),
  healthFile: path.join(__dirname, '..', 'logs', 'feishu-bridge.status.json'),
};

function loadCredentials() {
  // 优先读 eCompany 自有配置 channels-config.json
  try {
    var ccPath = path.join(__dirname, '..', 'channels-config.json');
    if (fs.existsSync(ccPath)) {
      var raw = fs.readFileSync(ccPath, 'utf-8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
      var cc = JSON.parse(raw);
      var fc = cc.feishu;
      if (fc && fc.appId && fc.appSecret) {
        return { appId: fc.appId, appSecret: fc.appSecret, accountId: fc.userId || 'default' };
      }
    }
  } catch(e) {}
  // 回退到 openclaw.json（旧兼容）
  try {
    var cfgPath = path.join(process.env.USERPROFILE, '.openclaw', 'openclaw.json');
    if (!fs.existsSync(cfgPath)) return null;
    var raw = fs.readFileSync(cfgPath, 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
    var cfg = JSON.parse(raw);
    var fc = cfg.channels && cfg.channels.feishu;
    if (fc && fc.appId && fc.appSecret) {
      return { appId: fc.appId, appSecret: fc.appSecret, accountId: 'default' };
    }
  } catch(e) {}
  return null;
}

function log(level, msg) {
  var ts = new Date().toISOString();
  var line = '[' + ts + '] [' + level + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(CONFIG.logFile, line + '\n', 'utf-8'); } catch(e) {}
}

function httpPost(host, port, pathname, body) {
  return new Promise(function(resolve, reject) {
    var data = JSON.stringify(body);
    var opts = {
      hostname: host, port: port,
      path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 65000,
    };
    var req = http.request(opts, function(res) {
      var d = ''; res.on('data', function(c) { d += c; });
      res.on('end', function() { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    req.write(data); req.end();
  });
}

function forwardToECompany(message, from, chatId) {
  return httpPost(CONFIG.eCompanyHost, CONFIG.eCompanyPort, '/api/v4/channel/incoming', {
    message: message, from: from || chatId || '', channel: 'feishu'
  });
}

async function sendFeishuMessage(client, receiveId, text, receiveIdType) {
  try {
    var resp = await client.im.message.create({
      params: { receive_id_type: receiveIdType || 'open_id' },
      data: {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: text })
      }
    });
    if (resp.code === 0) return true;
    log('WARN', 'send fail: ' + JSON.stringify(resp).substring(0, 150));
    return false;
  } catch(e) {
    log('ERROR', 'send error: ' + e.message);
    return false;
  }
}

var bridgeStatus = {
  status: 'starting', startedAt: null, lastEventAt: null, lastMessageAt: null,
  errorCount: 0, messageCount: 0, account: '',
};

function startHealthServer() {
  var server = http.createServer(function(req, res) {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(bridgeStatus));
    } else { res.writeHead(404); res.end('not found'); }
  });
  server.listen(CONFIG.healthPort, '127.0.0.1', function() {
    log('INFO', 'health: http://127.0.0.1:' + CONFIG.healthPort + '/health');
  });
  server.on('error', function(e) { log('WARN', 'health port taken: ' + e.message); });
}

function startHealthWriter() {
  setInterval(function() {
    try { fs.writeFileSync(CONFIG.healthFile, JSON.stringify(bridgeStatus, null, 2), 'utf-8'); } catch(e) {}
  }, 15000);
}

var stopped = false;

async function main() {
  log('INFO', '=== Feishu Bridge v2 ===');
  log('INFO', 'PID: ' + process.pid);

  var creds = loadCredentials();
  if (!creds) {
    log('WARN', 'no feishu credentials, waiting...');
    bridgeStatus.status = 'waiting_account';
    bridgeStatus.startedAt = new Date().toISOString();
    startHealthServer();
    startHealthWriter();
    // 定期检查
    // 账号已锁定：不自动切换，除非进程重启
  log('INFO', '账号已锁定，停止凭证轮询');
    return;
  }

  log('INFO', 'App ID: ' + creds.appId);
  bridgeStatus.account = creds.appId;
  bridgeStatus.startedAt = new Date().toISOString();

  startHealthServer();
  startHealthWriter();

  var Lark = await import('@larksuiteoapi/node-sdk');

  var client = new Lark.Client({
    appId: creds.appId,
    appSecret: creds.appSecret,
    logLevel: Lark.LoggerLevel.debug,
  });
  log('INFO', 'Client created');

  var eventDispatcher = new Lark.EventDispatcher({});
  var wsHandler = new Lark.WSClient({
    appId: creds.appId,
    appSecret: creds.appSecret,
    logLevel: Lark.LoggerLevel.debug,
  });

  log('INFO', 'WSClient + EventDispatcher created');
  bridgeStatus.status = 'connecting';

  // WSClient 事件监听
  wsHandler.onError = function(err) {
    log('WARN', 'WSClient error: ' + (err.message || err));
    bridgeStatus.errorCount++;
  };
  wsHandler.onReconnecting = function(retry) {
    log('WARN', 'WSClient reconnecting (attempt ' + retry + ')...');
    bridgeStatus.status = 'reconnecting';
  };
  wsHandler.onReconnected = function() {
    log('INFO', 'WSClient reconnected');
    bridgeStatus.status = 'running';
  };

  eventDispatcher.register({
    '*': async function(d) {
      log('INFO', 'CATCHALL type=' + (d && d['type']));
      log('INFO', 'CATCHALL keys=' + Object.keys(d || {}).join(','));
    },
    'im.message.receive_v1': async function(data) {
    log('INFO', 'EVENT FIRED! type=im.message.receive_v1');
    log('INFO', 'DATA keys=' + Object.keys(data).join(','));
    bridgeStatus.lastEventAt = new Date().toISOString();

    if (!data.message) { log('WARN', 'no message in event'); return; }
    var message = data.message;

    var msgType = message.message_type || '';
    var content = message.content || '{}';
    var sender = data.sender || {};
    var senderId = sender.sender_id || {};
    var openId = senderId.open_id || '';
    var chatId = message.chat_id || '';
    var chatType = message.chat_type || 'p2p';

    log('INFO', 'msgType=' + msgType + ' openId=' + openId);
    log('INFO', 'msg type=' + message.message_type + ' chat=' + message.chat_type + ' content=' + (message.content || '').substring(0, 60));

    // 语音/音频消息处理
    if (msgType === 'audio') {
      log('INFO', '收到语音消息: ' + content.substring(0, 200));
      try {
        var audioInfo = JSON.parse(content);
        log('INFO', '语音文件信息: file_key=' + (audioInfo.file_key || audioInfo.fileToken || audioInfo.file_token || '?') + ' duration=' + (audioInfo.duration || '?'));
      } catch(e) { log('INFO', '语音内容解析失败: ' + e.message); }
      // 飞书音频需要先用 file_key 下载再转写，暂时返回占位
      textContent = '[收到语音消息，语音识别功能开发中]';
    }
    
    if (msgType !== 'text' && msgType !== 'audio') { log('INFO', 'not text/audio, skipping type=' + msgType); return; }

    try {
      var textContent = textContent || JSON.parse(content).text || content;
      textContent = textContent.replace(/@_user_\d+/g, '').trim();
      if (!textContent) { log('WARN', 'empty text'); return; }

      log('INFO', 'msg from ' + openId + ': ' + textContent.substring(0, 60));
      bridgeStatus.lastMessageAt = new Date().toISOString();
      bridgeStatus.messageCount++;

      var ecoResp = await forwardToECompany(textContent, openId, chatId);
      var replyText = (ecoResp && ecoResp.reply) || '';
      log('INFO', 'CEO reply: ' + (replyText.substring(0, 60) || '(empty)'));

      if (replyText) {
        var receiveId = chatType === 'group' ? chatId : openId;
        var idType = chatType === 'group' ? 'chat_id' : 'open_id';
        await sendFeishuMessage(client, receiveId, replyText, idType);
        log('INFO', 'reply sent to feishu');
      }
    } catch(e) {
      log('ERROR', 'event handler error: ' + e.message);
    }
    }
  });

  try {
    await wsHandler.start({ eventDispatcher: eventDispatcher });
    bridgeStatus.status = 'running';
    log('INFO', 'WebSocket connected, waiting for messages...');
  } catch(e) {
    log('FATAL', 'WS start failed: ' + e.message);
    bridgeStatus.status = 'failed: ' + e.message;
  }

  process.stdin.resume();
}

process.on('SIGINT', function() { stopped = true; process.exit(0); });
process.on('SIGTERM', function() { stopped = true; process.exit(0); });
process.on('uncaughtException', function(err) { log('FATAL', 'uncaught: ' + err.message); });
process.on('unhandledRejection', function(err) { log('FATAL', 'rejection: ' + (err.message || err)); });

main().catch(function(e) { log('FATAL', 'startup: ' + e.message); });

// ========== 热切换：监听 channels-config.json 变化自动重启 ==========
(function() {
  var hotConfigPath = require('path').join(__dirname, '..', 'channels-config.json');
  if (require('fs').existsSync(hotConfigPath)) {
    var _lastConfig = '';
    try { _lastConfig = require('fs').readFileSync(hotConfigPath, 'utf-8'); } catch(e) {}
    require('fs').watch(hotConfigPath, { persistent: false }, function(event) {
      if (event === 'change') {
        try {
          var _new = require('fs').readFileSync(hotConfigPath, 'utf-8');
          if (_new !== _lastConfig) {
            _lastConfig = _new;
            console.log('[热切换] feishu-bridge 检测到配置变化，退出由父进程看门狗重启...');
            setTimeout(function() { process.exit(0); }, 1000);
          }
        } catch(e) {}
      }
    });
  }
})();
