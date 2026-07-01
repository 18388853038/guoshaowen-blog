'use strict';
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  const fs = require('fs');
  const path = require('path');
  const TASKS_FILE = path.join(__dirname, '..', 'tasks.json');

  function loadTasks() {
    try {
      if (fs.existsSync(TASKS_FILE)) return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    } catch(e) {
      logger && logger.warn('Failed to load tasks', typeof e === 'object' ? e.message : e);
    }
    return [];
  }

  function saveTasks(tasks) {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
  }

  registerRoute(['GET'], '/api/tasks', (req, res, url) => {
    const status = url.searchParams.get('status');
    const assignee = url.searchParams.get('assignee');
    let tasks = loadTasks();
    if (status) tasks = tasks.filter(t => t.status === status);
    if (assignee) tasks = tasks.filter(t => t.assigneeId === assignee);
    json(res, { ok: true, count: tasks.length, tasks });
  });

  registerRoute(['GET'], '/api/tasks/list', (req, res, url) => {
    const tasks = loadTasks();
    json(res, { ok: true, count: tasks.length, tasks });
  });

  registerRoute(['POST'], '/api/tasks', (req, res, url) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const tasks = loadTasks();
        const task = { id: 'task_' + Date.now(), ...data, createdAt: new Date().toISOString() };
        tasks.push(task);
        saveTasks(tasks);
        json(res, { ok: true, task }, 201);
      } catch(e) { error(res, e.message); }
    });
  });

  registerRoute(['DELETE'], '/api/tasks/:id', (req, res, url) => {
    const taskId = url.pathname.replace('/api/tasks/', '');
    let tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) { error(res, 'Task not found', 404); return; }
    tasks.splice(idx, 1);
    saveTasks(tasks);
    json(res, { ok: true });
  });
};
