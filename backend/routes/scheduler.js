'use strict';
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  let cronApi = null;
  try { cronApi = require('../modules/scheduler-api'); } catch(e) {
    logger && logger.warn('scheduler-api module not available');
  }

  registerRoute(['GET'], '/api/cron/tasks', (req, res, url) => {
    try {
      const tasks = cronApi ? cronApi.loadTasks() : [];
      json(res, { ok: true, count: tasks.length, tasks });
    } catch(e) { error(res, e.message); }
  });

  registerRoute(['POST'], '/api/cron/tasks', (req, res, url) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const task = cronApi ? cronApi.addTask(data) : { id: 'mock_' + Date.now(), ...data };
        json(res, { ok: true, task }, 201);
      } catch(e) { error(res, e.message); }
    });
  });

  registerRoute(['PUT'], '/api/cron/tasks/:id', (req, res, url) => {
    const id = url.pathname.replace('/api/cron/tasks/', '');
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!cronApi || !cronApi.updateTask) { error(res, 'Cron API not available'); return; }
        const task = cronApi.updateTask(id, data);
        if (!task) { error(res, 'Task not found', 404); return; }
        json(res, { ok: true, task });
      } catch(e) { error(res, e.message); }
    });
  });

  registerRoute(['DELETE'], '/api/cron/tasks/:id', (req, res, url) => {
    const id = url.pathname.replace('/api/cron/tasks/', '');
    if (!cronApi || !cronApi.deleteTask) { error(res, 'Cron API not available'); return; }
    const ok = cronApi.deleteTask(id);
    if (!ok) { error(res, 'Task not found', 404); return; }
    json(res, { ok: true });
  });
};
