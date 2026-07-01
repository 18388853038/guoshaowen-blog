<template>
  <div class="page">
    <!-- 页面头 -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div>
        <h2 style="margin:0">⚙️ {{ __('settingsTitle') }}</h2>
        <p class="desc" style="margin:4px 0 0">{{ __('settingsDesc') }}</p>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-primary" @click="saveAll">💾 {{ __('settingsSaveConfig') }}</button>
        <button class="btn btn-ghost" @click="testConnection">🔌 {{ __('settingsTestConnection') }}</button>
        <button class="btn btn-ghost" @click="showImportExport = !showImportExport">📋 {{ __('settingsImportExport') }}</button>
      </div>
    </div>

    <!-- Toast 反馈 -->
    <div v-if="toast.show" class="toast" :class="toast.type" style="margin-bottom:12px">
      <span>{{ toast.msg }}</span>
      <button class="toast-close" @click="toast.show=false">✕</button>
    </div>

    <!-- 导入/导出 -->
    <div v-if="showImportExport" class="settings-section" style="margin-bottom:16px">
      <h3>📋 {{ __('settingsImportExportTitle') }}</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="save-btn" @click="exportConfig">📤 {{ __('settingsExportConfig') }}</button>
        <label class="save-btn" style="cursor:pointer">📥 {{ __('settingsImportConfig') }}<input type="file" accept=".json" hidden @change="importConfig" /></label>
      </div>
    </div>

    <!-- ===== 大模型配置 ===== -->
    <div class="settings-section">
      <h3>🤖 {{ __('settingsAiModel') }}</h3>
      <div class="model-config">
        <!-- 服务商选择 -->
        <div class="provider-grid">
          <div v-for="p in providerList" :key="p" class="provider-card"
            :class="providerCardClass(p)"
            @click="selectProvider(p)" :title="providerLabels[p]">
            <span class="p-icon">{{ provIcon(p) }}</span>
            <span class="p-name">{{ providerLabels[p] || p }}</span>
            <span v-if="isProviderConfigured(p)" class="p-check">✅</span>
          </div>
        </div>

        <!-- 模型选择 -->
        <div class="model-select-area" v-if="provider">
          <div class="model-search-bar">
            <input v-model="modelSearch" class="input" style="flex:1;min-width:0" :placeholder="__('settingsSearchModel')" />
            <div class="tag-filters">
              <span v-for="tag in modelFilterOptions" :key="tag"
                class="filter-tag" :class="{active:modelFilter.includes(tag)}"
                @click="toggleModelFilter(tag)">{{ tag }}</span>
              <span v-if="modelFilter.length" class="filter-tag clear" @click="modelFilter=[]">✕ {{ __('settingsClearFilter') }}</span>
            </div>
          </div>

          <div class="model-actions">
            <button class="btn btn-ghost" @click="selectAllModels" :disabled="hasAllEnabled">✅ 全选</button>
            <button class="btn btn-ghost" @click="deselectAllModels" :disabled="hasNoneEnabled">⬜ 取消全选</button>
            <span style="font-size:11px;color:var(--fg3)">{{ enabledModelCount }}/{{ modelCount }} 模型已启用</span>
          </div>
          <div class="model-grid">
            <div v-for="m in filteredModels" :key="m.id" class="model-card"
              :class="{selected:model===m.id}" @click="selectModel(m)">
              <label class="model-checkbox">
              <input type="checkbox" :checked="enabledModels[m.id]!==false" @change="toggleModel(m)" />
              </label>

              <div class="mc-header">
                <span class="mc-name">{{ m.label || m.id }}</span>
                <span v-if="isDefaultModel(m.id)" class="mc-rec">{{ __('settingsRecommended') }}</span>
              </div>
              <div class="mc-tags">
                <span v-for="t in (m.tags||[])" :key="t" class="mc-tag">{{ t }}</span>
              </div>
              <div class="mc-id"><code>{{ m.id }}</code></div>
              <div v-if="(m.contextWindow||0)" class="mc-ctx">📦 {{ fmtCtx((m.contextWindow||0)) }}</div>
              <div v-if="model === m.id" class="mc-check">✓ {{ __('settingsSelected') }}</div>
            </div>
            <div v-if="!filteredModels.length && modelSearch" class="model-card add-custom">
              <div class="mc-header"><span class="mc-name">{{ __('settingsUse') }} "{{ modelSearch }}"</span></div>
              <div class="mc-tags"><span class="mc-tag" style="background:rgba(78,205,196,0.15);color:var(--accent)">{{ __('settingsCustomModel') }}</span></div>
              <button class="btn btn-ghost" @click="model=modelSearch; modelSearch=''" style="margin-top:6px">{{ __('settingsUseModel') }}</button>
            </div>
          </div>
        </div>

        <!-- API 凭据 -->
        <div class="cred-area" v-if="provider">
          <div class="cred-row">
            <span class="cred-label">{{ __('settingsApiKey') }}</span>
            <div style="flex:1;display:flex;gap:4px;align-items:center">
              <input v-model="apiKey" class="input" style="flex:1" :type="showKey?'text':'password'"
                :placeholder="__('settingsEnterKey') + ' ' + (providerLabels[provider]||provider) + ' Key'" />
              <button class="btn btn-ghost" style="flex-shrink:0;padding:4px 8px;font-size:11px" @click="showKey=!showKey">{{ showKey ? __('settingsHide') : __('settingsShow') }}</button>
              <a v-if="keyUrls[provider]" :href="keyUrls[provider]" target="_blank" class="key-link" style="flex-shrink:0">{{ __('settingsGetKey') }} ↗</a>
            </div>
          </div>
          <div class="cred-row">
            <span class="cred-label">{{ __('settingsApiBase') }}</span>
            <input v-model="apiBase" class="input" style="flex:1"
              :placeholder="apiBases[provider] || 'https://api.deepseek.com/v1/chat/completions'" />
            <button v-if="apiBase !== apiBases[provider] && apiBases[provider]" class="btn btn-ghost" style="flex-shrink:0;padding:2px 6px;font-size:10px" @click="apiBase=apiBases[provider]">重置</button>
          </div>
          <div class="cred-row">
            <span class="cred-label">{{ __('settingsTestResult') }}</span>
            <div style="flex:1;font-size:12px">
              <span v-if="lastTestResult === null" style="color:var(--fg3)">{{ __('settingsTestHint') }}</span>
              <span v-else :style="{color:lastTestResult.ok?'#22c55e':'#ef4444'}">
                {{ lastTestResult.ok ? '✅ ' + __('settingsConnectionOk') : '❌ ' + (lastTestResult.msg || __('settingsConnectionFail')) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== 轮询策略 ===== -->
    <div class="settings-section">
      <h3>🔄 {{ __('settingsMultiModelStrategy') }}</h3>
      <div class="strategy-grid">
        <div v-for="s in strategies" :key="s.id" class="strategy-card"
          :class="{active:rotationMode===s.id}" @click="rotationMode=s.id">
          <div class="s-icon">{{ s.icon }}</div>
          <div class="s-name">{{ s.name }}</div>
          <div class="s-desc">{{ s.desc }}</div>
        </div>
      </div>
      <div v-if="rotationMode==='fallback' || rotationMode==='roundrobin'" class="backup-models">
        <div style="font-size:12px;color:var(--fg2);margin-bottom:6px">{{ __('settingsBackupModels') }}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
          <span v-for="(m,i) in backupModels" :key="i" class="backup-tag">
            {{ m }} <span class="backup-del" @click="backupModels.splice(i,1)">✕</span>
          </span>
          <input v-model="newBackupModel" @keydown.enter.prevent="addBackupModel"
            :placeholder="__('settingsAddBackupModel')" class="backup-input" />
        </div>
      </div>
    </div>

    <!-- ===== Provider Key 管理 ===== -->
    <div class="settings-section">
      <h3>🔑 {{ __('settingsProviderKeyManagement') }}</h3>
      <div class="pk-grid">
        <div v-for="(val,key) in providerKeys" :key="key" class="pk-row">
          <span class="pk-icon">{{ provIcon(key) }}</span>
          <span class="pk-label">{{ providerLabels[key] || key }}</span>
          <input v-model="providerKeys[key]" class="input" style="flex:1;min-width:0" type="password"
            :placeholder="__('settingsEnterKey') + ' ' + key + ' Key'" />
          <span class="pk-status" :class="{ok:val && val.length>10}">
            {{ val && val.length>10 ? '✅' : '⏳' }}
          </span>
        </div>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px">
        <button class="save-btn" @click="saveProviderKeys">💾 {{ __('settingsSaveAllKeys') }}</button>
        <button class="btn btn-ghost" @click="loadProviderKeys">🔄 {{ __('settingsRefreshStatus') }}</button>
      </div>
    </div>

    <!-- ===== 恢复出厂设置 ===== -->
    <div class="settings-section" style="border-color:rgba(239,68,68,0.3)">
      <h3 style="color:#ef4444">⚠️ {{ __('settingsDangerAction') }}</h3>
      <p style="font-size:12px;color:var(--fg3);margin:0 0 10px">{{ __('settingsResetWarning') }}</p>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button class="reset-btn" @click="confirmReset" :disabled="resetting">{{ resetting ? __('settingsResetting') : '🧹 ' + __('settingsResetFactory') }}</button>
        <div v-if="showResetConfirm" style="display:flex;gap:6px;align-items:center">
          <input v-model="resetConfirmText" :placeholder="__('settingsResetConfirmHint')" class="input" style="width:130px" />
          <button class="reset-btn-exec" :disabled="resetConfirmText!==__('settingsResetConfirmKeyword')" @click="executeReset">{{ __('settingsResetExecute') }}</button>
          <button class="save-btn" @click="showResetConfirm=false;resetConfirmText=''">{{ __('settingsCancel') }}</button>
        </div>
      </div>
      <div v-if="resetMsg" style="margin-top:8px;font-size:12px" :style="{color:resetOk?'#22c55e':'#ef4444'}">{{ resetMsg }}</div>
    </div>
  </div>
</template>

<script>
import { API } from '../main.js'

export default {
  data() {
    return {
      provider: (localStorage.getItem('ecompany_provider') || 'deepseek'), model: (localStorage.getItem('ecompany_model') || ''), apiKey: '', apiBase: '',
      showKey: false, lastTestResult: null,
      modelSearch: '', modelFilter: [],
      providerModels: {}, configuredProviders: {}, providerDefaults: {}, enabledModels: {},
      providerList: ['deepseek','openai','claude','gemini','openrouter','moonshot','tongyi','zhipu','siliconflow','baichuan','minimax','doubao','step','custom','hunyuan','ernie','yi'],
      providerLabels: { deepseek:'DeepSeek', openai:'OpenAI', claude:'Anthropic Claude', gemini:'Google Gemini', openrouter:'OpenRouter', moonshot:'Moonshot', tongyi:'通义千问', zhipu:'智谱 GLM', siliconflow:'SiliconFlow', baichuan:'百川智能', minimax:'MiniMax', doubao:'豆包', step:'阶跃星辰', custom:'自定义', hunyuan:'腾讯混元', ernie:'文心一言', yi:'零一万物' },
      providerIcons: { deepseek:'🟢', openai:'🟡', claude:'🟣', gemini:'🔵', openrouter:'🟠', moonshot:'🌙', tongyi:'☁️', zhipu:'🔮', siliconflow:'💎', baichuan:'🌊', minimax:'🎯', doubao:'🫘', step:'🚀', custom:'🔧', hunyuan:'🌊' },
      keyUrls: { deepseek:'https://platform.deepseek.com/api_keys', openai:'https://platform.openai.com/api-keys', claude:'https://console.anthropic.com/settings/keys', gemini:'https://aistudio.google.com/app/apikey', openrouter:'https://openrouter.ai/keys', moonshot:'https://platform.moonshot.cn/console/api-keys', tongyi:'https://dashscope.aliyun.com/', zhipu:'https://open.bigmodel.cn/usercenter/apikeys', siliconflow:'https://cloud.siliconflow.cn/', baichuan:'https://platform.baichuan-ai.com/', minimax:'https://platform.minimaxi.com/', doubao:'https://console.volcengine.com/ark/', step:'https://platform.stepfun.com/', custom:'', hunyuan:'https://console.cloud.tencent.com/cam/capi', ernie:'https://console.bce.baidu.com/', yi:'https://platform.01.ai/' },
      apiBases: { deepseek:'https://api.deepseek.com/v1/chat/completions', openai:'https://api.openai.com/v1/chat/completions', claude:'https://api.anthropic.com/v1/messages', gemini:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', openrouter:'https://openrouter.ai/api/v1/chat/completions', moonshot:'https://api.moonshot.cn/v1/chat/completions', tongyi:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', zhipu:'https://open.bigmodel.cn/api/paas/v4/chat/completions', siliconflow:'https://api.siliconflow.cn/v1/chat/completions', baichuan:'https://api.baichuan-ai.com/v1/chat/completions', minimax:'https://api.minimaxi.com/v1/text/chatcompletion', doubao:'https://ark.cn-beijing.volces.com/api/v3/chat/completions', step:'https://api.stepfun.com/v1/chat/completions', custom:'http://localhost:11434/v1/chat/completions', hunyuan:'https://api.hunyuan.cloud.tencent.com/v1/chat/completions', ernie:'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions', yi:'https://api.01.ai/v1/chat/completions' },
      rotationMode: 'fixed', backupModels: [], newBackupModel: '',
      providerKeys: {}, providerKeysLoaded: false,
      providerListAll: ['deepseek','openai','claude','gemini','openrouter','moonshot','tongyi','zhipu','siliconflow','baichuan','minimax','doubao','step','custom','hunyuan','ernie','yi','groq'],
      toast: { show: false, msg: '', type: 'success' },
      showImportExport: false,
      // 恢复出厂设置
      showResetConfirm: false,
      resetConfirmText: '',
      resetting: false,
      resetMsg: '',
      resetOk: false
    }
  },
  computed: {
    filteredModels() {
      let list = (this.providerModels || {})[this.provider] || []
      if (this.modelSearch) {
        const q = this.modelSearch.toLowerCase()
        list = list.filter(function(m) { return (m.id||'').toLowerCase().includes(q) || (m.label||'').toLowerCase().includes(q) })
      }
      if (this.modelFilter && this.modelFilter.length) {
        list = list.filter(function(m) { return this.modelFilter.every(function(t) { return (m.tags||[]).includes(t) }) }.bind(this))
      }
      return list
    },
    strategies() {
      return [
        { id:'fixed', icon:'🎯', name:this.__('strategyFixed'), desc:this.__('strategyFixedDesc') },
        { id:'fallback', icon:'🔄', name:this.__('strategyFallback'), desc:this.__('strategyFallbackDesc') },
        { id:'roundrobin', icon:'🔁', name:this.__('strategyRoundrobin'), desc:this.__('strategyRoundrobinDesc') },
        { id:'smart', icon:'🧠', name:this.__('strategySmart'), desc:this.__('strategySmartDesc') }
      ]
  },
  hasAllEnabled: function() {
    var models = (this.providerModels && this.providerModels[this.provider]) || [];
    if (!models.length) return false;
    return models.every(function(m) { return !m.hidden && this.enabledModels[m.id] !== false }.bind(this))
  },
  hasNoneEnabled: function() {
    var models = (this.providerModels && this.providerModels[this.provider]) || [];
    if (!models.length) return true;
    return models.every(function(m) { return this.enabledModels[m.id] === false }.bind(this))
  },
  enabledModelCount: function() {
    var models = (this.providerModels && this.providerModels[this.provider]) || [];
    return models.filter(function(m) { return this.enabledModels[m.id] !== false }.bind(this)).length;
  },
  modelCount: function() {
    return ((this.providerModels && this.providerModels[this.provider]) || []).length;
  }
  },
  methods: {
    /* === Safe getters === */
    providerCardClass(p) { return { active: this.provider === p, configured: !!(this.configuredProviders && this.configuredProviders[p]) } },
    provIcon(p) { return (this.providerIcons || {})[p] || '🤖' },
    isProviderConfigured(p) { return !!(this.configuredProviders && this.configuredProviders[p]) },
    isDefaultModel(id) { return !!(this.providerDefaults && this.providerDefaults[this.provider] === id) },
    /* === Toast === */
    showToast(msg, type) { this.toast = { show: true, msg, type: type||'success' }; setTimeout(() => this.toast.show = false, 3000) },
    /* === 提供商/模型 === */

  /* === 模型启用控制 === */
  toggleModel(m) {
    if (!m || !m.id) return;
    if (!this.enabledModels) this.enabledModels = {};
    var cur = this.enabledModels[m.id];
    this.enabledModels[m.id] = cur === false ? true : false;
    this.saveEnabledModels();
  },
  selectModel(m) {
    if (!m || !m.id) return;
    this.model = m.id;
    this.modelSearch = '';
    try { localStorage.setItem('ecompany_model', m.id) } catch(e){}
    // Auto-enable selected model
    if (this.enabledModels && this.enabledModels[m.id] === false) {
      this.enabledModels[m.id] = true;
      this.saveEnabledModels();
    }
  },
  selectAllModels() {
    var models = (this.providerModels && this.providerModels[this.provider]) || [];
    var self = this;
    models.forEach(function(m) { self.enabledModels[m.id] = true });
    this.saveEnabledModels();
  },
  deselectAllModels() {
    var models = (this.providerModels && this.providerModels[this.provider]) || [];
    if (!models.length) return;
    var self = this;
    // Keep at least one enabled (the first one)
    models.forEach(function(m,i) { self.enabledModels[m.id] = i === 0 });
    this.saveEnabledModels();
  },
  loadEnabledModels() {
    try {
      var raw = localStorage.getItem('ecompany_enabled_models');
      if (raw) {
        var parsed = JSON.parse(raw);
        this.enabledModels = parsed[this.provider] || {};
      }
    } catch(e) { this.enabledModels = {} }
  },
  saveEnabledModels() {
    try {
      var key = 'ecompany_enabled_models';
      var all = JSON.parse(localStorage.getItem(key) || '{}');
      all[this.provider] = this.enabledModels || {};
      localStorage.setItem(key, JSON.stringify(all));
    } catch(e) {}
  },

    selectProvider(p) { try { localStorage.setItem('ecompany_provider', p) } catch(e){}
      this.provider = p; this.apiBase = ''; this.apiKey = (this.providerKeys || {})[p] || ''
      const models = (this.providerModels || {})[p] || []
      this.model = (this.providerDefaults || {})[p] || (models[0] && models[0].id) || ''
    this.loadEnabledModels()
    },
    toggleModelFilter(tag) {
      const i = this.modelFilter.indexOf(tag)
      i > -1 ? this.modelFilter.splice(i, 1) : this.modelFilter.push(tag)
    },
    fmtCtx(n) { return n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(0)+'K' : n + 'B' },
    /* === 加载 === */
    async loadProviderModels() {
      try {
        const d = await API.get('/api/models/providers')
        if (d && d.providers) {
          for (const k in d.providers) { if (d.providers[k].models) this.providerModels[k] = d.providers[k].models; if (d.providers[k].configured) this.configuredProviders[k] = true }
          this.loadEnabledModels()
        }
      } catch(e) { try { var lp = localStorage.getItem('ecompany_provider'); if (lp) this.provider = lp; var lm = localStorage.getItem('ecompany_model'); if (lm) this.model = lm; } catch(e2) {} }
    },
    async loadProviderDefaults() {
      try {
        const d = await API.get('/api/models/providers')
        if (d && d.providers) { const defs = {}; for (const k in d.providers) defs[k] = d.providers[k].defaultModel || k + '-default'; this.providerDefaults = defs }
      } catch(e) {}
    },
    async loadSettings() {
      try {
        const d = await API.get('/api/v4/settings/provider')
        if (d && d.ok) { this.provider = d.provider||'deepseek'; this.model = d.model||''; this.apiBase = d.apiBase||'' }
        const cfg = await API.get('/api/provider/config')
        if (cfg) { if (cfg.apiKey) this.apiKey = cfg.apiKey; if (cfg.apiBase) this.apiBase = cfg.apiBase }
      } catch(e) { try { var lp = localStorage.getItem('ecompany_provider'); if (lp) this.provider = lp; var lm = localStorage.getItem('ecompany_model'); if (lm) this.model = lm; } catch(e2) {} }
    },
    async saveAll() {
      // 统一使用新模型管理API
      const body = { key: this.provider, apiKey: '', baseUrl: this.apiBase }
      if (this.apiKey && this.apiKey.length > 10 && !this.apiKey.includes('****')) body.apiKey = this.apiKey
      // 同时保存当前选中的模型版本
      if (this.model) {
        var modelVersions = (this.providerModels && this.providerModels[this.provider]) || []
        // 使用模型启用状态（勾选框选择），确保当前选中模型至少有一个启用
        var exists = modelVersions.some(function(m) { return m.id === this.model }.bind(this))
        var hasAnyEnabled = modelVersions.some(function(m) { return this.enabledModels && this.enabledModels[m.id] !== false }.bind(this))
        body.models = modelVersions.map(function(m) {
          var en = this.enabledModels && this.enabledModels[m.id]
          // 如果没有任何模型启用则默认启用当前选中的
          if (!hasAnyEnabled && m.id === this.model) en = true
          return { id: m.id, name: m.label, tags: m.tags || ['user-configured'], enabled: en !== false, contextWindow: m.contextWindow || 0 }
        }.bind(this))
        if (!exists) {
          body.models.push({ id: this.model, name: this.providerLabels[this.provider] + ' ' + this.model, tags: ['user-configured'], enabled: true, contextWindow: 0 })
        }
      }
      const r = await API.post('/api/models/providers', body)
      // 同时保存策略配置
      try {
        await API.post('/api/models/strategy', { strategy: this.rotationMode || 'fixed', backupModels: this.backupModels || [] });
      } catch(e) {}
      if (r && r.ok) {
        this.configuredProviders[this.provider] = true
        this.showToast(this.$t('settingsSaved') || '配置已保存', 'success')
        // 刷新provider数据
        this.loadProviderModels()
      } else {
        this.showToast('⚠️ ' + (this.$t('settingsSaveFailed') || '配置保存失败'), 'warn')
      }
    },
    async saveProviderKeys() {
      try { let count = 0; for (const prov in this.providerKeys) {
        const key = this.providerKeys[prov]; if (key && key.length > 10) {
          const r = await API.post('/api/models/providers', { key: prov, apiKey: key }); if (r && r.ok) count++;
        }
      } this.showToast('✅ ' + count + ' ' + (this.$t('settingsKeysSaved') || '个密钥已保存')) } catch(e) { this.showToast('⚠️ 保存失败: ' + e.message, 'warn') }
    },
    async loadProviderKeys() {
      try {
        const r = await API.get('/api/models/providers');
        if (r && r.providers) {
          const newKeys = {}; const newCfg = {};
          // 展示所有供应商，已配置的显示掩码，未配置的留空让用户填写
          for (const k in r.providers) {
            if (r.providers[k].configured) {
              newKeys[k] = '****已配置****';
              newCfg[k] = true;
            } else {
              newKeys[k] = '';
              newCfg[k] = false;
            }
          }
          // 确保全部供应商列表都在keys对象中（即使API没返回某个供应商）
          for (const k of this.providerListAll) {
            if (!(k in newKeys)) newKeys[k] = '';
          }
          this.providerKeys = newKeys; this.configuredProviders = newCfg;
        }
        const curKey = (this.providerKeys || {})[this.provider]; if (curKey) this.apiKey = curKey;
      } catch(e) {}
    },
    async testConnection() {
      this.lastTestResult = await API.post('/api/provider/test', {
        provider: this.provider,
        model: this.model,
        apiKey: this.apiKey,
        apiBase: this.apiBase
      })
    },
    addBackupModel() { if (this.newBackupModel && !this.backupModels.includes(this.newBackupModel)) { this.backupModels.push(this.newBackupModel); this.newBackupModel = '' } },
    exportConfig() {
      const config = { provider: this.provider, model: this.model, apiBase: this.apiBase, rotationMode: this.rotationMode, backupModels: this.backupModels }
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ecompany-settings.json'; a.click()
      this.showToast(__('settingsExported'), 'success')
    },
    importConfig(e) {
      const file = e.target.files[0]; if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try { const cfg = JSON.parse(ev.target.result); if (cfg.provider) this.provider = cfg.provider; if (cfg.model) this.model = cfg.model; if (cfg.apiBase) this.apiBase = cfg.apiBase; if (cfg.rotationMode) this.rotationMode = cfg.rotationMode; if (cfg.backupModels) this.backupModels = cfg.backupModels; this.showToast(__('settingsImportedHint'), 'success') } catch(e) { this.showToast('⚠️ 导入失败: 无效的配置文件', 'warn') }
      }
      reader.readAsText(file)
    },

    // === 恢复出厂设置 ===
    confirmReset() {
      this.showResetConfirm = true;
      this.resetConfirmText = '';
      this.resetMsg = '';
    },
    async executeReset() {
      if (this.resetConfirmText !== __('settingsResetConfirmKeyword')) return;
      this.resetting = true;
      this.resetMsg = '';
      try {
        var r = await fetch('/api/system/reset-factory', { method: 'POST' });
        var d = await r.json();
        if (d.ok) {
          this.resetMsg = d.message || ('✅ ' + __('settingsResetStarted'));
          this.resetOk = true;
          // 轮询检测服务器就绪后再刷新，避免 404/白屏
          var pollTimer = setInterval(function() {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/health', true);
            xhr.timeout = 3000;
            xhr.onload = function() {
              if (xhr.status === 200) {
                clearInterval(pollTimer);
                // 标记需要自动回焦，Chat.vue mounted 时主动 focus
                sessionStorage.setItem('restoreFactoryDone', '1');
                location.reload();
              }
            };
            xhr.onerror = function() {};  // 忽略，继续轮询
            xhr.send();
          }, 1500);
          // 最坏情况兜底：15 秒后无论如何刷新
          setTimeout(function() {
            clearInterval(pollTimer);
            location.reload();
          }, 15000);
        } else {
          this.resetMsg = '❌ ' + (d.error || __('settingsResetFailed'));
          this.resetOk = false;
        }
      } catch(e) {
        this.resetMsg = '❌ ' + __('settingsResetNetError') + ': ' + e.message;
        this.resetOk = false;
      }
      this.resetting = false;
    }
  },
  mounted() {
    this.loadSettings(); this.loadProviderModels(); this.loadProviderDefaults(); this.loadProviderKeys()
  },
  watch: {
    provider(p) {
      var savedKey = (this.providerKeys || {})[p];
      if (savedKey && savedKey.length > 4) this.apiKey = savedKey;
    }
  }
}
</script>

<style scoped>
/* === Provider Grid === */
.provider-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 6px; margin-bottom: 16px; }
.provider-card { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 6px; border-radius: 8px; border: 1px solid var(--border); background: rgba(255,255,255,0.02); cursor: pointer; transition: all 0.12s; position: relative; }
.provider-card:hover { border-color: rgba(78,205,196,0.3); background: rgba(78,205,196,0.03); }
.provider-card.active { border-color: var(--accent); background: rgba(78,205,196,0.06); }
.provider-card.configured { border-color: rgba(34,197,94,0.3); }
.provider-card.configured.active { border-color: var(--accent); }
.p-icon { font-size: 20px; }
.p-name { font-size: 10px; color: var(--fg); text-align: center; line-height: 1.2; }
.p-check { position: absolute; top: 2px; right: 4px; font-size: 10px; }

/* === Model Select === */
.model-select-area { margin-bottom: 16px; }
.model-search-bar { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.tag-filters { display: flex; gap: 4px; flex-wrap: wrap; }
.filter-tag { padding: 3px 8px; border-radius: 12px; font-size: 10px; background: rgba(255,255,255,0.04); border: 1px solid transparent; color: var(--fg2); cursor: pointer; transition: all 0.12s; }
.filter-tag:hover { border-color: rgba(78,205,196,0.3); color: var(--fg); }
.filter-tag.active { background: rgba(78,205,196,0.12); color: var(--accent); border-color: var(--accent); }
.filter-tag.clear { color: #ef4444; }
.filter-tag.clear:hover { border-color: rgba(239,68,68,0.3); }
.model-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; max-height: 320px; overflow-y: auto; padding: 2px; }
.model-card { padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(255,255,255,0.02); cursor: pointer; transition: all 0.12s; position: relative; }
.model-card:hover { border-color: rgba(78,205,196,0.3); background: rgba(78,205,196,0.03); }
.model-card.selected { border-color: var(--accent); background: rgba(78,205,196,0.06); }
.model-card.add-custom { border-style: dashed; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.mc-header { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.mc-name { font-size: 12px; color: #fff; font-weight: 500; }
.mc-rec { font-size: 9px; padding: 1px 5px; border-radius: 8px; background: rgba(234,179,8,0.15); color: #eab308; }
.mc-tags { display: flex; gap: 3px; flex-wrap: wrap; margin-bottom: 4px; }
.mc-tag { font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(59,130,246,0.12); color: #60a5fa; }
.mc-id { font-size: 10px; color: var(--fg3); margin-bottom: 2px; }
.mc-id code { font-size: 9px; }
.mc-ctx { font-size: 10px; color: var(--fg2); }
.mc-check { position: absolute; top: 6px; right: 8px; font-size: 11px; color: var(--accent); font-weight: 600; }

/* === Credentials === */
.cred-area { border-top: 1px solid var(--border); padding-top: 12px; }
.cred-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.cred-label { font-size: 12px; color: var(--fg2); min-width: 70px; flex-shrink: 0; }
.cred-row .input { padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--fg); font-size: 13px; outline: none; }
.cred-row .input:focus { border-color: var(--accent); }
.key-link { font-size: 11px; color: #3b82f6; text-decoration: none; }
.key-link:hover { text-decoration: underline; }

/* === Strategy Cards === */
.strategy-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-bottom: 12px; }
.strategy-card { padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: rgba(255,255,255,0.02); cursor: pointer; transition: all 0.12s; }
.strategy-card:hover { border-color: rgba(78,205,196,0.3); }
.strategy-card.active { border-color: var(--accent); background: rgba(78,205,196,0.06); }
.s-icon { font-size: 24px; margin-bottom: 4px; }
.s-name { font-size: 13px; color: #fff; font-weight: 500; margin-bottom: 2px; }
.s-desc { font-size: 10px; color: var(--fg3); line-height: 1.3; }
.backup-models { padding: 10px; background: rgba(255,255,255,0.02); border-radius: 6px; }
.backup-tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: rgba(255,255,255,0.06); border-radius: 4px; font-size: 12px; }
.backup-del { cursor: pointer; color: #ef4444; font-size: 11px; }
.backup-input { width: 150px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: rgba(255,255,255,0.03); color: var(--fg); font-size: 12px; outline: none; }

/* === Provider Keys === */
.pk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pk-row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: rgba(255,255,255,0.02); }
.pk-icon { font-size: 16px; flex-shrink: 0; }
.pk-label { font-size: 11px; color: var(--fg2); min-width: 60px; flex-shrink: 0; }
.pk-row .input { padding: 5px 8px; border-radius: 4px; border: none; background: rgba(255,255,255,0.03); color: var(--fg); font-size: 11px; outline: none; }
.pk-status { font-size: 12px; flex-shrink: 0; }

/* === Toast === */
.toast { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-radius: 8px; font-size: 13px; animation: slideIn 0.2s ease; }
.toast.success { background: rgba(34,197,94,0.1); color: #22c55e; border: 1px solid rgba(34,197,94,0.2); }
.toast.warn { background: rgba(234,179,8,0.1); color: #eab308; border: 1px solid rgba(234,179,8,0.2); }
.toast-close { background: none; border: none; color: inherit; cursor: pointer; opacity: 0.6; font-size: 14px; }
.toast-close:hover { opacity: 1; }
@keyframes slideIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }

.save-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--fg2); font-size: 12px; cursor: pointer; transition: all 0.12s; }
.save-btn:hover { border-color: var(--accent); color: var(--accent); background: rgba(78,205,196,0.04); }
.reset-btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #ef4444; background: transparent; color: #ef4444; font-size: 12px; cursor: pointer; transition: all 0.12s; }
.reset-btn:hover { background: rgba(239,68,68,0.08); }
.reset-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.reset-btn-exec { padding: 8px 16px; border-radius: 6px; border: 1px solid #dc2626; background: #dc2626; color: #fff; font-size: 12px; cursor: pointer; transition: all 0.12s; }
.reset-btn-exec:hover { background: #b91c1c; }
.reset-btn-exec:disabled { opacity: 0.4; cursor: not-allowed; background: #6b7280; border-color: #6b7280; }

/* 模型版本选择 */
.model-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; padding: 6px 8px; background: var(--bg2); border-radius: 8px; }
.model-actions button { font-size: 11px; padding: 3px 8px; }
.model-checkbox { display: flex; align-items: center; padding: 2px 0; cursor: pointer; }
.model-checkbox input { width: 14px; height: 14px; cursor: pointer; accent-color: var(--accent); }
.model-card .mc-header { margin-left: 4px; }
</style>
