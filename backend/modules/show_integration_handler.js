var s = require('fs').readFileSync('F:\\eCompanyClaw\\backend\\server-modern.js', 'utf-8');

// 从末尾开始找最后一个 /api/integration/status 注册路由 — 342116
var regIdx = 342116;
console.log('handler starting at', regIdx);
console.log(s.substring(regIdx, Math.min(s.length, regIdx + 2000)));
