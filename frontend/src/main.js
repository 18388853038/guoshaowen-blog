import { createApp, reactive } from 'vue'
import { t as __t, setLang as __setLang, getLang as __getLang, i18n } from './i18n.js'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './assets/style.css'
export const API = reactive({
  base: '',
  token: localStorage.getItem('token') || '',
  get(path) {
    return fetch(this.base + path, {
      headers: this.token ? { Authorization: 'Bearer ' + this.token } : {}
    }).then(r => r.json())
  },
  post(path, data) {
    return fetch(this.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
      body: JSON.stringify(data)
    }).then(r => r.json())
  },
  put(path, data) {
    return fetch(this.base + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
      body: JSON.stringify(data)
    }).then(r => r.json())
  },
  del(path) {
    return fetch(this.base + path, {
      method: 'DELETE',
      headers: this.token ? { Authorization: 'Bearer ' + this.token } : {}
    }).then(r => r.json())
  },
  setToken(t) {
    this.token = t
    if (t) localStorage.setItem('token', t)
    else localStorage.removeItem('token')
  }
})
window.API = API
const routes = [
  { path: '/', redirect: '/login' },
  { path: '/login', component: () => import('./views/Login.vue') },
  { path: '/setup', component: () => import('./views/Setup.vue') },
  { path: '/chat', component: () => import('./views/Chat.vue'), meta: { auth: true } },
  { path: '/skills', component: () => import('./views/SkillsPage.vue'), meta: { auth: true } },
  { path: '/memory', component: () => import('./views/MemoryPage.vue'), meta: { auth: true } },
  { path: '/channels', component: () => import('./views/ChannelsPage.vue'), meta: { auth: true } },
  { path: '/auto-evolution', component: () => import('./views/AutoEvolutionPage.vue'), meta: { auth: true } },
  { path: '/dashboard', component: () => import('./views/DashboardPage.vue'), meta: { auth: true } },
  { path: '/loop-engine', component: () => import('./views/LoopPage.vue'), meta: { auth: true } },
  { path: '/scheduler', component: () => import('./views/SchedulerPage.vue'), meta: { auth: true } },
  { path: '/heartbeat', component: () => import('./views/HeartbeatPage.vue'), meta: { auth: true } },
  { path: '/profile', component: () => import('./views/Profile.vue'), meta: { auth: true } },
  { path: '/files', component: () => import('./views/Files.vue'), meta: { auth: true } },
  { path: '/harness', component: () => import('./views/Harness.vue'), meta: { auth: true } },
  { path: '/settings', component: () => import('./views/Settings.vue'), meta: { auth: true } },
  { path: '/boundary', component: () => import('./views/Boundary.vue'), meta: { auth: true } },
]
const router = createRouter({ history: createWebHistory(), routes })
import { translateDOM } from './i18n.js'
router.afterEach(function() { setTimeout(translateDOM, 300); });
// First-run redirect: check setup status
var _setupChecked = false;
var _tokenValidated = false;
router.beforeEach(function(to, from, next) {
  // Public paths: always allow
  if (to.path === '/setup' || to.path === '/login') { next(); return; }
  // No token at all: redirect to login
  if (!API.token) { next('/login'); return; }
  // Validate token with server on first navigation
  if (!_tokenValidated) {
    _tokenValidated = true;
    fetch(API.base + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + API.token }
    }).then(function(r) {
      if (r.ok) {
        // Token valid, proceed with setup check
        return fetch(API.base + '/api/setup/status').then(function(r2) { return r2.json(); });
      } else {
        // Token invalid, clear and redirect to login
        API.setToken('');
        next('/login');
        throw new Error('token invalid');
      }
    }).then(function(d) {
      if (d && d.ok && !d.configured) { next('/setup'); } else { next(); }
    }).catch(function() { next(); });
    return;
  }
  next();
});
const app = createApp(App)
const __map = {
  navLogout:'nav.logout',navCore:'nav.core',navSystem:'nav.system',
  appSub:'app.sub',appVersion:'app.version',
  chatSend:'chat.send',chatPlaceholder:'chat.placeholder',chatThinking:'chat.thinking',chatSelectAgent:'chat.selectAgent',
  chatSearch:'chat.search',chatNoMatch:'chat.noMatch',chatUploadFile:'chat.uploadFile',chatVoiceInput:'chat.voiceInput',
  chatActivity:'chat.activity',chatCollapse:'chat.collapse',chatWaitingActivity:'chat.waitingActivity',chatStopRecording:'chat.stopRecording',chatFileUnit:'chat.fileUnit',
  setupTitle:'setup.title',setupWelcome:'setup.welcome',setupDesc:'setup.desc',setupStep1:'setup.step1',
  setupStep2:'setup.step2',setupStep3:'setup.step3',setupStep4:'setup.step4',setupNext:'setup.next',setupPrev:'setup.prev',
  setupFinish:'setup.finish',setupConfigureProvider:'setup.configureProvider',setupEnterApiKey:'setup.enterApiKey',
  setupEnterName:'setup.enterName',setupEnterTitle:'setup.enterTitle',setupEnterEmail:'setup.enterEmail',
  setupSetupComplete:'setup.setupComplete',setupGotoDashboard:'setup.gotoDashboard',setupStartChat:'setup.startChat',
  setupBrowseEmployees:'setup.browseEmployees',setupFeature1:'setup.feature1',setupFeature2:'setup.feature2',
  setupFeature3:'setup.feature3',setupFeature4:'setup.feature4',
  loading:'common.loading',status:'common.status',all:'common.all',search:'common.search',
  name:'common.name',online:'common.online',offline:'common.offline',commonSave:'common.save',
  noActivity:'common.noActivity',
  // Dashboard
  dashTitle:'dashboard.title',dashDesc:'dashboard.desc',dashLoadError:'message.error',
  // Login
  loginMorning:'time.morning',loginNoon:'time.noon',loginEvening:'time.evening',loginLateNight:'time.night',loginTokenInvalid:'auth.token',loginSub:'app.description',
  // Skills
  skillsTitle:'skills.title',skillsDesc:'skills.desc',skillsRefresh:'common.refresh',skillsEmployeeHeader:'skills.employee',skillsTotalCount:'dashboard.total',skillsUnit:'dashboard.unit',skillsOpenclawHeader:'skills.openclaw',skillsAvailableUnit:'skills.available',skillsToggleOn:'skills.enabled',skillsToggleOff:'skills.disabled',skillsNoResult:'common.noMatch',skillsSearchPlaceholder:'common.search',skillsOpFail:'message.error',
  // Auto Evolution
  autoEvoTitle:'autoEvo.title',autoEvoDesc:'autoEvo.desc',autoEvoRunning:'autoEvo.running',autoEvoRunOnce:'autoEvo.runOnce',autoEvoStats:'autoEvo.stats',autoEvoTotalCycles:'autoEvo.totalCycles',autoEvoIssuesFound:'autoEvo.issuesFound',autoEvoFixed:'autoEvo.fixed',autoEvoPromoted:'autoEvo.promoted',autoEvoFixRate:'autoEvo.fixRate',autoEvoCleanCycles:'autoEvo.cleanCycles',autoEvoRecentResults:'autoEvo.recentResults',autoEvoRecentRecords:'autoEvo.recentRecords',autoEvoNoRecords:'autoEvo.noRecords',autoEvoComplete:'autoEvo.complete',autoEvoFailed:'autoEvo.failed',autoEvoNeverRun:'autoEvo.neverRun',autoEvoJustRun:'autoEvo.justRun',autoEvoMinAgo:'autoEvo.minAgo',autoEvoStatsFail:'autoEvo.statsFail',autoEvoNetErr:'message.error',autoEvoHistoryFail:'autoEvo.historyFail',autoEvoRunFail:'autoEvo.runFail',
  // Heartbeat
  heartbeatTitle:'heartbeat.title',heartbeatDesc:'heartbeat.desc',heartbeatInterval:'heartbeat.interval',heartbeatMinutes:'heartbeat.minutes',heartbeatBeatInterval:'heartbeat.beatInterval',heartbeatMonitorStatus:'heartbeat.monitorStatus',heartbeatNoChannel:'heartbeat.noChannel',heartbeatSysStatus:'heartbeat.sysStatus',heartbeatSaveConfig:'heartbeat.saveConfig',heartbeatSaving:'heartbeat.saving',heartbeatOnline:'heartbeat.online',heartbeatOffline:'heartbeat.offline',heartbeatWaitCred:'heartbeat.waiting',heartbeatConfig:'heartbeat.config',
  // Memory
  memoryTitle:'memory.title',memoryDesc:'memory.desc',memoryCoreTab:'memory.coreTab',memoryKbTab:'memory.kbTab',memoryFilterAll:'memory.filterAll',memoryNoMatch:'common.noMatch',memoryLoading:'common.loading',memoryNewEntry:'memory.newEntry',memoryEditForm:'memory.editForm',memorySave:'memory.save',memoryCancel:'memory.cancel',memorySearchResult:'memory.searchResult',memoryEdit:'common.edit',memoryDelete:'common.delete',memoryNoKb:'memory.noKb',memoryPriorityHigh:'memory.priorityHigh',memoryPriorityMedium:'memory.priorityMedium',memoryPriorityLow:'memory.priorityLow',memoryConfirmDel:'memory.confirmDel',memoryTagsPlaceholder:'memory.tagsPlaceholder',
  // Scheduler
  schedulerTitle:'scheduler.title',schedulerDesc:'scheduler.desc',schedulerNewJob:'scheduler.newJob',schedulerRefresh:'common.refresh',schedulerCronExpr:'scheduler.cronExpr',schedulerTarget:'scheduler.target',schedulerActions:'scheduler.actions',schedulerRun:'scheduler.run',schedulerEdit:'common.edit',schedulerDelete:'common.delete',schedulerEnable:'scheduler.enable',schedulerDisable:'scheduler.disable',schedulerNoJobs:'scheduler.noJobs',schedulerHint:'scheduler.hint',schedulerHintText:'scheduler.hintText',schedulerEnabled:'scheduler.enabled',schedulerPaused:'scheduler.paused',schedulerSoon:'scheduler.soon',
  // Workflow
  workflowTitle:'workflow.title',workflowDesc:'workflow.desc',workflowNew:'workflow.new',workflowList:'workflow.list',workflowNoItems:'workflow.noItems',workflowTypeTask:'workflow.typeTask',workflowTypeParallel:'workflow.typeParallel',workflowTypeCondition:'workflow.typeCondition',workflowTypeNotify:'workflow.typeNotify',workflowValidate:'workflow.validate',workflowStart:'workflow.start',workflowNode:'workflow.node',workflowStatusDraft:'workflow.statusDraft',workflowStatusActive:'workflow.statusActive',workflowStatusRunning:'workflow.statusRunning',workflowStatusDone:'workflow.statusDone',workflowStatusFailed:'workflow.statusFailed',workflowNewName:'workflow.newName',workflowConfirmDel:'workflow.confirmDel',workflowStarted:'workflow.started',workflowExecFail:'workflow.execFail',workflowSave:'workflow.save',workflowSaveFail:'workflow.saveFail',
  // Channels
  channelsTitle:'channels.title',channelsDesc:'channels.desc',channelsWechat:'channels.wechat',channelsFeishu:'channels.feishu',channelsWecom:'channels.wecom',channelsPersonalWx:'channels.personalWx',channelsConnect:'channels.connect',channelsConfig:'channels.config',channelsUnknownErr:'message.error',channelsBuiltin:'channels.builtin',channelsApiInterface:'channels.apiInterface',channelsQrDesc:'channels.qrDesc',channelsQqQrDesc:'channels.qqQrDesc',channelsDisconnect:'channels.disconnect',channelsConnecting:'channels.connecting',
  online:'common.online',};

// Reactive language version - force re-render on change

var langVer = reactive({ v: 0 });
__onLangChange(function() { langVer.v++; });
app.config.globalProperties.__ = function(k) { langVer.v; var mk = __map[k] || k; return __t(mk); }
app.config.globalProperties.__lang = __getLang
app.config.globalProperties.__setLang = __setLang
app.config.globalProperties.__translate = __translate

// Translation plugin: auto-scan DOM on language change
import { translateDOM as __translate, onLangChange as __onLangChange } from './i18n.js'
__onLangChange(function() { setTimeout(__translate, 100); })
app.use(i18n).use(router); /* installLangMixin inline */
(function(app) {
  const __onLangChange = (function() {
    var listeners = [];
    var _currentLang = 'zh-CN';
    if (typeof localStorage !== 'undefined') {
      try { var ls = localStorage.getItem('ecompany_lang'); if (ls) _currentLang = ls; } catch(e) {}
    }
    function notify(v) { listeners.forEach(function(fn) { try { fn(v); } catch(e) {} }); }
    return { addListener: function(fn) { listeners.push(fn); return function() { listeners = listeners.filter(function(f) { return f !== fn; }); }; }, setLang: function(v) { _currentLang = v; try { if (typeof localStorage !== 'undefined') localStorage.setItem('ecompany_lang', v); } catch(e) {} __setLang(v); i18n.global.locale.value = v; notify(v); }, getLang: function() { return _currentLang; } };
  })();
  window.__localLang = __onLangChange;
  var langVer = { v: 0 };
  __onLangChange.addListener(function() { langVer.v++; });
  app.mixin({
    data: function() { return { __i18nVer: 0 }; },
    created: function() {
      var self = this;
      this.__disposeI18n = __onLangChange.addListener(function() { self.__i18nVer++; });
    },
    beforeUnmount: function() {
      if (this.__disposeI18n) this.__disposeI18n();
    },
    computed: {
      __i18nDep: function() { return this.__i18nVer; }
    },
    methods: {
      __: function(k) { this.__i18nDep; var r = typeof __t === 'function' ? __t(k) : k; console.log('[I18N] __("'+k+'") = "'+r+'" locale='+window.__localLang.getLang()); return r; }
    }
  });
})(app);; app.mount('#app')
