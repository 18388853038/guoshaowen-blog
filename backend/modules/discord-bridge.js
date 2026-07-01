/**
 * Discord 桥接 - eCompany 独立子进程 v2
 * 消息双向转发：Discord ↔ CEO
 * 使用 discord.js 接收/发送消息
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.DISCORD_HTTP_PORT || 28013;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const ECOMPANY_HOST = '127.0.0.1';
const ECOMPANY_PORT = 8005;
const LOG_FILE = path.join(__dirname, '..', 'logs', 'discord-bridge.log');
const STATUS_FILE = path.join(__dirname, '..', 'logs', 'discord-bridge.status.json');

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
    message: message, from: from || channelId || '', channel: 'discord'
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
  log('INFO', '=== Discord Bridge v2 ===');
  log('INFO', 'PID: ' + process.pid);

  bridgeStatus.startedAt = new Date().toISOString();
  writeStatus();

  if (!DISCORD_BOT_TOKEN) {
    log('WARN', '暂无 Discord Bot Token');
    bridgeStatus.status = 'waiting_token';
    return;
  }

  try {
    var { Client, GatewayIntentBits } = require('discord.js');
    var client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ]
    });

    client.on('ready', function() {
      log('INFO', '✅ Discord bot connected as ' + client.user.tag);
      bridgeStatus.account = client.user.tag;
      bridgeStatus.status = 'running';
      writeStatus();
    });

    client.on('messageCreate', async function(msg) {
      if (msg.author.bot) return;
      var text = msg.content || '';
      if (!text) return;

      log('INFO', 'msg from ' + msg.author.tag + ': ' + text.substring(0, 60));
      bridgeStatus.lastEventAt = new Date().toISOString();
      bridgeStatus.lastMessageAt = new Date().toISOString();
      bridgeStatus.messageCount++;

      try {
        var ecoResp = await forwardToECompany(text, msg.author.tag, msg.channel.id);
        var replyText = (ecoResp && ecoResp.reply) || '';
        log('INFO', 'CEO reply: ' + (replyText.substring(0, 60) || '(empty)'));

        if (replyText) {
          await msg.channel.send(replyText);
          log('INFO', 'reply sent to discord');
        }
      } catch(e) {
        log('ERROR', 'forward error: ' + e.message);
        bridgeStatus.errorCount++;
      }
    });

    await client.login(DISCORD_BOT_TOKEN);
  } catch(e) {
    log('ERROR', 'Discord 初始化失败: ' + e.message);
    bridgeStatus.status = 'failed: ' + e.message;
    writeStatus();
  }
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
            console.log('[热切换] discord-bridge 检测到配置变化，退出由父进程看门狗重启...');
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
