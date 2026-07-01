'use strict';
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  const fs = require('fs');
  const path = require('path');
  const TEAM_FILE = path.join(__dirname, '..', 'data', 'team.json');

  function loadTeam() {
    try {
      if (fs.existsSync(TEAM_FILE)) return JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8'));
    } catch(e) {
      logger && logger.warn('Failed to load team data', typeof e === 'object' ? e.message : e);
    }
    return [];
  }

  registerRoute(['GET'], '/api/team/agents', (req, res, url) => {
    json(res, { ok: true, agents: loadTeam() });
  });

  registerRoute(['GET'], '/api/team/agent', (req, res, url) => {
    const id = url.searchParams.get('id') || '';
    const agents = loadTeam();
    const agent = agents.find(a => a.id === id);
    if (!agent) { error(res, 'Agent not found', 404); return; }
    json(res, { ok: true, agent });
  });

  registerRoute(['GET'], '/api/team/agents/list', (req, res, url) => {
    json(res, { ok: true, agents: loadTeam() });
  });
};
