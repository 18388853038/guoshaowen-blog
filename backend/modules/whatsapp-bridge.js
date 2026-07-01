/**
 * WhatsApp Cloud API 桥接 - eCompany 独立子进程 v2
 * 消息双向转发：WhatsApp ↔ CEO
 * 通过 Facebook Graph API 收发消息
 */
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const HTTP_PORT = process.env.WHATSAPP_HTTP_PORT || 28012;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'verify_ecompany';
const ECOMPANY_HOST = '127.0.0.1';
const ECOMPANY_PORT = 8005;
const LOG_FILE = path.join(__dirname, '..', 'logs', 'whatsapp-bridge.log');
const STATUS_FILE = path.join(__dirname, '..', 'logs', 'whatsapp-bridge.status.json');

function log(level, msg) {
  var ts = new Date().toISOString();
  var line = '[' + ts + '] [' + level + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8'); } catch(e) {}
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
    req.on('error', function(e) { reject(e); });
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    req.write(data); req.end();
  });
}

function forwardToECompany(message, from, chatId) {
  return httpPost(ECOMPANY_HOST, ECOMPANY_PORT, '/api/v4/channel/incoming', {
    message: message, from: from || chatId || '', channel: 'whatsapp'
  });
}

function sendWhatsAppMessage(to, text) {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) return;
  return httpPost('graph.facebook.com', 443, '/v21.0/' + PHONE_NUMBER_ID + '/messages', {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: text }
  });
}

var bridgeStatus = {
  status: 'starting', startedAt: null, lastEventAt: null, lastMessageAt: null,
  errorCount: 0, messageCount: 0, account: PHONE_NUMBER_ID,
};

function writeStatus() {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify(bridgeStatus, null, 2), 'utf-8'); } catch(e) {}
}

var server = http.createServer(function(req, res) {
  var u = url.parse(req.url, true);

  // Webhook verification (Meta required)
  if (req.method === 'GET' && u.pathname === '/webhook') {
    var mode = u.query['hub.mode'];
    var token = u.query['hub.verify_token'];
    var challenge = u.query['hub.challenge'];
    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
      log('INFO', 'Webhook verified');
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  // Webhook incoming messages
  if (req.method === 'POST' && u.pathname === '/webhook') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', async function() {
      res.writeHead(200);
      res.end('OK');
      try {
        var data = JSON.parse(body);
        var entry = (data.entry || [])[0];
        var change = (entry && entry.changes || [])[0];
        var value = change && change.value || {};
        var messages = value.messages || [];
        if (messages.length === 0) return;

        var msg = messages[0];
        var from = msg.from || '';
        var text = '';
        if (msg.type === 'text' && msg.text) {
          text = msg.text.body || '';
        }

        if (!text) return;
        log('INFO', 'msg from ' + from + ': ' + text.substring(0, 60));
        bridgeStatus.lastEventAt = new Date().toISOString();
        bridgeStatus.lastMessageAt = new Date().toISOString();
        bridgeStatus.messageCount++;

        var ecoResp = await forwardToECompany(text, from, from);
        var replyText = (ecoResp && ecoResp.reply) || '';
        log('INFO', 'CEO reply: ' + (replyText.substring(0, 60) || '(empty)'));

        if (replyText) {
          await sendWhatsAppMessage(from, replyText);
          log('INFO', 'reply sent to whatsapp');
        }
      } catch(e) {
        log('ERROR', 'handle webhook: ' + e.message);
        bridgeStatus.errorCount++;
      }
    });
    return;
  }

  // Health check
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(bridgeStatus));
});

server.listen(HTTP_PORT, function() {
  log('INFO', '=== WhatsApp Cloud API Bridge v2 ===');
  log('INFO', 'PID: ' + process.pid);
  log('INFO', 'Webhook server on port ' + HTTP_PORT);
  bridgeStatus.startedAt = new Date().toISOString();
  bridgeStatus.status = PHONE_NUMBER_ID ? 'running' : 'waiting_config';
  if (!PHONE_NUMBER_ID) log('WARN', '暂无 WhatsApp Phone Number ID');
  writeStatus();
});

setInterval(writeStatus, 15000);

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
            console.log('[热切换] whatsapp-bridge 检测到配置变化，退出由父进程看门狗重启...');
            setTimeout(function() { process.exit(0); }, 1000);
          }
        } catch(e) {}
      }
    });
  }
})();

process.on('SIGINT', function() { process.exit(0); });
process.on('SIGTERM', function() { process.exit(0); });
process.on('uncaughtException', function(err) { log('FATAL', 'uncaught: ' + err.message); });
process.on('unhandledRejection', function(err) { log('FATAL', 'rejection: ' + (err.message || err)); });
