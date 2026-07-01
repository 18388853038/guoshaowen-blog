/**
 * feishu-bridge-webhook.js — 飞书桥接 v3 (Webhook 模式)
 *
 * 改用 HTTP Webhook 回调接收飞书消息（相对于 WSClient 更稳定）。
 * 启动一个 HTTP 服务接收飞书 POST 回调（需要飞书后台配置回调URL）。
 * 然后内网调用 eCompany HTTP API 转发消息。
 *
 * 不依赖 @larksuiteoapi/node-sdk。
 * 
 * 飞书后台配置：
 *   事件回调URL → http://<公网IP>:28003/webhook/callback
 *   App 凭证 → 不需要加解密（encrypt_key 可选）
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const CONFIG = {
  webhookPort: 28003,
  eCompanyHost: '127.0.0.1',
  eCompanyPort: 8005,
  logFile: path.join(__dirname, '..', 'logs', 'feishu-bridge.log'),
  healthFile: path.join(__dirname, '..', 'logs', 'feishu-bridge.status.json'),
};

// ========== Logger ==========
function log(level, msg) {
  var ts = new Date().toISOString();
  var line = '[' + ts + '] [' + level + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(CONFIG.logFile, line + '\n', 'utf-8'); } catch(e) {}
}

// ========== Credentials ==========
function loadCredentials() {
  try {
    var ccPath = path.join(__dirname, '..', 'channels-config.json');
    if (fs.existsSync(ccPath)) {
      var raw = fs.readFileSync(ccPath, 'utf-8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
      var cc = JSON.parse(raw);
      var fc = cc.feishu;
      if (fc && fc.appId && fc.appSecret) {
        return { appId: fc.appId, appSecret: fc.appSecret };
      }
    }
  } catch(e) {}
  return null;
}

// ========== 获取 tenant_access_token ==========
var cachedToken = { token: null, expiresAt: 0 };

async function getTenantToken(appId, appSecret) {
  if (cachedToken.token && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  return new Promise(function(resolve, reject) {
    var data = JSON.stringify({ app_id: appId, app_secret: appSecret });
    var opts = {
      hostname: 'open.feishu.cn',
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 10000,
    };
    var req = https.request(opts, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(d);
          if (parsed.code === 0 && parsed.tenant_access_token) {
            cachedToken = {
              token: parsed.tenant_access_token,
              expiresAt: Date.now() + parsed.expire * 1000,
            };
            log('INFO', 'Token refreshed, expires in ' + parsed.expire + 's');
            resolve(parsed.tenant_access_token);
          } else {
            log('WARN', 'Token failed: ' + d.substring(0, 100));
            reject(new Error(parsed.msg || 'token failed'));
          }
        } catch(e) {
          reject(new Error('parse error: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// ========== 飞书 API 调用 ==========
function feishuApi(token, method, apiPath, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? JSON.stringify(body) : '';
    var opts = {
      hostname: 'open.feishu.cn',
      path: '/open-apis' + apiPath,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    
    var req = https.request(opts, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({}); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

// ========== 发送消息到飞书 ==========
async function sendFeishuMessage(appId, appSecret, receiveId, text, idType) {
  try {
    var token = await getTenantToken(appId, appSecret);
    var resp = await feishuApi(token, 'POST', '/im/v1/messages?receive_id_type=' + (idType || 'open_id'), {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: text }),
    });
    if (resp.code === 0) return true;
    log('WARN', 'send fail: ' + JSON.stringify(resp).substring(0, 150));
    return false;
  } catch(e) {
    log('ERROR', 'send error: ' + e.message);
    return false;
  }
}

// ========== 转发到 eCompany ==========
function forwardToECompany(message, from, chatId) {
  return new Promise(function(resolve, reject) {
    var data = JSON.stringify({ message: message, from: from || '', channel: 'feishu' });
    var opts = {
      hostname: CONFIG.eCompanyHost,
      port: CONFIG.eCompanyPort,
      path: '/api/v4/channel/incoming',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 65000,
    };
    var req = http.request(opts, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// ========== Status ==========
var bridgeStatus = {
  status: 'starting',
  startedAt: null,
  lastEventAt: null,
  lastMessageAt: null,
  errorCount: 0,
  messageCount: 0,
  account: '',
  webhookPort: CONFIG.webhookPort,
};

// ========== 验证飞书回调签名 ==========
function verifySignature(encryptKey, body, timestamp, nonce, signature) {
  if (!encryptKey) return true; // 没有 encryptKey 时不验证
  var content = timestamp + nonce + encryptKey + JSON.stringify(body);
  var computed = crypto.createHash('sha256').update(content).digest('hex');
  return computed === signature;
}

// ========== 处理飞书回调 ==========
async function handleCallback(req, res) {
  var chunks = '';
  req.on('data', function(c) { chunks += c; });
  req.on('end', async function() {
    try {
      var body = JSON.parse(chunks);
      log('INFO', 'Received webhook: keys=' + Object.keys(body).join(', '));

      // === 飞书 URL 验证挑战 === (首次配置回调URL时)
      if (body.type === 'url_verification' || body.challenge) {
        log('INFO', 'URL verification challenge received');
        var challenge = body.challenge || body.challenge;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ challenge: challenge }));
        log('INFO', 'Challenge response sent: ' + challenge);
        return;
      }

      bridgeStatus.lastEventAt = new Date().toISOString();

      // === 事件回调 ===
      var event = body.event || {};
      var header = body.header || {};
      var eventType = header.event_type || event.type || '';

      log('INFO', 'Event type: ' + eventType);

      // 只处理 im.message.receive_v1
      if (eventType !== 'im.message.receive_v1') {
        log('INFO', 'Unhandled event type: ' + eventType + ', skipping');
        res.writeHead(200);
        res.end('ok');
        return;
      }

      var message = event.message || {};
      var sender = event.sender || {};
      var msgType = message.message_type || '';
      var content = message.content || '{}';
      var chatId = message.chat_id || '';
      var chatType = message.chat_type || '';
      var senderId = sender.sender_id || {};
      var openId = senderId.open_id || '';

      log('INFO', 'msgType=' + msgType + ' openId=' + openId + ' chatType=' + chatType);

      if (msgType !== 'text') {
        log('INFO', 'not text, skipping');
        res.writeHead(200);
        res.end('ok');
        return;
      }

      // 解析文本内容
      var textContent = '';
      try { textContent = JSON.parse(content).text || ''; } catch(e) { textContent = content; }
      textContent = textContent.replace(/@_user_\d+/g, '').trim();
      if (!textContent) {
        res.writeHead(200);
        res.end('ok');
        return;
      }

      log('INFO', 'Message: ' + textContent.substring(0, 60));
      bridgeStatus.lastMessageAt = new Date().toISOString();
      bridgeStatus.messageCount++;

      // 转发给 eCompany CEO
      var ecoResp = await forwardToECompany(textContent, openId, chatId);
      var replyText = (ecoResp && ecoResp.reply) || '';
      log('INFO', 'CEO reply: ' + (replyText.substring(0, 60) || '(empty)'));

      if (replyText) {
        var creds = loadCredentials();
        if (creds) {
          var receiveId = chatType === 'group' ? chatId : openId;
          var idType = chatType === 'group' ? 'chat_id' : 'open_id';
          await sendFeishuMessage(creds.appId, creds.appSecret, receiveId, replyText, idType);
          log('INFO', 'Reply sent to feishu');
        }
      }

      res.writeHead(200);
      res.end('ok');
    } catch(e) {
      log('ERROR', 'Callback error: ' + e.message);
      res.writeHead(200);
      res.end('ok');
    }
  });
}

// ========== 启动 ==========
function startWebhookServer() {
  var server = http.createServer(function(req, res) {
    if (req.method === 'POST' && req.url === '/webhook/callback') {
      handleCallback(req, res);
    } else if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(bridgeStatus));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  server.listen(CONFIG.webhookPort, '0.0.0.0', function() {
    log('INFO', 'Webhook server listening on http://0.0.0.0:' + CONFIG.webhookPort + '/webhook/callback');
    bridgeStatus.status = 'running';
    bridgeStatus.webhookPort = CONFIG.webhookPort;
    log('INFO', '=== Feishu Bridge v3 (Webhook) ===');
    log('INFO', 'PID: ' + process.pid);
    var creds = loadCredentials();
    if (creds) {
      log('INFO', 'App ID: ' + creds.appId);
      bridgeStatus.account = creds.appId;
    } else {
      log('WARN', 'Not configured. Set credentials in channels-config.json and restart.');
      bridgeStatus.status = 'waiting_account';
    }
  });
  server.on('error', function(e) {
    log('FATAL', 'Server error: ' + e.message);
    bridgeStatus.status = 'failed: ' + e.message;
  });
  
  bridgeStatus.startedAt = new Date().toISOString();
  return server;
}

// ========== 状态写入 ==========
function startHealthWriter() {
  setInterval(function() {
    try { fs.writeFileSync(CONFIG.healthFile, JSON.stringify(bridgeStatus, null, 2), 'utf-8'); } catch(e) {}
  }, 15000);
}

// ========== 主入口 ==========
function main() {
  startHealthWriter();
  startWebhookServer();
  
  process.stdin.resume();
}

process.on('SIGINT', function() { process.exit(0); });
process.on('SIGTERM', function() { process.exit(0); });
process.on('uncaughtException', function(err) {
  log('FATAL', 'uncaught: ' + err.message);
});
process.on('unhandledRejection', function(err) {
  log('FATAL', 'rejection: ' + (err.message || err));
});

main();
