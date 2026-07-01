<template>
  <div class="chat-layout"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onFileDrop"
    @paste="onPaste">
    <!-- 拖拽遮罩 -->
    <div v-if="dragOver" class="drag-overlay">
      <div class="drag-hint">📎 拖拽文件到此处上传</div>
    </div>
    <!-- Sidebar: Agent List + Timeline -->
    <div class="chat-main">
      <div class="agent-sidebar">
        <div class="sb-search">
          <input v-model="search" :placeholder="__('chatSearch')" class="search-input" />
        </div>
        <div class="agent-scroll">
          <div v-for="cat in categories" :key="cat.label" class="agent-group">
            <div class="group-label">{{ cat.label }}</div>
            <template v-for="a in cat.agents" :key="a.id">
              <div class="agent-item" :class="{ active: current && current.id === a.id }" @click="selectAgent(a)">
                <span class="ci">{{ a.icon || '👑' }}</span>
                <div class="cinfo">
                  <div class="cin">{{ a.name_cn }}</div>
                  <div class="cit">{{ a.title }}</div>
                </div>
                <span class="cst" :class="a.status||'online'"></span>
              </div>
            </template>
          </div>
          <div v-if="!categories.length" class="empty-state"><p>{{ __('chatNoMatch') }}</p></div>
        </div>
      </div>
      <!-- Timeline Panel at sidebar bottom -->
      <div class="timeline-panel" :class="{ collapsed: !showTimeline }">
        <div class="timeline-header" @click="showTimeline = !showTimeline">
          <span class="timeline-title">📡 AI员工工作动态</span>
          <span class="timeline-toggle">{{ showTimeline ? '▼' : '◀' }}</span>
        </div>
        <div v-if="showTimeline" class="timeline-scroll" ref="timelineBox">
          <div v-for="(act, i) in liveActivities" :key="act.id || i" class="timeline-item" :class="'timeline-' + act.status">
            <div class="timeline-avatar">{{ act.icon }}</div>
            <div class="timeline-content">
              <div class="timeline-name">{{ act.name }} <span class="timeline-role">{{ act.role }}</span></div>
              <div class="timeline-action">{{ act.action }}</div>
            </div>
            <div class="timeline-time">{{ formatMsgTime(act.time) }}</div>
          </div>
          <div v-if="!liveActivities.length" class="timeline-empty">⏳ 正在加载员工动态...</div>
        </div>
      </div>
    </div>

    <!-- Chat Area -->
    <div class="chat-area">
      <template v-if="current">
        <div class="chat-hdr">
          <span class="chi">{{ current.icon || '👑' }}</span>
          <div>
            <div class="chn">{{ current.name_cn }}</div>
            <div class="cht">{{ current.title }}</div>
          </div>
        </div>
        <div class="msg-box" ref="msgBox">
          <div class="msg-spacer"></div>
          <div v-for="(m,i) in messages" :key="i" :class="'msg msg-' + m.role">
            <!-- Tool call card -->
            <div v-if="m.type === 'tool_call'" class="tool-call-card" :class="{ collapsed: !m._expanded }">
              <div class="tool-call-header" @click="m._expanded = !m._expanded">
                <span class="tool-icon">🔧</span>
                <span class="tool-name">{{ m.toolName }}</span>
                <span class="tool-status" :class="'status-' + (m.status || 'pending')">{{ m.status === 'running' ? '执行中...' : m.status === 'done' ? '✅ 完成' : m.status === 'error' ? '❌ 失败' : '等待中' }}</span>
                <span class="tool-toggle">{{ m._expanded ? '▼' : '▶' }}</span>
              </div>
              <div v-if="m._expanded" class="tool-call-body">
                <div class="tool-call-args">{{ m.summary || (m.args ? JSON.stringify(m.args, null, 2) : '') }}</div>
                <div v-if="m.result" class="tool-call-result" :class="{ 'result-error': m.status === 'error' }">{{ typeof m.result === 'string' ? m.result : JSON.stringify(m.result, null, 2) }}</div>
              </div>
            </div>
            <!-- Thinking block -->
            <div v-else-if="m.type === 'thinking'" class="thinking-block">
              <span class="thinking-icon">🧠</span>
              <span class="thinking-text">{{ m.content }}</span>
              <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
            <!-- File operation card -->
            <div v-else-if="m.type === 'file_op'" class="file-op-card">
              <span class="file-op-icon">{{ m.op === 'read' ? '📖' : '📝' }}</span>
              <span class="file-op-text">{{ m.op === 'read' ? '读取文件' : '写入文件' }}</span>
              <code class="file-op-path">{{ m.path }}</code>
              <span v-if="m.status === 'done'" class="file-op-status status-ok">✅</span>
              <span v-else class="file-op-status status-running">⏳</span>
            </div>
            <!-- Regular message -->
            <div v-else :class="'msg-body' + (m.content && m.content.length > 3000 ? ' msg-body-long' : '')" v-html="renderContent(m)"></div>
            <div v-if="m.files && m.files.length" class="msg-files">
              <div v-for="(f,fi) in m.files.filter(function(x){return x.isImg&&x.data})" :key="fi" class="msg-img-wrap">
                <img :src="f.data" class="msg-img" @click="previewImg(f.data)" />
              </div>
              <div v-for="(f,fi) in m.files.filter(function(x){return !x.isImg||!x.data})" :key="'nf'+fi" class="msg-file">
                📎 {{ f.name }}
              </div>
            </div>
            <div class="msg-time">{{ formatMsgTime(m.time) }}</div>
            <button v-if="m.content" class="msg-copy-btn" @click="copyMsg(m.content)" title="复制消息">📋</button>
          </div>
          <!-- Live streaming indicator -->
          <div v-if="streaming" class="msg msg-assistant">
            <div class="msg-body streaming-content">{{ streamContent }}<span class="streaming-cursor">▊</span></div>
          </div>
          <!-- Loading indicator -->
          <div v-if="loading && !streaming" class="msg msg-system">
            <div class="msg-body thinking-indicator">
              <span class="thinking-dot">●</span>
              <span class="thinking-dot">●</span>
              <span class="thinking-dot">●</span>
              <span class="thinking-text">{{ __('chatThinking') }}</span>
            </div>
          </div>
        </div>
        
        <!-- Input Area -->
        <div class="input-area">
          <textarea v-model="input" ref="chatInput" @keydown.enter.exact.prevent="send" :placeholder="__('chatPlaceholder')" rows="2" class="chat-input" :disabled="loading"></textarea>
          <div v-if="files.length" class="file-preview-wrap">
            <div v-for="(f,fi) in files" :key="fi" class="file-preview-item">
              <img v-if="f.isImg && f.data" :src="f.data" class="file-preview-img" />
              <span v-else class="file-preview-name">📎 {{ f.name }}</span>
              <button class="file-remove-btn" @click="removeFile(fi)">×</button>
            </div>
          </div>
          <div class="chat-actions">
            <label class="file-btn" :title="__('chatUploadFile')">📎<input type="file" multiple hidden @change="onFileSelect" /></label>
            <button v-if="!recording" @click="startRecording" class="file-btn" :title="__('chatVoiceInput')">🎤</button>
            <button v-else @click="stopRecording" class="file-btn" style="color:#ef4444" :title="__('chatStopRecording')">⏹️</button>
            <button v-if="!loading" @click="send" class="send-btn" :disabled="!input.trim() && !files.length">{{ __('chatSend') }}</button>
            <span v-if="files.length" class="file-count">{{ files.length }} {{ __('chatFileUnit') }}</span>
          </div>
        </div>
      </template>
      <div v-else class="no-chat-selected">
        <div class="no-chat-hint">← 请选择一位 AI 员工开始对话</div>
      </div>
    </div>

    <!-- Activity Panel (right side) -->
        <!-- Activity monitoring button + panel -->
    <div class="bottom-row">
      <div class="activity-mini" @click="showActivity=!showActivity" title="历史报告">
        <span>📋</span>
        <span v-if="activityCount > 0" class="activity-badge">{{ activityCount > 99 ? '99+' : activityCount }}</span>
      </div>
      <div v-show="showActivity" class="activity-bar">
        <div class="activity-toggle" @click="showActivity=!showActivity">
          <span>{{ '▼ 历史报告' }}</span>
        </div>
        <div class="activity-panel">
          <div v-for="(a,i) in activities.slice(-30).reverse()" :key="a.id || i" class="activity-item">
            <span class="act-icon">{{ a.icon || '•' }}</span>
            <span class="act-text">{{ a.text }}</span>
            <span class="act-time">{{ formatTime(a.time) }}</span>
          </div>
          <div v-if="!activities.length" class="act-empty">暂无历史报告</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { API } from '../main.js'
export default {
  data() {
    return {
      agents: [], current: null, messages: [],
      input: '', search: '', loading: false,
      dragOver: false, files: [], recording: false,
      showActivity: false,
      activityCount: 0,
      activities: [],
      showTimeline: true,
      liveActivities: [],
      livePollTimer: null,
      streaming: false,
      streamContent: '',
      ws: null,
      mediaRecorder: null, audioChunks: []
    }
  },
  computed: {
    filteredAgents() {
      if (!this.search) return this.agents
      const q = this.search.toLowerCase()
      return this.agents.filter(a => (a.name_cn||'').toLowerCase().includes(q) || (a.title||'').toLowerCase().includes(q))
    },
    categories() {
      const cats = [
        { label: '管理层', ids: ['ai_ceo','ai_cto','ai_cpo','ai_coo','ai_ciso'] },
        { label: '总监', ids: ['ai_architect','ai_fe_dir','ai_be_dir','ai_qa_dir','ai_sec_dir'] },
        { label: '资深', ids: ['ai_sr_frontend','ai_sr_backend','ai_sr_fullstack','ai_sr_ai','ai_sr_mobile','ai_sr_devops','ai_sr_data','ai_sr_sec'] },
        { label: '工程师', ids: ['ai_sec_engineer1','ai_sec_engineer2','ai_fe_vue','ai_fe_react','ai_be_python','ai_be_java','ai_be_go','ai_mobile_ios','ai_mobile_android','ai_test_auto','ai_test_manual','ai_db_admin','ai_ui_design','ai_sre','ai_doc_dev'] },
        { label: '全栈', ids: ['ai_sr_fullstack2','ai_sr_fullstack3','ai_fs_xuwenbin','ai_fs_yesiqi','ai_fs_fanzhiyuan','ai_fs_luojiayin','ai_fs_qinzixuan','ai_fs_pengzihao'] },
        { label: '合规审计(联合治理)', ids: ['ai_compliance_dir','ai_compliance_senior','ai_compliance_auditor','ai_compliance_data','ai_compliance_legal'] },
      ]
      const filtered = this.filteredAgents
      return cats.map(c => ({ label: c.label, agents: c.ids.map(id => filtered.find(a => a.id === id)).filter(Boolean) })).filter(c => c.agents.length)
    }
  },
  watch: {
    'messages': { handler: 'scrollToBottom', deep: true },
    'activities': { handler: 'onActivityChange', deep: true }
  },
  methods: {
    copyMsg(content) {
      if (!content) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      } else {
        // Fallback for older browsers
        var ta = document.createElement('textarea');
        ta.value = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    },
    scrollToBottom() {
      this.$nextTick(function() {
        var box = this.$refs && this.$refs.msgBox;
        if (box) { box.scrollTop = box.scrollHeight; }
      }.bind(this))
    },
    onActivityChange() {
      var el = this.$el && this.$el.querySelector('.activity-panel');
      if (el) { el.scrollTop = el.scrollHeight; }
    },
    selectAgent(a) {
      this.current = a
      this.loadMessages(a.id)
      this.$nextTick(this.scrollToBottom)
      this.$nextTick(() => {
        if (this.$refs.chatInput) this.$refs.chatInput.focus();
      });
    },
    // SSE streaming chat
    async send() {
      if (!this.input.trim() && !this.files.length) return
      var loadingFiles = this.files.filter(function(f) { return f._loading; })
      if (loadingFiles.length > 0) {
        var waitCount = 0
        while (loadingFiles.some(function(f) { return f._loading; }) && waitCount < 50) {
          await new Promise(function(r) { setTimeout(r, 100); })
          waitCount++
        }
      }
      let text = this.input.trim()
      let imageData = null;
      let textFiles = [];
      
      if (this.files.length) {
        this.files.forEach(f => {
          if (f.isImg && f.data) {
            if (!imageData) imageData = f.data.split(',')[1] || f.data;
          } else if (f.data && !f.isImg) {
            let content = f.data;
            if (f.data.startsWith('data:')) {
              content = f.data.split(',')[1] || f.data;
              try { content = atob(content); } catch(e) {}
            }
            textFiles.push({ name: f.name, type: f.type, content: content.substring(0, 50000) });
          }
        });
      }
      
      var sendFiles = this.files.length ? this.files.map(function(f) { return { name: f.name, isImg: f.isImg, size: f.size, data: f.data }; }) : null
      this.messages.push({ role: 'user', content: text, files: sendFiles, time: new Date().toISOString() })
      this.saveMessages()
      this.input = ''
      this.files = []
      this.$nextTick(this.scrollToBottom)
      
      if (!this.current || this.current.id !== 'ai_ceo') {
        this.loading = true
        try {
          const resp = await API.post('/api/chat', { agentId: this.current.id, message: text, image: imageData, files: textFiles })
          if (resp.reply) this.typewriterEffect(resp.reply)
          else if (resp.error) this.messages.push({ role: 'assistant', content: '错误: ' + resp.error, isError: true, time: new Date().toISOString() })
        } catch(e) {
          this.messages.push({ role: 'assistant', content: '网络错误: ' + e.message, isError: true, time: new Date().toISOString() })
        } finally {
          this.loading = false
          this.$nextTick(this.scrollToBottom)
          if (this.$refs.chatInput) this.$refs.chatInput.focus();
        }
        return
      }
      
      // CEO: SSE streaming
      this.loading = true
      this.streaming = true
      this.streamContent = ''
      var self = this
      self.addThinkingMsg('AI CEO 正在分析你的问题')
      
      try {
        const resp = await fetch('/api/chat/sse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: 'ai_ceo', message: text, image: imageData, files: textFiles })
        })
        
        if (!resp.ok) {
          var errText = await resp.text()
          self.messages.push({ role: 'assistant', content: '错误: ' + (errText || resp.statusText), isError: true, time: new Date().toISOString() })
          self.saveMessages()
          self.streaming = false
          self.loading = false
          self.removeLastThinking()
          self.$nextTick(self.scrollToBottom)
          return
        }
        
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        var buffer = ''
        var finalReply = ''
        
        while (true) {
          var { done, value } = await reader.read()
          if (done) break
          
          buffer += decoder.decode(value, { stream: true })
          var lines = buffer.split('\n')
          buffer = lines.pop() || ''
          
          for (var _l = 0; _l < lines.length; _l++) {
            var line = lines[_l].trim()
            if (!line || !line.startsWith('data: ')) continue
            var data
            try { data = JSON.parse(line.substring(6)) } catch(e) { continue }
            
            if (data.type === 'thinking') self.addThinkingMsg(data.content)
            else if (data.type === 'tool_call') { self.removeLastThinking(); self.addToolCall(data.name, data.args, data.summary); }
            else if (data.type === 'tool_result') self.updateLastToolCall(data.status, data.result)
            else if (data.type === 'file_read') { self.removeLastThinking(); self.addFileOp('read', data.path); }
            else if (data.type === 'file_write') { self.removeLastThinking(); self.addFileOp('write', data.path); }
            else if (data.type === 'message') { finalReply += data.content || ''; self.streamContent = finalReply; }
            else if (data.type === 'done') { finalReply = data.reply || finalReply; self.streamContent = finalReply; }
            self.$nextTick(self.scrollToBottom)
          }
        }
        
        self.streaming = false
        self.loading = false
        self.removeLastThinking()
        if (finalReply) self.typewriterEffect(finalReply)
        self.saveMessages()
        self.$nextTick(self.scrollToBottom)
      } catch(e) {
        console.error('SSE error:', e)
        self.messages.push({ role: 'assistant', content: '网络错误: ' + e.message, isError: true, time: new Date().toISOString() })
        self.saveMessages()
        self.streaming = false
        self.loading = false
        self.removeLastThinking()
        self.$nextTick(self.scrollToBottom)
      }
      if (self.$refs.chatInput) self.$refs.chatInput.focus();
    },
    
    addToolCall(name, args, summary) {
      this.messages.push({ role: 'assistant', type: 'tool_call', toolName: name, args: args || {}, summary: summary || '', status: 'running', _expanded: false, time: new Date().toISOString() })
      this.saveMessages()
    },
    updateLastToolCall(status, result) {
      for (var i = this.messages.length - 1; i >= 0; i--) {
        if (this.messages[i].type === 'tool_call') { this.messages[i].status = status || 'done'; if (result) this.messages[i].result = result; break; }
      }
    },
    addThinkingMsg(text) {
      this.messages.push({ role: 'assistant', type: 'thinking', content: text || '思考中...', time: new Date().toISOString() })
    },
    removeLastThinking() {
      for (var i = this.messages.length - 1; i >= 0; i--) {
        if (this.messages[i].type === 'thinking') { this.messages.splice(i, 1); break; }
      }
    },
    addFileOp(op, path) {
      this.messages.push({ role: 'assistant', type: 'file_op', op: op, path: path, status: 'running', time: new Date().toISOString() })
      setTimeout(() => {
        for (var i = this.messages.length - 1; i >= 0; i--) {
          if (this.messages[i].type === 'file_op' && this.messages[i].op === op && this.messages[i].path === path) { this.messages[i].status = 'done'; break; }
        }
      }, 500)
    },
    typewriterEffect(text) {
      var words = text.split('')
      var chunkSize = 3
      var idx = 0
      var msg = { role: 'assistant', content: '', time: new Date().toISOString() }
      this.messages.push(msg)
      this.saveMessages()
      var self = this
      function typeNext() {
        if (idx >= words.length) { msg.content = text; self.saveMessages(); self.$nextTick(self.scrollToBottom); return; }
        var chunk = words.slice(idx, idx + chunkSize).join('')
        idx += chunkSize
        msg.content = (msg.content || '') + chunk
        self.$nextTick(self.scrollToBottom)
        var delay = chunk.match(/[，。！？；：\n]/) ? 50 : 15
        setTimeout(typeNext, delay)
      }
      typeNext()
    },
    renderContent(m) {
      if (!m || !m.content) return ''
      var text = m.content
      // For very long messages, skip markdown rendering entirely
      // The msg-body-long class uses CSS pre-wrap for clean display
      if (text.length > 8000) {
        return '<div style="white-space:pre-wrap;word-break:break-word;line-height:1.6">' + (text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') + '</div>';
      }
      text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
      text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
      return text;
    }
    __escapeHtml: function(t) {
      return (t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },
    onFileSelect(e) {
      var self = this;
      var selected = Array.from(e.target.files || []);
      selected.forEach(function(file) {
        var reader = new FileReader();
        var item = { name: file.name, size: file.size, type: file.type, _loading: true };
        reader.onload = function(ev) { item.data = ev.target.result; item.isImg = file.type.startsWith('image/'); item._loading = false; };
        reader.readAsDataURL(file);
        self.files.push(item);
      });
      e.target.value = '';
    },
    removeFile(idx) { this.files.splice(idx, 1); },
    previewImg(src) { window.open(src, '_blank'); },
    startRecording() {
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert('浏览器不支持语音识别，请使用 Chrome/Edge');
        return;
      }
      this.recording = true;
      var recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = false;
      var self = this;
      recognition.onresult = function(event) {
        var transcript = event.results[0][0].transcript;
        self.input = (self.input || '') + transcript;
        self.recording = false;
        self.$nextTick(function() {
          if (self.$refs.chatInput) self.$refs.chatInput.focus();
        });
      };
      recognition.onerror = function(event) {
        console.error('Speech error:', event.error);
        self.recording = false;
      };
      recognition.onend = function() {
        self.recording = false;
      };
      try { recognition.start(); } catch(e) { self.recording = false; }
    },
    stopRecording() { this.recording = false; },
    onFileDrop(e) { this.dragOver = false; var files = e.dataTransfer.files; if (files && files.length > 0) this.processFiles(files); },
    onPaste(e) {
      var items = e.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) { var item = items[i]; if (item.type.startsWith('image/') || item.kind === 'file') { var file = item.getAsFile(); if (file) this.processFiles([file]); } }
    },
    processFiles(fileList) {
      Array.from(fileList).forEach(file => {
        if (file.size > 10 * 1024 * 1024) { alert('文件过大，最大支持 10MB: ' + file.name); return; }
        var isImg = file.type.startsWith('image/'); var reader = new FileReader();
        reader.onload = (e) => { this.files.push({ name: file.name, size: file.size, type: file.type, isImg: isImg, data: e.target.result, file: file }); };
        if (isImg) reader.readAsDataURL(file);
        else if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|js|ts|vue|html|css|py|java|go|rs|sh|bat|ps1|yaml|yml|xml|sql|log|csv)$/i)) reader.readAsText(file);
        else reader.readAsDataURL(file);
      });
    },
    loadMessages(agentId) { try { var key = 'chat_' + agentId; var saved = localStorage.getItem(key); this.messages = saved ? JSON.parse(saved) : []; } catch(e) { this.messages = []; } },
    saveMessages() { if (!this.current) return; var key = 'chat_' + this.current.id; localStorage.setItem(key, JSON.stringify(this.messages)); },
    formatMsgTime(ts) {
      if (!ts) return ''; var d = new Date(ts); var now = new Date(); var isToday = d.toDateString() === now.toDateString(); var time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      if (isToday) return time; return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + time;
    },
    formatTime(ts) { if (!ts) return ''; return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); },
    connectWebSocket() {
      var wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => { console.log('[WS] 已连接'); this.ws.send(JSON.stringify({ type: 'subscribe', channels: ['channel', 'ceo', 'agents'] })); };
      this.ws.onmessage = (event) => { try { var msg = JSON.parse(event.data); this.handleWSMessage(msg); } catch(e) {} };
      this.ws.onerror = (err) => { console.error('[WS] 连接错误:', err); };
      this.ws.onclose = () => { console.log('[WS] 连接关闭，5秒后重连'); setTimeout(() => this.connectWebSocket(), 5000); };
    },
    handleWSMessage(msg) {
      var { channel, type } = msg;
      if (channel === 'channel' && type === 'channel_message') {
        this.activities.unshift({ type: 'external', source: msg.source, message: msg.message, from: msg.from, time: msg.timestamp || new Date().toISOString() });
        this.activityCount++;
        if (this.current && this.current.id === 'ai_ceo') {
          this.messages.push({ role: 'external', content: msg.message, source: msg.source, from: msg.from, time: msg.timestamp });
          this.$nextTick(this.scrollToBottom); this.saveMessages();
        }
      }
      if (channel === 'ceo' && type === 'ceo_message') {
        if (this.current && this.current.id === 'ai_ceo') {
          this.messages.push({ role: 'assistant', content: msg.message, source: msg.source, agentName: 'AI CEO', time: msg.timestamp });
          this.$nextTick(this.scrollToBottom); this.saveMessages();
        }
      }
    },
    pollLiveActivities() {
      var self = this;
      var since = self.liveActivities.length ? self.liveActivities[self.liveActivities.length - 1].time : '';
      API.get('/api/employee-activities?limit=50' + (since ? '&since=' + encodeURIComponent(since) : '')).then(function(d) {
        if (d.ok && d.activities && d.activities.length) {
          var newItems = since ? d.activities : d.activities.slice(-30);
          newItems.forEach(function(a) { if (!self.liveActivities.find(function(x) { return x.id === a.id; })) { self.liveActivities.push(a); } });
          if (self.liveActivities.length > 100) self.liveActivities = self.liveActivities.slice(-100);
          self.$nextTick(function() { var box = self.$refs.timelineBox; if (box) box.scrollTop = box.scrollHeight; });
        }
      }).catch(function(err) { console.error('[Timeline] API error:', err); });
    }
  },
  mounted() {
    API.get('/api/employees').then(d => {
      if (d.ok && d.employees) {
        this.agents = d.employees;
        var main = this.agents.find(a => a.id === 'ai_ceo') || this.agents[0];
        if (main) this.selectAgent(main);
      }
    }).catch(e => console.error('Load agents error:', e));
    
    API.get('/api/activities').then(d => { if (d.ok && d.activities) this.activities = d.activities; }).catch(e => console.error('Load activities error:', e));
    
    this.pollLiveActivities();
    this.livePollTimer = setInterval(this.pollLiveActivities.bind(this), 5000);
    this.connectWebSocket();
  },
  beforeUnmount() {
    if (this.livePollTimer) { clearInterval(this.livePollTimer); this.livePollTimer = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}
</script>

<style scoped>
.chat-layout { display: flex; height: 100vh; overflow: hidden; }
.chat-main { width: 180px; min-width: 180px; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg2); }
.agent-sidebar { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.sb-search { padding: 8px 10px; }
.search-input { width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--fg); font-size: 12px; outline: none; box-sizing: border-box; }
.search-input:focus { border-color: var(--accent); }
.agent-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.agent-group { margin-bottom: 2px; }
.group-label { padding: 5px 10px 2px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--fg3); }
.agent-item { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background 0.1s; }
.agent-item:hover { background: rgba(255,255,255,0.05); }
.agent-item.active { background: rgba(78, 205, 196, 0.08); border-left: 2px solid var(--accent); padding-left: 8px; }
.ci { text-align: center; min-width: 24px; font-size: 16px; }
.cinfo { flex: 1; min-width: 0; overflow: hidden; }
.cin { font-size: 12px; font-weight: 500; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cit { font-size: 10px; color: var(--fg2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cst { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.cst.online { background: var(--accent); }
.cst.offline { background: #666; }

/* Timeline Panel */
.timeline-panel { flex-shrink: 0; height: 160px; background: var(--bg1); border-top: 1px solid var(--border); display: flex; flex-direction: column; transition: height 0.3s; overflow: hidden; }
.timeline-panel.collapsed { height: 28px; }
.timeline-header { display: flex; align-items: center; padding: 4px 8px; cursor: pointer; font-size: 10px; color: var(--fg2); user-select: none; background: rgba(255,255,255,0.02); }
.timeline-title { flex: 1; }
.timeline-toggle { font-size: 8px; }
.timeline-scroll { flex: 1; overflow-y: auto; padding: 4px 6px; }
.timeline-item { display: flex; align-items: flex-start; gap: 4px; padding: 3px 4px; border-radius: 4px; font-size: 10px; }
.timeline-item:hover { background: rgba(255,255,255,0.03); }
.timeline-avatar { font-size: 12px; }
.timeline-content { flex: 1; min-width: 0; }
.timeline-name { font-size: 9px; color: var(--accent); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.timeline-role { font-size: 8px; color: var(--fg3); font-weight: normal; }
.timeline-action { font-size: 9px; color: var(--fg2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.timeline-time { font-size: 8px; color: var(--fg3); flex-shrink: 0; }
.timeline-empty { text-align: center; padding: 20px; color: var(--fg3); font-size: 10px; }

/* Chat Area */
.chat-area { flex: 1; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.chat-hdr { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--border); }
.chi { font-size: 20px; }
.chn { font-size: 14px; color: #fff; font-weight: 600; }
.cht { font-size: 11px; color: var(--fg2); }
.msg-box { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.msg-spacer { flex: 1; }
.msg { max-width: 85%; border-radius: 8px; padding: 8px 12px; font-size: 13px; line-height: 1.5; animation: fadeInMsg 0.2s ease; }
@keyframes fadeInMsg { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
.msg-user { background: rgba(78, 205, 196, 0.15); border: 1px solid rgba(78, 205, 196, 0.2); align-self: flex-end; color: #e0f5f2; }
.msg-assistant { background: rgba(255,255,255,0.06); align-self: flex-start; color: var(--fg); }
.msg-system { background: transparent; align-self: center; color: var(--fg3); font-size: 12px; }
.msg-body { white-space: pre-wrap; word-break: break-word; }
.msg-body strong { color: var(--accent); }
.msg-body code { background: rgba(0,0,0,0.3); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.msg-body pre { background: rgba(0,0,0,0.3); border-radius: 6px; padding: 10px; overflow-x: auto; margin: 8px 0; font-size: 12px; }
.msg-time { font-size: 10px; color: var(--fg3); margin-top: 3px; text-align: right; }
.msg-img-wrap { margin-top: 4px; }
.msg-img { max-width: 180px; max-height: 180px; border-radius: 6px; cursor: pointer; }
.msg-file { display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.08); border-radius: 4px; padding: 2px 8px; font-size: 11px; margin-right: 4px; margin-top: 4px; }
.msg-files { margin-top: 4px; }

/* Tool call card */
.tool-call-card { background: rgba(78, 205, 196, 0.06); border: 1px solid rgba(78, 205, 196, 0.15); border-radius: 8px; overflow: hidden; margin: 2px 0; font-size: 12px; align-self: flex-start; width: 100%; max-width: 85%; }
.tool-call-header { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; user-select: none; }
.tool-icon { font-size: 13px; }
.tool-name { color: var(--accent); font-weight: 600; flex: 1; font-size: 11px; }
.tool-status { font-size: 10px; padding: 1px 5px; border-radius: 3px; }
.status-running { color: #eab308; background: rgba(234, 179, 8, 0.15); }
.status-done { color: #22c55e; background: rgba(34, 197, 94, 0.15); }
.status-error { color: #ef4444; background: rgba(239, 68, 68, 0.15); }
.tool-toggle { color: var(--fg3); font-size: 9px; }
.tool-call-body { padding: 3px 8px 6px; border-top: 1px solid rgba(255,255,255,0.05); }
.tool-call-args { font-size: 11px; color: var(--fg2); font-family: monospace; white-space: pre-wrap; }
.tool-call-result { font-size: 11px; color: var(--fg); background: rgba(0,0,0,0.2); border-radius: 4px; padding: 4px; margin-top: 4px; font-family: monospace; white-space: pre-wrap; max-height: 100px; overflow-y: auto; }

/* Thinking block */
.thinking-block { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--fg2); padding: 4px 0; align-self: flex-start; }
.thinking-icon { font-size: 13px; }
.thinking-dots { display: inline-flex; gap: 2px; }
.thinking-dots span { animation: dotPulse 1.4s infinite; }
.thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotPulse { 0%, 80%, 100% { opacity: 0; } 40% { opacity: 1; } }

/* File op card */
.file-op-card { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--fg2); padding: 3px 0; align-self: flex-start; }
.file-op-icon { font-size: 13px; }
.file-op-path { background: rgba(0,0,0,0.3); padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 11px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-op-status { flex-shrink: 0; }

/* Streaming */
.streaming-content { white-space: pre-wrap; }
.streaming-cursor { animation: cursorBlink 0.8s infinite; color: var(--accent); }
@keyframes cursorBlink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }

/* Thinking indicator */
.thinking-indicator { display: flex; align-items: center; gap: 4px; padding: 6px; }
.thinking-dot { font-size: 16px; color: var(--accent); animation: dotBounce 1.4s infinite; }
.thinking-dot:nth-child(2) { animation-delay: 0.2s; }
.thinking-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotBounce { 0%, 80%, 100% { transform: scale(0.6); } 40% { transform: scale(1); } }
.thinking-text { font-size: 12px; color: var(--fg2); margin-left: 4px; }

/* Input */
.input-area { border-top: 1px solid var(--border); padding: 8px 16px; background: var(--bg2); }
.chat-input { width: 100%; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--fg); font-size: 13px; outline: none; resize: none; font-family: inherit; box-sizing: border-box; }
.chat-input:focus { border-color: var(--accent); }
.file-preview-wrap { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 4px; }
.file-preview-item { display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.06); border-radius: 4px; padding: 2px 6px; font-size: 11px; }
.file-preview-img { width: 28px; height: 28px; border-radius: 4px; object-fit: cover; }
.file-preview-name { color: var(--fg2); }
.file-remove-btn { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 14px; padding: 0 2px; }
.chat-actions { display: flex; align-items: center; gap: 6px; padding-top: 6px; }
.file-btn { background: none; border: 1px solid var(--border); border-radius: 6px; padding: 5px 7px; cursor: pointer; font-size: 13px; line-height: 1; color: var(--fg2); transition: all 0.12s; }
.file-btn:hover { color: var(--fg); border-color: var(--accent); }
.file-btn input[type=file] { display: none; }
.send-btn { padding: 5px 14px; border-radius: 6px; border: none; background: var(--accent); color: #0f0c29; font-size: 13px; font-weight: 600; cursor: pointer; }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.file-count { color: var(--fg3); font-size: 11px; }
.no-chat-selected { flex: 1; display: flex; justify-content: center; align-items: center; }
.no-chat-hint { color: var(--fg3); font-size: 14px; }

/* Activity Panel */
.activity-mini{border:1px solid var(--border);background:var(--bg2);cursor:pointer;border-radius:50%;justify-content:center;align-items:center;width:40px;height:40px;font-size:18px;display:flex;box-shadow:0 2px 12px rgba(0,0,0,0.3);transition:all .15s;position:absolute;top:-48px;right:0;z-index:101}
.activity-mini:hover{border-color:var(--accent);transform:scale(1.1)}
.bottom-row { position: fixed; right: 16px; bottom: 16px; z-index: 100; max-width: 320px; }
.activity-bar { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
.activity-toggle { display: flex; align-items: center; gap: 6px; padding: 6px 12px; cursor: pointer; font-size: 11px; color: var(--fg2); user-select: none; }
.activity-toggle:hover { background: rgba(255,255,255,0.03); }
.activity-badge { background: var(--accent); color: #0f0c29; border-radius: 10px; padding: 0 6px; font-size: 10px; font-weight: 600; }
.activity-panel { max-height: 300px; overflow-y: auto; padding: 4px 8px; border-top: 1px solid var(--border); }
.activity-item { display: flex; align-items: flex-start; gap: 6px; padding: 4px 4px; border-radius: 4px; font-size: 11px; }
.activity-item:hover { background: rgba(255,255,255,0.03); }
.act-icon { font-size: 12px; flex-shrink: 0; }
.act-text { flex: 1; min-width: 0; color: var(--fg2); word-break: break-word; }
.act-time { font-size: 9px; color: var(--fg3); flex-shrink: 0; white-space: nowrap; }
.act-empty { text-align: center; padding: 20px; color: var(--fg3); font-size: 11px; }

.msg-copy-btn {
  opacity: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
  transition: opacity 0.2s;
  line-height: 1;
}
.msg:hover .msg-copy-btn {
  opacity: 0.6;
}
.msg-copy-btn:hover {
  opacity: 1 !important;
}


/* Long message rendering - pure text to avoid DOM explosion */
.msg-body-long {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  line-height: 1.6;
}
.msg-body-long strong { font-weight: 600; }
.msg-body-long code {
  background: rgba(255,255,255,0.08);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.9em;
}
.msg-body-long pre {
  background: rgba(0,0,0,0.2);
  padding: 8px 12px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 4px 0;
}

</style>
