'use strict';
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  let mcpManager = null;
  try { mcpManager = require('../modules/mcp-manager'); } catch(e) {
    logger && logger.warn('mcp-manager module not available');
  }

  registerRoute(['GET'], '/api/mcp/status', (req, res, url) => {
    const status = mcpManager
      ? { initialized: true, tools: typeof mcpManager.listTools === 'function' ? mcpManager.listTools().length : 0 }
      : { initialized: false };
    json(res, { ok: true, ...status });
  });

  registerRoute(['POST'], '/api/mcp/call', (req, res, url) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (!mcpManager || typeof mcpManager.callTool !== 'function') { error(res, 'MCP not initialized'); return; }
        const result = await mcpManager.callTool(data.tool, data.args || {});
        json(res, { ok: true, result });
      } catch(e) { error(res, e.message); }
    });
  });
};
