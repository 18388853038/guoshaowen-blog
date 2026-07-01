<template>
  <div class="skills-page">
    <div class="page-hdr">
      <h2>🎯 {{ __('skillsPageTitle') }}</h2>
      <div class="page-hdr-extra">
        <p class="page-desc">{{ __('skillsPageDesc') }}</p>
        <button class="refresh-btn" @click="loadSkills()" :disabled="loading">{{ loading ? __('skillsLoading') : '🔄 '+__('skillsRefresh') }}</button>
      </div>
    </div>
    <div class="community-bar">
      <a href="https://clawhub.ai/" target="_blank" rel="noopener" class="community-link">
        <span class="comm-icon">🏪</span>
        <span class="comm-text">{{ __('skillsBrowseMarket') }}</span>
        <span class="comm-arrow">↗</span>
      </a>
      <a href="https://www.skillhub.cn/" target="_blank" rel="noopener" class="community-link">
        <span class="comm-icon">🧩</span>
        <span class="comm-text">{{ __('skillsCommunity') }}</span>
        <span class="comm-arrow">↗</span>
      </a>
    </div>

    <!-- AI {{ __('skillsEmployeeSkills') }} -->
    <!-- 员工技能矩阵 -->
    <div class="section">
      <h3 class="section-title">🧭 员工技能矩阵</h3>
      <p class="section-desc">团队成员 × 技能能力交叉对照表</p>
      <div v-if="loading" class="empty-tip">加载中...</div>
      <div v-else-if="members.length === 0" class="empty-tip">暂无员工数据</div>
      <div v-else class="matrix-wrap">
        <table class="matrix-table">
          <thead>
            <tr>
              <th class="matrix-corner">技能 \ 员工</th>
              <th v-for="m in members" :key="m.id">{{ m.name_cn || m.name || m.id }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in allSkillKeys" :key="s">
              <td class="matrix-skill-name">{{ s }}</td>
              <td v-for="m in members" :key="m.id">
                <span v-if="m.skills && m.skills.includes(s)" class="matrix-yes">✅</span>
                <span v-else class="matrix-no">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- AI {{ __('skillsEmployeeSkills') }} -->
    <div class="section">
      <h3 class="section-title">🤖 AI {{ __('skillsEmployeeSkills') }}</h3>
      <p class="section-desc">{{ __('skillsControlDesc') }}</p>
      <div v-if="employeeSkills.length === 0 && !loading" class="empty-tip">{{ __('skillsNoData') }}</div>
      <div class="skills-grid">
        <div v-for="(s,i) in employeeSkills" :key="'emp-'+i" class="skill-card" :class="{ active: s.enabled }">
          <div class="skill-icon">{{ s.icon }}</div>
          <div class="skill-info">
            <div class="skill-name">{{ s.name }}</div>
            <div class="skill-desc">{{ s.desc }}</div>
            <div class="skill-status">{{ s.enabled ? ('✅ '+__('skillsEnabled')) : ('⏸️ '+__('skillsDisabled')) }}</div>
          </div>
          <div class="skill-actions">
            <button class="skill-btn" :class="{ disable: s.enabled }" @click="toggleEmployeeSkill(s)">{{ s.enabled ? __('skillsToggleDisable') : __('skillsToggleEnable') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== 技能健康检查 ===== -->
    <div class="section health-section">
      <div class="health-header">
        <h3 class="section-title">🏥 技能健康检查</h3>
        <div class="health-actions">
          <button class="refresh-btn" @click="runHealthCheck()" :disabled="healthLoading">
            {{ healthLoading ? '检查中...' : '🔄 运行检查' }}
          </button>
          <button class="health-apply-btn" @click="applyHealthFix()" v-if="healthResult && (healthResult.red > 0 || healthResult.yellow > 0)" :disabled="applyingFix">
            {{ applyingFix ? '处理中...' : '🔧 执行修复' }}
          </button>
        </div>
      </div>

      <!-- 健康概览 -->
      <div v-if="healthResult" class="health-overview">
        <div class="health-stat green">
          <div class="health-stat-num">{{ healthResult.green }}</div>
          <div class="health-stat-label">🟢 健康</div>
        </div>
        <div class="health-stat yellow">
          <div class="health-stat-num">{{ healthResult.yellow }}</div>
          <div class="health-stat-label">🟡 警告</div>
        </div>
        <div class="health-stat red">
          <div class="health-stat-num">{{ healthResult.red }}</div>
          <div class="health-stat-label">🔴 异常</div>
        </div>
        <div class="health-score" :class="{ 'good': healthResult.healthScore >= 80, 'fair': healthResult.healthScore >= 50, 'poor': healthResult.healthScore < 50 }">
          <div class="health-stat-num">{{ healthResult.healthScore }}%</div>
          <div class="health-stat-label">健康分</div>
        </div>
        <div class="health-total">
          <div class="health-stat-num">{{ healthResult.total }}</div>
          <div class="health-stat-label">共检查</div>
        </div>
      </div>

      <div v-if="!healthResult && !healthLoading" class="empty-tip">
        点击「运行检查」对所有技能进行完整性、语法和依赖检测
      </div>

      <!-- 异常技能列表 -->
      <div v-if="healthResult && (healthResult.red > 0 || healthResult.yellow > 0)" class="health-list">
        <div v-for="s in healthResult.skills" :key="s.id" class="health-item" :class="'health-' + s.status">
          <div class="health-item-icon">
            <span v-if="s.status === 'red'">🔴</span>
            <span v-else-if="s.status === 'yellow'">🟡</span>
            <span v-else>🟢</span>
          </div>
          <div class="health-item-info">
            <div class="health-item-name">
              {{ s.emoji }} {{ s.name }}
              <span class="health-item-version">v{{ s.version }}</span>
              <span class="health-item-enabled" :class="{ disabled: !s.enabled }">{{ s.enabled ? '启用' : '禁用' }}</span>
            </div>
            <div class="health-item-desc">{{ s.description }}</div>
            <div class="health-item-detail" v-if="s.issues.length > 0">
              <div v-for="(iss, ii) in s.issues" :key="'iss-'+ii" class="health-issue">❌ {{ iss }}</div>
            </div>
            <div class="health-item-detail" v-if="s.warnings.length > 0 && s.issues.length === 0">
              <div v-for="(w, wi) in s.warnings" :key="'warn-'+wi" class="health-warning">⚠️ {{ w }}</div>
            </div>
          </div>
          <div class="health-item-actions">
            <button v-if="s.status === 'red'" class="skill-btn disable" @click="disableSkill(s)">禁用</button>
            <button v-if="s.status === 'yellow'" class="skill-btn" @click="markRepair(s)">标记修复</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 修复队列 -->
    <div class="section" v-if="repairQueue.length > 0">
      <h3 class="section-title">📋 修复队列 ({{ repairQueue.length }})</h3>
      <p class="section-desc">黄标技能须在截止日期前完成修复，逾期的将自动禁用</p>
      <div class="health-list">
        <div v-for="q in repairQueue" :key="q.id" class="health-item" :class="{ 'health-overdue': q.status === 'overdue', 'health-done': q.status === 'completed' }">
          <div class="health-item-icon">
            <span v-if="q.status === 'overdue'">⏰</span>
            <span v-else-if="q.status === 'completed'">✅</span>
            <span v-else>📅</span>
          </div>
          <div class="health-item-info">
            <div class="health-item-name">
              {{ q.name || q.id }}
              <span class="status-badge" :class="q.status">{{ ({ 'pending': '待修复', 'completed': '已完成', 'overdue': '已逾期' })[q.status] || q.status }}</span>
            </div>
            <div class="health-item-detail" v-if="q.warnings && q.warnings.length">
              <div v-for="(w, wi) in q.warnings" :key="'qw-'+wi" class="health-warning">⚠️ {{ w }}</div>
            </div>
            <div class="repair-deadline">
              添加于: {{ formatDate(q.addedAt) }} | 截止: {{ formatDate(q.deadline) }}
            </div>
          </div>
          <div class="health-item-actions" v-if="q.status !== 'completed'">
            <button class="skill-btn" @click="markRepairComplete(q)">标记完成</button>
          </div>
        </div>
      </div>
    </div>

    <!-- OpenClaw {{ __('skillsName') }} -->
    <div class="section">
      <h3 class="section-title">⚙️ OpenClaw {{ __('skillsPageTitle') }}</h3>
      <p class="section-desc">从 SKILL.md 加载的原生{{ __('skillsName') }}，共 {{ openclawSkills.length }} 个</p>
      <div v-if="openclawSkills.length === 0 && !loading" class="empty-tip">暂无 OpenClaw {{ __('skillsName') }}</div>
      <div class="skills-grid">
        <div v-for="(s,i) in openclawSkills" :key="'oc-'+i" class="skill-card" :class="{ active: s.enabled }">
          <div class="skill-icon">{{ s.emoji || '🔌' }}</div>
          <div class="skill-info">
            <div class="skill-name">{{ s.name || s.id }}</div>
            <div class="skill-desc">{{ s.description || '无描述' }}</div>
            <div class="skill-status">{{ s.enabled ? '✅ '+__('skillsEnabled') : '⏸️ '+__('skillsDisabled') }}</div>
            <div class="skill-tags" v-if="s.metadata && s.metadata.openclaw && s.metadata.openclaw.requires">
              <span v-for="(tag,tj) in (s.metadata.openclaw.requires.bins||[])" :key="tj" class="tag">{{ tag }}</span>
            </div>
          </div>
          <div class="skill-actions">
            <button class="skill-btn" :class="{ disable: s.enabled }" @click="toggleOpenclawSkill(s)">{{ s.enabled ? __('skillsToggleDisable') : __('skillsToggleEnable') }}</button>
          </div>
        </div>
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
      members: [],
      allSkillKeys: [],
      employeeSkills: [],
      openclawSkills: [],
      loading: true,
      healthResult: null,
      healthLoading: false,
      applyingFix: false,
      repairQueue: []
    }
  },
  async mounted() {
    await this.loadSkills();
    await this.loadRepairQueue();
  },
  methods: {
    formatDate(iso) {
      if (!iso) return '-';
      try {
        var d = new Date(iso);
        return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      } catch(e) { return iso; }
    },
    async loadSkills() {
      this.loading = true;
      // 加载员工技能矩阵
      try {
        var agentsResp = await API.get('/api/agents');
        if (agentsResp && agentsResp.agents) {
          this.members = agentsResp.agents;
          // 收集所有技能
          var allSet = {};
          agentsResp.agents.forEach(function(m) {
            if (m.skills) m.skills.forEach(function(sk) { allSet[sk] = true; });
          });
          this.allSkillKeys = Object.keys(allSet).sort();
        }
      } catch(e) {}
      try {
        var [empResp, ocResp] = await Promise.all([
          API.get('/api/ai-employee/skills'),
          API.get('/api/skills')
        ]);
        if (empResp && empResp.ok && empResp.skills) {
          this.employeeSkills = empResp.skills;
        }
        if (ocResp && ocResp.skills) {
          this.openclawSkills = ocResp.skills;
        }
      } catch(e) {
        console.error('加载'+this.__('skillsName')+'失败:', e);
      }
      this.loading = false;
    },
    async toggleEmployeeSkill(s) {
      var newEnabled = !s.enabled;
      try {
        var resp = await API.put('/api/ai-employee/skills/' + s.key, { enabled: newEnabled });
        if (resp && resp.ok) {
          s.enabled = newEnabled;
        } else {
          alert(this.__('skillsOpFail') + ': ' + ((resp && resp.error) || '未知错误'));
        }
      } catch(e) {
        alert('网络错误: ' + e.message);
      }
    },
    async toggleOpenclawSkill(s) {
      var newEnabled = !s.enabled;
      try {
        var resp = await API.put('/api/skills/' + encodeURIComponent(s.id || s.name), { enabled: newEnabled });
        if (resp && resp.ok) {
          s.enabled = newEnabled;
        } else {
          alert(this.__('skillsOpFail') + ': ' + ((resp && resp.error) || '未知错误'));
        }
      } catch(e) {
        alert('网络错误: ' + e.message);
      }
    },
    async runHealthCheck() {
      this.healthLoading = true;
      this.healthResult = null;
      try {
        var resp = await API.get('/api/v4/skills/health');
        this.healthResult = resp;
        // 同时加载修复队列
        await this.loadRepairQueue();
      } catch(e) {
        alert('健康检查失败: ' + e.message);
      }
      this.healthLoading = false;
    },
    async applyHealthFix() {
      if (!confirm('确认执行修复？\n\n🟢 保留所有绿标技能\n🔴 自动禁用' + (this.healthResult?.red||0) + ' 个异常技能\n🟡 将 ' + (this.healthResult?.yellow||0) + ' 个警告技能加入7天修复队列')) return;
      this.applyingFix = true;
      try {
        var resp = await API.post('/api/v4/skills/health/apply', { autoFix: true });
        if (resp.ok) {
          alert(resp.message);
          // 重新检查
          await this.runHealthCheck();
          await this.loadSkills();
        } else {
          alert('修复失败: ' + (resp.error || '未知错误'));
        }
      } catch(e) {
        alert('网络错误: ' + e.message);
      }
      this.applyingFix = false;
    },
    async loadRepairQueue() {
      try {
        var resp = await API.get('/api/v4/skills/repair-queue');
        if (resp.ok) this.repairQueue = resp.queue || [];
      } catch(e) {}
    },
    async disableSkill(s) {
      if (!confirm('确认禁用技能 ' + s.name + '？')) return;
      try {
        var resp = await API.post('/api/skills', { name: s.id, enabled: false });
        if (resp.ok) {
          await this.runHealthCheck();
          await this.loadSkills();
        } else {
          alert('操作失败: ' + (resp.error || '未知错误'));
        }
      } catch(e) {
        alert('网络错误: ' + e.message);
      }
    },
    async markRepair(s) {
      try {
        await API.post('/api/v4/skills/health/apply', { autoFix: false });
        await this.loadRepairQueue();
        await this.runHealthCheck();
      } catch(e) {
        alert('操作失败: ' + e.message);
      }
    },
    async markRepairComplete(q) {
      try {
        var resp = await API.post('/api/v4/skills/repair/complete', { id: q.id });
        if (resp.ok) {
          await this.loadRepairQueue();
          await this.runHealthCheck();
        } else {
          alert('操作失败: ' + (resp.error || '未知错误'));
        }
      } catch(e) {
        alert('网络错误: ' + e.message);
      }
    }
  }
}
</script>
<style scoped>
.skills-page{padding:20px 24px;height:100%;overflow-y:auto}
.page-hdr{margin-bottom:16px}
.page-hdr h2{font-size:18px;margin:0 0 8px}
.page-hdr-extra{display:flex;align-items:center;justify-content:space-between}
.page-desc{color:var(--fg2,#9090b0);font-size:12px;margin:0}
.refresh-btn{padding:4px 12px;border-radius:6px;border:1px solid var(--accent2,#7c6ff0);background:transparent;color:var(--accent2,#7c6ff0);cursor:pointer;font-size:11px}
.refresh-btn:hover{background:rgba(124,111,240,0.12)}
.refresh-btn:disabled{opacity:0.5;cursor:not-allowed}
.section{margin-bottom:24px}
.section-title{font-size:15px;margin:0 0 4px;font-weight:600}
.section-desc{color:var(--fg2,#9090b0);font-size:11px;margin:0 0 12px}
.empty-tip{color:var(--fg2,#9090b0);font-size:12px;padding:20px;text-align:center}
.skills-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
.skill-card{display:flex;align-items:center;gap:12px;padding:14px;background:var(--bg3,#1c1c30);border-radius:10px;border:1px solid var(--border);transition:all 0.2s}
.skill-card.active{border-color:rgba(78,205,196,0.3);background:rgba(78,205,196,0.04)}
.skill-card:hover{background:var(--bg4,#242440)}
.community-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.community-link{display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;border:1px dashed var(--accent2,#7c6ff0);background:rgba(124,111,240,0.06);text-decoration:none;transition:all 0.2s;font-size:12px}
.community-link:hover{background:rgba(124,111,240,0.12);border-color:var(--accent2,#7c6ff0);transform:translateY(-1px)}
.comm-icon{font-size:20px}
.comm-text{color:var(--fg,#e0e0f0);font-weight:500}
.comm-arrow{color:var(--accent2,#7c6ff0);font-size:11px}
.matrix-wrap{overflow-x:auto;margin-bottom:8px}
.matrix-table{width:100%;border-collapse:collapse;font-size:12px;background:var(--bg3,#1c1c30);border-radius:8px;overflow:hidden}
.matrix-table th,.matrix-table td{padding:6px 10px;border:1px solid var(--border,#2a2a45);text-align:center}
.matrix-table th{background:var(--bg4,#242440);color:var(--fg,#e0e0f0);font-weight:600;white-space:nowrap}
.matrix-corner{color:var(--fg2,#9090b0);font-weight:400}
.matrix-skill-name{text-align:left;white-space:nowrap;color:var(--fg,#e0e0f0);font-weight:500}
.matrix-yes{font-size:14px}
.matrix-no{color:var(--fg3,#606080)}
.skill-icon{font-size:28px;flex-shrink:0}
.skill-info{flex:1;min-width:0}
.skill-name{font-size:13px;font-weight:600;color:var(--fg,#e0e0f0)}
.skill-desc{font-size:11px;color:var(--fg2,#9090b0);margin-top:2px}
.skill-status{font-size:10px;margin-top:4px}
.skill-tags{margin-top:4px;display:flex;gap:4px;flex-wrap:wrap}
.tag{padding:1px 6px;border-radius:4px;background:rgba(124,111,240,0.12);color:var(--accent2,#7c6ff0);font-size:9px}
.skill-actions{flex-shrink:0}
.skill-btn{padding:5px 12px;border-radius:6px;border:1px solid var(--accent,#4ecdc4);background:transparent;color:var(--accent,#4ecdc4);cursor:pointer;font-size:11px;transition:all 0.15s}
.skill-btn:hover{background:var(--accent,#4ecdc4);color:#000}
.skill-btn.disable{border-color:#ef4444;color:#ef4444}
.skill-btn.disable:hover{background:#ef4444;color:#fff}

/* === 健康检查 === */
.health-section{border:1px solid var(--border,#2a2a45);border-radius:12px;padding:16px;background:var(--bg2,#141428)}
.health-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.health-header .section-title{margin:0}
.health-actions{display:flex;gap:8px}
.health-apply-btn{padding:6px 14px;border-radius:6px;border:1px solid var(--accent2,#f59e0b);background:transparent;color:var(--accent2,#f59e0b);cursor:pointer;font-size:11px;font-weight:500}
.health-apply-btn:hover{background:rgba(245,158,11,0.12)}
.health-apply-btn:disabled{opacity:0.5;cursor:not-allowed}
.health-overview{display:flex;gap:12px;margin-bottom:16px}
.health-stat{flex:1;text-align:center;padding:14px 8px;border-radius:8px;border:1px solid var(--border,#2a2a45)}
.health-stat.green{border-color:rgba(34,197,94,0.3);background:rgba(34,197,94,0.06)}
.health-stat.yellow{border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.06)}
.health-stat.red{border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.06)}
.health-stat-num{font-size:26px;font-weight:700}
.health-stat.green .health-stat-num{color:#22c55e}
.health-stat.yellow .health-stat-num{color:#f59e0b}
.health-stat.red .health-stat-num{color:#ef4444}
.health-stat-label{font-size:11px;color:var(--fg2,#9090b0);margin-top:4px}
.health-score{flex:1;text-align:center;padding:14px 8px;border-radius:8px;border:1px solid var(--border,#2a2a45)}
.health-score.good{border-color:rgba(34,197,94,0.3);background:rgba(34,197,94,0.06)}
.health-score.fair{border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.06)}
.health-score.poor{border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.06)}
.health-score.good .health-stat-num{color:#22c55e}
.health-score.fair .health-stat-num{color:#f59e0b}
.health-score.poor .health-stat-num{color:#ef4444}
.health-total{flex:1;text-align:center;padding:14px 8px;border-radius:8px;border:1px solid var(--border,#2a2a45)}
.health-total .health-stat-num{color:var(--fg,#e0e0f0)}
.health-list{display:flex;flex-direction:column;gap:6px}
.health-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--border,#2a2a45);background:var(--bg3,#1c1c30)}
.health-item.health-red{border-color:rgba(239,68,68,0.25);background:rgba(239,68,68,0.04)}
.health-item.health-yellow{border-color:rgba(245,158,11,0.25);background:rgba(245,158,11,0.04)}
.health-item.health-overdue{border-color:rgba(239,68,68,0.25);background:rgba(239,68,68,0.04)}
.health-item.health-done{border-color:rgba(34,197,94,0.2)}
.health-item-icon{font-size:20px;flex-shrink:0;padding-top:2px}
.health-item-info{flex:1;min-width:0}
.health-item-name{font-size:13px;font-weight:600;color:var(--fg,#e0e0f0)}
.health-item-version{font-size:10px;color:var(--fg3,#606080);margin-left:6px}
.health-item-enabled{font-size:10px;margin-left:6px;padding:1px 5px;border-radius:3px;background:rgba(34,197,94,0.12);color:#22c55e}
.health-item-enabled.disabled{background:rgba(107,114,128,0.12);color:#6b7280}
.health-item-desc{font-size:11px;color:var(--fg2,#9090b0);margin-top:2px}
.health-item-detail{margin-top:4px}
.health-issue{font-size:11px;color:#ef4444;line-height:1.5}
.health-warning{font-size:11px;color:#f59e0b;line-height:1.5}
.health-item-actions{flex-shrink:0;display:flex;gap:4px;padding-top:2px}
.status-badge{font-size:10px;margin-left:6px;padding:1px 5px;border-radius:3px}
.status-badge.pending{background:rgba(245,158,11,0.12);color:#f59e0b}
.status-badge.completed{background:rgba(34,197,94,0.12);color:#22c55e}
.status-badge.overdue{background:rgba(239,68,68,0.12);color:#ef4444}
.repair-deadline{font-size:10px;color:var(--fg3,#606080);margin-top:4px}
</style>
