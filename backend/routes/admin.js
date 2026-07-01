'use strict';
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  const fs = require('fs');
  const path = require('path');
  const CONFIG_FILE = path.join(__dirname, '..', 'system-config.json');

  function loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch(e) {
      logger && logger.warn('Failed to load system config', typeof e === 'object' ? e.message : e);
    }
    return {};
  }

  function saveConfig(cfg) {
    if (Object.keys(cfg).length > 0) fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  }

  registerRoute(['GET'], '/api/admin/config', (req, res, url) => {
    json(res, { ok: true, config: loadConfig() });
  });

  registerRoute(['POST'], '/api/admin/config', (req, res, url) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const cfg = loadConfig();
        Object.assign(cfg, data);
        saveConfig(cfg);
        json(res, { ok: true, config: cfg });
      } catch(e) { error(res, e.message); }
    });
  });

  registerRoute(['GET'], '/api/admin/metrics', (req, res, url) => {
    json(res, {
      ok: true,
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      pid: process.pid,
      node: process.version,
      platform: process.platform
    });
  });
};
