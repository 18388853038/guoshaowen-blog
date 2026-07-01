'use strict';
/**
 * modules/tdoc-bridge.js — 腾讯文档集成桥接
 * 
 * 通过 Tencent Docs OpenAPI / MCP 调用腾讯文档服务
 * 支持：创建文档、读取内容、编辑文档、导出文档等
 * 
 * 复用 QClaw 的 qclaw_tdoc_mcp_call 设计模式：
 * - 所有调用通过 MCP（Model Context Protocol）统一出口
 * - 支持 HTTP 直连 fallback
 */

const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ===== 配置 =====
const CONFIG = {
  // 腾讯文档 Open API 端点
  apiBase: 'https://docs.qq.com/openapi/v3',
  // 可通过环境变量覆盖
  appId: process.env.TENCENT_DOC_APP_ID || '',
  appSecret: process.env.TENCENT_DOC_APP_SECRET || '',
  // MCP 服务地址（可选，如果通过 MCP 代理调用）
  mcpEndpoint: process.env.TDOC_MCP_ENDPOINT || 'http://127.0.0.1:28011/mcp/v1',
  // 访问令牌缓存
  _tokenCache: null,
  _tokenExpires: 0
};

// ===== 获取访问令牌 =====
async function getAccessToken() {
  // 优先从 credential-store 获取
  try {
    const credStore = require('./credential-store');
    const saved = credStore.getApiKey('tencent_doc');
    if (saved) return saved;
  } catch(e) {}

  // 从配置文件读取
  try {
    const cfgPath = path.join(__dirname, '..', 'provider-keys.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (cfg.tencent_doc || cfg.tencentDoc) return cfg.tencent_doc || cfg.tencentDoc;
    }
  } catch(e) {}

  // 环境变量
  if (process.env.TENCENT_DOC_TOKEN) return process.env.TENCENT_DOC_TOKEN;

  return CONFIG.appId ? 'config_loaded' : null;
}

// ===== HTTP 请求封装 =====
function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === 'https:' ? https : http;
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 15000
    };
    
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers }); }
        catch(e) { resolve({ status: res.statusCode, data: data, headers: res.headers }); }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ===== 通过 MCP 调用 =====
async function callViaMCP(action, params) {
  try {
    const res = await request(CONFIG.mcpEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    }, { action: 'tdoc_' + action, params: params || {} });
    return res;
  } catch(e) {
    return { status: 500, data: { ok: false, error: e.message } };
  }
}

// ===== 核心 API =====

// 创建文档
async function createDoc(title, type) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: '未配置腾讯文档凭证' };
  
  // 先尝试 MCP 调用
  const mcpRes = await callViaMCP('create', { title, type: type || 'doc' });
  if (mcpRes.status === 200 && mcpRes.data && mcpRes.data.ok !== false) {
    return mcpRes.data;
  }
  
  // MCP 失败，走 HTTP 直连
  try {
    const res = await request(CONFIG.apiBase + '/documents', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }, { title, type: type || 'doc' });
    
    if (res.status === 200) {
      return { ok: true, docId: res.data.document_id, url: res.data.url, title };
    }
    return { ok: false, error: '创建失败: HTTP ' + res.status, detail: res.data };
  } catch(e) {
    return { ok: false, error: '创建文档失败: ' + e.message };
  }
}

// 读取文档内容
async function readDoc(docId) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: '未配置腾讯文档凭证' };
  
  const mcpRes = await callViaMCP('read', { docId });
  if (mcpRes.status === 200 && mcpRes.data && mcpRes.data.ok !== false) {
    return mcpRes.data;
  }
  
  try {
    const res = await request(CONFIG.apiBase + '/documents/' + docId, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    
    if (res.status === 200) {
      return { ok: true, docId, content: res.data.content || res.data, meta: res.data.meta };
    }
    return { ok: false, error: '读取失败: HTTP ' + res.status };
  } catch(e) {
    return { ok: false, error: '读取文档失败: ' + e.message };
  }
}

// 编辑文档（追加内容）
async function appendDoc(docId, content, position) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: '未配置腾讯文档凭证' };
  
  const mcpRes = await callViaMCP('append', { docId, content, position });
  if (mcpRes.status === 200 && mcpRes.data && mcpRes.data.ok !== false) {
    return mcpRes.data;
  }
  
  try {
    const res = await request(CONFIG.apiBase + '/documents/' + docId + '/content', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }, { content, position: position || 'end' });
    
    return res.status === 200
      ? { ok: true, docId }
      : { ok: false, error: '编辑失败: HTTP ' + res.status };
  } catch(e) {
    return { ok: false, error: '编辑文档失败: ' + e.message };
  }
}

// 导出文档
async function exportDoc(docId, format) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: '未配置腾讯文档凭证' };
  
  const mcpRes = await callViaMCP('export', { docId, format: format || 'pdf' });
  if (mcpRes.status === 200 && mcpRes.data && mcpRes.data.ok !== false) {
    return mcpRes.data;
  }
  
  try {
    const res = await request(CONFIG.apiBase + '/documents/' + docId + '/export', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }, { format: format || 'pdf' });
    
    if (res.status === 200) {
      return { ok: true, downloadUrl: res.data.download_url, format };
    }
    return { ok: false, error: '导出失败: HTTP ' + res.status };
  } catch(e) {
    return { ok: false, error: '导出文档失败: ' + e.message };
  }
}

// 列出文档
async function listDocs(offset, limit) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: '未配置腾讯文档凭证' };
  
  const mcpRes = await callViaMCP('list', { offset: offset || 0, limit: limit || 20 });
  if (mcpRes.status === 200 && mcpRes.data && mcpRes.data.ok !== false) {
    return mcpRes.data;
  }
  
  try {
    const res = await request(CONFIG.apiBase + '/documents', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    
    if (res.status === 200) {
      return { ok: true, docs: res.data.documents || [], total: res.data.total || 0 };
    }
    return { ok: false, error: '列表获取失败: HTTP ' + res.status };
  } catch(e) {
    return { ok: false, error: '获取文档列表失败: ' + e.message };
  }
}

// 搜索文档
async function searchDocs(query) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: '未配置腾讯文档凭证' };
  
  const mcpRes = await callViaMCP('search', { query });
  if (mcpRes.status === 200 && mcpRes.data && mcpRes.data.ok !== false) {
    return mcpRes.data;
  }
  
  try {
    const res = await request(CONFIG.apiBase + '/documents/search?q=' + encodeURIComponent(query), {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    
    if (res.status === 200) {
      return { ok: true, results: res.data.results || [], total: res.data.total || 0 };
    }
    return { ok: false, error: '搜索失败: HTTP ' + res.status };
  } catch(e) {
    return { ok: false, error: '搜索文档失败: ' + e.message };
  }
}

// ===== 统一调用入口（类似 qclaw_tdoc_mcp_call）=====
async function tdocCall(action, params) {
  switch (action) {
    case 'create': return await createDoc(params.title, params.type);
    case 'read':   return await readDoc(params.docId);
    case 'append': return await appendDoc(params.docId, params.content, params.position);
    case 'export': return await exportDoc(params.docId, params.format);
    case 'list':   return await listDocs(params.offset, params.limit);
    case 'search': return await searchDocs(params.query);
    default:       return { ok: false, error: '未知操作: ' + action };
  }
}

// ===== 工具定义（给 _EXECUTOR_TOOLS 注册用）=====
const TENCENT_DOC_TOOLS = {
  tencent_doc_call: {
    description: '调用腾讯文档服务（创建/读取/编辑/导出/搜索文档）',
    params: {
      action: { type: 'string', required: true, enum: ['create', 'read', 'append', 'export', 'list', 'search'],
        description: '操作类型：create(创建文档), read(读取内容), append(追加内容), export(导出), list(列表), search(搜索)' },
      title: { type: 'string', description: '文档标题（create 操作必需）' },
      docId: { type: 'string', description: '文档 ID（read/append/export 操作必需）' },
      content: { type: 'string', description: '文档内容（append 操作必需）' },
      format: { type: 'string', enum: ['pdf', 'docx', 'txt', 'md'], description: '导出格式（export 操作）' },
      query: { type: 'string', description: '搜索关键词（search 操作必需）' },
      type: { type: 'string', enum: ['doc', 'sheet', 'slide', 'form'], description: '文档类型（create 操作）' }
    }
  }
};

module.exports = {
  tdocCall,
  createDoc, readDoc, appendDoc, exportDoc, listDocs, searchDocs,
  TENCENT_DOC_TOOLS,
  getAccessToken
};
