/**
 * chat-upload.js — /api/chat/upload 路由处理器
 * 处理 multipart/form-data 文件上传 + 聊天消息
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const busboy = require('busboy');
const os = require('os');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch(e) {}
}

/**
 * 注册 /api/chat/upload 路由
 * @param {Function} registerRoute - 路由注册函数
 * @param {Function} parseBody - JSON body 解析器
 * @param {Function} json - JSON 响应函数
 * @param {Object} ctx - 上下文 { AGENTS_MAP, runCEOCEO, logActivity }
 */
function registerChatUpload(registerRoute, parseBody, json, ctx) {
  if (!ctx) ctx = {};
  var A = ctx.AGENTS_MAP || {};
  var runCEO = ctx.runCEOCEO || async function() { return {reply:'AI引擎未就绪'}; };
  var logAct = ctx.logActivity || function() {};

  registerRoute(['POST'], /^\/api\/chat\/upload$/, async function(req, res) {
    try {
      // 检查 Content-Type
      var ct = req.headers['content-type'] || '';
      if (!ct.includes('multipart/form-data')) {
        json(res, { ok: false, error: '需要 multipart/form-data' }, 400);
        return;
      }

      var fields = {};
      var files = [];
      var fileCount = 0;
      var parseErr = null;
      var MAX_FILES = 10;
      var MAX_SIZE = 20 * 1024 * 1024; // 20MB

      var bb = busboy({ headers: req.headers, limits: { files: MAX_FILES, fileSize: MAX_SIZE } });

      bb.on('field', function(name, val) {
        fields[name] = val;
      });

      bb.on('file', function(fieldname, stream, info) {
        var filename = info.filename || 'unnamed';
        var mimeType = info.mimeType || 'application/octet-stream';
        fileCount++;
        if (fileCount > MAX_FILES) {
          stream.resume();
          return;
        }
        // 生成唯一文件名
        var ext = path.extname(filename) || '';
        var safeName = Date.now() + '_' + Math.random().toString(36).substr(2, 6) + ext;
        var savePath = path.join(UPLOAD_DIR, safeName);
        var writeStream = fs.createWriteStream(savePath);
        var size = 0;

        stream.on('data', function(chunk) {
          size += chunk.length;
          if (size > MAX_SIZE) {
            stream.destroy(new Error('File too large'));
          }
        });

        stream.pipe(writeStream);

        stream.on('limit', function() {
          parseErr = '文件超过20MB限制: ' + filename;
          stream.resume();
        });

        writeStream.on('finish', function() {
          files.push({
            originalName: filename,
            savedName: safeName,
            path: savePath,
            size: size,
            mimeType: mimeType
          });
        });
      });

      bb.on('finish', async function() {
        if (parseErr) {
          // 清理已保存的文件
          files.forEach(function(f) {
            try { fs.unlinkSync(f.path); } catch(e) {}
          });
          json(res, { ok: false, error: parseErr }, 400);
          return;
        }

        var agentId = fields.agentId || '';
        var message = fields.message || '';

        if (!agentId) {
          json(res, { ok: false, error: '缺少 agentId' }, 400);
          return;
        }

        var agent = A[agentId];
        if (!agent) {
          json(res, { ok: false, error: '未知员工: ' + agentId }, 404);
          return;
        }

        // 构建带文件信息的消息
        var fileInfo = files.map(function(f) {
          return '[' + f.originalName + '](' + formatSize(f.size) + ')';
        }).join(', ');

        var fullMessage = message;
        if (fileInfo) {
          fullMessage = (message ? message + '\n\n' : '') + '📎 上传了 ' + files.length + ' 个文件: ' + fileInfo;
        }

        // 调用 AI
        try {
          var msgCtx = [{ role: 'user', content: fullMessage }];
          var result = await runCEO(msgCtx, {});
          var reply = (result && result.reply) || '已收到文件';
          json(res, {
            ok: true,
            agentId: agentId,
            name: agent.name_cn || agent.name || agentId,
            reply: reply,
            files: files.map(function(f) { return { name: f.originalName, size: f.size }; })
          });
        } catch (aiErr) {
          json(res, {
            ok: true,
            agentId: agentId,
            name: agent.name_cn || agent.name || agentId,
            reply: '已收到 ' + files.length + ' 个文件' + (message ? ': ' + message : ''),
            files: files.map(function(f) { return { name: f.originalName, size: f.size }; })
          });
        }
      });

      bb.on('error', function(err) {
        json(res, { ok: false, error: err.message }, 500);
      });

      // 如果 req 有已缓冲的数据，处理它
      req.pipe(bb);

    } catch (err) {
      json(res, { ok: false, error: err.message }, 500);
    }
  });

  console.log('[ChatUpload] /api/chat/upload 路由已注册');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

module.exports = { registerChatUpload };
