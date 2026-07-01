'use strict';
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  registerRoute(['GET'], '/api/health', async (req, res, url) => {
    const os = require('os');
    json(res, {
      ok: true, status: 'healthy', version: 'v2.0',
      uptime: Math.floor(process.uptime()),
      time: new Date().toISOString(),
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      node: process.version,
      checks: { database: db ? 'ok' : 'unavailable' }
    });
  });

  registerRoute(['GET'], '/api/status', async (req, res, url) => {
    const os = require('os');
    json(res, {
      ok: true, status: 'running', service: 'eCompany',
      cpu: (os.loadavg()[0] || 0).toFixed(2),
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      uptime: Math.floor(process.uptime())
    });
  });
};
