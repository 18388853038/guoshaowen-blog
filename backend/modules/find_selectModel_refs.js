var s = require('fs').readFileSync('F:\\eCompanyClaw\\backend\\server-modern.js', 'utf-8');

// 搜索 CEO 选择模型的逻辑 — selectModel 的调用
var selIdx = s.indexOf('selectModel');
console.log('selectModel occurrences:');
var idx = 0; var count = 0;
while (true) {
  var si = s.indexOf('selectModel', idx);
  if (si < 0) break;
  var ctx = s.substring(Math.max(0, si - 30), Math.min(s.length, si + 60)).replace(/\n/g, ' ');
  console.log('#' + count + ' at ' + si + ': ' + ctx);
  idx = si + 1;
  count++;
}
console.log('Total:', count);
