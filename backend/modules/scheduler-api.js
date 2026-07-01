/**
 * scheduler-api.js — 定时任务 CRUD API（持久化到 scheduler-tasks.json）
 * 支持的 data: cron, target(ceo|cto|system), prompt(任务内容),
 * model(可选), channel(可选), enabled
 */
const fs = require('fs');
const path = require('path');

const TASKS_PATH = path.join(__dirname, '..', 'scheduler-tasks.json');

let tasksCache = null;

function loadTasks() {
  if (tasksCache) return tasksCache;
  try {
    if (fs.existsSync(TASKS_PATH)) {
      const raw = fs.readFileSync(TASKS_PATH, 'utf8');
      // 防御空文件/损坏格式
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          tasksCache = parsed;
        } else {
          tasksCache = [];
        }
      } catch (e) {
        tasksCache = [];
      }
    } else {
      tasksCache = [];
    }
  } catch (e) {
    tasksCache = [];
  }
  return tasksCache;
}

function saveTasks(tasks) {
  tasksCache = tasks;
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2), 'utf8');
}

function addTask(task) {
  const tasks = loadTasks();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const newTask = {
    id,
    name: task.name || '未命名任务',
    cron: task.cron || '0 0 * * *',
    target: task.target || 'ceo',
    prompt: task.prompt || '',
    model: task.model || '',
    channel: task.channel || '',
    enabled: task.enabled !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  tasks.push(newTask);
  saveTasks(tasks);
  return newTask;
}

function updateTask(id, patch) {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;
  // 允许修改的字段
  const allowed = ['name','cron','target','prompt','model','channel','enabled'];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      tasks[idx][key] = patch[key];
    }
  }
  tasks[idx].updatedAt = new Date().toISOString();
  saveTasks(tasks);
  return tasks[idx];
}

function deleteTask(id) {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  saveTasks(tasks);
  return true;
}

function toggleTask(id) {
  const tasks = loadTasks();
  const t = tasks.find(t => t.id === id);
  if (!t) return null;
  t.enabled = !t.enabled;
  t.updatedAt = new Date().toISOString();
  saveTasks(tasks);
  return t;
}

module.exports = { loadTasks, saveTasks, addTask, updateTask, deleteTask, toggleTask };
