'use strict';
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const LOG_DIR = path.join(__dirname, '..', 'logs');

  registerRoute(['GET'], '/api/monitoring/system', (req, res, url) => {
    json(res, {
      ok: true,
      cpu: os.loadavg(),
      memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem() },
      uptime: Math.floor(os.uptime()),
      process: { uptime: Math.floor(process.uptime()), pid: process.pid, memory: process.memoryUsage().rss }
    });
  });

  registerRoute(['GET'], '/api/monitoring/logs', (req, res, url) => {
    const level = url.searchParams.get('level') || 'error';
    const maxLines = parseInt(url.searchParams.get('lines') || '50');
    const logFile = path.join(LOG_DIR, level === 'error' ? 'structured-error.log' : 'structured-combined.log');
    try {
      if (!fs.existsSync(logFile)) { json(res, { ok: true, lines: [] }); return; }
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n').filter(Boolean).slice(-maxLines);
      json(res, { ok: true, lines, count: lines.length });
    } catch(e) { error(res, e.message); }
  });
};
