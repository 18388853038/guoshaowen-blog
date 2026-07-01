<template>
  <div class="channels-page">
    <div class="page-hdr">
      <h2>📡 {{ __('channelsTitle') }}</h2>
      <p class="page-desc">管理所有外部{{ __('channelsTitle') }}、统一消息中心</p>
    </div>

    <!-- 标签栏 -->
    <div class="ch-tabs">
      <span class="ch-tab" :class="{active:chTab==='channels'}" @click="chTab='channels'">📡 渠道管理</span>
      <span class="ch-tab" :class="{active:chTab==='messages'}" @click="chTab='messages';loadMessages()">💬 消息中心 <span v-if="msgStatsTotal>0" class="ch-tab-badge">{{ msgStatsTotal }}</span></span>
    </div>

    <!-- ===== 渠道管理 ===== -->
    <div v-if="chTab==='channels'">
      <div v-if="loading" class="loading-state">{{ __('channelsLoading') }}...</div>
      <div v-else class="ch-grid">
      <div v-for="(c,i) in channels" :key="i" class="ch-card"
        :class="{'card-active':c.status==='active'||c.status==='connected'||c.status==='running',
                 'card-offline':c.status==='offline'||c.status==='inactive',
                 'card-error':c.status==='error'}">
      <!-- Card header -->
      <div class="ch-header">
        <div class="ch-icon-wrap" :style="{ background: c.color ? c.color+'18' : 'transparent' }">
          <span class="ch-icon">{{ c.icon }}</span>
        </div>
        <div class="ch-info">
          <div class="ch-name">{{ c.name }}</div>
          <div class="ch-type">{{ c.type }}</div>
        </div>
      </div>
      <!-- Status text -->
      <div class="ch-status-row">
        <span class="ch-dot" :class="statusClass(c)"></span>
        <span>{{ statusLabel(c) }}</span>
        <span v-if="c.account" class="ch-account">— {{ c.account }}</span>
      </div>
      <!-- Detail sub-status for bridges -->
      <div v-if="c._connected !== undefined && !c._connected" class="ch-detail-row">
        <span>⚠️ 连接已断开，正在等待重连</span>
      </div>
      <!-- Setup steps (collapsible) - QQ QR mode -->
      <div v-if="c.id==='qqbot' && c._mode==='qr'" class="ch-setup">
        <div class="ch-setup-header" @click="c._showSetup = !c._showSetup">
          <span v-if="c.setupSteps && c.setupSteps.length">📋 配置步骤</span>
          <span v-else>📋 扫码步骤</span>
          <span class="arrow">{{ c._showSetup ? '▼' : '▶' }}</span>
        </div>
        <div v-if="c._showSetup" class="ch-setup-body">
          <div v-for="(s,si) in (c.setupSteps.length ? c.setupSteps : c._qrSetup||[])" :key="si" class="setup-step">{{ si+1 }}. {{ s }}</div>
        </div>
      </div>
      <!-- Setup steps for other channels -->
      <div v-else-if="c.setupSteps && c.setupSteps.length && c.status !== 'active' && c.status !== 'connected'" class="ch-setup">
        <div class="ch-setup-header" @click="c._showSetup = !c._showSetup">
          <span>📋 配置步骤</span>
          <span class="arrow">{{ c._showSetup ? '▼' : '▶' }}</span>
        </div>
        <div v-if="c._showSetup" class="ch-setup-body">
          <div v-for="(s,si) in c.setupSteps" :key="si" class="setup-step">{{ si+1 }}. {{ s }}</div>
        </div>
      </div>
      <!-- Mode toggle for QQ Bot: credentials vs QR scan -->
      <div v-if="c.id === 'qqbot'" class="ch-mode-tabs">
        <span class="ch-mode-tab" :class="{active:c._mode==='credential'}" @click="c._mode='credential';c._showQR=!1">🔑 凭证配置</span>
        <span class="ch-mode-tab" :class="{active:c._mode==='qr'}" @click="c._mode='qr';loadQQQR(c)">📱 二维码绑定</span>
      </div>
      <!-- QR Code for personal_wx or qqbot -->
      <div v-if="(c.id === 'personal_wx' || (c.id === 'qqbot' && c._mode==='qr')) && c._showQR" class="ch-qr-area">
        <div v-if="c._bindMsg" class="ch-bind-msg">{{ c._bindMsg }}</div>
        <img v-if="c._qrImage" :src="c._qrImage" class="ch-qr-img" />
        <div v-else class="ch-qr-placeholder">⏳ {{ __('channelsGettingQr') }}...</div>
        <div class="ch-qr-hint">📱 扫码在 QQ 中打开 → 创建机器人应用 → 获取 appId 和 clientSecret → 填写凭证配置</div>
        <div v-if="c._bindStatus !== undefined" class="ch-bind-status">
          <span :class="c._bindStatus ? 'bind-ok' : 'bind-pending'">{{ c._bindStatus ? '✅ 已绑定' : '⏳ 等待扫码中...' }}</span>
        </div>
      </div>
      <!-- Config form for channels with fields -->
      <div v-if="c.fields && c.fields.length && (c.id!=='qqbot' || c._mode==='credential') && (c._showConfig || c.status === 'offline')" class="ch-config">
        <div v-for="(f,fi) in c.fields" :key="fi" class="config-field">
          <label class="config-label">{{ f.label }}</label>
          <input v-if="f.type!=='select'" class="config-input" :type="f.type||'text'" :placeholder="f.placeholder||''" v-model="c._configValues[f.key]" />
          <select v-else class="config-select" v-model="c._configValues[f.key]">
            <option v-for="(opt,oi) in (f.options||[])" :key="oi" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>
      </div>
      <!-- Actions -->
      <div class="ch-actions">
        <button v-if="(c.id === 'personal_wx' || (c.id === 'qqbot' && c._mode==='qr')) && (c.status === 'offline' || c.status === 'inactive')" class="ch-btn qr-btn" @click="c.id==='qqbot'?toggleQQQR(c):togglePersonalWX(c)" :disabled="c._toggling">
          {{ c._showQR ? '🔄 刷新二维码' : '📱 二维码绑定' }}
        </button>
        <button class="ch-btn" @click="toggleChannel(c)" :disabled="c._toggling">
          {{ c.status === 'active' || c.status === 'connected' || c.status === 'running' ? __('channelsDisconnect') : __('channelsConnect') }}
        </button>
        <button v-if="c.fields && c.fields.length && c.id !== 'qqbot' || (c.id==='qqbot' && c._mode==='credential')" class="ch-btn ghost" @click="c._showConfig = !c._showConfig">
          {{ c._showConfig ? __('channelsCollapse') : __('channelsConfig') }}
        </button>
      </div>
    </div>
    </div>
      <div class="ch-footer">
        <button class="ch-btn" @click="loadAll" :disabled="loading">🔄 {{ __('channelsRefreshStatus') }}</button>
      </div>
    </div>

    <!-- ===== 消息中心 ===== -->
    <div v-if="chTab==='messages'" class="msg-center">
      <div class="msg-toolbar">
        <div class="msg-stats">
          <span v-for="(v,k) in msgStats" :key="k" class="msg-stat-item">
            <span class="msg-stat-icon">{{ channelIcon(k) }}</span>
            <span class="msg-stat-num">{{ v.total }}</span>
          </span>
          <span class="msg-stat-item" v-if="msgStatsTotal===0">暂无消息</span>
        </div>
        <div class="msg-filter-bar">
          <select v-model="msgFilter" @change="loadMessages()" class="msg-filter-select">
            <option value="all">全部渠道</option>
            <option v-for="k in Object.keys(msgStats)" :key="k" :value="k">{{ channelIcon(k) }} {{ k }}</option>
          </select>
          <input v-model="msgSearch" placeholder="搜索消息内容…" class="msg-search-input" @input="debounceMsgSearch" />
        </div>
      </div>
      <div v-if="msgLoading" class="loading-state" style="padding:40px">加载中...</div>
      <div v-else class="msg-list">
        <div v-for="m in filteredMessages()" :key="m.id" class="msg-item" :class="{'msg-in':m.direction==='in','msg-out':m.direction==='out'}">
          <div class="msg-header">
            <span class="msg-channel-tag">{{ channelIcon(m.channel) }} {{ m.channel }}</span>
            <span class="msg-direction">{{ m.direction === 'in' ? '📥 收到' : '📤 发送' }}</span>
            <span class="msg-time">{{ new Date(m.timestamp).toLocaleString() }}</span>
          </div>
          <div class="msg-body">{{ m.content }}</div>
          <div class="msg-meta">
            <span v-if="m.from">从: {{ m.from }}</span>
            <span v-if="m.to">到: {{ m.to }}</span>
          </div>
        </div>
        <div v-if="!filteredMessages().length" class="msg-empty">
          <p v-if="msgStatsTotal===0">暂无消息记录，各渠道的消息将自动汇集于此</p>
          <p v-else>当前筛选条件下无匹配消息</p>
        </div>
      </div>
      <div class="msg-footer">
        <span v-if="msgList.length>0">显示 {{ filteredMessages().length }} / {{ msgList.length }} 条消息</span>
        <button class="refresh-btn" @click="loadMessages()" style="margin-left:auto">🔄 刷新</button>
      </div>
    </div>
    </div>
</template>

<script>
import { __ } from '../i18n'
import { API } from '../main.js'

export default {
  data() {
    return {
      loading: true,
      channels: [],
      chTab: 'channels',
      msgLoading: false,
      msgStats: {},
      msgStatsTotal: 0,
      msgList: [],
      msgFilter: 'all',
      msgSearch: '',
    }
  },
  mounted() {
    this.loadAll()
  },
  methods: {
    async loadAll() {
      this.loading = true;
      try {
        // Get channel types definition
        var btResp = await fetch('/api/bindings/channel-types');
        var btData = await btResp.json();
        var channelTypes = (btData.channelTypes || []).reduce(function(acc, c) { acc[c.id] = c; return acc; }, {});
        
        // Get real-time channel status from channels/list (comprehensive metadata)
        var chResp = await fetch('/api/channels/list');
        var chData = await chResp.json();
        var liveList = chData.channels || [];
        var liveChannels = {};
        liveList.forEach(function(c) { liveChannels[c.id] = c; });
        
        // Get real channel connectivity status (backend query)
        var runtimeStatus = {};
        try {
          var stResp = await fetch('/api/channels/status');
          var stData = await stResp.json();
          if (stData.ok && stData.channels) {
            stData.channels.forEach(function(ch) { runtimeStatus[ch.id] = ch; });
          }
        } catch(e) {}
        // bridgeStatus aliased for backward compat
        var bridgeStatus = {};
        for (var sid in runtimeStatus) {
          var rs = runtimeStatus[sid];
          bridgeStatus[sid] = { alive: rs.connected, status: { status: rs.status, account: rs.account, messageCount: rs.messageCount, _connected: sid === "personal_wx" || sid === "qqbot" ? undefined : rs.connected } };
        }

        var self = this;
        var externalOnlyIds = ['tencent', 'personal_wx', 'qqbot', 'dingtalk', 'wecom', 'feishu', 'wechat_ilink'];
        
        // Build channel list from liveChannels, with metadata from channelTypes
        // 补充桥接渠道：bridge status 显示运行中但不在 channels/list 中的渠道
        for (var bid in bridgeStatus) {
          var bs = bridgeStatus[bid];
          var isRunning = bs && bs.alive && bs.status && (typeof bs.status.status === 'string' ? bs.status.status === 'running' : bs.status === 'running');
          if (isRunning && !liveChannels[bid]) {
            liveChannels[bid] = {
              id: bid,
              name: { wechat_ilink: '微信桥接', wecom: '企业微信' }[bid] || bid,
              icon: { wechat_ilink: '📱', wecom: '🏢' }[bid] || '📡',
              connected: true,
              desc: '运行中'
            };
          }
        }
        
        var allChannels = [];
        for (var id in liveChannels) {
          var lc = liveChannels[id];
          var ct = channelTypes[id] || {};
          var bs = bridgeStatus[id];
          
          // Determine status
          var status = 'offline';
          // 桥接状态优先（alive 且 status.running 表示进程存活且正常运行）
          if (bs && bs.alive && bs.status && (typeof bs.status.status === 'string' ? bs.status.status === 'running' : bs.status === 'running')) {
            status = 'running';
          } else if (lc.connected) {
            if (lc.desc === '连通中') status = 'connecting';
            else if (lc.desc === '运行中') status = externalOnlyIds.includes(id) ? 'running' : 'active';
            else if (lc.desc) status = 'active';
          }
          // 没有 bridge 但有字段需要配置 -> 标记为待配置（区别于完全 offline）
          if (status === 'offline' && ct.fields && ct.fields.length > 0 && !bs) {
            status = 'inactive';
          }
          if (bs && bs.status && bs.status.status === 'error') status = 'error';
          
          // Build message count and account
          var account = bs && bs.status ? bs.status.account || '' : '';
          var messageCount = bs && bs.status ? bs.status.messageCount || 0 : 0;
          var _connected = bs && bs.status ? bs.status._connected : undefined;
          
          var ch = {
            id: lc.id,
            name: ct.name || lc.name || id,
            icon: ct.icon || lc.icon || (id === 'web' ? '🌐' : id === 'api' ? '🔌' : '📡'),
            color: ct.color || undefined,
            type: externalOnlyIds.includes(id) ? ('外部·' + (ct.name || id)) : '内置·前端聊天',
            status: status,
            builtin: !externalOnlyIds.includes(id),
            account: account,
            messageCount: messageCount,
            _connected: _connected,
            _showSetup: false,
            _showConfig: false,
            _showQR: false,
            _configValues: {},
            _toggling: false,
            _saving: false,
            _qrImage: null,
            setupSteps: ct.setupSteps || [],
            fields: ct.fields || [],
            bindMode: ct.bindMode || '',
            _mode: id === 'qqbot' ? 'credential' : undefined,
            _qrSetup: id === 'qqbot' ? ['1. 点击「二维码绑定」生成二维码','2. 打开手机 QQ 扫码','3. 扫码后 QQ Bot 自动关联你的 QQ','4. 系统自动完成绑定'] : undefined
          };
          allChannels.push(ch);
        }
        
        this.channels = allChannels;
      } catch(e) {
        console.error('加载渠道状态失败:', e);
        this.channels = [
          { id:'web', name:'Web Chat', icon:'🌐', type:'内置·前端聊天', status:'active', builtin:true },
          { id:'api', name:'REST API', icon:'🔌', type:'内置·HTTP 接口', status:'active', builtin:true },
          { id:'ws', name:'WebSocket', icon:'🔗', type:'内置·实时通道', status:'active', builtin:true },
          { id:'dingtalk', name:'钉钉', icon:'📱', color:'#0089FF', type:'外部·DingTalk', status:'offline', _configValues:{} },
          { id:'wecom', name:'企业微信', icon:'🏢', color:'#2BAD13', type:'外部·WeCom', status:'offline', _configValues:{} },
          { id:'wechat_ilink', name:'微信', icon:'📱', color:'#07C160', type:'外部·WeChat iLink', status:'offline' },
          { id:'feishu', name:'飞书', icon:'📘', color:'#3370FF', type:'外部·Feishu', status:'offline', _configValues:{} },
          { id:'personal_wx', name:'个人微信', icon:'💬', color:'#07C160', type:'外部·ClawBot', status:'offline' },
          { id:'qqbot', name:'QQ 机器人', icon:'🐧', color:'#12B7F5', type:'外部·QQ Bot', status:'offline', _configValues:{} },
        ];
      } finally {
        this.loading = false;
      }
    },

    statusClass(c) {
      if (c.status === 'active' || c.status === 'connected') return 'dot-on'
      if (c.status === 'running') return 'dot-running'
      if (c.status === 'connecting' || c.status === 'pending') return 'dot-connecting'
      if (c.status === 'error') return 'dot-error'
      if (c.status === 'inactive') return 'dot-inactive'
      return 'dot-off'
    },

    statusLabel(c) {
      if (c.status === 'running') return '已' + __('channelsConnect')
      if (c.status === 'active' || c.status === 'connected') return '已' + __('channelsConnect')
      if (c.status === 'connecting') return __('channelsConnecting')
      if (c.status === 'error') return __('channelsConnect') + '失败'
      if (c.status === 'inactive') return '待配置'
      return '未' + __('channelsConnect')
    },

    async toggleChannel(c) {
      if (c._toggling) return
      c._toggling = true

      if (c.status === 'active' || c.status === 'connected' || c.status === 'running') {
        // ' + __('channelsDisconnect') + '：更新状态为 offline（实际可能需要 API）
        c.status = 'offline'
        c._toggling = false
        return
      }

      // ' + __('channelsConnect') + '
      if (c.builtin) {
        c.status = 'active'
        c._toggling = false
        return
      }

      // ' + __('channelsExternalDesc') + '：检查是否有' + __('channelsConfig') + '字段需要填写
      if (c.fields && c.fields.length) {
        var missing = c.fields.filter(function(f) { return f.required && !c._configValues[f.key] })
        if (missing.length) {
          c._showConfig = true
          c._toggling = false
          return
        }
      }

      // ' + __('channelsCallInstall') + ' API
      try {
        c.status = 'connecting'
        var resp = await API.post('/api/channels/install', { channelId: c.id, params: c._configValues || {} })
        if (resp.ok) {
          c.status = 'connected'
        } else {
          c.status = 'error'
        }
      } catch(e) {
        c.status = 'error'
      }
      c._toggling = false
    },

    async loadQQQR(c) {
      c._qrImage = null
      try {
        var resp = await fetch('/api/qqbot/qrcode')
        var data = await resp.json()
        if (data.ok && data.image) {
          c._qrImage = data.image
          c._bindMsg = ''
          // 轮询' + __('channelsBindStatus') + '
          if (c._qrPollTimer) { clearInterval(c._qrPollTimer); c._qrPollTimer = null }
          c._qrPollTimer = setInterval(async function() {
            try {
              var pr = await fetch('/api/qqbot/bind/status')
              var pd = await pr.json()
              c._bindStatus = pd.bound
              if (pd.bound) {
                c.status = 'connected'
                c.account = pd.account || __('channelsBound')
                clearInterval(c._qrPollTimer)
                c._qrPollTimer = null
              }
            } catch(e) {}
          }, 3000)
        } else {
          c._qrImage = null
          if (data && data.message) {
            c._bindMsg = data.message
          }
        }
      } catch(e) {
        c._qrImage = null
      }
    },

    async toggleQQQR(c) {
      c._showQR = true;
      // 二维码已显示 -> 刷新（不关闭）
      if (c._qrImage) {
        c._qrImage = null;
        if (c._qrPollTimer) { clearInterval(c._qrPollTimer); c._qrPollTimer = null; }
      }
      this.loadQQQR(c);
    },

    async togglePersonalWX(c) {
      // 二维码已显示 -> 刷新（不关闭）
      if (c._showQR) {
        this._refreshPersonalWXQR(c);
        return;
      }
      c._showQR = true;
      this._fetchPersonalWXQR(c);
    },
    async _fetchPersonalWXQR(c) {
      // Start periodic status refresh for personal_wx
      if (!c._statusTimer) {
        c._statusTimer = setInterval(async function() {
          try {
            var sr = await fetch('/api/channels/status', { signal: AbortSignal.timeout(5000) });
            var sd = await sr.json();
            if (sd.ok && sd.channels) {
              var pw = sd.channels.find(function(x) { return x.id === 'personal_wx'; });
              // Only use status API to move offline -> connected (positive confirmation)
              // Never use it to downgrade connected -> offline (that's the QR poll's job)
              if (pw && pw.connected && c.status !== 'connected') {
                c.status = 'connected';
                c.account = pw.account || c.account;
                if (c._qrPollTimer) { clearInterval(c._qrPollTimer); c._qrPollTimer = null; }
                c._bindMsg = '✅ 个人微信已成功连接';
              }
              // QR poll succeeded but status API still shows offline — that's expected while 
              // the bridge status cache hasn't updated. Don't downgrade.
            }
          } catch(e) {}
        }, 10000);
      }
      c._showQR = true;
      try {
        var resp = await fetch('/api/wechat/qrcode');
        var data = await resp.json();
        if (data.ok && data.qrcode) {
          c._qrImage = data.qrcode;
          if (!c._qrPollTimer) {
            c._qrPollTimer = setInterval(async function() {
              try {
                var pr = await fetch('/api/wechat/qrcode/status?token=' + (data.qrToken || data.wxUrl || ''));
                var pd = await pr.json();
                if (pd.ok) {
                  if (pd.bound) {
                    c.status = 'connected';
                    c.account = pd.user || pd.userId || __('channelsBound');
                    c._statusTimer = null;
                    clearInterval(c._qrPollTimer);
                    c._qrPollTimer = null;
                    c._bindMsg = '✅ 个人微信绑定成功！';
                  } else {
                    c._bindStatus = false;
                  }
                }
              } catch(e) {}
            }, 2000);
          }
        } else {
          c._qrImage = null;
        }
      } catch(e) {
        c._qrImage = null;
      }
    },
    _refreshPersonalWXQR(c) {
      c._qrImage = null;
      // Keep status timer alive; clear poll timer so new fetch creates a new one with fresh token
      if (c._qrPollTimer) { clearInterval(c._qrPollTimer); c._qrPollTimer = null; }
      this._fetchPersonalWXQR(c);
    },

    async refreshQR(c) {
      c._qrImage = null
      try {
        var url = c.id === 'qqbot' ? '/api/qqbot/qrcode' : '/api/wechat/qrcode'
        var resp = await fetch(url)
        var data = await resp.json()
        var imgField = c.id === 'qqbot' ? 'image' : 'qrcode'
        if (data.ok && data[imgField]) c._qrImage = data[imgField]
      } catch(e) {}
    },

    async saveConfig(c) {
      c._saving = true
      try {
        var resp = await API.post('/api/channels/install', { channelId: c.id, params: c._configValues || {} })
        if (resp.ok) {
          c.status = 'connected'
          c._showConfig = false
        } else {
          alert(__('channelsConfig') + '失败: ' + (resp.error || __('channelsUnknownErr')))
        }
      } catch(e) {
        alert('保存失败: ' + e.message)
      }
      c._saving = false
    },
    async loadMessages() {
      this.msgLoading = true;
      try {
        var [statsR, msgR] = await Promise.all([
          fetch('/api/v4/messages/stats', { signal: AbortSignal.timeout(5000) }),
          fetch('/api/v4/messages?limit=100', { signal: AbortSignal.timeout(5000) })
        ]);
        var statsD = await statsR.json();
        var msgD = await msgR.json();
        if (statsD.ok) {
          this.msgStats = statsD.stats;
          this.msgStatsTotal = 0;
          Object.values(statsD.stats).forEach(function(s) { this.msgStatsTotal += s.total; }.bind(this));
        }
        if (msgD.ok) { this.msgList = msgD.messages; }
      } catch(e) { console.error('加载消息失败:', e); }
      this.msgLoading = false;
    },
    filteredMessages() {
      var list = this.msgList;
      if (this.msgFilter !== 'all') {
        list = list.filter(function(m) { return m.channel === this.msgFilter; }.bind(this));
      }
      if (this.msgSearch) {
        var s = this.msgSearch.toLowerCase();
        list = list.filter(function(m) { return (m.content && m.content.toLowerCase().includes(s)) || (m.from && m.from.toLowerCase().includes(s)); });
      }
      return list;
    },
    debounceMsgSearch: (function() {
      var timer;
      return function() {
        if (timer) clearTimeout(timer);
        var self = this;
        timer = setTimeout(function() { self.filteredMessages(); }, 300);
      };
    })(),
    channelIcon(id) {
      var map = { wechat:'💚', dingtalk:'🔶', qqbot:'🐧', feishu:'📘', wecom:'🏢', telegram:'✈️', whatsapp:'💬', discord:'🎮', slack:'💜', tencent:'☁️', webchat:'🌐' };
      return map[id] || '📡';
    }
  },
  beforeUnmount() {
    // channelsCleanPoll
    this.channels.forEach(function(c) {
      if (c._qrPollTimer) { clearInterval(c._qrPollTimer); c._qrPollTimer = null }
      if (c._statusTimer) { clearInterval(c._statusTimer); c._statusTimer = null }
    })
  }
}
</script>

<style scoped>
.channels-page{padding:20px 28px;height:100%;overflow-y:auto}
.page-hdr{margin-bottom:20px}
.page-hdr h2{font-size:18px;margin:0 0 4px;color:var(--fg)}
.page-desc{color:var(--fg2);font-size:12px;margin:0}

.loading-state{text-align:center;padding:60px 0;color:var(--fg3);font-size:13px}

.ch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.ch-card{padding:16px;background:var(--bg2);border-radius:10px;border:1px solid var(--border);display:flex;flex-direction:column;gap:8px;transition:all .2s}
.ch-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.04)}
.ch-card.online,.ch-card.connected{border-color:rgba(16,185,129,.3)}
.ch-card.running{border-color:rgba(78,205,196,.3)}
.ch-card.error{border-color:rgba(239,68,68,.3)}
.ch-card.inactive{border-color:rgba(156,163,175,.3)}

.ch-header{display:flex;align-items:center;gap:10px}
.ch-icon-wrap{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ch-icon{font-size:20px;line-height:1}
.ch-info{flex:1;min-width:0}
.ch-name{font-size:13px;font-weight:600;color:var(--fg)}
.ch-type{font-size:10px;color:var(--fg3);margin-top:1px}

.ch-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-on{background:#10b981;box-shadow:0 0 6px rgba(16,185,129,.4)}
.dot-running{background:var(--accent,#4ecdc4);box-shadow:0 0 6px rgba(78,205,196,.4);animation:pulse 1.5s infinite}
.dot-connecting{background:#f59e0b;animation:pulse 1s infinite}
.dot-error{background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,.4)}
.dot-off{background:var(--fg3)}
.dot-inactive{background:var(--fg3);opacity:.4}

@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

.ch-status-row{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--fg2);flex-wrap:wrap}
.ch-status-label{font-weight:500}
.ch-account{color:var(--fg3);font-family:monospace;font-size:10px}
.ch-msg-count{color:var(--fg3);font-size:10px}
.ch-sub-status{font-size:10px;color:#f59e0b}

.ch-detail-row{padding:6px 8px;background:rgba(245,158,11,.08);border-radius:6px;font-size:11px;color:var(--fg2)}

.ch-setup{background:var(--bg3);border-radius:6px;overflow:hidden}
.ch-setup-header{padding:6px 8px;font-size:11px;font-weight:500;color:var(--fg2);cursor:pointer;display:flex;align-items:center;gap:4px}
.setup-toggle{font-size:9px;margin-left:auto}
.ch-setup-body{padding:0 8px 6px}
.setup-step{font-size:10px;color:var(--fg3);padding:3px 0;border-bottom:1px solid var(--border)}.setup-step:last-child{border:none}

.ch-qr-area{display:flex;flex-direction:column;align-items:center;padding:12px;gap:8px}
.ch-qr-img{width:160px;height:160px;border-radius:8px;border:1px solid var(--border)}
.ch-qr-placeholder{width:160px;height:160px;display:flex;align-items:center;justify-content:center;background:var(--bg3);border-radius:8px;font-size:12px;color:var(--fg3)}
.ch-qr-hint{font-size:11px;color:var(--fg3)}

.ch-config{display:flex;flex-direction:column;gap:6px;padding:8px;background:var(--bg3);border-radius:6px}
.config-field{display:flex;flex-direction:column;gap:2px}
.config-label{font-size:10px;font-weight:500;color:var(--fg2)}
.config-input{padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:11px;background:var(--bg2);color:var(--fg);outline:none}
.config-input:focus{border-color:var(--accent)}

.ch-mode-tabs{display:flex;background:var(--bg3);border-radius:6px;overflow:hidden}
.ch-mode-tab{flex:1;padding:5px 8px;font-size:11px;text-align:center;cursor:pointer;color:var(--fg3);transition:all .15s;border:1px solid transparent}
.ch-mode-tab.active{background:var(--bg2);color:var(--fg);border-color:var(--border);font-weight:500;border-radius:5px}
.ch-mode-tab:not(.active):hover{color:var(--fg2)}
.ch-bind-status{font-size:10px;color:var(--fg3)}
.config-save-btn{margin-top:4px}

.ch-actions{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}
.ch-btn{padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--fg2);cursor:pointer;font-size:11px;transition:all .15s}
.ch-btn:hover{color:var(--fg);border-color:var(--accent)}
.ch-btn:disabled{opacity:.4;cursor:not-allowed}
.ch-btn.small{padding:3px 8px;font-size:10px}
.ch-btn.ghost{border-color:transparent;background:transparent;color:var(--fg3)}
.ch-btn.ghost:hover{color:var(--fg2);background:var(--bg3)}
.ch-btn.config-save-btn{background:var(--accent);color:var(--fg);border-color:transparent;font-weight:500}

.ch-footer{margin-top:20px;display:flex;justify-content:center}
.ch-tabs{display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:8px}.ch-tab{padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;color:var(--fg2);transition:all 0.15s;position:relative;user-select:none}.ch-tab:hover{color:var(--fg);background:var(--bg3)}.ch-tab.active{color:var(--accent,#4ecdc4);background:rgba(78,205,196,0.08);font-weight:600}.ch-tab-badge{background:var(--accent,#4ecdc4);color:#000;border-radius:10px;padding:0 6px;font-size:10px;margin-left:4px}.msg-center{padding:0}.msg-toolbar{display:flex;flex-direction:column;gap:10px;margin-bottom:12px}.msg-stats{display:flex;gap:8px;flex-wrap:wrap}.msg-stat-item{display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;background:var(--bg3,#1c1c30);font-size:12px}.msg-stat-icon{font-size:14px}.msg-stat-num{font-weight:700;color:var(--fg)}.msg-filter-bar{display:flex;gap:8px}.msg-filter-select,.msg-search-input{padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg3,#1c1c30);color:var(--fg);font-size:12px;outline:none}.msg-filter-select{width:120px}.msg-search-input{flex:1}.msg-list{max-height:60vh;overflow-y:auto}.msg-item{padding:10px 12px;border-radius:8px;border:1px solid var(--border);margin-bottom:8px;background:var(--bg3,#1c1c30);transition:all 0.15s}.msg-item:hover{background:var(--bg4,#242440)}.msg-in{border-left:3px solid var(--accent,#4ecdc4)}.msg-out{border-left:3px solid #a855f7}.msg-header{display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap}.msg-channel-tag{padding:1px 6px;border-radius:4px;background:rgba(124,111,240,0.12);color:var(--accent2,#7c6ff0);font-size:10px;font-weight:600}.msg-direction{font-size:11px;color:var(--fg2)}.msg-time{font-size:10px;color:var(--fg3);margin-left:auto}.msg-body{font-size:13px;color:var(--fg);white-space:pre-wrap;word-break:break-word;margin-bottom:4px}.msg-meta{display:flex;gap:12px;font-size:10px;color:var(--fg3)}.msg-empty{padding:40px;text-align:center;color:var(--fg3);font-size:13px}.msg-footer{display:flex;align-items:center;margin-top:8px;font-size:11px;color:var(--fg3)}</style>
