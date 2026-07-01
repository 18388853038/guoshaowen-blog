/**
 * eCompany Channel Webhook Receiver
 * Routes incoming messages from external channels (飞书/钉钉/企微/QQ) to CEO AI
 * CEO reply is sent back through the same channel
 */
var http = require('http');
var FORWARD_URL = 'http://127.0.0.1:8005/api/v4/channel/incoming';

function forwardToCEO(channelId, userId, userMessage) {
  return new Promise(function(resolve) {
    try {
      var body = JSON.stringify({ message: userMessage, from: channelId + '/' + userId, channel: channelId });
      var urlObj = new URL(FORWARD_URL);
      var opts = {
        hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      };
      var req = http.request(opts, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          try { resolve(JSON.parse(data)); } catch(e) { resolve({ reply: data }); }
        });
      });
      req.on('error', function() { resolve({}); });
      req.write(body);
      req.end();
    } catch(e) { resolve({}); }
  });
}

function sendToChannel(channelId, text, userId) {
  try {
    var channels = require('./channels');
    channels.sendViaChannel(channelId, {}, { text: text, userId: userId }).catch(function() {});
  } catch(e) {}
}

exports.handle = async function(body, headers) {
  var channelId = body.channel || body.channelId || headers['x-channel-id'] || 'unknown';
  var userMessage = body.content || body.text || body.message || body.msg || '';
  var userId = body.userId || body.from || body.sender || body.openid || '';
  if (!userMessage) return { ok: false, error: 'empty message' };

  // 广播到工作台
  try {
    var wsServer = require('./ws-server');
    wsServer.broadcast('channel', {
      type: 'channel_message',
      from: userId || body.from || 'unknown',
      content: userMessage,
      message: userMessage,
      source: channelId,
      timestamp: new Date().toISOString()
    });
  } catch(e) {}

  try {
    var ceoResult = await forwardToCEO(channelId, userId, userMessage);
    var reply = (ceoResult && (ceoResult.reply || ceoResult.message || '')) || '';
    if (reply) {
      sendToChannel(channelId, reply, userId);
      // CEO回复也广播到工作台
      try {
        var wsServer = require('./ws-server');
        wsServer.broadcast('channel', {
          type: 'channel_message',
          from: 'CEO',
          content: reply,
          message: reply,
          source: channelId,
          timestamp: new Date().toISOString()
        });
      } catch(e) {}
    }
    return { ok: true, reply: reply, channel: channelId, userId: userId };
  } catch(e) {
    return { ok: false, error: e.message };
  }
};

exports.sendToChannel = sendToChannel;
exports.forwardToCEO = forwardToCEO;
