<template>
  <div class="chat-layout"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onFileDrop"
    @paste="onPaste">
    <!-- Main Chat Area -->
    <div class="chat-main">
      <!-- 主聊天框拖拽遮罩 -->
      <div v-if="dragOver" class="drag-overlay" @dragleave.prevent="dragOver=false" @drop.prevent="handleDrop">
        <div class="drag-overlay-content">
          <p>{{ $t('chat.drop_files') || '释放文件到主聊天框' }}</p>
        </div>
      </div>
      <div class="chat-hdr">
        <span class="chi">{{ current ? (current.icon || '👑') : '👑' }}</span>
        <div>
          <div class="chn">{{ current ? current.name_cn : $t('chat.ceo_main_workspace', '工作台') }}</div>
          <div class="cht">{{ current ? current.title : $t('chat.ready', '就绪') }}</div>
        </div>
        <button class="create-avatar-btn" @click="showCreateAvatar = true" :title="$t('chat.new_avatar', '创建新分身')">+ {{ $t('chat.avatar_clone', '分身') }}</button>
        <select v-model="modelName" class="model-select" @change="onModelChange" title="选择模型">
          <option v-for="m in modelList" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
        <button class="compress-btn" @click="compressHistory" title="压缩历史消息" :disabled="messages.length < 50">📦</button>
        <button class="refresh-btn" @click="refreshHistory" title="刷新消息">🔄</button><button class="search-btn" @click="showSearch = !showSearch" title="搜索消息" :class="{ active: showSearch }">🔍</button>
        <div v-if="showSearch" class="search-bar">
          <input v-model="searchQuery" ref="searchInput" placeholder="搜索消息..." @keyup.escape="showSearch=false" @keyup.enter="doSearch()" class="search-input" />
          <div class="search-meta">
            <span v-if="searchResults.length">{{ searchIdx + 1 }}/{{ searchResults.length }}</span>
            <button v-if="searchResults.length" class="search-nav-btn" @click="searchPrev">▲</button>
            <button v-if="searchResults.length" class="search-nav-btn" @click="searchNext">▼</button>
            <button class="search-close-btn" @click="showSearch = false">✕</button>
          </div>
        </div>
        <span v-if="compressedCount" class="compress-badge" @click="compressHistory">已压缩 {{ compressedCount }} 条</span>
        <!-- WebSocket broadcast notifications -->
        <div class="ws-notif-area" @mouseenter="wsNotifUnread = 0">
          <button class="ws-notif-btn" :class="{ connected: wsConnected }"><span class="ws-dot"></span>🔔</button>
          <span v-if="wsNotifUnread > 0" class="ws-notif-badge">{{ wsNotifUnread > 99 ? '99+' : wsNotifUnread }}</span>
          <div v-if="wsNotifications.length" class="ws-notif-dropdown" @mouseenter.stop>
            <div class="ws-notif-header">实时动态</div>
            <div class="ws-notif-list">
              <div v-for="(n,i) in wsNotifications.slice(-20).reverse()" :key="i" class="ws-notif-item">
                <span class="ws-notif-icon">{{ n.source_icon || '📡' }}</span>
                <div class="ws-notif-body">
                  <div class="ws-notif-text">{{ n.message || n.content || '' }}</div>
                  <div class="ws-notif-meta">{{ n.channel }} · {{ n.from || '' }} · {{ formatMsgTime(n.time) }}</div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="ws-notif-dropdown" @mouseenter.stop>
            <div class="ws-notif-header">实时动态</div>
            <div class="ws-notif-empty">暂无实时动态</div>
          </div>
        </div>
      </div>

      <div class="msg-box" ref="msgBox">
        <div class="msg-spacer"></div><transition name="fade">
          <button v-if="showScrollBtn" class="scroll-bottom-btn" @click="scrollToBottom">⬇ 回到底部</button>
        </transition>
        <div v-for="(m,i) in messages" :key="i" :class="'msg msg-' + m.role">
          <!-- Tool call card (workflow timeline) -->
          <div v-if="m.type === 'tool_call'" class="tool-call-card" :class="{ collapsed: !m._expanded, 'status-done': m.status==='done', 'status-error': m.status==='error', 'status-running': m.status==='running' }">
            <!-- Timeline connector line (shown when prev msg is also a tool_call) -->
            <div v-if="i>0 && messages[i-1] && messages[i-1].type==='tool_call'" class="timeline-connector"></div>
            <div class="tool-call-header" @click="m._expanded = !m._expanded">
              <span class="tl-step-badge" :class="'step-' + (m.status || 'pending')">{{ m.status === 'running' ? '⚡' : m.status === 'done' ? '✅' : m.status === 'error' ? '❌' : '⏳' }}</span>
              <span class="tool-name">{{ m.toolName }}</span>
              <!-- 步骤计数器 -->
              <span class="tl-step-counter">{{ getToolStep(i, messages) }}</span>
              <span class="tool-status" :class="'status-' + (m.status || 'pending')">{{ m.status === 'running' ? '执行中...' : m.status === 'done' ? $t('chat.completed') : m.status === 'error' ? '失败' : '等待' }}</span>
              <span class="tool-toggle">{{ m._expanded ? '▾' : '▸' }}</span>
            </div>
            <!-- Collapsed: show one-line summary -->
            <div v-if="!m._expanded" class="tool-call-preview">
              <span class="tool-preview-text">{{ (m.summary ? m.summary : '(直接执行)') }}</span>
              <span v-if="m.result" class="tool-preview-result">{{ typeof m.result === 'string' ? m.result.substring(0,80) : JSON.stringify(m.result).substring(0,80) }}{{ ((typeof m.result === 'string' ? m.result : JSON.stringify(m.result)) || '').length > 80 ? '…' : '' }}</span>
            </div>
            <!-- Expanded: show full details -->
            <div v-if="m._expanded" class="tool-call-body">
              <div class="tool-call-section">
                <span class="tl-section-label">{{ $t('chat.task_input','📥 输入') }}</span>
                <div class="tool-call-args source-code">{{ m.summary || (m.args ? JSON.stringify(m.args, null, 2) : '无参数') }}</div>
              </div>
              <div v-if="m.result" class="tool-call-section">
                <span class="tl-section-label">{{ $t('chat.task_output','📤 结果') }}</span>
                <div class="tool-call-result" :class="{ 'result-error': m.status === 'error' }">{{ typeof m.result === 'string' ? m.result : JSON.stringify(m.result, null, 2) }}</div>
              </div>
            </div>
          </div>
          <!-- Thinking block -->
          <div v-else-if="m.type === 'thinking'" class="thinking-block">
            <span class="thinking-icon">🧠</span>
            <span class="thinking-text">{{ m.content }}</span>
            <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
          </div>
          <!-- 文件安全授权卡片 -->
          <div v-else-if="m.type === 'auth_request'" class="auth-card">
            <div class="auth-header">
              <span class="auth-icon">🔐</span>
              <span class="auth-title">文件访问授权请求</span>
            </div>
            <div class="auth-body">
              <div class="auth-field"><span class="auth-label">路径:</span> <code>{{ m.path }}</code></div>
              <div class="auth-field"><span class="auth-label">工具:</span> <code>{{ m.toolName }}</code></div>
              <div v-if="m.message" class="auth-field">{{ m.message }}</div>
              <div v-if="m.status === 'authorized'" class="auth-result auth-approved">✅ 已授权</div>
              <div v-else-if="m.status === 'denied'" class="auth-result auth-rejected">❌ 已拒绝</div>
              <div v-else class="auth-buttons">
                <button class="btn-auth auth-once" @click="sendAuthDecision(m.authId, 'one_time')">同意</button>
                <button class="btn-auth auth-deny" @click="sendAuthDecision(m.authId, 'deny')">拒绝</button>
              </div>
            </div>
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
          <div v-else class="msg-bubble" :style="bubbleStyle(m.role)" @contextmenu.prevent="showContextMenu($event, m)"><div class="msg-text" v-html="renderContent(m)"></div></div>
          <div v-if="m.files && m.files.length" class="msg-files">
            <div v-for="(f,fi) in m.files.filter(function(x){return x.isImg&&x.data})" :key="fi" class="msg-img-wrap">
              <img :src="f.data" class="msg-img" @click="previewImg(f.data)" @error="f._imgErr=true" />
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
          <div class="msg-bubble streaming"><div class="msg-text streaming-content">{{ streamContent }}<span class="streaming-cursor">▊</span></div></div>
        </div>
        <!-- Loading indicator -->
        
      <!-- Right-click context menu -->
      <div v-if="ctxMenu.show" class="ctx-menu" :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }" @click.stop @contextmenu.prevent>
        <div class="ctx-menu-item" @click="ctxCopy">📋 复制消息</div>
        <div class="ctx-menu-item" @click="ctxQuote">💬 引用回复</div>
        <div class="ctx-menu-item" @click="ctxFillInput">✏️ 填入输入框</div>
        <div v-if="ctxMenu.msg && ctxMenu.msg.role === 'user'" class="ctx-menu-item" @click="ctxResend">🔄 重新发送</div>
      </div>
      <!-- Context menu backdrop -->
      <div v-if="ctxMenu.show" class="ctx-backdrop" @click="ctxMenu.show = false"></div>
<div v-if="loading && !streaming" class="msg msg-system">
          <div class="msg-bubble system"><div class="msg-text thinking-indicator">
            <span class="thinking-dot">●</span>
            <span class="thinking-dot">●</span>
            <span class="thinking-dot">●</span>
            <span class="thinking-text">{{ __('chatThinking') }}</span>
          </div></div>
        </div>
      </div>

      <!-- File preview bar for main chat -->
      <div v-if="files.length" class="file-preview-wrap main-file-preview">
        <div v-for="(f,fi) in files" :key="fi" class="file-preview-item">
          <img v-if="f.isImg && f.data" :src="f.data" class="file-preview-img" />
          <span v-else class="file-preview-name">📎 {{ f.name }}</span>
          <button class="file-remove-btn" @click="removeFile(fi)">×</button>
        </div>
      </div>

      <!-- Input Area -->
      <div class="input-area">
        
        <div v-if="showQuickActions" class="quick-actions">
          <div class="quick-action-item" @click="fillQuick('告警引擎状态')">🔔 告警引擎状态</div>
          <div class="quick-action-item" @click="fillQuick('系统健康检查')">💊 系统健康检查</div>
          <div class="quick-action-item" @click="fillQuick('数据库中有哪些表')">🗄️ 数据库表</div>
          <div class="quick-action-item" @click="fillQuick('回滚点列表')">↩ 回滚点列表</div>
          <div class="quick-action-item" @click="fillQuick('热搜词')">🔥 热搜词</div>
          <div class="quick-action-item" @click="fillQuick('搜索')">🔍 搜索...</div>
        </div><div class="long-text-indicator" :class="{ show: input.length >= LONG_TEXT_THRESHOLD }">📄 文本较长，将自动转为文件</div>
        <div class="input-row">
          <textarea v-model="input" ref="chatInput" @keydown.enter.exact.prevent="send" @keydown.ctrl.enter.prevent="insertNewline" :placeholder="__('chatPlaceholder')" rows="1" class="chat-input" :disabled="loading"></textarea>
          <button class="pause-btn" @click="togglePause" :class="{paused:taskPaused,busy:!taskPaused&&(loading||streaming)}" :title="taskPaused?$t('chat.resume_task','恢复后台任务'):$t('chat.pause_task','暂停后台任务')">{{loading||streaming?'⏳':taskPaused?'▶':'⏸'}}</button>
              <button class="send-btn" @click="send" :disabled="!input.trim() && !files.length && !streaming">➤</button>
        </div>
        <div class="chat-actions">
          <button class="qa-btn" @click="showQuickActions = !showQuickActions" title="快捷操作">⚡</button>
          <label class="file-label">📎<input type="file" multiple hidden @change="onFileSelect" /></label>
          <button v-if="!recording" @click="startRecording" class="file-label" title="语音输入">🎤</button>
          <button v-else @click="stopRecording" class="file-label" style="color:#ef4444" title="停止录音">⏹️</button>
          <span v-if="files.length" class="file-count">{{ files.length }} 个文件</span>
          <span class="hint-text">{{ $t('chat.file_hint') }}</span>
        </div>
      </div>
    </div>

    <!-- Right Column Toggle -->
    <button class="right-toggle" @click="rightCollapsed = !rightCollapsed" :class="{ collapsed: rightCollapsed }" :title="rightCollapsed ? $t('chat.expand_panel','展开右侧面板') : $t('chat.collapse_panel','收起右侧面板')">
      {{ rightCollapsed ? '▶' : '◀' }}
    </button>

    <!-- Right Column (paste/drop stop to prevent main chat interception) -->
    <div class="chat-right-col" :class="{ collapsed: rightCollapsed }" @paste.stop @drop.stop.prevent>
      <!-- Goals Panel -->
      <div class="panel goals-panel">
        <div class="panel-header">🎯 {{ $t('chat.current_goals','当前目标') }} <button class="goal-add-btn" @click="showAddGoal = true">➕ {{ $t('chat.new_goal','新建') }}</button></div>
        <div class="panel-body" ref="goalsPanel">
          <!-- 新建目标输入框 -->
          <div v-if="showAddGoal" style="margin-bottom:8px;">
            <input v-model="newGoalTitle" placeholder="目标标题" style="width:100%;padding:4px 6px;font-size:12px;border:1px solid var(--bd);border-radius:4px;background:var(--bg2);color:var(--fg);margin-bottom:4px;">
            <input v-model="newGoalDesc" placeholder="描述（可选）" style="width:100%;padding:4px 6px;font-size:12px;border:1px solid var(--bd);border-radius:4px;background:var(--bg2);color:var(--fg);margin-bottom:4px;">
            <div style="display:flex;gap:4px;">
              <button style="flex:1;padding:3px 8px;font-size:12px;background:var(--ac);color:#fff;border:none;border-radius:4px;cursor:pointer;" @click="createGoal()">确定</button>
              <button style="flex:1;padding:3px 8px;font-size:12px;background:var(--bg2);color:var(--fg);border:1px solid var(--bd);border-radius:4px;cursor:pointer;" @click="showAddGoal=false">取消</button>
            </div>
          </div>
          <!-- 活跃目标列表 -->
          <div v-if="goals.active && goals.active.length" v-for="(g,i) in goals.active" :key="g.id" class="goal-card" @click="clickGoal(g)">
            <div class="goal-row">
              <span class="goal-status-icon">{{ g.status === 'paused' ? '⏸' : g.status === 'blocked' ? '🔴' : '🟢' }}</span>
              <span class="goal-title">{{ g.title }}</span>
              <span class="goal-actions">
                <button class="goal-act-btn" @click.stop="completeGoal(g.id)" title="完成">✅</button>
                <button v-if="g.status==='active'" class="goal-act-btn" @click.stop="togglePauseGoal(g.id)" title="暂停">⏸</button>
                <button v-if="g.status==='paused'" class="goal-act-btn" @click.stop="resumeGoal(g.id)" title="恢复">▶</button>
                <button class="goal-act-btn" @click.stop="deleteGoal(g.id)" title="删除">🗑</button>
              </span>
            </div>
            <div v-if="g.description" class="goal-desc">{{ g.description.substring(0, 80) }}{{ g.description.length > 80 ? '...' : '' }}</div>
            <div v-if="g.note" class="goal-note">📌 {{ g.note.substring(0, 60) }}</div>
            <div class="goal-time">{{ formatMsgTime(g.created_at || g.updated_at) }}</div>
          </div>
          <!-- 无活跃目标 -->
          <div v-if="!goals.active || !goals.active.length" style="font-size:12px;color:var(--fg3);padding:8px 0;text-align:center;">{{ $t('chat.no_active_goals','暂无可用的活跃目标') }}<br><span style="font-size:11px;">{{ $t('chat.goal_tip','在CEO对话中可以创建和管理目标') }}</span></div>
          <!-- 已完成目标（折叠） -->
          <details v-if="goals.completed && goals.completed.length" style="margin-top:8px;font-size:12px;">
            <summary style="cursor:pointer;padding:4px 0;font-weight:600;">✅ 已完成 ({{ goals.completed.length }})</summary>
            <div v-for="(g,i) in goals.completed.slice(0, 10)" :key="g.id" class="goal-card completed" @click="clickGoal(g)" style="opacity:0.6;">
              <div class="goal-row">
                <span class="goal-status-icon">✅</span>
                <span class="goal-title">{{ g.title }}</span>
              </div>
              <div class="goal-time">{{ formatMsgTime(g.completed_at || g.updated_at) }}</div>
            </div>
          </details>
        </div>
      </div>

      <!-- Subchat Panel -->
      <div class="panel subchat-panel">
        <div class="panel-header" style="cursor:pointer" @click="subchatCollapsed = !subchatCollapsed">
          💬 {{ $t('chat.sub_window', '副聊天窗口') }}
          <span style="margin-left:auto;font-size:10px;color:var(--fg3);">{{ subchatCollapsed ? '展开' : '收起' }}</span>
        </div>
        <template v-if="!subchatCollapsed">
          <div class="subchat-header">💬 {{ $t('chat.sub_window','副窗口') }} → {{ current ? (current.name_cn||'CEO') : $t('chat.not_selected','未选中') }} · {{ $t('chat.auto_follow','自动跟随') }}</div>
          <div class="subchat-msg-box" ref="subchatMsgBox">
            <div v-if="!subchatMessages.length" style="text-align:center;color:var(--fg3);padding:20px 0;font-size:12px;">{{ $t('chat.sub_window','副窗口') }} · {{ $t('chat.auto_follow_main','自动跟随主窗口员工') }}</div>
            <div v-for="(m,i) in subchatMessages" :key="i" :class="'subchat-msg msg-' + m.role">
              <!-- Tool call card in subchat (workflow timeline) -->
              <div v-if="m.type === 'tool_call'" class="tool-call-card subchat-tool" :class="{ collapsed: !m._expanded, 'status-done': m.status==='done', 'status-error': m.status==='error', 'status-running': m.status==='running' }">
                <!-- Timeline connector -->
                <div v-if="i>0 && subchatMessages[i-1] && subchatMessages[i-1].type==='tool_call'" class="timeline-connector"></div>
                <div class="tool-call-header" @click="m._expanded = !m._expanded">
                  <span class="tl-step-badge" :class="'step-' + (m.status || 'pending')">{{ m.status === 'running' ? '⚡' : m.status === 'done' ? '✅' : m.status === 'error' ? '❌' : '⏳' }}</span>
                  <span class="tool-name">{{ m.toolName }}</span>
                  <!-- 步骤计数器 -->
                  <span class="tl-step-counter">{{ getToolStep(i, subchatMessages) }}</span>
                  <span class="tool-status" :class="'status-' + (m.status || 'pending')">{{ m.status === 'running' ? '执行中…' : m.status === 'done' ? '完成' : m.status === 'error' ? '失败' : '等待' }}</span>
                  <span class="tool-toggle">{{ m._expanded ? '▾' : '▸' }}</span>
                </div>
                <div v-if="!m._expanded" class="tool-call-preview">
                  <span class="tool-preview-text">{{ m.summary ? m.summary.substring(0,60) : '(直接执行)' }}{{ m.summary && m.summary.length > 60 ? '…' : '' }}</span>
                </div>
                <div v-if="m._expanded" class="tool-call-body">
                  <div class="tool-call-section">
                    <span class="tl-section-label">📥 输入</span>
                    <div class="tool-call-args source-code">{{ m.summary || (m.args ? JSON.stringify(m.args, null, 2) : '无参数') }}</div>
                  </div>
                  <div v-if="m.result" class="tool-call-section">
                    <span class="tl-section-label">📤 结果</span>
                    <div class="tool-call-result" :class="{ 'result-error': m.status === 'error' }">{{ typeof m.result === 'string' ? m.result : JSON.stringify(m.result, null, 2) }}</div>
                  </div>
                </div>
              </div>
              <!-- Thinking block in subchat -->
              <div v-else-if="m.type === 'thinking'" class="thinking-block" style="font-size:11px">
                <span class="thinking-icon">🧠</span><span class="thinking-text">{{ m.content }}</span>
              </div>
              <!-- Regular message in subchat -->
              <div v-else-if="m.content" class="msg-bubble" :style="bubbleStyle(m.role)"><div class="msg-text" v-html="renderContent(m)"></div></div>
              <div v-if="m.files && m.files.length" class="msg-files">
                <div v-for="(f,fi) in m.files.filter(x=>x.isImg&&x.data)" :key="fi" class="msg-img-wrap">
                  <img :src="f.data" class="msg-img" style="max-width:120px;max-height:120px" @click="previewImg(f.data)" />
                </div>
              </div>
              <div v-if="m.time && m.type !== 'thinking' && m.type !== 'tool_call'" class="subchat-time">{{ formatMsgTime(m.time) }}</div>
            </div>
            <!-- Subchat streaming indicator -->
            <div v-if="subchatStreaming" class="subchat-msg msg-assistant">
              <div class="msg-body streaming-content" style="font-size:12px">{{ subchatStreamContent }}<span class="streaming-cursor">▊</span></div>
            </div>
            <div v-if="subchatLoading && !subchatStreaming" style="text-align:center;color:var(--fg3);padding:10px;font-size:11px;">思考中...</div>
          </div>
          <!-- Subchat file preview -->
          <div v-if="subchatFiles.length" class="file-preview-wrap subchat-preview">
            <div v-for="(f,fi) in subchatFiles" :key="fi" class="file-preview-item subchat-item">
              <span class="file-preview-name">📎 {{ f.name }}</span>
              <button class="file-remove-btn" @click="removeSubchatFile(fi)">×</button>
            </div>
          </div>
          <div class="subchat-input-area">
            <div class="long-text-indicator subchat" :class="{ show: subchatInput.length >= LONG_TEXT_THRESHOLD }">📄 文本较长，将自动转为文件</div>
            <div class="input-row">
              <textarea v-model="subchatInput" ref="subchatTextarea" @keydown.enter.exact.prevent="sendSubchat" @paste="onSubchatPaste" @drop="onSubchatDrop" @dragover.stop="" :placeholder="$t('chat.sub_placeholder') || '拖拽或粘贴文件...'" rows="1" class="chat-input" :disabled="subchatLoading"></textarea>
              <button class="send-btn" @click="sendSubchat" :disabled="!subchatInput.trim() && !subchatFiles.length">➤</button>
            </div>
            <div class="chat-actions">
              <label class="file-label">📎<input type="file" multiple hidden @change="onSubchatFileSelect" /></label>
              <button v-if="!subchatRecording" @click="startSubchatRecording" class="file-label" title="语音输入">🎤</button>
              <button v-else @click="stopSubchatRecording" class="file-label" style="color:#ef4444" title="停止录音">⏹️</button>
              <span v-if="subchatFiles.length" class="file-count">{{ subchatFiles.length }} 个文件</span>
              <span class="hint-text">{{ $t('chat.file_hint') }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>

  <!-- Create Avatar Modal -->
  <div v-if="showCreateAvatar" class="modal-overlay" @click.self="showCreateAvatar = false">
    <div class="modal-dialog create-avatar-dialog">
      <h3>{{ $t('chat.new_avatar') }}</h3>
      <p class="modal-desc">{{ $t('chat.new_avatar_desc') }}</p>
      <div class="form-group">
        <label>分身名称 *</label>
        <input v-model="avatarForm.name" placeholder="例如: 分析助手" class="modal-input" />
      </div>
      <div class="form-group">
        <label>身份 / 职责</label>
        <input v-model="avatarForm.title" placeholder="例如: 高级数据分析师" class="modal-input" />
      </div>
      <div class="form-group">
        <label>图标</label>
        <input v-model="avatarForm.icon" placeholder="🤖" maxlength="2" class="modal-input icon-input" />
      </div>
      <div class="modal-actions">
        <button class="modal-btn cancel" @click="showCreateAvatar = false">取消</button>
        <button class="modal-btn confirm" @click="createAvatar" :disabled="!avatarForm.name.trim()">创建</button>
      </div>
    </div>
  </div>

  <!-- Drag-Drop Overlay (已移至chat-main内) -->
  <!-- Paste Overlay -->
  <div v-if="showPasteOverlay" class="paste-overlay" @click="showPasteOverlay=false">
    <div class="paste-overlay-content">
      <p>{{ $t('chat.paste_notice') }}</p>
    </div>
  </div>
</template>

<script>
import { API } from '../main.js'

const LONG_TEXT_THRESHOLD = 500

export default {
  data() {
    return {
      current: null,
      messages: [],
      compressThreshold: 50,
      compressedCount: 0,
      _autoCleanTimer: null,
      input: '',
      loading: false,
      dragOver: false,
      showPasteOverlay: false,
      pasteFiles: [],
      files: [],
      recording: false,
      streaming: false,
      streamContent: '',
      modelName: 'deepseek-chat',
      modelList: [{ value: 'deepseek-chat', label: 'DeepSeek Chat' }, { value: 'deepseek-reasoner', label: 'DeepSeek R1 推理版' }],
      ws: null,
      subchatInput: '',
      subchatMessages: [],
      subchatFiles: [],
      subchatLoading: false,
      subchatCollapsed: false,
      subchatStreaming: false,
      subchatStreamContent: '',
      subchatRecording: false,
      rightCollapsed: false,
      showCreateAvatar: false,
      avatarForm: { name: '', title: '', icon: '🤖' },
      activities: [],
      mediaRecorder: null,
      audioChunks: [],
      _saveTimer: null,
      // WebSocket connection for real-time broadcasts
      wsConnected: false,
      wsNotifications: [],
      wsReconnectTimer: null,
      wsNotifUnread: 0,
      ctxMenu: { show: false, x: 0, y: 0, msg: null },
      ctxDisable: false,
      showSearch: false,
      searchQuery: '',
      searchResults: [],
      searchIdx: 0,
      showScrollBtn: false,
      showQuickActions: false,
      _typingTimer: null,
      taskPaused: false,
      goals: { active: [], completed: [] },
      showAddGoal: false,
      newGoalTitle: '',
      newGoalDesc: '',
      _goalsTimer: null
    }
  },

  // === 生命周期：恢复/保存聊天历史 ===
  created() {
    this.loadMessages('__ceo_main__')
    this.loadSubchatMessages('__ceo_main__')
  },
  mounted() {
    this.loadModelList()
    this.$nextTick(function() { this._initWebSocket(); }.bind(this))
    this.loadGoals()
    // 每30秒刷新目标状态
    this._goalsTimer = setInterval(function() { this.loadGoals(); }.bind(this), 30000)
    // 自动检查历史积压（每5分钟）
    this._autoCleanTimer = setInterval(function() { this._checkAndAutoClean(); }.bind(this), 300000)
    // 首次检查（延迟2秒避免页面渲染竞态）
    setTimeout(function() { this._checkAndAutoClean(); }.bind(this), 2000)
    
    // 滚动监听：显示"回到底部"按钮
    this._scrollHandler = function() {
      var box = this.$refs && this.$refs.msgBox;
      if (!box) return;
      var threshold = 200;
      var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < threshold;
      this.showScrollBtn = !atBottom;
    }.bind(this);
    this.$nextTick(function() {
      var box = this.$refs && this.$refs.msgBox;
      if (box) { box.addEventListener('scroll', this._scrollHandler); }
    }.bind(this));

    // 粘贴文件检测
    document.addEventListener('paste', function(e) {
      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        this.pasteFiles = Array.from(e.clipboardData.files)
        this.showPasteOverlay = true
        this.$nextTick(function() {
          if (this.$refs.pasteInput) this.$refs.pasteInput.click()
        }.bind(this))
      }
    }.bind(this))
  },
  beforeUnmount() {
    if (this._saveTimer) clearTimeout(this._saveTimer)
    this._saveNow()
    if (this._subchatSaveTimer) clearTimeout(this._subchatSaveTimer)
    this._saveSubchatNow()
    
    if (this._scrollHandler) {
      try {
        if (this.$refs && this.$refs.msgBox) this.$refs.msgBox.removeEventListener('scroll', this._scrollHandler);
      } catch(e) {}
    }
    if (this._goalsTimer) clearInterval(this._goalsTimer)
    if (this._autoCleanTimer) clearInterval(this._autoCleanTimer)
    this._destroyWebSocket()
  },
  watch: {
    messages: { handler: 'scrollToBottom', deep: true },
    subchatMessages: { handler: 'scrollSubchatToBottom', deep: true },
    input: 'onInputChange',
    subchatInput: 'onSubchatInputChange'
  },
  computed: {
    taskPlans() {
      return this.activities.filter(function(a) {
        var kw = (a.action || a.title || a.text || '').toLowerCase()
        return /plan|规划|schedule|task_plan|create_plan|方案|设计|总任务/.test(kw)
      })
    },
    progressItems() {
      return this.activities.filter(function(a) {
        var kw = (a.action || a.title || a.text || '').toLowerCase()
        return /step|进度|步骤|completed|phase|阶段|部署|更新|处理|完成|review|评审/.test(kw)
      })
    },
    reportItems() {
      return this.activities.filter(function(a) {
        var kw = (a.action || a.title || a.text || '').toLowerCase()
        return /report|output|产出|报告|总结|document|result|分析|审查|漏洞|用户行为/.test(kw)
      })
    },
    otherActivities() {
      var self = this
      return this.activities.filter(function(a) {
        var kw = (a.action || a.title || a.text || '').toLowerCase()
        return !/plan|规划|方案|step|进度|步骤|部署|更新|处理|完成|review|评审|report|产出|报告|总结|分析|审查/.test(kw)
      })
    }
  },
  methods: {
    __(e) { const _m={chatThinking:'思考中...',chatPlaceholder:'输入消息...'}; return _m[e]||e; },
    scrollToBottom() {
      this.$nextTick(function() {
        var box = this.$refs && this.$refs.msgBox
        if (box) box.scrollTop = box.scrollHeight
      }.bind(this))
    },
    scrollSubchatToBottom() {
      this.$nextTick(function() {
        var box = this.$refs && this.$refs.subchatMsgBox
        if (box) box.scrollTop = box.scrollHeight
      }.bind(this))
    },
    showContextMenu(e, m) {
      if (this.ctxDisable) return;
      this.ctxMenu = { show: true, x: e.clientX, y: e.clientY, msg: m };
    },
    ctxCopy() {
      var m = this.ctxMenu.msg;
      if (m && m.content) this.copyMsg(m.content);
      this.ctxMenu.show = false;
    },
    ctxQuote() {
      var m = this.ctxMenu.msg;
      if (m && m.content) {
        var text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        var excerpt = text.substring(0, 200);
        this.input = '> ' + excerpt.replace(/\n/g, '\n> ') + '\n\n';
        this.$nextTick(function() { if (this.$refs.chatInput) { this.$refs.chatInput.focus(); var len = this.input.length; this.$refs.chatInput.setSelectionRange(len, len); } }.bind(this));
      }
      this.ctxMenu.show = false;
    },
    ctxFillInput() {
      var m = this.ctxMenu.msg;
      if (m && m.content) {
        this.input = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
        this.$nextTick(function() { if (this.$refs.chatInput) { this.$refs.chatInput.focus(); var len = this.input.length; this.$refs.chatInput.setSelectionRange(len, len); } }.bind(this));
      }
      this.ctxMenu.show = false;
    },
    ctxResend() {
      var m = this.ctxMenu.msg;
      if (m && m.content && m.role === 'user') {
        this.input = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        this.$nextTick(this.send);
      }
      this.ctxMenu.show = false;
    },
    isSameGroup(idx) {
      if (idx <= 0) return false;
      var cur = this.messages[idx];
      var prev = this.messages[idx - 1];
      if (!cur || !prev) return false;
      if (cur.type === 'tool_call' || prev.type === 'tool_call') return false;
      if (cur.role !== prev.role) return false;
      var curTime = typeof cur.time === 'number' ? cur.time : new Date(cur.time).getTime();
      var prevTime = typeof prev.time === 'number' ? prev.time : new Date(prev.time).getTime();
      if (isNaN(curTime) || isNaN(prevTime)) return false;
      return (curTime - prevTime) < 120000;
    },


    toggleSearch() { this.showSearch = !this.showSearch; if (this.showSearch) this.$nextTick(function(){ if (this.$refs.searchInput) this.$refs.searchInput.focus(); }.bind(this)); },
    doSearch() {
      var q = this.searchQuery.trim().toLowerCase();
      if (!q) { this.searchResults = []; this.searchIdx = 0; return; }
      var results = [];
      this.messages.forEach(function(m, i) {
        var content = '';
        if (typeof m.content === 'string') content = m.content;
        else try { content = JSON.stringify(m.content); } catch(e) {}
        if (content.toLowerCase().indexOf(q) >= 0) results.push(i);
      });
      this.searchResults = results;
      this.searchIdx = 0;
      if (results.length > 0) this.jumpToSearch(0);
    },
    jumpToSearch(idx) {
      if (idx < 0 || idx >= this.searchResults.length) return;
      this.searchIdx = idx;
      var msgIdx = this.searchResults[idx];
      this.$nextTick(function() {
        var box = this.$refs && this.$refs.msgBox;
        if (!box) return;
        var target = box.querySelector('.msg:nth-child(' + (msgIdx + 2) + ')'); // +2 for spacer and scrollBtn
        if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.style.transition = 'background 1s'; target.style.background = 'rgba(99,102,241,0.12)'; setTimeout(function(){ target.style.background = ''; }, 2000); }
      }.bind(this));
    },
    searchNext() { if (this.searchResults.length) this.jumpToSearch((this.searchIdx + 1) % this.searchResults.length); },
    searchPrev() { if (this.searchResults.length) this.jumpToSearch((this.searchIdx - 1 + this.searchResults.length) % this.searchResults.length); },
    fillQuick(text) {
      this.input = text;
      this.showQuickActions = false;
      this.$nextTick(function() { if (this.$refs.chatInput) { this.$refs.chatInput.focus(); var len = this.input.length; this.$refs.chatInput.setSelectionRange(len, len); } }.bind(this));
    },
    copyMsg(content) {
      if (!content) return
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(typeof content === 'string' ? content : JSON.stringify(content, null, 2))
      } else {
        var ta = document.createElement('textarea')
        ta.value = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
    },
    renderContent(m) {
      if (!m || !m.content) return ''
      var text = m.content
      var escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')
      if (text.length > 8000) {
        return '<div style="white-space:pre-wrap;word-break:break-word;line-height:1.6">' + escaped + '</div>'
      }
      escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      escaped = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, function(m, lang, code) {
      var lines = code.split('\n').length;
      var lineNums = '';
      for (var li = 1; li <= lines; li++) lineNums += li + '\n';
      return '<div class="code-block-wrap"><div class="code-header"><span class="code-lang">' + (lang || 'text') + '</span><button class="code-copy-btn" onclick="(function(btn){var t=btn.parentNode.nextSibling;if(t&&t.tagName===\'PRE\'){var c=t.textContent;navigator.clipboard.writeText(c).then(function(){btn.textContent=\'\u2713 \u5df2\u590d\u5236\';setTimeout(function(){btn.textContent=\'\u590d\u5236\'},2000)})}})(this)">\u590d\u5236</button></div><div class="code-scroll"><pre><span class="code-lines">' + lineNums + '</span><code class="lang-' + lang + '">' + code + '</code></pre></div></div>'
    })
      escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>')
      return escaped
    },
    formatMsgTime(ts) {
      if (!ts) return ''
      // 兼容秒级时间戳（小于 1e12 的视为秒而非毫秒）
      if (typeof ts === 'number' && ts < 1e12) { ts = ts * 1000; }
      if (typeof ts === 'string' && ts.length === 10 && /^\d+$/.test(ts)) { ts = parseInt(ts) * 1000; }
      var d = new Date(ts)
      var now = new Date()
      var isToday = d.toDateString() === now.toDateString()
      var time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      if (isToday) return time
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + time
    },
    formatTime(ts) {
      if (!ts) return ''
      return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    showReportDetail(a) {
      // Show activity detail - expand in main chat or log
      if (a.details) {
        this.messages.push({ role: 'assistant', content: a.details, time: new Date().toISOString() })
        this.$nextTick(this.scrollToBottom)
      } else if (a.summary || a.text) {
        this.messages.push({ role: 'assistant', content: a.summary || a.text, time: new Date().toISOString() })
        this.$nextTick(this.scrollToBottom)
      }
    },
    selectAgent(a) {
      this.current = a
      this.loadMessages(a.id)
      this.$nextTick(this.scrollToBottom)
    },
    loadMessages(agentId) {
      try {
        var key = 'chat_' + (agentId || '__ceo_main__')
        var saved = localStorage.getItem(key)
        this.messages = saved ? JSON.parse(saved) : []
      } catch(e) { this.messages = [] }
    },
    _chatKey() {
      return this.current ? 'chat_' + this.current.id : 'chat___ceo_main__'
    },
    _saveNow() {
      var key = this._chatKey()
      // 先试 localStorage，若失败再压缩
      try {
        localStorage.setItem(key, JSON.stringify(this.messages))
      } catch(e) {
        // localStorage 满了，立即用后端压缩
        console.error('[Cleaner] localStorage full, triggering compress:', e)
        this._compressWithBackend()
      }
    },
    saveMessages() {
      var self = this
      if (this._saveTimer) clearTimeout(this._saveTimer)
      this._saveTimer = setTimeout(function() { self._saveNow() }, 300)
    },

    compressHistory() {
      this._compressWithBackend()
    },

    refreshHistory() {
      this.loadMessages(this.current ? this.current.id : '__ceo_main__')
      this.$nextTick(this.scrollToBottom)
    },

    // ===== 后端引擎自动清理 =====

    _checkAndAutoClean() {
      if (!this.messages || this.messages.length < 50) return
      var self = this
      // 阈值: >=200 立即压缩, >=100 高优先压缩, >=50 中优先压缩
      var count = this.messages.length
      if (count >= 200) {
        console.log('[Cleaner] 紧急自动压缩: ' + count + ' 条消息')
        self._compressWithBackend()
        return
      }
      // 异步检查后端（backup 判断）
      var estSize = count * 3000
      fetch('/api/chat/history/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageCount: count, estimatedSize: estSize })
      }).then(function(r) { return r.json() }).then(function(d) {
        if (!d || !d.ok) return
        var urg = d.status && d.status.urgency
        if (urg === 'critical' || urg === 'high' || (urg === 'medium' && count >= 80)) {
          console.log('[Cleaner] 后端建议压缩: urgency=' + urg + ', msgCount=' + count)
          self._compressWithBackend()
        }
      }).catch(function() { /* offline, use local threshold */ })
    },

    _compressWithBackend() {
      if (!this.messages || this.messages.length < 30) return
      var self = this
      var msgs = this.messages
      var totalBefore = msgs.length
      // 本地压缩：保留最后 50 条，生成本地摘要
      var keepCount = 50
      var summaryLines = []
      for (var ci = msgs.length - 1; ci >= 0 && summaryLines.length < 3; ci--) {
        var m = msgs[ci]
        if (m.role === 'user' && m.content) summaryLines.push('用户: ' + m.content.substring(0, 60))
        if (m.role === 'assistant' && m.content) summaryLines.push('回复: ' + m.content.substring(0, 80))
      }
      var summaryText = summaryLines.reverse().join(' | ') || '无'
      // 截断长消息（最后一条保留完整内容）
      var kept = msgs.slice(0 - keepCount).map(function(m, idx, arr) {
        // 最后一条消息（最新回复）不截断，保证当前对话可见完整内容
        if (idx === arr.length - 1) return m;
        if (m.content && typeof m.content === 'string' && m.content.length > 500) {
          return Object.assign({}, m, { content: m.content.substring(0, 200) + '...(截断至200字)' })
        }
        return m
      })
      self.messages = kept
      if (summaryText) {
        self.messages.unshift({
          role: 'system', type: 'summary',
          content: '📋 已自动压缩 ' + totalBefore + '→' + keepCount + ' 条: ' + summaryText,
          time: new Date().toISOString()
        })
      }
      self.saveMessages()
      self.compressedCount = (self.compressedCount || 0) + (totalBefore - keepCount)
      self.$nextTick(self.scrollToBottom)
      console.log('[Cleaner] 本地压缩: ' + totalBefore + '->' + keepCount + ', 摘要: ' + summaryText)
      // 同时异步通知后端记录（失败不影响前端）
      fetch('/api/chat/history/compress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs, keepCount: 50, source: 'chat_workspace' })
      }).then(function(r) { return r.json() }).then(function(d) {
        if (d && d.ok) console.log('[Cleaner] 后端同步压缩确认')
      }).catch(function() {})
    },

    // ===== WebSocket 实时广播连接 =====
    _initWebSocket() {
      if (this.ws && this.ws.readyState === 1) return
      if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null }
      // Port might differ if frontend is served separately; default to 8005
      var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      var host = window.location.hostname || '127.0.0.1'
      var port = window.location.port || (protocol === 'wss:' ? 443 : 8005)
      var url = protocol + '//' + host + ':' + port + '/ws'
      try {
        this.ws = new WebSocket(url)
        var self = this
        this.ws.onopen = function() {
          self.wsConnected = true
          console.log('[WS] Connected:', url)
          // Subscribe to broadcast channels
          self.ws.send(JSON.stringify({ type: 'subscribe', channels: ['channel','tasks','agents','system','tools','workpath'] }))
        }
        this.ws.onmessage = function(evt) {
          try {
            var msg = JSON.parse(evt.data)
            self._onWsMessage(msg)
          } catch(e) { /* ignore parse errors */ }
        }
        this.ws.onclose = function() {
          self.wsConnected = false
          console.log('[WS] Disconnected, reconnecting in 5s...')
          self.wsReconnectTimer = setTimeout(function() { self._initWebSocket() }, 5000)
        }
        this.ws.onerror = function() {
          self.wsConnected = false
        }
      } catch(e) {
        console.error('[WS] Connection failed:', e)
        this.wsReconnectTimer = setTimeout(function() { self._initWebSocket() }, 10000)
      }
    },
    // 将渠道消息格式化为对话条目，支持新旧两种 WS 事件格式
    _formatChannelMsg(msg) {
      var text = msg.content || msg.message || '';
      if (!text) return null;
      var src = msg.srcChannel || msg.source || '外部';
      // 新格式：统一走 channel 频道
      if (msg.channel === 'channel') {
        if (msg.type === 'channel_message') {
          return { role: 'system', content: '📡 [' + src + '] ' + (msg.from || '') + ': ' + text, time: msg.time || new Date().toISOString() };
        } else if (msg.type === 'ceo_reply') {
          return { role: 'system', content: '🤖 [' + src + '回复] ' + text, time: msg.time || new Date().toISOString() };
        }
      }
      // 旧格式兼容：直接识别消息/事件类型
      if (msg.type === 'wechat_message' || msg.type === 'channel_message') {
        return { role: 'system', content: '📡 [' + src + '] ' + (msg.from || '') + ': ' + text, time: msg.time || new Date().toISOString() };
      }
      if (msg.type === 'ceo_message' || msg.type === 'ceo_reply') {
        return { role: 'system', content: '🤖 [' + src + '回复] ' + text, time: msg.time || new Date().toISOString() };
      }
      return null;
    },
    _destroyWebSocket() {
      if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null }
      if (this.ws) {
        this.ws.onclose = null
        this.ws.onerror = null
        this.ws.onmessage = null
        this.ws.close()
        this.ws = null
      }
      this.wsConnected = false
    },
    _onWsMessage(msg) {
      // ===== 工具调用实时推送（通过WS 'tools' 频道） =====
      if (msg.channel === 'tools' && msg.type === 'tool_call_started') {
        // 在有 SSE 流时已经包含了 tool_call 卡片，WS 只做通知提醒 + 通知栏
        var nm = { role: 'assistant', type: 'tool_call', toolName: msg.toolName, args: msg.args || {}, summary: msg.summary || '', status: 'running', _expanded: true, time: msg.time || new Date().toISOString(), _wsPushed: true }
        this.messages.push(nm);
        try { this.saveMessages(); } catch(e) {}
        try { this.$forceUpdate(); } catch(e) {}
        this.$nextTick(this.scrollToBottom);
        // 通知栏
        var nEntry = { channel: 'tools', message: '🔧 工具调用: ' + (msg.toolName || ''), from: 'CEO', time: msg.time || new Date().toISOString(), source_icon: '🔧' }
        this.wsNotifications.push(nEntry);
        if (this.wsNotifications.length > 100) this.wsNotifications.splice(0, this.wsNotifications.length - 100);
        this.wsNotifUnread++;
        return;
      }
      if (msg.channel === 'tools' && msg.type === 'tool_call_completed') {
        // 更新最后一条对应工具调用的状态
        for (var _ti = this.messages.length - 1; _ti >= 0; _ti--) {
          if (this.messages[_ti].type === 'tool_call' && this.messages[_ti].toolName === msg.toolName && this.messages[_ti].status === 'running') {
            this.messages[_ti].status = msg.status === 'done' ? 'done' : 'error';
            if (msg.result) this.messages[_ti].result = msg.result;
            break;
          }
        }
        try { this.saveMessages(); } catch(e) {}
        try { this.$forceUpdate(); } catch(e) {}
        return;
      }
      // ===== 工作路径实时推送（通过WS 'workpath' 频道） =====
      if (msg.channel === 'workpath' && msg.type === 'workpath_update') {
        var wpEntry = { channel: 'workpath', message: '📂 ' + (msg.path || '') + (msg.detail ? ': ' + msg.detail : ''), from: '工作路径', time: msg.time || new Date().toISOString(), source_icon: '📂' }
        this.wsNotifications.push(wpEntry);
        if (this.wsNotifications.length > 100) this.wsNotifications.splice(0, this.wsNotifications.length - 100);
        this.wsNotifUnread++;
        return;
      }
      // ===== 原有通知处理 =====
      // Add to notification list (max 100)
      var entry = { channel: msg.channel, message: msg.message || msg.content || '', from: msg.from || '系统', time: msg.time || new Date().toISOString(), source_icon: msg.channel === 'tasks' ? '📋' : msg.channel === 'agents' ? '🤖' : msg.channel === 'system' ? '🔧' : msg.channel === 'ceo' ? '👑' : msg.channel === 'tools' ? '🔧' : msg.channel === 'workpath' ? '📂' : '📡' }
      this.wsNotifications.push(entry)
      if (this.wsNotifications.length > 100) this.wsNotifications.splice(0, this.wsNotifications.length - 100)
      this.wsNotifUnread++
      
      // 渠道消息 → 工作台（兼容新旧格式）
      var entry = this._formatChannelMsg(msg);
      if (entry) {
        this.messages.push(entry);
        try { this.$forceUpdate(); } catch(e) {}
      }
    },

    _doCompress() {
      var keepCount = 30
      var count = 0
      for (var i = 0; i < this.messages.length - keepCount; i++) {
        var m = this.messages[i]
        if (!m._compressed && m.content && typeof m.content === 'string' && m.content.length > 200) {
          m._originalContent = m.content
          m.content = m.content.substring(0, 150) + '... [📦 已压缩]'
          m._compressed = true
          m._expanded = false
          count++
        }
      }
      this.compressedCount = count
    },

    // ---- 聚焦输入框辅助方法 ----
    _removedFocus() {
      // 原生 DOM 方式：遍历所有可见的 textarea，找到主聊天框
      var self = this;
      setTimeout(function() {
        try {
          var tas = document.querySelectorAll('textarea');
          for (var i = 0; i < tas.length; i++) {
            var ta = tas[i];
            // 跳过 disabled/隐藏的 textarea
            if (ta.disabled) continue;
            if (ta.offsetParent === null) continue;
            if (ta.closest('.subchat-input-area')) continue;
            // 找到主聊天的 textarea
            ta.focus();
            return;
          }
        } catch(e) { console.error('[focus]', e); }
        // fallback: $refs
        try {
          if (self.$refs && self.$refs.chatInput) {
            self.$refs.chatInput.focus();
          }
        } catch(e) {}
      }.bind(this), 50);
      // 第二次尝试（100ms后，等 Vue 完成重绘）
      setTimeout(function() {
        try {
          var tas = document.querySelectorAll('textarea');
          for (var i = 0; i < tas.length; i++) {
            var ta = tas[i];
            if (ta.disabled) continue;
            if (ta.offsetParent === null) continue;
            if (ta.closest('.subchat-input-area')) continue;
            ta.focus();
            return;
          }
        } catch(e) {}
      }, 100);
    },
    _focusSubchatInput() {
      this.$nextTick(function() {
        try {
          if (this.$refs && this.$refs.subchatTextarea) {
            this.$refs.subchatTextarea.focus()
          }
        } catch(e) {}
      }.bind(this))
    },

    insertNewline() {
      this.input += '\n';
      this.$nextTick(function(){
        if (this.$refs.chatInput) {
          var t = this.$refs.chatInput;
          t.style.height = 'auto';
          t.style.height = t.scrollHeight + 'px';
        }
      }.bind(this));
    },

    // ---- Main chat send (SSE streaming for CEO) ----
    async send() {
      if (!this.input.trim() && !this.files.length) return

      // Wait for loading files
      var loadingFiles = this.files.filter(function(f) { return f._loading })
      if (loadingFiles.length > 0) {
        var waitCount = 0
        while (loadingFiles.some(function(f) { return f._loading }) && waitCount < 50) {
          await new Promise(function(r) { setTimeout(r, 100) })
          waitCount++
        }
      }

      let text = this.input.trim()
      let imageData = null
      let textFiles = []

            // (长文本转附件在输入时自动处理，发送时不再截断)


      if (this.files.length) {
        this.files.forEach(f => {
          if (f.isImg && f.data) {
            if (!imageData) imageData = f.data.split(',')[1] || f.data
          } else if (f.data && !f.isImg) {
            let content = f.data
            if (f.data.startsWith('data:')) {
              content = f.data.split(',')[1] || f.data
              try { content = atob(content) } catch(e) {}
            }
            textFiles.push({ name: f.name, type: f.type, content: content.substring(0, 50000) })
          }
        })
      }

      var sendFiles = this.files.length ? this.files.map(function(f) { return { name: f.name, isImg: f.isImg, size: f.size, data: f.data } }) : null
      this.messages.push({ role: 'user', content: text, files: sendFiles, time: new Date().toISOString() })
      this.saveMessages()
      this.input = ''
      this.files = []
      this.$nextTick(this.scrollToBottom)

      // Non-CEO agents use simple API
      if (this.current && this.current.id !== 'ai_ceo') {
        this.loading = true
        try {
          const resp = await API.post('/api/chat', { agentId: this.current ? this.current.id : 'ai_ceo', message: text, image: imageData, files: textFiles })
          // Parse tool calls from response and render as timeline cards
          if (resp.toolCalls && resp.toolCalls.length) {
            var self = this;
            resp.toolCalls.forEach(function(tc) {
              self.messages.push({
                role: 'assistant',
                type: 'tool_call',
                toolName: tc.name,
                args: tc.args || {},
                result: tc.result,
                status: tc.result && !tc.result.success ? 'error' : 'done',
                _expanded: false,
                summary: tc.name + '(' + (tc.args.filepath || tc.args.dirpath || tc.args.query || tc.args.skillName || '...') + ')',
                time: new Date().toISOString()
              });
            });
          }
          if (resp.reply) { this.messages.push({ role: 'assistant', content: resp.reply, time: new Date().toISOString() }); this.saveMessages() }
          else if (resp.error) { this.messages.push({ role: 'assistant', content: '错误: ' + resp.error, isError: true, time: new Date().toISOString() }); this.saveMessages() }
        } catch(e) {
          this.messages.push({ role: 'assistant', content: '网络错误: ' + e.message, isError: true, time: new Date().toISOString() })
          this.saveMessages()
        } finally {
          this.loading = false
          this.$nextTick(this.scrollToBottom)
          this._removedFocus()
          this
        }
        this._checkAndAutoClean()
        return
      }

      // CEO: SSE streaming
      this.loading = true
      this.streaming = true
      this.streamContent = ''
      var self = this
      // 移除预设的思考动画，等待后端推送 thinking 事件

      try {
        const resp = await fetch('/api/chat/sse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: 'ai_ceo', message: text, image: imageData, files: textFiles, model: this.modelName })
        })

        if (!resp.ok) {
          var errText = await resp.text()
          self.messages.push({ role: 'assistant', content: '错误: ' + (errText || resp.statusText), isError: true, time: new Date().toISOString() })
          self.saveMessages()
          self.streaming = false
          self.loading = false
          self.removeLastThinking()
          self.$nextTick(self.scrollToBottom)
          self._removedFocus()
          self
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
            else if (data.type === 'tool_call') { 
              // 添加 200ms 延迟，模拟逐步展示效果
              await new Promise(function(r) { setTimeout(r, 200) });
              self.removeLastThinking(); 
              self.addToolCall(data.name, data.args, data.summary) 
            }
            else if (data.type === 'tool_result') { 
              // 添加 100ms 延迟
              await new Promise(function(r) { setTimeout(r, 100) });
              self.updateLastToolCall(data.status, data.result) 
            }
            else if (data.type === 'auth_request') {
              self.removeLastThinking();
              self.addAuthRequest(data.id, data.path, data.toolName, data.args, data.message);
            }
            else if (data.type === 'file_read') { self.removeLastThinking(); self.addFileOp('read', data.path) }
            else if (data.type === 'file_write') { self.removeLastThinking(); self.addFileOp('write', data.path) }
            else if (data.type === 'message') {
              finalReply += data.content || '';
              var target = finalReply;
              // 平滑打字效果：速度限制（每 30ms 最多更新一次）
              if (!self._lastStreamUpdate) self._lastStreamUpdate = 0;
              var now = Date.now();
              if (now - self._lastStreamUpdate > 40) {
                self.streamContent = target;
                self._lastStreamUpdate = now;
              } else {
                // 延迟更新，避免闪烁但保持流畅
                clearTimeout(self._streamDebounce);
                self._streamDebounce = setTimeout(function() { self.streamContent = target; }, 30);
              }
            }
            else if (data.type === 'done') { 
              finalReply = data.reply || finalReply; 
              self.streamContent = finalReply;
            }
            self.$nextTick(self.scrollToBottom)
          }
        }

        if (finalReply) {
          self.messages.push({ role: 'assistant', content: finalReply, time: new Date().toISOString() })
          self.saveMessages()
        }
        // Smooth transition: keep streaming visible until msg rendered, then hide all
        self.$nextTick(function() {
          self.streaming = false
          self.loading = false
          self.removeLastThinking()
        })
        self.$nextTick(self.scrollToBottom)
        self._removedFocus()
        self
      } catch(e) {
        console.error('SSE error:', e)
        self.messages.push({ role: 'assistant', content: '网络错误: ' + e.message, isError: true, time: new Date().toISOString() })
        self.saveMessages()
        self.streaming = false
        self.loading = false
        self.removeLastThinking()
        self.$nextTick(self.scrollToBottom)
        self._removedFocus()
        self
      }
      this._checkAndAutoClean()
    },

    /** 计算工具调用的步骤序号（从连续的 tool_call 序列中定位） */
    getToolStep(index, list) {
      // 确定当前 index 所在的连续 tool_call 序列边界
      var seqStart = index, seqEnd = index;
      for (var k = index - 1; k >= 0; k--) {
        if (list[k] && list[k].type === 'tool_call') seqStart = k;
        else break;
      }
      for (var k = index + 1; k < list.length; k++) {
        if (list[k] && list[k].type === 'tool_call') seqEnd = k;
        else break;
      }
      var totalNum = seqEnd - seqStart + 1;
      if (totalNum <= 1) return '';
      var stepNum = index - seqStart + 1;
      return stepNum + '/' + totalNum;
    },
    addToolCall(name, args, summary) {
      this.messages.push({ role: 'assistant', type: 'tool_call', toolName: name, args: args || {}, summary: summary || '', status: 'running', _expanded: true, time: new Date().toISOString() })
      this.saveMessages()
    },
    addAuthRequest(authId, path, toolName, args, message) {
      this.messages.push({ role: 'assistant', type: 'auth_request', authId: authId, path: path, toolName: toolName, args: args || {}, message: message || '', status: 'pending', _expanded: true, time: new Date().toISOString() });
      this.saveMessages();
    },
    sendAuthDecision(authId, decision) {
      var _self = this;
      fetch('/api/chat/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authId: authId, decision: decision })
      }).then(function(r) { return r.json(); }).then(function(resp) {
        if (!resp.ok) {
          console.error('授权请求失败:', resp.error);
          return;
        }
        // 更新本地状态
        for (var i = _self.messages.length - 1; i >= 0; i--) {
          if (_self.messages[i].type === 'auth_request' && _self.messages[i].authId === authId) {
            _self.messages[i].status = decision === 'deny' ? 'denied' : 'authorized';
            _self.messages[i].decision = decision;
            break;
          }
        }
      }).catch(function(e) { console.error('授权请求网络错误:', e); });
    },    updateLastToolCall(status, result) {
      for (var i = this.messages.length - 1; i >= 0; i--) {
        if (this.messages[i].type === 'tool_call') { this.messages[i].status = status || 'done'; if (result) this.messages[i].result = result; break }
      }
    },
    addThinkingMsg(text) {
      this.messages.push({ role: 'assistant', type: 'thinking', content: text || '思考中...', time: new Date().toISOString() })
    },
    removeLastThinking() {
      for (var i = this.messages.length - 1; i >= 0; i--) {
        if (this.messages[i].type === 'thinking') { this.messages.splice(i, 1); break }
      }
    },
    addFileOp(op, path) {
      this.messages.push({ role: 'assistant', type: 'file_op', op: op, path: path, status: 'running', time: new Date().toISOString() })
      setTimeout(() => {
        for (var i = this.messages.length - 1; i >= 0; i--) {
          if (this.messages[i].type === 'file_op' && this.messages[i].op === op && this.messages[i].path === path) { this.messages[i].status = 'done'; break }
        }
      }, 500)
    },
    typewriterEffect(text) {
      var words = text.split('')
      var chunkSize = 3
      var idx = 0
      var msg = { role: 'assistant', content: '', time: new Date().toISOString() }
      this.messages.push(msg)
      msg = this.messages[this.messages.length - 1] /* get reactive proxy */
      this.saveMessages()
      var self = this
      function typeNext() {
        if (idx >= words.length) { msg.content = text; self.saveMessages(); self.$nextTick(self.scrollToBottom); self; return }
        var chunk = words.slice(idx, idx + chunkSize).join('')
        idx += chunkSize
        msg.content = (msg.content || '') + chunk
        self.$nextTick(self.scrollToBottom)
        var delay = chunk.match(/[，。！？；：\n]/) ? 50 : 15
        setTimeout(typeNext, delay)
      }
      typeNext()
    },

    // ---- Subchat (SSE streaming, same as main chat) ----
    async sendSubchat() {
      if (!this.subchatInput.trim() && !this.subchatFiles.length) return
      /* subchat defaults to CEO AI when no employee selected */

      var text = this.subchatInput.trim()
      var textFiles = []
      var imageData = null

            // (长文本转附件在输入时自动处理，发送时不再截断)


      if (this.subchatFiles.length) {
        this.subchatFiles.forEach(f => {
          if (f.isImg && f.data) {
            if (!imageData) imageData = f.data.split(',')[1] || f.data
          } else if (f.data && !f.isImg) {
            let content = f.data
            if (f.data.startsWith('data:')) { content = f.data.split(',')[1] || f.data; try { content = atob(content) } catch(e) {} }
            textFiles.push({ name: f.name, type: f.type, content: content.substring(0, 50000) })
          }
        })
      }

      this.subchatMessages.push({ role: 'user', content: text || '', files: this.subchatFiles.length ? this.subchatFiles.map(function(f) { return { name: f.name, isImg: f.isImg } }) : null, time: new Date().toISOString() })
      this.subchatInput = ''
      this.subchatFiles = []
      this.subchatLoading = true
      this.saveSubchatMessages()
      this.$nextTick(this.scrollSubchatToBottom)

      var self = this
      var agentId = this.current ? this.current.id : 'ai_ceo'

      // Non-CEO agents use simple API
      if (agentId !== 'ai_ceo') {
        try {
          const resp = await API.post('/api/chat', { agentId: agentId, message: text, image: imageData, files: textFiles })
          self.subchatMessages.push({ role: 'assistant', content: resp.reply || resp.response || resp.text || '(无响应)', time: new Date().toISOString() })
          self.saveSubchatMessages()
        } catch(e) {
          self.subchatMessages.push({ role: 'assistant', content: '错误: ' + e.message, isError: true, time: new Date().toISOString() })
          self.saveSubchatMessages()
        } finally {
          self.subchatLoading = false
          self.$nextTick(self.scrollSubchatToBottom)
          self.$nextTick(function() { try { self.$refs.subchatTextarea?.focus() } catch(e) {} })
        }
        return
      }

      // CEO: SSE streaming
      this.subchatLoading = true
      this.subchatStreaming = true
      this.subchatStreamContent = ''
      // 移除预设的思考动画，等待后端推送 thinking 事件

      try {
        const resp = await fetch('/api/chat/sse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: 'ai_ceo', message: text, image: imageData, files: textFiles, model: this.modelName })
        })

        if (!resp.ok) {
          var errText = await resp.text()
          self.subchatMessages.push({ role: 'assistant', content: '错误: ' + (errText || resp.statusText), isError: true, time: new Date().toISOString() })
          self.saveSubchatMessages()
          self.subchatStreaming = false
          self.subchatLoading = false
          self.removeSubchatLastThinking()
          self.$nextTick(self.scrollSubchatToBottom)
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
            if (data.type === 'thinking') self.addSubchatThinking(data.content)
            else if (data.type === 'tool_call') { 
              // 添加 200ms 延迟，模拟逐步展示效果
              await new Promise(function(r) { setTimeout(r, 200) });
              self.removeSubchatLastThinking(); 
              self.addSubchatToolCall(data.name, data.args, data.summary) 
            }
            else if (data.type === 'tool_result') { 
              // 添加 100ms 延迟
              await new Promise(function(r) { setTimeout(r, 100) });
              self.updateSubchatLastToolCall(data.status, data.result) 
            }
            else if (data.type === 'file_read') { self.removeSubchatLastThinking(); self.addSubchatFileOp('read', data.path) }
            else if (data.type === 'file_write') { self.removeSubchatLastThinking(); self.addSubchatFileOp('write', data.path) }
            else if (data.type === 'message') {
              finalReply += data.content || '';
              if (!self._subchatLastStreamUpdate) self._subchatLastStreamUpdate = 0;
              var now = Date.now();
              if (now - self._subchatLastStreamUpdate > 40) {
                self.subchatStreamContent = finalReply;
                self._subchatLastStreamUpdate = now;
              } else {
                clearTimeout(self._subchatStreamDebounce);
                self._subchatStreamDebounce = setTimeout(function() { self.subchatStreamContent = finalReply; }, 30);
              }
            }
            else if (data.type === 'done') { 
                finalReply = data.reply || finalReply; if (typeof finalReply === 'string') { finalReply = finalReply.replace(/\\n/g, '\n'); }
              self.subchatStreamContent = finalReply;
            }
            self.$nextTick(self.scrollSubchatToBottom)
          }
        }

        if (finalReply) {
          var msg = { role: 'assistant', content: finalReply, time: new Date().toISOString() }
          self.subchatMessages.push(msg)
          self.saveSubchatMessages()
        }
        // Smooth transition: keep streaming visible until msg rendered, then hide all
        self.$nextTick(function() {
          self.subchatStreaming = false
          self.subchatLoading = false
          self.removeSubchatLastThinking()
        })
        self.$nextTick(self.scrollSubchatToBottom)
        self.$nextTick(function() { try { self.$refs.subchatTextarea?.focus() } catch(e) {} })
      self._focusSubchatInput()
      } catch(e) {
        console.error('Subchat SSE error:', e)
        self.subchatMessages.push({ role: 'assistant', content: '网络错误: ' + e.message, isError: true, time: new Date().toISOString() })
        self.saveSubchatMessages()
        self.subchatStreaming = false
        self.subchatLoading = false
        self.removeSubchatLastThinking()
        self.$nextTick(self.scrollSubchatToBottom)
        self.$nextTick(function() { try { self.$refs.subchatTextarea?.focus() } catch(e) {} })
      }
    },
    async createAvatar() {
      var form = this.avatarForm
      if (!form.name.trim()) return
      try {
        var resp = await API.post('/api/employees', { name_cn: form.name.trim(), title: form.title.trim(), icon: form.icon || '🤖' })
        if (resp.ok && resp.agent) {
          this.messages.push({ role: 'system', content: '✅ 分身创建成功: ' + form.icon + ' ' + form.name.trim() + (form.title ? ' (' + form.title + ')' : ''), time: new Date().toISOString() })
          var self = this
          this.input = '请认识新同事 ' + (form.icon || '🤖') + ' ' + form.name.trim() + (form.title ? ' (' + form.title + ')' : '') + '，请分配任务和指导。'
          this
        } else {
          this.messages.push({ role: 'system', content: '❌ 创建失败: ' + (resp.error || '未知错误'), isError: true, time: new Date().toISOString() })
        }
      } catch(e) {
        this.messages.push({ role: 'system', content: '❌ 网络错误: ' + e.message, isError: true, time: new Date().toISOString() })
      }
      this.showCreateAvatar = false
      this.avatarForm = { name: '', title: '', icon: '🤖' }
      this.$nextTick(this.scrollToBottom)
    },
    updateSubchatLastToolCall(status, result) {
      for (var i = this.subchatMessages.length - 1; i >= 0; i--)
        if (this.subchatMessages[i].type === 'tool_call') {
          this.subchatMessages[i].status = status || 'done';
          if (result) this.subchatMessages[i].result = result;
          break;
        }
    },

    addSubchatThinking(text) {
      this.subchatMessages.push({ role: 'assistant', type: 'thinking', content: text || '思考中...', time: new Date().toISOString() })
    },

    removeSubchatLastThinking() {
      for (var i = this.subchatMessages.length - 1; i >= 0; i--)
        if (this.subchatMessages[i].type === 'thinking') {
          this.subchatMessages.splice(i, 1);
          break;
        }
    },

    addSubchatFileOp(op, path) {
      this.subchatMessages.push({ role: 'assistant', type: 'file_op', op: op, path: path, status: 'running', time: new Date().toISOString() })
      setTimeout((function() {
        for (var i = this.subchatMessages.length - 1; i >= 0; i--)
          if (this.subchatMessages[i].type === 'file_op') {
            this.subchatMessages[i].status = 'done';
            break;
          }
      }).bind(this), 2000)
    },

    addSubchatToolCall(name, args, summary) {
      this.subchatMessages.push({ role: 'assistant', type: 'tool_call', toolName: name, args: args || {}, summary: summary || '', status: 'running', _expanded: true, time: new Date().toISOString() })
      this.saveSubchatMessages()
    },

    showReportDetail(item) {
      if (item.details) {
        this.messages.push({ role: 'assistant', content: item.details, time: new Date().toISOString() })
        this.$nextTick(this.scrollToBottom)
      } else if (item.summary || item.text) {
        this.messages.push({ role: 'assistant', content: item.summary || item.text, time: new Date().toISOString() })
        this.$nextTick(this.scrollToBottom)
      }
    },

    onFileSelect(e) {
      var files = e.target.files
      if (files && files.length > 0) this.processFiles(files)
      e.target.value = ''
    },

    startRecording() {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SR) { alert('浏览器不支持语音识别，请使用 Chrome/Edge'); return }
      this.recording = true
      var rec = new SR()
      rec.lang = 'zh-CN'
      rec.continuous = false
      rec.interimResults = false
      var self = this
      rec.onresult = function(e) {
        var transcript = e.results[0][0].transcript
        self.input = (self.input || '') + transcript
        self.recording = false
        self
      }
      rec.onerror = function(e) { console.error('Speech error:', e.error); self.recording = false }
      rec.onend = function() { self.recording = false }
      try { rec.start() } catch(e) { self.recording = false }
    },

    stopRecording() { this.recording = false },

    onFileDrop(e) {
      this.dragOver = false
      var files = e.dataTransfer.files
      if (files && files.length > 0) this.processFiles(files)
    },

    onPaste(e) {
      var items = e.clipboardData.items
      if (items) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i]
          if (item.type.startsWith('image/') || item.kind === 'file') {
            var file = item.getAsFile()
            if (file) this.processFiles([file])
          }
        }
      }
    },

    processFiles(files) {
      Array.from(files).forEach(function(file) {
        if (file.size > 10 * 1024 * 1024) {
          alert('文件过大，最大支持 10MB: ' + file.name)
          return
        }
        var isImg = file.type.startsWith('image/')
        file._oid = Math.random()
        var blobUrl = URL.createObjectURL(file)
        this.files.push({ name: file.name, size: file.size, type: file.type, isImg: isImg, data: blobUrl, file: file, _oid: file._oid, _loading: true })
        var reader = new FileReader()
        reader.onload = function(e) {
          var idx = this.files.findIndex(function(f) { return f._oid === file._oid })
          if (~idx) { this.files[idx].data = e.target.result; this.files[idx]._loading = false }
        }.bind(this)
        if (isImg) reader.readAsDataURL(file)
        else if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|js|ts|vue|html|css|py|java|go|rs|sh|bat|ps1|yaml|yml|xml|sql|log|csv)$/i)) reader.readAsText(file)
        else reader.readAsDataURL(file)
      }, this)
    },

    removeFile(index) {
      this.files.splice(index, 1)
    },

    previewImg(data) {
      if (data && data.startsWith('data:')) {
        var w = window.open('')
        if (w) { w.document.write('<img src="' + data + '" style="max-width:100%;max-height:100vh" />'); return }
      }
      window.open(data, '_blank')
    },

    onSubchatPaste(e) {
      var items = e.clipboardData.items
      if (items) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i]
          if (item.type.startsWith('image/') || item.kind === 'file') {
            var file = item.getAsFile()
            if (file) this.addSubchatFiles([file])
          }
        }
      }
    },

    onSubchatDrop(e) {
      e.preventDefault()
      e.stopPropagation()
      this.dragOver = false
      var files = e.dataTransfer.files
      if (files && files.length > 0) this.addSubchatFiles(files)
    },

    onSubchatFileSelect(e) {
      var files = e.target.files
      if (files && files.length > 0) this.addSubchatFiles(files)
      e.target.value = ''
    },

    addSubchatFiles(files) {
      Array.from(files).forEach(function(file) {
        if (file.size > 10 * 1024 * 1024) {
          alert('文件过大，最大支持 10MB: ' + file.name)
          return
        }
        var isImg = file.type.startsWith('image/')
        var blobUrl = URL.createObjectURL(file)
        this.subchatFiles.push({ name: file.name, size: file.size, type: file.type, isImg: isImg, data: blobUrl, file: file })
        var reader = new FileReader()
        reader.onload = function(e) {
          var idx = this.subchatFiles.findIndex(function(f) { return f.file === file })
          if (~idx) this.subchatFiles[idx].data = e.target.result
        }.bind(this)
        if (isImg) reader.readAsDataURL(file)
        else if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|js|ts|vue|html|css|py|java|go|rs|sh|bat|ps1|yaml|yml|xml|sql|log|csv)$/i)) reader.readAsText(file)
        else reader.readAsDataURL(file)
      }, this)
    },

    removeSubchatFile(index) {
      this.subchatFiles.splice(index, 1)
    },

    startSubchatRecording() {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SR) { alert('浏览器不支持语音识别，请使用 Chrome/Edge'); return }
      this.subchatRecording = true
      var rec = new SR()
      rec.lang = 'zh-CN'
      rec.continuous = false
      rec.interimResults = false
      var self = this
      rec.onresult = function(e) {
        var transcript = e.results[0][0].transcript
        self.subchatInput = (self.subchatInput || '') + transcript
        self.subchatRecording = false
        self._focusSubchatInput()
      }
      rec.onerror = function(e) { console.error('Subchat speech error:', e.error); self.subchatRecording = false }
      rec.onend = function() { self.subchatRecording = false }
      try { rec.start() } catch(e) { self.subchatRecording = false }
    },

    stopSubchatRecording() { this.subchatRecording = false },

    scrollSubchatToBottom() {
      this.$nextTick(function() {
        var el = this.$refs && this.$refs.subchatMsgBox;
        if (el) el.scrollTop = el.scrollHeight;
      }.bind(this))
    },

    // === 副窗口消息持久化 ===
    _subchatKey() {
      return this.current ? 'subchat_' + this.current.id : 'subchat___ceo_main__'
    },
    _saveSubchatNow() {
      try { localStorage.setItem(this._subchatKey(), JSON.stringify(this.subchatMessages)) } catch(e) {}
    },
    saveSubchatMessages() {
      var self = this
      if (this._subchatSaveTimer) clearTimeout(this._subchatSaveTimer)
      this._subchatSaveTimer = setTimeout(function() { self._saveSubchatNow() }, 300)
    },
    loadSubchatMessages(agentId) {
      try {
        var key = 'subchat_' + (agentId || '__ceo_main__')
        var saved = localStorage.getItem(key)
        this.subchatMessages = saved ? JSON.parse(saved) : []
      } catch(e) { this.subchatMessages = [] }
    },
    // 输入时自动检测长文本并转为附件（不拦截发送）
    onInputChange(val, oldVal) {
      this._autoConvertLongText(val, 'files', 'input')
    },
    onSubchatInputChange(val, oldVal) {
      this._autoConvertLongText(val, 'subchatFiles', 'subchatInput')
    },
    _autoConvertLongText(text, filesKey, inputKey) {
      if (!text || text.length < 500 || this[filesKey].length > 0) return
      var blob = new Blob([text], {type: 'text/plain;charset=utf-8'})
      var summary = text.replace(/[\\/:*?"<>|]/g, '_').trim()
      if (summary.length > 40) summary = summary.substring(0, 40)
      var file = new File([blob], '消息_' + summary + '.txt', {type: 'text/plain;charset=utf-8'})
      var me = this
      var reader = new FileReader()
      reader.onload = function(e) {
        me[filesKey].push({ name: file.name, size: file.size, type: 'text/plain', isImg: false, data: e.target.result, file: file })
      }
      reader.readAsDataURL(file)
      me[inputKey] = ''
    },
    bubbleStyle(role) {
      if (role === 'user') {
        return {
          color: '#e0e7ff',
          background: 'linear-gradient(135deg, #4f46e5, #3730a3)',
          borderBottomRightRadius: '4px',
          textAlign: 'left'
        }
      } else {
        return {
          color: '#1f2937',
          background: '#f3f4f6',
          border: '1px solid #e5e7eb',
          borderBottomLeftRadius: '4px',
          textAlign: 'left'
        }
      }
    },
    _loadActivities() {
      API.get("/api/activities").then(function(d) {
        if (d && d.activities) { this.activities = d.activities; }
      }.bind(this)).catch(function(e) { console.error("Activity load failed", e); });
      // 同时加载报告
      API.get("/api/v4/reports").then(function(d) {
        if (d && d.ok && d.reports) { this.reports = d.reports; }
      }.bind(this)).catch(function() {});
    },
    loadGoals() {
      API.get("/api/v4/goals").then(function(d) {
        if (d && d.ok && d.goals) { this.goals = d.goals; }
      }.bind(this)).catch(function() {});
    },
    createGoal() {
      var title = this.newGoalTitle.trim();
      if (!title) return;
      var desc = this.newGoalDesc.trim();
      API.post("/api/v4/goals", { title: title, description: desc }).then(function(d) {
        if (d && d.ok) {
          this.newGoalTitle = '';
          this.newGoalDesc = '';
          this.showAddGoal = false;
          this.loadGoals();
        }
      }.bind(this)).catch(function() {});
    },
    completeGoal(id) {
      fetch("/api/v4/goals/" + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) }).then(function(r){return r.json()}).then(function(d) {
        if (d && d.ok) this.loadGoals();
      }.bind(this)).catch(function() {});
    },
    togglePauseGoal(id) {
      fetch("/api/v4/goals/" + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paused' }) }).then(function(r){return r.json()}).then(function(d) {
        if (d && d.ok) this.loadGoals();
      }.bind(this)).catch(function() {});
    },
    resumeGoal(id) {
      fetch("/api/v4/goals/" + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) }).then(function(r){return r.json()}).then(function(d) {
        if (d && d.ok) this.loadGoals();
      }.bind(this)).catch(function() {});
    },
    deleteGoal(id) {
      fetch("/api/v4/goals/" + id, { method: 'DELETE' }).then(function(r){return r.json()}).then(function(d) {
        if (d && d.ok) this.loadGoals();
      }.bind(this)).catch(function() {});
    },
    clickGoal(g) {
      if (!g || !g.title) return;
      var text = '🎯 目标: ' + g.title;
      if (g.description) text += '\n' + g.description;
      if (g.note) text += '\n📌 ' + g.note;
      text += '\n状态: ' + (g.status === 'active' ? '进行中' : g.status === 'paused' ? '已暂停' : g.status === 'completed' ? '已完成' : g.status);
      this.messages.push({ role: 'assistant', content: text, time: new Date().toISOString() });
      this.$nextTick(this.scrollToBottom);
    },
    togglePause() {
      if (this.taskPaused) {
        API.post("/api/v4/tasks/resume").then(function(d) { if (d && d.ok) { this.taskPaused = false; } }.bind(this)).catch(function() {});
      } else {
        API.post("/api/v4/tasks/pause").then(function(d) { if (d && d.ok) { this.taskPaused = true; } }.bind(this)).catch(function() {});
      }
    },
    onModelChange() {
      var names = {}
      this.modelList.forEach(function(m) { names[m.value] = m.label })
      this.messages.push({ role: 'system', content: '🔄 ' + this.$t('chat.switched_to') + ' ' + (names[this.modelName] || this.modelName), time: new Date().toISOString(), isSystem: true })
      this.saveMessages()
      this.$nextTick(this.scrollToBottom)
    },
    async loadModelList() {
      try {
        var resp = await fetch('/api/router/config')
        if (resp.ok) {
          var data = await resp.json()
          if (data.models && Array.isArray(data.models)) {
            var list = []
            data.models.forEach(function(m) {
              var value = m.model
              var label = m.name || (m.provider + ' \u00b7 ' + m.model)
              list.push({ value: value, label: label })
            })
            if (list.length > 0) {
              this.modelList = list
            }
          }
        }
      } catch(e) {
        // Silently fail, keep defaults
      }
    },
    handleDrop(e) {
      this.dragOver = false
      var droppedFiles = e.dataTransfer.files
      if (droppedFiles.length) {
        for (var i = 0; i < droppedFiles.length; i++) {
          this.files.push(droppedFiles[i])
        }
      }
    },
    handlePasteFiles(e) {
      var pasted = e.target.files
      if (pasted.length) {
        for (var i = 0; i < pasted.length; i++) {
          this.files.push(pasted[i])
        }
        this.showPasteOverlay = false
      }
    }
  }
}
</script>

<style scoped>
/* QClaw Style Optimization */
@import './Chat-optimized.css';
/* === FORCE OVERRIDE: user and assistant bubble colors === */
.msg.user .msg-bubble {
  color: #e0e7ff !important;
  background: linear-gradient(135deg, #4f46e5, #3730a3) !important;
  border-bottom-right-radius: 4px !important;
}
.msg.assistant .msg-bubble {
  color: #1f2937 !important;
  background: #f3f4f6 !important;
  border: 1px solid #e5e7eb !important;
  border-bottom-left-radius: 4px !important;
}
/* Layout: force left/right alignment */
.msg.user {
  align-items: flex-end !important;
}
.msg.assistant {
  align-items: flex-start !important;
}

.chat-layout{display:flex;height:100%;position:relative;overflow:hidden;gap:0}.chat-hdr{display:flex;align-items:center;gap:8px;padding:8px 12px;flex-shrink:0;flex-wrap:wrap}.chi{font-size:22px;line-height:1}.chn{font-size:14px;font-weight:600;white-space:nowrap}.cht{font-size:11px;opacity:.7}.create-avatar-btn{background:var(--accent,#6366f1);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;white-space:nowrap}.create-avatar-btn:hover{filter:brightness(1.1)}.chat-main,.chat-main-col{flex:1;display:flex;flex-direction:column;min-width:0;position:relative}.chat-right-col{width:320px;min-width:320px;display:flex;flex-direction:column;border-left:1px solid var(--border-color,#e0e0e0);background:var(--bg-secondary,var(--bg3));transition:width .3s ease,min-width .3s ease,opacity .3s ease;overflow:hidden}.chat-right-col.collapsed{width:0;min-width:0;opacity:0;border-left:none;padding:0}.chat-header{padding:12px 16px;border-bottom:1px solid var(--border-color,#e0e0e0);background:var(--bg-primary,var(--bg2))}.msg-box{flex:1;overflow-y:auto;padding:16px}.drag-overlay{position:absolute;inset:0;background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;z-index:100;pointer-events:none}.chat-main{position:relative}.drag-hint{font-size:24px;color:#333;background:rgba(255,255,255,.9);padding:20px 40px;border-radius:12px;border:2px dashed #666}.file-preview{display:flex;flex-wrap:wrap;gap:8px;padding:8px 16px}.file-item{position:relative;display:flex;align-items:center;gap:4px;padding:4px 8px;background:var(--bg-secondary,var(--bg3));border-radius:4px;font-size:12px}.file-remove-btn{position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:50%;border:none;background:#ef4444;color:white;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}.input-area{padding:8px 16px;border-top:1px solid var(--border-color,#e0e0e0)}.input-row{display:flex;gap:8px}.chat-input{flex:1;resize:none;border:1px solid var(--border-color,#d0d0d0);border-radius:8px;padding:8px 12px;font-size:14px;outline:none;min-height:40px;max-height:120px;line-height:1.4}.chat-input:focus{border-color:var(--accent,#4ecdc4)}.send-btn{width:40px;height:40px;border:none;background:var(--accent,#4ecdc4);color:var(--fg,#1e1e30);border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0}.send-btn:disabled{background:#ccc;cursor:not-allowed}.file-label{background:none;border:none;cursor:pointer;font-size:18px;padding:4px;line-height:1}.hint-text{font-size:11px;color:var(--fg3,#999);align-self:center}

/* ===== 消息布局与气泡卡片 ===== */
.msg{margin-bottom:16px;max-width:85%;position:relative;display:flex;flex-direction:column}
.msg.user{align-items:flex-end}
.msg.assistant{align-items:flex-start}
.msg.system{align-items:center;max-width:100%}

/* 气泡容器 - 宽度自适应 */
.msg-bubble{display:inline-block;position:relative;border-radius:12px;padding:10px 14px;max-width:100%;word-break:break-word;box-shadow:0 1px 3px rgba(0,0,0,.08)}

/* 用户消息气泡 - 绿色渐变 + 右下角尾巴 */
.msg.user .msg-bubble{background:linear-gradient(135deg,#4f46e5,#3730a3);color:#e0e7ff;border-bottom-right-radius:4px;box-shadow:0 2px 8px rgba(79,70,229,.25)}
.msg.user .msg-bubble::after{content:'';position:absolute;bottom:0;right:-6px;width:12px;height:12px;background:#3730a3;border-bottom-right-radius:4px;clip-path:polygon(0 0,100% 100%,0 100%)}

/* AI消息气泡 - 白色卡片 + 左下角尾巴 */
.msg.assistant .msg-bubble{background:#f3f4f6;color:#1f2937;border:1px solid #e5e7eb;border-bottom-left-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
.msg.assistant .msg-bubble::after{content:'';position:absolute;bottom:0;left:-6px;width:12px;height:12px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;border-left:1px solid #e5e7eb;border-bottom-left-radius:4px;clip-path:polygon(100% 0,100% 100%,0 100%)}

/* 系统消息 - 居中灰条 */
.msg.system .msg-bubble{background:transparent;display:inline-block;box-shadow:none}
.msg.system .msg-text{background:var(--bg3,#ecedf3);color:var(--fg2,#585e7a);padding:6px 14px;border-radius:20px;font-size:12px;text-align:center;display:inline-block}

.msg-text{font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.msg-text.streaming-content{display:inline}

/* 时间戳对齐 */
.msg.user .msg-time{text-align:right}
.msg.assistant .msg-time{text-align:left}
.msg-time{font-size:11px;color:var(--fg3,#999);margin-top:4px;padding:0 4px}

/* 复制按钮 - 悬停显示 */
.msg-copy-btn{opacity:0;transition:opacity .2s;background:none;border:none;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:4px;margin-top:2px}
.msg:hover .msg-copy-btn{opacity:.6}
.msg-copy-btn:hover{opacity:1!important;background:rgba(0,0,0,.05)}

.report-section{margin:8px;padding:8px;background:var(--bg-primary,var(--bg2));border-radius:6px}.section-title{font-size:12px;font-weight:600;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--border-color,#e0e0e0)}.plan-card{padding:6px 8px;margin-bottom:6px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;font-size:12px;cursor:pointer}.progress-card{padding:6px 8px;margin-bottom:6px;background:#eff6ff;border-left:3px solid #3b82f6;border-radius:4px;font-size:12px;cursor:pointer}.report-card{padding:6px 8px;margin-bottom:6px;background:#ecfdf5;border-left:3px solid #10b981;border-radius:4px;font-size:12px;cursor:pointer}.other-card{padding:6px 8px;margin-bottom:6px;background:#fafafa;border-left:3px solid #9ca3af;border-radius:4px;font-size:12px;cursor:pointer}.long-text-indicator{font-size:11px;color:#f59e0b;padding:2px 8px;display:none}.long-text-indicator.show{display:block}.subchat-msg-box{flex:1;overflow-y:auto;padding:8px;font-size:12px}.subchat-msg{margin-bottom:6px;padding:4px 8px;border-radius:4px}.subchat-msg.user{text-align:right;background:rgba(78,205,196,0.08);color:var(--fg,var(--fg))}.subchat-msg.assistant{background:var(--bg-tertiary,var(--bg3))}.subchat-msg.system{text-align:center;font-size:11px;color:#888}.subchat-msg .msg-time{font-size:10px}.subchat-input-row{display:flex;gap:4px;padding:4px 8px}

/* History compression */
.compress-btn,.refresh-btn{background:none;border:1px solid var(--border-color,#d0d0d0);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:14px;white-space:nowrap;line-height:1;transition:all .2s;margin-left:2px}
.compress-btn:hover,.refresh-btn:hover{background:var(--bg-secondary,var(--bg3));border-color:var(--fg3,#999)}
.compress-btn:disabled{opacity:.4;cursor:not-allowed}
.compress-badge{font-size:11px;color:var(--fg3,#888);cursor:pointer;padding:2px 6px;background:var(--bg-secondary,var(--bg3));border-radius:4px;white-space:nowrap;margin-left:2px}
.compress-badge:hover{background:#e0e0e0}
.msg-compressed{max-width:85%;margin-bottom:12px;margin-right:auto;cursor:pointer}
.compress-header{display:flex;align-items:center;gap:6px;padding:6px 10px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px 8px 4px 4px;font-size:12px;color:#f57f17}
.compress-icon{font-size:14px}
.compress-label{font-weight:500}
.compress-toggle{margin-left:auto;font-size:11px;color:#f9a825}
.compress-preview{opacity:.7;font-size:13px}

/* Right column layout */
.right-toggle{position:absolute;right:320px;top:50%;transform:translateY(-50%);z-index:20;width:24px;height:48px;border:1px solid var(--border-color,#e0e0e0);border-right:none;background:var(--bg-primary,var(--bg2));cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--fg2,#666);border-radius:4px 0 0 4px;transition:right .3s ease}
.right-toggle.collapsed{right:0}

/* Panels */
.panel{display:flex;flex-direction:column;overflow:hidden;flex-shrink:0}
.panel.goals-panel{border-bottom:1px solid var(--border-color,#e0e0e0);max-height:40%}.goals-panel .panel-body{overflow-y:auto}.goal-add-btn{background:var(--accent,#6366f1);color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;margin-left:auto;white-space:nowrap}.goal-card{padding:6px 8px;margin:4px 0;border-radius:6px;background:var(--bg2);border:1px solid var(--border-color,#e0e0e0);cursor:pointer;transition:background .15s}.goal-card:hover{background:var(--bg3)}.goal-card.completed{opacity:.6}.goal-row{display:flex;align-items:center;gap:4px;font-size:12px}.goal-status-icon{flex-shrink:0;font-size:14px}.goal-title{flex:1;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.goal-actions{display:flex;gap:2px;flex-shrink:0;opacity:0;transition:opacity .15s}.goal-card:hover .goal-actions{opacity:1}.goal-act-btn{background:none;border:none;cursor:pointer;font-size:13px;padding:1px 3px;line-height:1}.goal-act-btn:hover{opacity:.7}.goal-desc{font-size:11px;color:var(--fg2);padding:2px 0 0 18px}.goal-note{font-size:11px;color:var(--accent,#6366f1);padding:1px 0 0 18px}.goal-time{font-size:10px;color:var(--fg3);padding:2px 0 0 18px}
.panel.subchat-panel{flex:1;min-height:0}
.panel-header{display:flex;align-items:center;gap:6px;padding:8px 12px;font-size:13px;font-weight:600;background:var(--bg-primary,var(--bg2));border-bottom:1px solid var(--border-color,#e0e0e0);flex-shrink:0}
.panel-body{flex:1;overflow-y:auto;padding:8px;min-height:0}

/* Subchat */
.subchat-header{font-size:11px;padding:6px 12px;color:var(--fg3,#888);border-bottom:1px solid var(--border-color,#e0e0e0);flex-shrink:0}
.subchat-input-area{padding:6px 8px;border-top:1px solid var(--border-color,#e0e0e0);flex-shrink:0}

/* File preview */
.file-preview-wrap{display:flex;flex-wrap:wrap;gap:4px;padding:4px 8px;flex-shrink:0}
.file-preview-item{display:flex;align-items:center;gap:4px;padding:2px 6px;background:var(--bg-secondary,var(--bg3));border-radius:4px;font-size:11px;position:relative}
.file-preview-img{width:24px;height:24px;object-fit:cover;border-radius:3px}
.file-preview-name{max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Chat actions bar */
.chat-actions{display:flex;align-items:center;gap:6px;padding:4px 0;flex-wrap:wrap;flex-shrink:0}
.file-count{font-size:11px;color:var(--fg3,#888)}
.subchat-item{font-size:10px}
.subchat-preview{background:var(--bg-primary,var(--bg2));border-bottom:1px solid var(--border-color,#e0e0e0)}
.msg-img-wrap{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;justify-content:flex-end}
.msg.user .msg-img-wrap{justify-content:flex-end}
.msg-img{max-width:260px;max-height:300px;border-radius:8px;cursor:pointer;object-fit:cover;border:1px solid var(--border-color,#e0e0e0);transition:opacity .2s}
.msg-img[src=""],.msg-img._err{display:none}

/* === 工作流路径/工具调用时间线 === */
.tool-call-card{background:var(--bg2);border:1px solid var(--border-color,#d0d0d0);border-radius:8px;overflow:hidden;margin:4px 0;position:relative}
.tool-call-card.status-running{border-color:var(--accent,#4ecdc4);box-shadow:0 0 0 1px var(--accent,#4ecdc4)}
.tool-call-card.status-done{border-color:var(--border-color,#d0d0d0)}
.tool-call-card.status-error{border-color:#ef4444}
.timeline-connector{height:16px;position:relative;left:20px;border-left:2px dashed var(--border-color,#ccc);margin-left:20px}
.tl-step-badge{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;margin-right:6px;border:2px solid transparent}
.tl-step-badge.step-running{border-color:var(--accent,#4ecdc4);background:rgba(78,205,196,.1)}
.tl-step-badge.step-done{border-color:#10b981;background:rgba(16,185,129,.1)}
.tl-step-badge.step-error{border-color:#ef4444;background:rgba(239,68,68,.1)}
.tool-call-header{display:flex;align-items:center;padding:6px 8px;cursor:pointer;gap:4px;user-select:none}
.tool-call-header:hover{background:rgba(0,0,0,.02)}
.tool-name{font-size:13px;font-weight:600;color:var(--fg);flex-shrink:0}
.tool-status{font-size:11px;color:var(--fg3);margin-left:auto;padding:0 4px}
.tool-status.status-running{color:var(--accent,#4ecdc4)}
.tool-status.status-done{color:#10b981}
.tool-status.status-error{color:#ef4444}
.tool-toggle{font-size:10px;color:var(--fg3);padding:0 2px;flex-shrink:0}
.tl-step-counter{font-size:10px;color:var(--fg3,#999);padding:0 4px;font-weight:500;white-space:nowrap;flex-shrink:0}
.tool-call-preview{padding:0 8px 6px 8px;display:flex;flex-direction:column;gap:2px}
.tool-preview-text{font-size:11px;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tool-preview-result{font-size:10px;color:var(--fg3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tool-call-body{padding:0 8px 6px 8px;border-top:1px solid var(--border-color,#e0e0e0)}
.tool-call-section{margin-top:6px}
.tl-section-label{font-size:10px;font-weight:600;color:var(--fg3);text-transform:uppercase;letter-spacing:.5px}
.tool-call-args{font-size:11px;color:var(--fg2);padding:2px 0;word-break:break-all}
.tool-call-result{font-size:11px;color:var(--fg);padding:4px 6px;background:rgba(16,185,129,.05);border-radius:4px;margin-top:2px;max-height:200px;overflow-y:auto;word-break:break-all;white-space:pre-wrap;font-family:monospace}
.tool-call-result.result-error{background:rgba(239,68,68,.05);color:#ef4444}
.source-code{font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,.02);padding:4px 6px;border-radius:4px;max-height:200px;overflow-y:auto}

/* WS Notification bell & dropdown */
.ws-notif-area{position:relative;margin-left:auto;display:flex;align-items:center}
.ws-notif-btn{background:none;border:none;cursor:pointer;font-size:16px;padding:2px 6px;position:relative;opacity:.5;transition:opacity .2s}
.ws-notif-btn.connected{opacity:1}
.ws-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#ccc;margin-right:2px;vertical-align:middle}
.connected .ws-dot{background:#10b981}
.ws-notif-badge{position:absolute;top:-2px;right:-2px;background:#ef4444;color:#fff;font-size:9px;min-width:14px;height:14px;border-radius:7px;display:flex;align-items:center;justify-content:center;padding:0 3px;font-weight:600;pointer-events:none}
.ws-notif-dropdown{position:absolute;top:100%;right:0;z-index:1000;background:var(--bg-card,#fff);border:1px solid var(--border-color,#ddd);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:280px;max-width:360px;max-height:400px;display:none;margin-top:4px}
.ws-notif-area:hover .ws-notif-dropdown{display:flex;flex-direction:column}
.ws-notif-header{padding:8px 12px;font-size:12px;font-weight:600;color:var(--fg);border-bottom:1px solid var(--border-color,#ddd)}
.ws-notif-list{flex:1;overflow-y:auto;max-height:340px}
.ws-notif-item{display:flex;gap:8px;padding:6px 12px;border-bottom:1px solid var(--border-color,#eee);font-size:12px}
.ws-notif-item:last-child{border-bottom:none}
.ws-notif-icon{flex-shrink:0;font-size:14px;width:20px;text-align:center}
.ws-notif-body{flex:1;min-width:0}
.ws-notif-text{color:var(--fg);word-break:break-word;line-height:1.3}
.ws-notif-meta{font-size:10px;color:var(--fg3);margin-top:1px}
.ws-notif-empty{padding:16px;text-align:center;color:var(--fg3);font-size:12px}

.pause-btn{background:none;border:none;cursor:pointer;font-size:14px;line-height:1;padding:0 6px;vertical-align:middle;opacity:.5}
.pause-btn:hover{opacity:1}
.pause-btn.paused{opacity:1;color:var(--accent)}
.pause-btn.busy{opacity:1;color:#f59e0b;animation:pulse-busy 1.2s ease-in-out infinite}
@keyframes pulse-busy{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.15);opacity:1}}


/* ====== 工具调用时间线增强 ====== */
.tool-call-card{background:var(--bg2,#f8f9fa);border:1px solid var(--border-color,#d0d0d0);border-radius:8px;overflow:hidden;margin:6px 0;position:relative;transition:all .2s ease}
.tool-call-card:hover{border-color:var(--accent,#4ecdc4);box-shadow:0 2px 8px rgba(78,205,196,.15)}
.tool-call-card.status-running{border-color:var(--accent,#4ecdc4);box-shadow:0 0 0 1px var(--accent,#4ecdc4),0 2px 8px rgba(78,205,196,.2)}
.tool-call-card.status-done{border-color:var(--border-color,#d0d0d0)}
.tool-call-card.status-done:hover{border-color:#10b981;box-shadow:0 2px 8px rgba(16,185,129,.15)}
.tool-call-card.status-error{border-color:#ef4444}
.tool-call-card.status-error:hover{border-color:#ef4444;box-shadow:0 2px 8px rgba(239,68,68,.15)}
.timeline-connector{height:18px;position:relative;left:20px;border-left:2.5px solid var(--accent,#4ecdc4);margin-left:20px;opacity:.5;transition:opacity .2s}
.tl-step-badge{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;margin-right:8px;border:2.5px solid transparent;transition:all .3s ease}
.tl-step-badge.step-running{border-color:var(--accent,#4ecdc4);background:rgba(78,205,196,.12);animation:tl-pulse 1.5s ease-in-out infinite}
.tl-step-badge.step-done{border-color:#10b981;background:rgba(16,185,129,.1)}
.tl-step-badge.step-error{border-color:#ef4444;background:rgba(239,68,68,.1)}
.tool-call-header{display:flex;align-items:center;padding:7px 10px;cursor:pointer;gap:6px;user-select:none}
.tool-call-header:hover{background:rgba(0,0,0,.03)}
.tool-name{font-weight:600;font-size:13px;color:var(--fg,#333);flex:1}
.tool-name:before{content:'\2699\ufe0f';margin-right:4px;font-size:11px}
.tool-status{font-size:11px;color:var(--fg3,#999);padding:2px 8px;border-radius:10px;background:rgba(0,0,0,.04)}
.tool-status.status-done{color:#10b981;background:rgba(16,185,129,.08)}
.tool-status.status-running{color:var(--accent,#4ecdc4);background:rgba(78,205,196,.08)}
.tool-status.status-error{color:#ef4444;background:rgba(239,68,68,.08)}
.tool-toggle{font-size:10px;color:var(--fg3,#aaa);transition:transform .2s}
.tool-call-card:not(.collapsed) .tool-toggle{transform:rotate(180deg)}
.tl-step-counter{font-size:10px;color:var(--fg3,#999);padding:2px 6px;font-weight:500;white-space:nowrap;flex-shrink:0;background:rgba(0,0,0,.03);border-radius:8px;margin-right:2px}
.tool-call-preview{padding:0 10px 8px 44px;display:flex;flex-direction:column;gap:3px}
.tool-preview-text{font-size:11px;color:var(--fg2,#666)}
.tool-preview-result{font-size:11px;color:var(--fg3,#888);padding:2px 6px;background:rgba(0,0,0,.03);border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tool-call-body{padding:0 10px 8px 44px;border-top:1px solid var(--border-color,#e0e0e0)}
.tool-call-section{margin-top:8px}
.tl-section-label{font-size:10px;font-weight:600;color:var(--fg3,#888);text-transform:uppercase;letter-spacing:.5px}
.tool-call-args{font-size:11px;color:var(--fg2,#666);padding:4px 0;word-break:break-all;font-family:monospace;background:rgba(0,0,0,.02);border-radius:4px;padding:4px 8px;margin-top:2px}
.tool-call-result{font-size:11px;color:var(--fg,#333);padding:6px 8px;background:rgba(16,185,129,.04);border-radius:4px;margin-top:4px;max-height:300px;overflow-y:auto;word-break:break-all;white-space:pre-wrap;font-family:monospace;border:1px solid rgba(16,185,129,.1)}
.tool-call-result.result-error{background:rgba(239,68,68,.05);color:#ef4444;border-color:rgba(239,68,68,.15)}
@keyframes tl-pulse{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.1);opacity:1}}

/* ====== 打字指示器（三点跳动） ====== */
.thinking-indicator{display:flex;align-items:center;gap:8px;padding:4px 0}
.thinking-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent,#4ecdc4);animation:dot-bounce 1.4s ease-in-out infinite}
.thinking-dot:nth-child(2){animation-delay:.2s}
.thinking-dot:nth-child(3){animation-delay:.4s}
@keyframes dot-bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-8px);opacity:1}}
.thinking-text{font-size:12px;color:var(--fg2,#888);font-style:italic;margin-left:4px}

/* ====== 思考块增强 ====== */
.thinking-block{background:linear-gradient(135deg, rgba(78,205,196,.05) 0%, rgba(16,185,129,.03) 100%);border:1px solid rgba(78,205,196,.2);border-radius:10px;padding:10px 14px;margin:8px 0;display:flex;align-items:center;gap:8px;animation:think-bounce .5s ease-out}
@keyframes think-bounce{0%{transform:translateY(-5px);opacity:0}50%{transform:translateY(2px)}100%{transform:translateY(0);opacity:1}}
.thinking-icon{font-size:16px;animation:think-rotate 2s ease-in-out infinite}
@keyframes think-rotate{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
.thinking-text{font-size:13px;color:var(--fg2,#666);font-style:italic}
.thinking-dots{display:inline-flex;gap:2px;margin-left:2px}
.thinking-dots span{animation:dot-jump 1.2s ease-in-out infinite;font-size:18px;font-weight:bold;color:var(--accent,#4ecdc4);line-height:1}
.thinking-dots span:nth-child(2){animation-delay:.15s}
.thinking-dots span:nth-child(3){animation-delay:.3s}
@keyframes dot-jump{0%,60%,100%{transform:translateY(0);opacity:.3}30%{transform:translateY(-6px);opacity:1}}


/* ====== 文件访问授权卡片 ====== */
.auth-card{background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border:2px solid #f59e0b;border-radius:10px;overflow:hidden;margin:8px 0;box-shadow:0 2px 8px rgba(245,158,11,.15)}.auth-header{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(245,158,11,.1);border-bottom:1px solid rgba(245,158,11,.2)}.auth-icon{font-size:18px}.auth-title{font-size:14px;font-weight:600;color:#92400e}.auth-body{padding:12px 14px}.auth-field{margin:4px 0;font-size:13px;color:#78350f}.auth-field code{background:rgba(245,158,11,.1);padding:2px 6px;border-radius:4px;font-size:12px;word-break:break-all}.auth-label{font-weight:600;color:#92400e}.auth-buttons{display:flex;gap:8px;margin-top:10px}.btn-auth{padding:6px 14px;border:none;border-radius:6px;font-size:13px;cursor:pointer;transition:all .15s ease;font-weight:500}.btn-auth:hover{transform:translateY(-1px);box-shadow:0 2px 6px rgba(0,0,0,.15)}.auth-once{background:#10b981;color:#fff}.auth-step{background:#3b82f6;color:#fff}.auth-deny{background:#ef4444;color:#fff}.auth-result{padding:6px 12px;border-radius:6px;font-size:13px;font-weight:600;text-align:center}.auth-approved{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}.auth-rejected{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
</style>
