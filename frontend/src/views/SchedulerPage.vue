<template>
  <div class="sched-page">
    <div class="page-hdr"><h2>⏰ {{ __('schedulerTitle') }}</h2><p class="page-desc">{{ __('schedulerDesc') }}</p></div>
    <div class="sched-toolbar">
      <button class="sched-add-btn" @click="showAdd = true" v-if="!showAdd">➕ {{ __('schedulerNewTask') }}</button>
    </div>
    <div v-if="showAdd" class="sched-add-form">
      <input v-model="form.name" :placeholder="__('loginTokenPlaceholder')" class="sched-input" />
      <input v-model="form.cron" :placeholder="'Cron ' + __('schedulerExprEg') + ' (例: 0 8 * * *)'" class="sched-input" />
      <select v-model="form.target" class="sched-input">
        <option value="ceo">CEO</option>
        <option value="cto">CTO</option>
        <option value="system">System</option>
      </select>
      <input v-model="form.prompt" :placeholder="__('memoryTagsPlaceholder') + ' / Prompt' + __('schedulerCancel')" class="sched-input sched-wide" />
      <input v-model="form.model" :placeholder="__('workflowNoDesc') + '（' + __('schedulerCancel') + '）'" class="sched-input sched-small" />
      <input v-model="form.channel" :placeholder="__('channelsConfig') + '（' + __('schedulerCancel') + '）'" class="sched-input sched-small" />
      <div class="sched-form-actions">
        <button class="sched-add-btn" @click="addTask">✅ {{ __('schedulerAdd') }}</button>
        <button class="sched-cancel-btn" @click="showAdd = false; resetForm()">{{ __('schedulerCancel') }}</button>
      </div>
    </div>
    <div class="sched-list">
      <div v-for="t in tasks" :key="t.id" class="sched-item" :class="{ running: t.enabled }">
        <div class="sched-info">
          <div class="sched-name">{{ t.name }}</div>
          <div class="sched-cron">{{ t.cron }}</div>
          <div class="sched-target">{{ t.target }}<span v-if="t.prompt"> · {{ truncate(t.prompt,40) }}</span></div>
        </div>
        <div class="sched-status">{{ t.enabled ? __('schedulerRunning') : __('schedulerPaused') }}</div>
        <div class="sched-actions">
          <button class="sched-btn" @click="toggleTask(t.id)">{{ t.enabled ? __('schedulerPause') : __('schedulerStart') }}</button>
          <button class="sched-btn-del" @click="delTask(t.id)">{{ __('schedulerDelete') }}</button>
        </div>
      </div>
      <div v-if="!tasks.length" class="sched-empty">{{ __('schedulerNoTasks') }}</div>
    </div>
    <!-- 最近报告区块 -->
  <!-- 最近工作日报 -->
  <div class="sched-reports">
    <div class="sched-reports-header">
      <h3 style="margin:24px 0 8px 0;font-size:16px">📊 最近工作日报</h3>
      <button class="sched-gen-btn" @click="generateReport" :disabled="generating">{{ generating ? '⏳ 生成中…' : '📝 生成工作日报' }}</button>
    </div>
    <div v-if="!reports.length && !generating" class="sched-empty">暂无日报，点击上方按钮立即生成</div>
    <div v-for="r in reports" :key="r.id" class="sched-report-item">
      <div class="sched-report-header">
        <span class="sched-report-time">{{ r.generatedAt }}</span>
        <span class="sched-report-type" v-if="r.type">{{ r.type }}</span>
        <button class="sched-report-toggle" @click="r.expanded = !r.expanded">{{ r.expanded ? '收起' : '展开' }}</button>
      </div>
      <div v-if="r.expanded" class="sched-report-body" v-html="r.content.replace(/\n/g,'<br>')"></div>
    </div>
  </div>
  <div class="sched-msg" v-if="msg">{{ msg }}</div>
  </div>
</template>
<script>
import { __ } from '../i18n'
function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
export default {
  data() {
    return {
      tasks: [],
      showAdd: false,
      msg: '',
      generating: false,
      form: { name: '', cron: '', target: 'ceo', prompt: '', model: '', channel: '' },
      reports: []
    };
  },
  mounted() { this.loadTasks(); this.loadReports(); },
  methods: {
    truncate,
    resetForm() {
      this.form = { name: '', cron: '', target: 'ceo', prompt: '', model: '', channel: '' };
    },
    async loadTasks() {
      try {
        const r = await fetch('/api/scheduler/tasks');
        const data = await r.json();
        this.tasks = data.tasks || [];
      } catch(e) {
        this.msg = __('schedulerLoadFail');
      }
    },
    async addTask() {
      if (!this.form.name || !this.form.cron) {
        this.msg = __('schedulerRequired');
        return;
      }
      try {
        const r = await fetch('/api/scheduler/tasks', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(this.form) });
        if (r.ok) { this.msg = __('schedulerAddOk'); this.showAdd = false; this.resetForm(); this.loadTasks(); }
        else this.msg = __('schedulerAddFail');
      } catch(e) {
        this.msg = __('schedulerNetErr');
      }
    },
    async toggleTask(id) {
      try {
        const r = await fetch('/api/scheduler/tasks/' + id + '/toggle', { method: 'POST' });
        if (r.ok) { this.msg = __('schedulerStarted'); this.loadTasks(); }
      } catch(e) { this.msg = __('schedulerNetErr'); }
    },
    async loadReports() {
      try {
        var r = await fetch('/api/v4/reports');
        var data = await r.json();
        if (data && data.reports) {
          var list = [];
          for (var type in data.reports) {
            if (type === 'updatedAt') continue;
            var content = data.reports[type];
            if (content) {
              list.push({ id: type, type: type === 'summaryReport' ? '工作总结' : type === 'taskAnalysis' ? '任务分析' : type === 'execSteps' ? '执行记录' : type, content: content, generatedAt: data.reports.updatedAt ? new Date(data.reports.updatedAt).toLocaleString() : '', expanded: false });
            }
          }
          this.reports = list.reverse();
        }
      } catch(e) { /* 静默 */ }
    },
    async generateReport() {
      this.generating = true;
      this.msg = '';
      try {
        var r = await fetch('/api/v4/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types: ['taskAnalysis', 'execSteps', 'summaryReport'] }), signal: AbortSignal.timeout(130000) });
        var data = await r.json();
        if (data && data.ok) {
          this.msg = '✅ 日报生成成功';
          this.loadReports();
        } else {
          this.msg = '❌ 生成失败: ' + ((data && data.error) || '未知错误');
        }
      } catch(e) {
        this.msg = '❌ 网络错误: ' + e.message;
      }
      this.generating = false;
    },
    async delTask(id) {
      if (!confirm(__('schedulerConfirmDel'))) return;
      try {
        const r = await fetch('/api/scheduler/tasks/' + id, { method: 'DELETE' });
        if (r.ok) { this.msg = __('schedulerDeleted'); this.loadTasks(); }
        else this.msg = __('schedulerDelFail');
      } catch(e) { this.msg = __('schedulerNetErr'); }
    }
  }
}
</script>
<style scoped>
.sched-page {
  max-width: 960px; margin: 0 auto; padding: 24px;
}
.page-hdr h2 {
  font-size: 22px; font-weight: 600; margin: 0 0 6px 0;
}
.page-desc {
  color: #888; font-size: 14px; margin: 0 0 20px 0;
}
.sched-toolbar {
  margin-bottom: 16px;
}
.sched-add-btn {
  background: #1677ff; color: #fff; border: none;
  padding: 8px 16px; border-radius: 6px; cursor: pointer;
  font-size: 14px; transition: background .2s;
}
.sched-add-btn:hover {
  background: #4096ff;
}
.sched-cancel-btn {
  background: #f0f0f0; color: #333; border: 1px solid #d9d9d9;
  padding: 8px 16px; border-radius: 6px; cursor: pointer;
  font-size: 14px; margin-left: 8px;
}
.sched-add-form {
  background: #fafafa; border: 1px solid #e8e8e8;
  border-radius: 8px; padding: 16px; margin-bottom: 20px;
  display: flex; flex-wrap: wrap; gap: 10px;
}
.sched-input {
  padding: 8px 12px; border: 1px solid #d9d9d9;
  border-radius: 6px; font-size: 14px; outline: none;
  transition: border .2s; flex: 1 1 180px; min-width: 140px;
  box-sizing: border-box;
}
.sched-input:focus {
  border-color: #1677ff; box-shadow: 0 0 0 2px rgba(22,119,255,0.1);
}
.sched-wide {
  flex: 1 1 100%;
}
.sched-small {
  flex: 1 1 120px; min-width: 100px;
}
.sched-form-actions {
  flex: 0 0 100%; display: flex; gap: 8px; margin-top: 4px;
}
.sched-list {
  display: flex; flex-direction: column; gap: 10px;
}
.sched-item {
  display: flex; align-items: center; justify-content: space-between;
  background: #fff; border: 1px solid #e8e8e8;
  border-radius: 8px; padding: 14px 16px;
  transition: box-shadow .2s;
}
.sched-item:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}
.sched-item.running {
  border-left: 3px solid #52c41a;
}
.sched-info {
  flex: 1; min-width: 0;
}
.sched-name {
  font-weight: 600; font-size: 15px; margin-bottom: 4px;
}
.sched-cron {
  font-family: monospace; font-size: 13px; color: #666;
  background: #f5f5f5; display: inline-block;
  padding: 2px 8px; border-radius: 4px;
}
.sched-target {
  font-size: 12px; color: #999; margin-top: 4px;
}
.sched-status {
  margin: 0 16px; white-space: nowrap;
  font-size: 13px; padding: 2px 10px; border-radius: 10px;
  background: #f5f5f5; color: #666;
}
.sched-item.running .sched-status {
  background: #f6ffed; color: #52c41a;
}
.sched-actions {
  display: flex; gap: 6px; flex-shrink: 0;
}
.sched-btn {
  background: #fff; border: 1px solid #d9d9d9;
  padding: 4px 12px; border-radius: 4px; cursor: pointer;
  font-size: 13px; transition: all .2s;
}
.sched-btn:hover {
  border-color: #1677ff; color: #1677ff;
}
.sched-btn-del {
  background: #fff; border: 1px solid #ff4d4f;
  padding: 4px 12px; border-radius: 4px; cursor: pointer;
  font-size: 13px; color: #ff4d4f; transition: all .2s;
}
.sched-btn-del:hover {
  background: #ff4d4f; color: #fff;
}
.sched-empty {
  text-align: center; padding: 40px; color: #bbb;
  font-size: 14px;
}
.sched-msg {
  margin-top: 16px; padding: 10px 14px;
  border-radius: 6px; background: #fff7e6; border: 1px solid #ffd591;
  color: #d46b08; font-size: 13px;
}
.sched-reports {
  margin-top: 8px;
}
.sched-report-item {
  background: #fff; border: 1px solid #e8e8e8;
  border-radius: 8px; margin-bottom: 8px;
}
.sched-report-header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
}
.sched-report-time {
  font-size: 12px; color: #999;
}
.sched-report-type {
  font-size: 11px; background: #e6f7ff; color: #1677ff;
  padding: 2px 8px; border-radius: 4px;
}
.sched-report-toggle {
  margin-left: auto; background: none; border: 1px solid #d9d9d9;
  padding: 2px 10px; border-radius: 4px; cursor: pointer;
  font-size: 12px; color: #666;
}
.sched-report-toggle:hover {
  border-color: #1677ff; color: #1677ff;
}
.sched-report-body {
  padding: 0 14px 14px 14px; font-size: 13px;
  line-height: 1.7; color: #333; white-space: pre-wrap;
}
.sched-reports-header{display:flex;justify-content:space-between;align-items:center;gap:12px}.sched-gen-btn{padding:6px 14px;border-radius:6px;border:1px solid var(--accent,#4ecdc4);background:rgba(78,205,196,0.08);color:var(--accent,#4ecdc4);cursor:pointer;font-size:12px;white-space:nowrap;transition:all 0.15s;margin-top:16px}.sched-gen-btn:hover{background:rgba(78,205,196,0.2)}.sched-gen-btn:disabled{opacity:0.5;cursor:not-allowed}.sched-empty{color:var(--fg3,#606080);font-size:12px;padding:16px 0;text-align:center}
</style>
