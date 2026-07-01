'use strict';
/**
 * routes/tdoc.js — 腾讯文档 API 路由
 * 提供 RESTful 接口给前端调用腾讯文档功能
 */
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  if (typeof registerRoute !== 'function') return;

  const tdocBridge = require('../modules/tdoc-bridge');

  // 调用腾讯文档
  registerRoute(['POST'], '/api/tdoc/call', async (req, res, url) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const params = JSON.parse(body);
        const result = await tdocBridge.tdocCall(params.action || params.op, params);
        json(res, result);
      } catch(e) {
        json(res, { ok: false, error: e.message }, 400);
      }
    });
  });

  // 获取文档列表
  registerRoute(['GET'], '/api/tdoc/list', async (req, res, url) => {
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const result = await tdocBridge.listDocs(offset, limit);
    json(res, result);
  });

  // 搜索文档
  registerRoute(['GET'], '/api/tdoc/search', async (req, res, url) => {
    const query = url.searchParams.get('q') || '';
    if (!query) { json(res, { ok: false, error: '缺少搜索关键词' }, 400); return; }
    const result = await tdocBridge.searchDocs(query);
    json(res, result);
  });

  // 创建文档
  registerRoute(['POST'], '/api/tdoc/create', async (req, res, url) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const params = JSON.parse(body);
        const result = await tdocBridge.createDoc(params.title, params.type);
        json(res, result);
      } catch(e) {
        json(res, { ok: false, error: e.message }, 400);
      }
    });
  });

  // 读取文档
  registerRoute(['GET'], '/api/tdoc/read', async (req, res, url) => {
    const docId = url.searchParams.get('docId') || url.searchParams.get('id') || '';
    if (!docId) { json(res, { ok: false, error: '缺少文档 ID' }, 400); return; }
    const result = await tdocBridge.readDoc(docId);
    json(res, result);
  });

  // 文档配置状态
  registerRoute(['GET'], '/api/tdoc/status', async (req, res, url) => {
    try {
      const token = await tdocBridge.getAccessToken();
      json(res, {
        ok: true,
        configured: !!token,
        message: token ? '腾讯文档已配置' : '腾讯文档未配置（需设置 API Key）'
      });
    } catch(e) {
      json(res, { ok: false, configured: false, error: e.message });
    }
  });

  console.log('[TDoc] 腾讯文档路由注册成功');
};
