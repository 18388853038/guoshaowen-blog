'use strict';
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  const fs = require('fs');
  const path = require('path');
  const KB_FILE = path.join(__dirname, '..', 'knowledge-base.json');

  function loadKB() {
    try {
      if (fs.existsSync(KB_FILE)) return JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
    } catch(e) {
      logger && logger.warn('Failed to load knowledge base', typeof e === 'object' ? e.message : e);
    }
    return [];
  }

  registerRoute(['GET'], '/api/knowledge/search', (req, res, url) => {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const entries = loadKB();
    const results = entries.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.content || '').toLowerCase().includes(q) ||
      (e.tags || []).some(t => t.toLowerCase().includes(q))
    );
    json(res, { ok: true, count: results.length, results });
  });

  registerRoute(['GET'], '/api/knowledge/list', (req, res, url) => {
    const category = url.searchParams.get('category');
    let entries = loadKB();
    if (category) entries = entries.filter(e => e.category === category);
    json(res, { ok: true, count: entries.length, entries });
  });
};
