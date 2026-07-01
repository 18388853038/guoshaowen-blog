'use strict';
module.exports = function(registerRoute, json, error, sendSSE, db, logger) {
  let notifications = [];

  registerRoute(['GET'], '/api/notifications', (req, res, url) => {
    json(res, { ok: true, count: notifications.length, notifications });
  });

  registerRoute(['POST'], '/api/notifications', (req, res, url) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const notif = { id: 'notif_' + Date.now(), read: false, createdAt: new Date().toISOString(), ...data };
        notifications.unshift(notif);
        json(res, { ok: true, notification: notif }, 201);
      } catch(e) { error(res, e.message); }
    });
  });

  registerRoute(['POST'], '/api/notifications/read', (req, res, url) => {
    notifications.forEach(n => n.read = true);
    json(res, { ok: true });
  });
};
