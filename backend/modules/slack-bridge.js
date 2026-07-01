/**
 * Slack 桥接 - eCompany 独立子进程 v2
 * 消息双向转发：Slack ↔ CEO
 * 使用 @slack/bolt 接收/发送消息
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SLACK_HTTP_PORT || 28014;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN || '';
const ECOMPANY_HOST = '127.0.0.1';
const ECOMPANY_PORT = 8005;
const LOG_FILE = path.join(__dirname, '..', 'logs', 'slack-bridge.log');
const STATUS_FILE = path.join(__dirname, '..', 'logs', 'slack-bridge.status.json');

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

function forwardToECompany(message, from, channelId) {
  return httpPost(ECOMPANY_HOST, ECOMPANY_PORT, '/api/v4/channel/incoming', {
    message: message, from: from || channelId || '', channel: 'slack'
  });
}

var bridgeStatus = {
  status: 'starting', startedAt: null, lastEventAt: null, lastMessageAt: null,
  errorCount: 0, messageCount: 0, account: '',
};

function startHealthServer() {
  http.createServer(function(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(bridgeStatus));
  }).listen(PORT, function() {
    log('INFO', 'health: http://127.0.0.1:' + this.address().port + '/health');
    main();
  });
}

function writeStatus() {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify(bridgeStatus, null, 2), 'utf-8'); } catch(e) {}
}

async function main() {
  log('INFO', '=== Slack Bridge v2 ===');
  log('INFO', 'PID: ' + process.pid);

  bridgeStatus.startedAt = new Date().toISOString();
  writeStatus();

  if (!SLACK_BOT_TOKEN) {
    log('WARN', '暂无 Slack Bot Token');
    bridgeStatus.status = 'waiting_token';
    return;
  }

  try {
    var { App } = require('@slack/bolt');
    var app = new App({
      token: SLACK_BOT_TOKEN,
      signingSecret: SLACK_SIGNING_SECRET,
      socketMode: !!SLACK_APP_TOKEN,
      appToken: SLACK_APP_TOKEN || undefined,
      port: PORT + 100
    });

    app.event('app_mention', async function(args) {
      var text = args.event.text || '';
      var user = args.event.user || '';
      var channel = args.event.channel || '';
      var ts = args.event.ts || '';

      if (!text) return;
      text = text.replace(/<@[^>]+>/g, '').trim();

      log('INFO', 'msg from ' + user + ': ' + text.substring(0, 60));
      bridgeStatus.lastEventAt = new Date().toISOString();
      bridgeStatus.lastMessageAt = new Date().toISOString();
      bridgeStatus.messageCount++;

      try {
        var ecoResp = await forwardToECompany(text, user, channel);
        var replyText = (ecoResp && ecoResp.reply) || '';
        log('INFO', 'CEO reply: ' + (replyText.substring(0, 60) || '(empty)'));

        if (replyText) {
          await args.client.chat.postMessage({ channel: channel, text: replyText });
          log('INFO', 'reply sent to slack');
        }
      } catch(e) {
        log('ERROR', 'forward error: ' + e.message);
        bridgeStatus.errorCount++;
      }
    });

    // DM 消息监听
    app.message(/.*/, async function(args) {
      if (args.event.bot_id || args.event.bot_id !== undefined) return;
      // 只在 DM 频道处理（非 mention 场景）
      if (args.event.channel_type !== 'im') return;

      var text = args.event.text || '';
      var user = args.event.user || '';
      var channel = args.event.channel || '';

      if (!text) return;
      log('INFO', 'DM from ' + user + ': ' + text.substring(0, 60));
      bridgeStatus.lastEventAt = new Date().toISOString();
      bridgeStatus.lastMessageAt = new Date().toISOString();
      bridgeStatus.messageCount++;

      try {
        var ecoResp = await forwardToECompany(text, user, channel);
        var replyText = (ecoResp && ecoResp.reply) || '';
        log('INFO', 'CEO reply: ' + (replyText.substring(0, 60) || '(empty)'));

        if (replyText) {
          await args.client.chat.postMessage({ channel: channel, text: replyText });
          log('INFO', 'reply sent to slack');
        }
      } catch(e) {
        log('ERROR', 'forward error: ' + e.message);
        bridgeStatus.errorCount++;
      }
    });

    await app.start();
    bridgeStatus.status = 'running';
    log('INFO', '✅ Slack app running');
  } catch(e) {
    log('ERROR', 'Slack 初始化失败: ' + e.message);
    bridgeStatus.status = 'failed: ' + e.message;
  }

  writeStatus();
}

startHealthServer();
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
            console.log('[热切换] slack-bridge 检测到配置变化，退出由父进程看门狗重启...');
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
