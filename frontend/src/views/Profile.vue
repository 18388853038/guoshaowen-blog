<template>
  <div class="page">
    <!-- 页面标题 -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div>
        <h2 style="margin:0">{{ __('profileTitle') }}</h2>
        <p class="desc" style="margin:4px 0 0">{{ __('profileDesc') }}</p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" @click="saveProfile" :disabled="saving">
          {{ saving ? __('profileSaving') : __('profileSave') }}
        </button>
      </div>
    </div>

    <!-- 保存反馈 -->
    <div v-if="saveMsg" class="save-toast" :class="{error: saveError}" style="margin-bottom:12px">
      {{ saveMsg }}
    </div>

    <!-- 个人资料卡片 -->
    <div class="settings-section profile-header-card">
      <div class="profile-header">
        <div class="profile-avatar">
          <span class="avatar-icon">{{ profile.icon || '👤' }}</span>
        </div>
        <div class="profile-info">
          <h2>{{ __('profileAdmin') }}</h2>
          <div class="profile-title">{{ __('profileTitle') }}</div>
          <div class="profile-badge-row">
            <span class="badge status-online">🟢 {{ __('online') }}</span>
            <span class="badge">{{ __('profileAdmin') }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 个人信息 -->
    <div class="settings-section">
      <h3>{{ __('profileInfo') }}</h3>
      <div class="form-grid">
        <div class="form-field">
          <label>{{ __('profileIcon') }}</label>
          <div style="display:flex;align-items:center;gap:8px">
            <input v-model="profile.icon" class="input" style="flex:1;font-size:20px" placeholder="👤" maxlength="4" />
            <span style="font-size:10px;color:var(--fg3)">{{ __('profileEmojiHint') }}</span>
          </div>
        </div>
        <div class="form-field">
          <label>{{ __('profileName') }}</label>
          <input v-model="profile.name" class="input" :placeholder="__('profileAdmin')" />
        </div>
        <div class="form-field">
          <label>{{ __('profileNameEn') }}</label>
          <input v-model="profile.name_en" class="input" placeholder="Admin" />
        </div>
        <div class="form-field">
          <label>{{ __('profileTitle2') }}</label>
          <input v-model="profile.title" class="input" :placeholder="__('profileTitle')" />
        </div>
        <div class="form-field" style="grid-column: 1 / -1">
          <label>{{ __('profileBio') }}</label>
          <textarea v-model="profile.bio" class="input" rows="3" :placeholder="__('profileBioPlaceholder')" style="resize:vertical;font-size:13px;padding:10px;line-height:1.5"></textarea>
        </div>
      </div>
    </div>

    <!-- 联系方式 -->
    <div class="settings-section">
      <h3>{{ __('profileContact') }}</h3>
      <div class="form-grid">
        <div class="form-field">
          <label>{{ __('profileEmail') }}</label>
          <input v-model="profile.email" class="input" type="email" placeholder="admin@example.com" />
        </div>
        <div class="form-field">
          <label>{{ __('profilePhone') }}</label>
          <input v-model="profile.phone" class="input" type="tel" placeholder="138-0000-0000" />
        </div>
      </div>
    </div>

    <!-- 偏好设置 -->
    <div class="settings-section">
      <h3>{{ __('profilePreferences') }}</h3>
      <div class="form-grid">
        <div class="form-field">
          <label>{{ __('profileTheme') }}</label>
          <select v-model="profile.theme" class="input" @change="applyTheme">
            <option value="dark">{{ __('profileThemeDark') }}</option>
            <option value="light">{{ __('profileThemeLight') }}</option>
            <option value="auto">{{ __('profileThemeAuto') }}</option>
          </select>
        </div>
        <div class="form-field">
          <label>{{ __('profileLanguage') }}</label>
          <select v-model="profile.lang" class="input" @change="applyLang">
            <option value="zh-CN">{{ __('profileLangZh') }}</option>
            <option value="en">{{ __('profileLangEn') }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 账户信息 -->
    <div class="settings-section">
      <h3>{{ __('profileAccountInfo') }}</h3>
      <div class="health-grid">
        <div class="health-item">
          <div class="lbl">{{ __('profileTitle2') }}</div>
          <div class="val" style="font-size:14px;color:var(--fg)">{{ __('profileAdminFull') }}</div>
        </div>
        <div class="health-item">
          <div class="lbl">{{ __('profileCreatedAt') }}</div>
          <div class="val" style="font-size:13px;color:var(--fg)">{{ formatDate(profile.createdAt) }}</div>
        </div>
        <div class="health-item">
          <div class="lbl">{{ __('profileSystemName') }}</div>
          <div class="val" style="font-size:13px;color:var(--fg)">ECompany Asst v2.0</div>
        </div>
        <div class="health-item">
          <div class="lbl">{{ __('profileLicenseStatus') }}</div>
          <div class="val" style="font-size:13px;color:#22c55e">{{ __('profileLicenseLocal') }}</div>
        </div>
      </div>
    </div>

    <!-- 开发者公众号 -->
    <div class="settings-section">
      <h3>{{ __('profileDevAccount') }}</h3>
      <div class="qr-section">
        <div class="qr-placeholder">
          <div class="qr-code-box qr-img-box">
            <img src="/qrcode.jpg" alt="QR Code" class="qr-img" />
          </div>
        </div>
        <div class="qr-info">
          <div class="qr-title">eCompany - Claw</div>
          <p>{{ __('profileDevAccountDesc') }}</p>
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
      profile: {
        name: '管理员',
        name_en: 'Admin',
        title: '系统运营者',
        icon: '👤',
        email: '',
        phone: '',
        bio: 'eCompany 系统管理员',
        theme: 'dark',
        lang: 'zh-CN'
      },
      saving: false,
      saveMsg: '',
      saveError: false,
      currentLang: 'zh-CN'
    }
  },
  methods: {
    applyLang() {
      this.currentLang = this.profile.lang || 'zh-CN'
    },
    applyTheme() {
      const theme = this.profile.theme || 'dark'
      if (theme === 'light') {
        document.documentElement.style.setProperty('--bg', '#f0f0f0')
        document.documentElement.style.setProperty('--bg2', '#ffffff')
        document.documentElement.style.setProperty('--fg', '#1a1a2e')
        document.documentElement.style.setProperty('--fg2', '#555')
        document.documentElement.style.setProperty('--border', 'rgba(0,0,0,0.08)')
      } else {
        document.documentElement.style.setProperty('--bg', '#0f0c29')
        document.documentElement.style.setProperty('--bg2', '#1a1740')
        document.documentElement.style.setProperty('--fg', '#e0e0e0')
        document.documentElement.style.setProperty('--fg2', '#8892b0')
        document.documentElement.style.setProperty('--border', 'rgba(255,255,255,0.06)')
      }
    },
    loadProfile() {
      API.get('/api/profile').then(data => {
        if (data && data.name) {
          this.profile = data
          this.currentLang = data.lang || 'zh-CN'
          if (data.theme) this.applyTheme()
        }
      }).catch(() => {})
    },
    saveProfile() {
      this.saving = true
      this.saveMsg = ''
      this.saveError = false
      API.put('/api/profile', this.profile).then(data => {
        if (data && data.profile) {
          this.profile = data.profile
          this.saveMsg = '✅ ' + __('profileSaved')
          this.saveError = false
        } else if (data && data.error) {
          this.saveMsg = data.error
          this.saveError = true
        } else {
          this.saveMsg = __('saveErrorRetry')
          this.saveError = true
        }
      }).catch(e => {
        this.saveMsg = __('commonNetworkError')
        this.saveError = true
      }).finally(() => {
        this.saving = false
        setTimeout(() => { this.saveMsg = '' }, 3000)
      })
    },
    formatDate(dateStr) {
      if (!dateStr) return this.__('profileCreatedAtUnknown')
      try {
        const d = new Date(dateStr)
        const locale = this.currentLang === 'en' ? 'en-US' : 'zh-CN'
        return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      } catch { return dateStr }
    }
  },
  mounted() {
    this.loadProfile()
  }
}
</script>

<style scoped>
.profile-header-card { padding: 24px; }
.profile-header { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
.profile-avatar { width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, rgba(78,205,196,0.15), rgba(15,12,41,0.8)); border: 2px solid rgba(78,205,196,0.3); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.avatar-icon { font-size: 36px; line-height: 1; }
.profile-info h2 { font-size: 22px; color: #fff; margin: 0 0 4px; font-weight: 600; }
.profile-title { font-size: 13px; color: var(--fg2); margin-bottom: 8px; }
.profile-badge-row { display: flex; gap: 8px; flex-wrap: wrap; }
.profile-badge-row .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; background: rgba(78,205,196,0.1); color: var(--accent); }
.profile-badge-row .badge.status-online { background: rgba(34,197,94,0.1); color: #22c55e; }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font-size: 12px; color: var(--fg2); font-weight: 500; }
.form-field .input { padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--fg); font-size: 13px; outline: none; transition: border-color 0.15s; }
.form-field .input:focus { border-color: var(--accent); }
.form-field textarea.input { font-family: inherit; }
.form-field select.input { cursor: pointer; }

.save-toast { padding: 10px 16px; border-radius: 8px; font-size: 13px; background: rgba(34,197,94,0.1); color: #22c55e; border: 1px solid rgba(34,197,94,0.2); }
.save-toast.error { background: rgba(239,68,68,0.1); color: #ef4444; border-color: rgba(239,68,68,0.2); }

/* QR Code Section */
.qr-section { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
.qr-placeholder { flex-shrink: 0; }
.qr-code-box { width: 160px; height: 160px; border-radius: 12px; background: #fff; display: flex; align-items: center; justify-content: center; padding: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.2); }
.qr-img-box { padding: 4px; }
.qr-img { width: 100%; height: 100%; border-radius: 8px; object-fit: contain; }
.qr-info { flex: 1; min-width: 200px; }
.qr-title { font-size: 14px; color: #fff; font-weight: 600; margin-bottom: 6px; }
.qr-info p { font-size: 12px; color: var(--fg2); line-height: 1.6; margin: 0; }
</style>
