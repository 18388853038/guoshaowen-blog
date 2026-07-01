<template>
  <div class="app-layout">
    <aside class="sidebar" v-if="isLoggedIn" :class="{ collapsed: sidebarCollapsed }" @mouseenter="onSidebarEnter" @mouseleave="onSidebarLeave">
      <div class="sb-header">
        <div v-show="!sidebarCollapsed"><h1 style="font-size:14px">eCompanyClaw</h1></div>
        <button class="sidebar-toggle" @click="toggleSidebar" :title="sidebarCollapsed ? '展开导航' : '收缩导航'">
          {{ sidebarCollapsed ? '▶' : '◀' }}
        </button>
      </div>

      <div class="sb-section" v-show="!sidebarCollapsed"><span class="sb-section-title">{{ __("nav.core") }}</span></div>
      <nav class="sb-nav">
        <router-link to="/chat" class="nav-item" title="工作台">
          <span class="nav-icon">💬</span><span v-show="!sidebarCollapsed">{{ __("nav.chat") }}</span>
        </router-link>
        <router-link to="/skills" class="nav-item" title="技能系统">
          <span class="nav-icon">🎯</span><span v-show="!sidebarCollapsed">{{ __("nav.skills") }}</span>
        </router-link>
        <router-link to="/memory" class="nav-item" title="记忆中心">
          <span class="nav-icon">🧠</span><span v-show="!sidebarCollapsed">{{ __("nav.memory") }}</span>
        </router-link>
        <router-link to="/channels" class="nav-item" title="通讯渠道">
          <span class="nav-icon">📡</span><span v-show="!sidebarCollapsed">{{ __("nav.channels") }}</span>
        </router-link>
        <router-link to="/auto-evolution" class="nav-item" :title="__('nav.autoEvolution')">
          <span class="nav-icon">🧬</span><span v-show="!sidebarCollapsed">{{ __('nav.autoEvolution') }}</span>
        </router-link>
        <router-link to="/dashboard" class="nav-item" title="数据看板">
          <span class="nav-icon">📊</span><span v-show="!sidebarCollapsed">{{ __("nav.dashboard") }}</span>
        </router-link>
        <router-link to="/loop-engine" class="nav-item" :title="__('nav.loopEngine')">
          <span class="nav-icon">🔄</span><span v-show="!sidebarCollapsed">{{ __('nav.loopEngine') }}</span>
        </router-link>
        <router-link to="/scheduler" class="nav-item" title="定时任务">
          <span class="nav-icon">⏰</span><span v-show="!sidebarCollapsed">{{ __("nav.scheduler") }}</span>
        </router-link>
        <router-link to="/heartbeat" class="nav-item" title="心跳设置">
          <span class="nav-icon">❤️</span><span v-show="!sidebarCollapsed">{{ __("nav.heartbeat") }}</span>
        </router-link>
      </nav>

      <div class="sb-section" v-show="!sidebarCollapsed"><span class="sb-section-title">{{ __("nav.system") }}</span></div>
      <nav class="sb-nav">
        <router-link to="/profile" class="nav-item" :title="__('nav.profile')">
          <span class="nav-icon">👤</span><span v-show="!sidebarCollapsed">{{ __('nav.profile') }}</span>
        </router-link>
        <router-link to="/settings" class="nav-item" title="设置">
          <span class="nav-icon">⚙️</span><span v-show="!sidebarCollapsed">{{ __("nav.settings") }}</span>
        </router-link>
        <router-link to="/files" class="nav-item" title="文件">
          <span class="nav-icon">📁</span><span v-show="!sidebarCollapsed">{{ __("nav.files") }}</span>
        </router-link>
        <router-link to="/harness" class="nav-item" title="Harness 监控">
          <span class="nav-icon">🧠</span><span v-show="!sidebarCollapsed">{{ __("nav.harness") }}</span>
        </router-link>
        <router-link to="/boundary" class="nav-item" title="边界控制">
          <span class="nav-icon">🔒</span><span v-show="!sidebarCollapsed">{{ __("nav.boundary") }}</span>
        </router-link>
              </nav>

      <div class="sb-footer" v-show="!sidebarCollapsed">
        <div class="lang-bar">
          <div class="heartbeat-indicator" :title="'系统: ' + (serverStatus || '检查中...')">
            <span class="heartbeat-dot" :class="serverStatus"></span>
            <span class="heartbeat-label">{{ serverStatus === 'online' ? __('navStatusOnline') : serverStatus === 'busy' ? __('navStatusBusy') : __('navStatusChecking') }}</span>
          </div>
        </div>
        <div class="lang-bar">
          <select class="lang-select" @change="setLang($event.target.value)" :value="lang">
            <option value="zh-CN">🇨🇳 简体中文</option>
            <option value="zh-TW">🇹🇼 繁體中文</option>
            <option value="en-US">🇺🇸 English</option>
            <option value="ja-JP">🇯🇵 日本語</option>
            <option value="ko-KR">🇰🇷 한국어</option>
          </select>
        </div>
        <div class="nav-item" @click="logout" style="cursor:pointer">
          <span class="nav-icon">🚪</span><span>{{ __("nav.logout") }}</span>
        </div>
      </div>
    </aside>
    <main class="main-content">
      <router-view />
    </main>
    <!-- Global Error Toast -->
    <div v-if="errorMsg" class="error-toast" @click="errorMsg=''">
      <span>⚠️ {{ errorMsg }}</span>
      <span style="font-size:10px;margin-left:8px;opacity:0.7">{{ __("navClickClose") }}</span>
    </div>
  </div>
</template>

<script>
import { API } from './main.js'
import { translateDOM, getLang } from './i18n.js'
export default {
  data() { return { empCount: 0, lang: 'zh-CN', errorMsg: '', serverStatus: 'idle', busyCount: 0, sidebarCollapsed: false, autoCollapseTimer: null } },
  computed: {
    isLoggedIn() { return !!API.token }
  },
  methods: {
    setLang(l) { console.log('[I18N] App setLang called: input='+l); this.lang = l; var map={"en-US":"en","ja-JP":"ja","ko-KR":"ko"}; var ml=map[l]||l; console.log('[I18N] mapped lang='+ml); if (window.__localLang) { console.log('[I18N] calling __localLang.setLang...'); window.__localLang.setLang(ml); console.log('[I18N] after setLang, getLang='+window.__localLang.getLang()); } this.$nextTick(function() { translateDOM(); console.log('[I18N] translateDOM called'); }); try { API.put('/api/profile', {lang: l}); } catch(e) {} },
    logout() { API.setToken(''); this.$router.push('/login') },
    toggleSidebar() { this.sidebarCollapsed = !this.sidebarCollapsed; this.resetAutoCollapse(); },
    resetAutoCollapse() { if (this.autoCollapseTimer) { clearTimeout(this.autoCollapseTimer); this.autoCollapseTimer = null; } if (!this.sidebarCollapsed) { this.autoCollapseTimer = setTimeout(function() { this.sidebarCollapsed = true; }.bind(this), 30000); } },
    onSidebarEnter() { if (this.sidebarCollapsed) { this.sidebarCollapsed = false; this.resetAutoCollapse(); } },
    onSidebarLeave() { this.resetAutoCollapse(); }
  },
  mounted() {
    this.lang = getLang();
    if (API.token) {
      this.resetAutoCollapse();
      window.__appError = function(msg) { this.errorMsg = msg; setTimeout(function() { this.errorMsg = ''; }.bind(this), 6000); }.bind(this);
    window.addEventListener('unhandledrejection', function(e) { this.errorMsg = '请求异常: ' + (e.reason && e.reason.message ? e.reason.message : '网络错误'); }.bind(this));
    API.get('/api/agents').then(d => { if (d.total) this.empCount = d.total });
      API.get('/api/profile').then(function(d) { if (d && d.lang) { var m={"en-US":"en","ja-JP":"ja","ko-KR":"ko"}; var ml=m[d.lang]||d.lang; if (window.__localLang) window.__localLang.setLang(ml); this.lang = d.lang; translateDOM(); } }.bind(this)).catch(function() {});
    this.$nextTick(function() { translateDOM(); });
      // 系统心跳监控
      var _hb = this;
      setInterval(function() {
        fetch('/api/health').then(function(r){return r.json()}).then(function(d){
          _hb.serverStatus = (d.status === 'healthy' || d.ok) ? 'online' : 'busy';
        }).catch(function(){_hb.serverStatus='offline'});
      }, 10000);
        }
  }
}
</script>

<style scoped>
.sb-logo-img{width:28px;height:28px;border-radius:6px;object-fit:cover;flex-shrink:0;max-width:28px;max-height:28px}
.lang-bar{display:flex;align-items:center;gap:4px;padding:4px 10px;justify-content:center}
.lang-select{font-size:11px;padding:3px 6px;border-radius:4px;border:1px solid var(--border,#444);background:var(--bg2,#2a2a2a);color:var(--fg,#ccc);cursor:pointer;outline:none;width:160px;text-align:center}
.lang-select:hover{border-color:var(--accent,#4a9eff)}
.lang-select option{background:var(--bg2,#2a2a2a);color:var(--fg,#ccc)}
.error-toast{position:fixed;bottom:20px;right:20px;z-index:9999;background:rgba(239,68,68,0.95);color:#fff;padding:10px 16px;border-radius:8px;font-size:12px;cursor:pointer;max-width:400px;backdrop-filter:blur(8px);animation:fadeIn 0.3s}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

/* 系统心跳指示器 */
.heartbeat-indicator{display:flex;align-items:center;gap:6px;font-size:10px}
.heartbeat-dot{width:6px;height:6px;border-radius:50%;display:inline-block}
.heartbeat-dot.online{background:#10b981;box-shadow:0 0 4px rgba(16,185,129,0.5);animation:pulse-dot 2s infinite}
.heartbeat-dot.busy{background:#f59e0b;box-shadow:0 0 4px rgba(245,158,11,0.5);animation:pulse-dot 0.8s infinite}
.heartbeat-dot.offline{background:#ef4444}
.heartbeat-label{color:var(--fg3)}
@keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.5)}}

.sidebar-toggle{background:none;border:none;color:var(--fg3);font-size:14px;cursor:pointer;padding:4px 8px;border-radius:4px;transition:all 0.2s;flex-shrink:0;line-height:1}
.sidebar-toggle:hover{background:var(--bg1);color:var(--fg)}
.sidebar.collapsed{width:56px;min-width:56px}
.sidebar.collapsed .sb-header{justify-content:center;padding:12px 8px}
.sidebar.collapsed .nav-item{justify-content:center;padding:8px}
.sidebar.collapsed .sb-section-title{display:none}
</style>
