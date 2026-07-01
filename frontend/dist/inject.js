(function(){
// ===== eCompany Chat Enhancer v18 =====
// 规则：不动任何布局属性（display/position/margin/padding/flex/overflow）
// 只加视觉层：border-radius, background, box-shadow, color, opacity, transform
var V = 'v18';
console.log('['+V+'] Injecting...');

// ---------- CSS ----------
var css = document.createElement('style');
css.textContent = [
  // Bubble tail using ::before (position:absolute is fine since it's pseudo, doesn't affect parent layout)
  '.__ec_msg { border-radius: 12px !important; }',
  '.__ec_msg_user {',
    'background: linear-gradient(135deg, #10b981, #059669) !important;',
    'color: #fff !important;',
    'border-bottom-right-radius: 4px !important;',
  '}',
  '.__ec_msg_ai {',
    'background: #2a2a4a !important;',
    'color: #e0e0e0 !important;',
    'border-bottom-left-radius: 4px !important;',
  '}',
  // Copy button
  '.__ec_copy {',
    'position: absolute !important;',
    'top: 4px !important;',
    'right: 8px !important;',
    'opacity: 0 !important;',
    'transition: opacity 0.15s !important;',
    'cursor: pointer !important;',
    'font-size: 13px !important;',
    'line-height: 1 !important;',
    'padding: 2px 5px !important;',
    'border-radius: 4px !important;',
    'background: rgba(255,255,255,0.1) !important;',
    'border: none !important;',
    'color: inherit !important;',
    'z-index: 10 !important;',
    'user-select: none !important;',
  '}',
  '.__ec_msg:hover .__ec_copy { opacity: 1 !important; }',
  // Thinking animation
  '@keyframes __ec_pulse {',
    '0%, 100% { opacity: 0.4; }',
    '50% { opacity: 1; }',
  '}',
  '.__ec_thinking {',
    'display: inline-flex !important;',
    'align-items: center !important;',
    'gap: 4px !important;',
  '}',
  '.__ec_thinking span {',
    'width: 6px !important;',
    'height: 6px !important;',
    'border-radius: 50% !important;',
    'background: #4ecdc4 !important;',
    'animation: __ec_pulse 1.2s ease-in-out infinite !important;',
  '}',
  '.__ec_thinking span:nth-child(2) { animation-delay: 0.2s !important; }',
  '.__ec_thinking span:nth-child(3) { animation-delay: 0.4s !important; }',
  // Tool call card
  '.__ec_tool_card {',
    'margin: 8px 0 !important;',
    'padding: 8px 12px !important;',
    'border-radius: 8px !important;',
    'background: rgba(78,205,196,0.08) !important;',
    'border: 1px solid rgba(78,205,196,0.15) !important;',
    'font-size: 12px !important;',
    'line-height: 1.5 !important;',
    'color: #a0aec0 !important;',
  '}',
  '.__ec_tool_card .tool_name { color: #4ecdc4 !important; font-weight: 600 !important; }',
  '.__ec_tool_card .tool_status { float: right !important; font-size: 11px !important; }',
  // Working path badge
  '.__ec_path_badge {',
    'display: none !important;',
  '}',
].join('\n');
document.head.appendChild(css);

// ---------- Detect message container ----------
var scanTimer = null;
var processed = new WeakSet();
var _scanLock = false;

function scanMessages() {
  if (_scanLock) return;
  _scanLock = true;
  setTimeout(function() { _scanLock = false; }, 1000); // 解锁延迟防抖
  // Find message container first
  var msgContainer = document.querySelector('.chat-msgs') || 
                     document.querySelector('[class*="chat"]') ||
                     document.querySelector('[class*="message"]');
  if (!msgContainer) return;

  // 跳过卡片网格区域（防止误改员工列表等 Vue 组件）
  if (msgContainer.closest('.card-grid')) return;

  // Find message-like elements
  var allMsgs = msgContainer.querySelectorAll('.msg, [class*="msg-"], .message, [class*="message-"], .chat-bubble, [class*="bubble-"]');
  allMsgs.forEach(function(el) {
    if (processed.has(el)) return;
    // 双重检测: 已经有 __ec_msg 标记或者已经加了复制按钮的, 跳过
    if (el.classList.contains('__ec_msg')) return;
    if (el.querySelector('.__ec_copy')) return;
    // Check if this looks like a message (has substantial text)
    var text = el.textContent || '';
    if (text.length < 3) return;
    // Check if it's a proper message element (has some height)
    var rect = el.getBoundingClientRect();
    if (rect.height < 20 || rect.width < 50) return;
    
    processed.add(el);
    el.classList.add('__ec_msg');
    
    // Determine user vs AI
    // User messages are typically on the right, AI on the left
    var parentStyle = window.getComputedStyle(el.parentElement || el);
    var align = parentStyle.justifyContent || parentStyle.textAlign || '';
    if (align.indexOf('end') >= 0 || align.indexOf('right') >= 0 || align === 'flex-end') {
      el.classList.add('__ec_msg_user');
    } else {
      el.classList.add('__ec_msg_ai');
    }
    
    // 复制按钮由 Vue Chat 组件原生渲染, inject.js 不再添加
    
    // Check for thinking indicator
    if (text.indexOf('思考') >= 0 || text.indexOf('...') >= 0 || text.indexOf('thinking') >= 0) {
      enhanceThinking(el);
    }
    
    // Check for tool call patterns
    if (text.indexOf('🔧') >= 0 || text.indexOf('工具') >= 0 || text.indexOf('调用') >= 0 ||
        text.indexOf('search_web') >= 0 || text.indexOf('read_file') >= 0) {
      enhanceToolCard(el);
    }
  });
}

function enhanceThinking(el) {
  // Replace text with animated dots if it looks like a thinking message
  var text = el.textContent || '';
  if (text.indexOf('思考') >= 0 && text.indexOf('...') >= 0) {
    // Add thinking animation
    var dots = document.createElement('div');
    dots.className = '__ec_thinking';
    dots.innerHTML = '<span></span><span></span><span></span>';
    // Find the ... part and replace
    var html = el.innerHTML;
    html = html.replace(/\.\.\./g, dots.outerHTML);
    // Actually, simpler: just add the thinking class
    el.classList.add('__ec_thinking_anim');
  }
}

function enhanceToolCard(el) {
  // Check if this looks like a tool call result
  var text = el.textContent || '';
  if (text.length > 100) return; // Skip long responses
  
  var lines = text.split('\n').filter(function(l) { return l.trim(); });
  if (lines.length > 6) return; // Too many lines, not a tool card
  
  // Wrap in tool card style
  // But don't modify if it's already styled
  if (el.querySelector('.__ec_tool_inner')) return;
  
  var inner = document.createElement('div');
  inner.className = '__ec_tool_inner';
  inner.innerHTML = el.innerHTML;
  el.innerHTML = '';
  el.appendChild(inner);
  el.classList.add('__ec_tool_card');
}

// Start scanning
function startScan() {
  if (scanTimer) return;
  scanTimer = setInterval(scanMessages, 3000);
  // Also use MutationObserver for instant detection
  var obsTimer = null;
  var obs = new MutationObserver(function() {
    if (obsTimer) clearTimeout(obsTimer);
    obsTimer = setTimeout(function() { scanMessages(); }, 500);
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startScan);
} else {
  startScan();
}

console.log('['+V+'] All features active');
})();
