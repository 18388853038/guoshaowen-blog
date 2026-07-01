'use strict';
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  const fs = require('fs');
  const path = require('path');
  const BASE = path.join(__dirname, '..');
  const WORKSPACE_DIR = path.join(BASE, 'workspace');
  const FILES_DIR = path.join(BASE, 'files');
  if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  function getParams(url) {
    try { return new URL(url, 'http://localhost').searchParams; } catch(e) { return new URLSearchParams(); }
  }

  registerRoute(['GET'], '/api/workspace/files', (req, res) => {
    const params = getParams(req.url);
    const dir = params.get('dir') || '';
    const target = path.join(WORKSPACE_DIR, dir);
    if (!target.startsWith(WORKSPACE_DIR)) { error(res, 'Access denied', 403); return; }
    try {
      const items = fs.readdirSync(target, { withFileTypes: true }).map(d => ({
        name: d.name, type: d.isDirectory() ? 'dir' : 'file', size: d.isFile() ? fs.statSync(path.join(target, d.name)).size : 0
      }));
      json(res, { ok: true, path: dir, items });
    } catch(e) { error(res, e.message); }
  });

  registerRoute(['GET'], '/api/workspace/file', (req, res) => {
    const params = getParams(req.url);
    const filePath = params.get('path') || '';
    const target = path.join(BASE, filePath);
    if (!target.startsWith(BASE)) { error(res, 'Access denied', 403); return; }
    try {
      const content = fs.readFileSync(target, 'utf8');
      json(res, { ok: true, content, size: content.length });
    } catch(e) { error(res, e.message); }
  });

  registerRoute(['POST'], '/api/workspace/file', (req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const target = path.join(BASE, data.path || '');
        if (!target.startsWith(BASE)) { error(res, 'Access denied', 403); return; }
        fs.writeFileSync(target, data.content || '', 'utf8');
        json(res, { ok: true, path: data.path });
      } catch(e) { error(res, e.message); }
    });
  });

  // ★ 文件上传（通过 base64 body）
  registerRoute(['POST'], '/api/workspace/upload', (req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const fn = data.filename || 'unnamed';
        const content = data.content || '';
        const encoding = data.encoding || 'utf8';
        const target = path.join(FILES_DIR, fn);
        if (!target.startsWith(FILES_DIR)) { error(res, 'Access denied', 403); return; }
        if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
        if (encoding === 'base64') {
          fs.writeFileSync(target, Buffer.from(content, 'base64'));
        } else {
          fs.writeFileSync(target, content, encoding);
        }
        json(res, { ok: true, path: target, size: fs.statSync(target).size });
      } catch(e) { error(res, e.message); }
    });
  });

  // ★ 文件下载
  registerRoute(['GET'], '/api/workspace/download', (req, res) => {
    const params = getParams(req.url);
    const fn = params.get('filename') || '';
    const target = path.join(FILES_DIR, fn);
    if (!target.startsWith(FILES_DIR)) { error(res, 'Access denied', 403); return; }
    if (!fs.existsSync(target)) { error(res, '文件不存在', 404); return; }
    const content = fs.readFileSync(target);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + fn + '"',
      'Content-Length': content.length
    });
    res.end(content);
  });
};
