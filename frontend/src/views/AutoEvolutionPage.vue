<template>
  <div class="evolution-page">
    <div class="page-hdr">
      <div class="hdr-left">
        <h2>🧠 {{ __('autoEvoTitle') }}</h2>
        <p class="page-desc">{{ __('autoEvoDesc') }} — Agent 完成任务后自动提炼经验，越用越聪明</p>
      </div>
      <div class="hdr-right">
        <span class="badge" :class="lastRunBadge">{{ lastRunText }}</span>
      </div>
    </div>

    <!-- 知识概览统计 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="num">{{ stats.knowledgeBaseSize || 0 }}</div>
        <div class="label">📚 知识库条目</div>
      </div>
      <div class="stat-card">
        <div class="num">{{ stats.totalInsights || 0 }}</div>
        <div class="label">💡 提炼见解</div>
      </div>
      <div class="stat-card">
        <div class="num">{{ stats.totalKnowledgeAdded || 0 }}</div>
        <div class="label">📝 写入知识</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#10b981">{{ stats.successfulSessions || 0 }}</div>
        <div class="label">✅ 成功学习</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#ef4444">{{ stats.failedSessions || 0 }}</div>
        <div class="label">❌ 学习失败</div>
      </div>
      <div class="stat-card">
        <div class="num">{{ stats.totalSessions || 0 }}</div>
        <div class="label">🔄 学习次数</div>
      </div>
    </div>

    <!-- 知识库内容 -->
    <div class="section">
      <div class="section-title">
        📚 知识库
        <span class="section-count">{{ knowledge.length }} 条</span>
        <button class="btn btn-sm btn-ghost" @click="fetchKnowledge">⟳ 刷新</button>
      </div>
      <div class="kb-list">
        <div v-if="!knowledge.length" class="empty-state">
          <div class="icon">📭</div>
          <p>还没有提炼的知识。完成任务后会自动生成。点击下方「手动触发」让 Agent 复盘已有成果。</p>
        </div>
        <div v-for="(item, i) in knowledge" :key="item.id" class="kb-item">
          <div class="kb-icon" :class="item.type">
            {{ item.type === 'best_practice' ? '✅' : (item.type === 'lesson_learned' ? '❌' : '💡') }}
          </div>
          <div class="kb-body">
            <div class="kb-meta">
              <span class="kb-type">{{ item.type === 'best_practice' ? '成功经验' : (item.type === 'lesson_learned' ? '失败教训' : '经验') }}</span>
              <span class="kb-confidence" :class="item.confidence">{{ item.confidence }}</span>
              <span class="kb-source">{{ item.source }}</span>
              <span class="kb-time">{{ formatTime(item.createdAt) }}</span>
            </div>
            <div class="kb-content">{{ item.content }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 学习历史 -->
    <div class="section">
      <div class="section-title">
        📋 学习记录
        <span class="section-count">{{ history.length }} 条</span>
        <button class="btn btn-sm btn-primary" @click="triggerLearn" :disabled="learning">
          {{ learning ? '⏳ 学习中...' : '▶ 手动触发学习' }}
        </button>
      </div>
      <div class="cycles-list">
        <div v-if="!history.length" class="empty-state">
          <div class="icon">📭</div>
          <p>暂无学习记录</p>
        </div>
        <div v-for="item in history" :key="item.id" class="cycle-item">
          <div class="ci-header">
            <span class="ci-time">{{ formatTime(item.startedAt) }}</span>
            <span class="ci-status" :class="item.stage">
              {{ item.stage === 'ready' ? '✅ 已学习' : (item.stage === 'failed' ? '❌ 失败' : '⏳ 进行中') }}
            </span>
            <span class="ci-agent">🤖 {{ item.agentId }}</span>
          </div>
          <div class="ci-body">
            <div class="ci-desc">{{ item.description }}</div>
            <div class="ci-summary">{{ item.summary }}</div>
            <div v-if="item.insights && item.insights.length" class="ci-insights">
              <div v-for="(ins, ii) in item.insights" :key="ii" class="insight-tag">
                {{ ins.type === 'best_practice' ? '✅' : '💡' }} {{ ins.content }}
              </div>
            </div>
            <div v-if="item.metrics" class="ci-metrics">
              <span class="metric">💡 {{ item.metrics.insightCount || 0 }} 见解</span>
              <span class="metric">📝 {{ item.metrics.knowledgeCount || 0 }} 知识入库</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { __ } from '../i18n'
export default {
  data() {
    return {
      stats: {},
      history: [],
      knowledge: [],
      learning: false,
      error: ''
    }
  },
  computed: {
    lastRunText() {
      if (!this.stats.lastRunAt) return '尚未学习'
      var d = new Date(this.stats.lastRunAt)
      var now = new Date()
      var diff = Math.floor((now - d) / 1000)
      if (diff < 60) return '刚刚'
      if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
      return d.toLocaleString('zh-CN')
    },
    lastRunBadge() {
      var diff = Date.now() - new Date(this.stats.lastRunAt || 0).getTime()
      if (diff < 3600000) return 'badge warn'
      return 'badge'
    }
  },
  methods: {
    formatTime(iso) {
      if (!iso) return '-'
      var d = new Date(iso)
      return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    },
    async fetchStats() {
      try {
        var d = await API.get('/api/evolve/stats')
        if (d && d.ok !== false) this.stats = d
      } catch(e) {
        this.error = '获取统计失败: ' + (e.message || '网络错误')
      }
    },
    async fetchHistory() {
      try {
        var d = await API.get('/api/evolve/history')
        if (d && Array.isArray(d.history)) {
          this.history = d.history.slice(0, 20)
        } else if (d && Array.isArray(d)) {
          this.history = d.slice(0, 20)
        }
      } catch(e) {
        this.error = '获取学习记录失败'
      }
    },
    async fetchKnowledge() {
      try {
        var d = await API.get('/api/evolve/knowledge')
        if (d && Array.isArray(d.knowledge)) {
          this.knowledge = d.knowledge.slice(-50).reverse()
        } else if (d && d.ok && Array.isArray(d.knowledge)) {
          this.knowledge = d.knowledge.slice(-50).reverse()
        }
      } catch(e) {
        this.error = '获取知识库失败'
      }
    },
    async triggerLearn() {
      this.learning = true
      this.error = ''
      try {
        // 从已完成任务中批量学习
        var completedTasks = []
        try {
          var t = await API.get('/api/tasks')
          var allTasks = t && t.tasks ? t.tasks : (Array.isArray(t) ? t : [])
          completedTasks = allTasks.filter(function(t) {
            return t.status === 'completed' || t.status === 'done'
          }).slice(0, 10)
        } catch(e) {
          console.log('获取任务列表失败:', e.message)
        }

        var learnPayload = (completedTasks || []).map(function(t) {
          return {
            taskId: t.id || t.taskId,
            agentId: t.assigneeId || t.agentId || 'ai_ceo',
            description: t.title || t.description || '',
            result: t.result || '',
            success: t.status === 'completed'
          }
        })

        var d = await API.post('/api/evolve/cycle', { tasks: learnPayload })
        if (d && d.ok) {
          await this.fetchStats()
          await this.fetchHistory()
          await this.fetchKnowledge()
        }
      } catch(e) {
        this.error = '学习触发失败'
      }
      this.learning = false
    }
  },
  mounted() {
    this.fetchStats()
    this.fetchHistory()
    this.fetchKnowledge()
  }
}
</script>

<style scoped>
.evolution-page { padding: 20px 24px; height: 100%; overflow-y: auto; }
.page-hdr { margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.hdr-left h2 { font-size: 18px; margin: 0 0 4px; }
.page-desc { color: var(--fg2, #9090b0); font-size: 12px; margin: 0; }
.hdr-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.stats-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 24px; }
.stat-card { background: var(--bg2, #1a1a2e); border: 1px solid var(--border, rgba(255,255,255,0.06)); border-radius: 10px; padding: 16px; text-align: center; }
.stat-card .num { font-size: 26px; color: var(--accent, #4ecdc4); font-weight: 700; }
.stat-card .label { font-size: 11px; color: var(--fg2, #9090b0); margin-top: 4px; }

.section { margin-bottom: 24px; }
.section-title { font-size: 14px; font-weight: 600; color: var(--fg, #e0e0f0); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.section-count { font-size: 11px; color: var(--fg3, #606080); font-weight: 400; }

.kb-list { display: flex; flex-direction: column; gap: 6px; }

.kb-item { display: flex; gap: 10px; background: var(--bg2, #1a1a2e); border: 1px solid var(--border, rgba(255,255,255,0.06)); border-radius: 10px; padding: 12px 14px; align-items: flex-start; }
.kb-icon { font-size: 18px; flex-shrink: 0; }
.kb-body { flex: 1; min-width: 0; }
.kb-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; font-size: 11px; }
.kb-type { padding: 1px 6px; border-radius: 4px; background: rgba(78,205,196,0.1); color: var(--accent, #4ecdc4); font-size: 10px; }
.kb-confidence { padding: 1px 5px; border-radius: 3px; font-size: 10px; }
.kb-confidence.high { background: rgba(16,185,129,0.15); color: #10b981; }
.kb-confidence.medium { background: rgba(245,158,11,0.15); color: #f59e0b; }
.kb-source { color: var(--fg3, #606080); }
.kb-time { color: var(--fg3, #606080); }
.kb-content { font-size: 12px; color: var(--fg, #e0e0f0); line-height: 1.5; word-break: break-all; }

.cycles-list { display: flex; flex-direction: column; gap: 6px; }
.cycle-item { background: var(--bg2, #1a1a2e); border: 1px solid var(--border, rgba(255,255,255,0.06)); border-radius: 10px; padding: 12px 14px; }
.ci-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 12px; }
.ci-time { color: var(--fg3, #606080); flex-shrink: 0; }
.ci-status { font-size: 11px; flex-shrink: 0; }
.ci-status.ready { color: #10b981; }
.ci-status.failed { color: #ef4444; }
.ci-status.reflecting, .ci-status.distilling, .ci-status.storing { color: #3b82f6; }
.ci-agent { color: var(--fg2, #9090b0); }

.ci-body { }
.ci-desc { font-size: 12px; color: var(--fg, #e0e0f0); margin-bottom: 4px; }
.ci-summary { font-size: 11px; color: var(--fg3, #606080); margin-bottom: 6px; }
.ci-insights { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
.insight-tag { font-size: 11px; color: var(--fg2, #9090b0); padding: 2px 6px; background: rgba(0,0,0,0.1); border-radius: 4px; }
.ci-metrics { display: flex; gap: 12px; font-size: 10px; color: var(--fg3, #606080); }

.empty-state { text-align: center; padding: 30px; color: var(--fg3, #606080); }
.empty-state .icon { font-size: 36px; margin-bottom: 6px; }
.empty-state p { font-size: 13px; }

.badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 11px; background: rgba(78,205,196,0.1); color: var(--accent, #4ecdc4); white-space: nowrap; }
.badge.warn { background: rgba(245,158,11,0.1); color: #f59e0b; }
.btn { padding: 7px 14px; border-radius: 8px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
.btn-sm { padding: 4px 10px; font-size: 11px; }
.btn-primary { background: var(--accent, #4ecdc4); color: #0f0c29; }
.btn-primary:hover { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost { background: transparent; color: var(--fg2, #9090b0); border: 1px solid var(--border, rgba(255,255,255,0.08)); }
.btn-ghost:hover { background: rgba(255,255,255,0.05); }
</style>
