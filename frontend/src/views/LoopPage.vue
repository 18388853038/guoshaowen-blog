<template>
  <div class="loop-page">
    <!-- Dynamic header -->
    <div class="page-hdr">
      <h2>{{ activeTab === 'loop' ? __('loopEngineTitle') : __('workflowTitle') }}</h2>
      <p class="page-desc">{{ activeTab === 'loop' ? __('loopEngineDesc') : __('workflowDesc') }}</p>
    </div>

    <!-- Tab Bar -->
    <div class="tab-bar">
      <button class="tab-btn" :class="{ active: activeTab === 'loop' }" @click="activeTab = 'loop'">🔄 {{ __('loopEngineTitle') }}</button>
      <button class="tab-btn" :class="{ active: activeTab === 'workflow' }" @click="activeTab = 'workflow'; loadWorkflows()">📋 {{ __('workflowTitle') }}</button>
    </div>

    <!-- Loop Tab Content -->
    <template v-if="activeTab === 'loop'">
<!-- 启动新 Loop -->
    <div class="loop-section">
      <div class="section-hdr"><span>🚀 {{ __('loopStartNew') }}</span></div>
      <div class="form-row">
        <div class="form-group">
          <label>{{ __('loopGoal') }}</label>
          <input v-model="newLoop.goal" class="form-input" :placeholder="__('loopGoalPlaceholder')" />
        </div>
        <div class="form-group">
          <label>{{ __('loopModule') }}</label>
          <input v-model="newLoop.module" class="form-input" placeholder="modules/activities.js" />
        </div>
        <div class="form-group" style="max-width:100px">
          <label>{{ __('loopCoverageTarget') }}</label>
          <input v-model.number="newLoop.targetCoverage" type="number" class="form-input" min="0" max="100" />
        </div>
        <div class="form-group" style="max-width:80px">
          <label>{{ __('loopIterations') }}</label>
          <input v-model.number="newLoop.maxIterations" type="number" class="form-input" min="1" max="50" />
        </div>
      </div>
      <div class="form-actions">
        <button class="btn" @click="startLoop" :disabled="starting">
          {{ starting ? __('loopStarting') : __('loopBtnStart') }}
        </button>
        <span class="btn-hint" v-if="startMsg">{{ startMsg }}</span>
      </div>
    </div>

    <!-- Loop 列表 -->
    <div class="loop-section">
      <div class="section-hdr"><span>📋 {{ __('loopHistory') }}</span></div>
      <div class="loop-table-wrap" v-if="loops.length">
        <table class="loop-table">
          <thead>
            <tr>
              <th>{{ __('loopColId') }}</th>
              <th>{{ __('loopColGoal') }}</th>
              <th>{{ __('loopColModule') }}</th>
              <th>{{ __('loopColStatus') }}</th>
              <th>{{ __('loopColRounds') }}</th>
              <th>{{ __('loopColTokens') }}</th>
              <th>{{ __('loopColTime') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in loops" :key="l.loopId" :class="'status-' + l.status" @click="viewDetail(l.loopId)">
              <td class="td-id" :title="l.loopId">{{ l.loopId.substring(0, 16) }}..</td>
              <td class="td-goal">{{ l.goal }}</td>
              <td class="td-module">{{ l.moduleName || '-' }}</td>
              <td><span class="status-badge" :class="l.status">{{ statusLabel(l.status) }}</span></td>
              <td>{{ l.iteration }}</td>
              <td>{{ fmtTokens(l.tokensUsed) }}</td>
              <td class="td-time">{{ fmtTime(l.startedAt) }}</td>
              <td><button class="btn-sm" @click.stop="viewDetail(l.loopId)">👁️</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="empty-state" v-else>{{ __('loopNoData') }}</div>
    </div>

    <!-- Loop 详情 -->
    <div class="loop-section" v-if="detail.loopId">
      <div class="section-hdr">
        <span>📄 {{ __('loopDetailTitle') }}: {{ detail.loopId?.substring(0, 12) }}..</span>
        <button class="btn-sm" @click="detail={}">✕</button>
      </div>
      <div class="detail-status">{{ __('loopStatus') }}: <span class="status-badge" :class="detail.status">{{ statusLabel(detail.status) }}</span></div>
      <div class="detail-meta">
        <span>{{ __('loopGoal') }}: {{ detail.config?.goal }}</span>
        <span>{{ __('loopColModule') }}: {{ detail.config?.module }}</span>
        <span>{{ __('loopCoverageTarget') }}: {{ detail.config?.targetCoverage || '-' }}%</span>
        <span>{{ __('loopColTokens') }}: {{ fmtTokens(detail.tokensUsed) }}/{{ fmtTokens(detail.config?.maxTokens) }}</span>
        <span>{{ __('loopColRounds') }}: {{ detail.iteration }}/{{ detail.config?.maxIterations }}</span>
      </div>

      <!-- 历史轮次 -->
      <div class="round-list" v-if="detail.history?.length">
        <div class="round-item" v-for="r in detail.history" :key="r.round">
          <div class="rh-hdr">
            <span class="rh-round">{{ __('loopRound') }} {{ r.round }}</span>
            <span class="rh-time">{{ fmtTime(r.startedAt) }}</span>
            <span class="rh-tokens">⚡{{ r.tokensCost }} tokens</span>
            <span class="rh-duration">{{ r.durationMs ? (r.durationMs/1000).toFixed(1)+'s' : '' }}</span>
            <span class="rh-audit" :class="r.audit?.indexOf('pass')===0?'pass':'fail'">{{ r.audit }}</span>
          </div>
          <div class="rh-detail">
            <div class="rh-action"><strong>{{ __('loopAction') }}:</strong> {{ r.action }}</div>
            <div class="rh-result"><strong>{{ __('loopResult') }}:</strong> {{ r.result }}</div>
          </div>
        </div>
      </div>
      <div class="empty-state" v-else-if="detail.status==='running'">{{ __('loopRunning') }}</div>

      <!-- 最终结果 -->
      <div class="result-box" v-if="detail.finalResult">
        <div class="result-icon">{{ detail.finalResult.passed ? '🎉' : '❌' }}</div>
        <div class="result-text">
          <div class="result-title">{{ detail.finalResult.passed ? __('loopPassed') : __('loopFailed') }}</div>
          <div class="result-detail">{{ detail.finalResult.reason || detail.finalResult.summary }}</div>
          <div class="result-stats">{{ __('loopDuration') }}: {{ ((detail.finalResult.durationMs||0)/1000).toFixed(1) }}s | {{ __('loopColRounds') }}: {{ detail.finalResult.rounds }}</div>
        </div>
      </div>
    </div>
    </template>

    <!-- Workflow Tab Content -->
    <template v-if="activeTab === 'workflow'">

  <div class="workflow-page">
    <div class="page-header">
      <h2>📋 {{ __('workflowTitle') }}</h2>
      <p class="desc">{{ __('workflowDesc') }} — {{ __('workflowDragNodes') }}、{{ __('workflowConfigSteps') }}、一键执行</p>
    </div>

    <!-- Workflow List -->
    <div v-if="!editing" class="workflow-list">
      <div class="toolbar">
        <button class="btn btn-primary" @click="newWorkflow">+ {{ __('workflowNew') }}</button>
      </div>
      
      <div class="template-section" v-if="templates.length">
        <h3>📦 {{ __('workflowTemplate') }}</h3>
        <div class="template-grid">
          <div v-for="t in templates" :key="t.id" class="template-card" @click="createFromTemplate(t)">
            <div class="t-name">{{ t.name }}</div>
            <div class="t-desc">{{ t.description }}</div>
            <div class="t-meta">{{ t.nodes.length }} {{ __('workflowNodes') }}</div>
          </div>
        </div>
      </div>
      
      <div class="saved-section">
        <h3>💾 已{{ __('workflowSave') }}的工作流</h3>
        <div v-if="workflows.length === 0" class="empty-state">{{ __('workflowNoList') }}，点击上方按钮新建</div>
        <div v-for="wf in workflows" :key="wf.id" class="wf-card">
          <div class="wf-info" @click="editWorkflow(wf)">
            <div class="wf-name">{{ wf.name }}</div>
            <div class="wf-desc">{{ wf.description || __('workflowNoDesc') }}</div>
            <div class="wf-meta">
              <span class="wf-status" :class="wf.status">{{ statusText(wf.status) }}</span>
              <span>{{ wf.nodes.length }} {{ __('workflowNode') }}</span>
              <span>{{ wf.runs || 0 }} {{ __('workflowExecCount') }}</span>
            </div>
          </div>
          <div class="wf-actions">
            <button class="btn btn-sm" @click="editWorkflow(wf)" title="编辑">✏️</button>
            <button class="btn btn-sm" @click="runWorkflow(wf)" title="执行" :disabled="wf.status==='running'">▶️</button>
            <button class="btn btn-sm btn-danger" @click="deleteWorkflow(wf)" title="删除">🗑️</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Workflow Editor -->
    <div v-else class="editor-container">
      <div class="editor-toolbar">
        <input v-model="editName" class="wf-title-input" placeholder="工作流{{ __('workflowNodeName') }}" />
        <div class="editor-actions">
          <button class="btn btn-ghost" @click="validateWorkflow">🔍 {{ __('workflowValidate') }}</button>
          <button class="btn btn-ghost" @click="saveWorkflow">💾 {{ __('workflowSave') }}</button>
          <button class="btn btn-primary" @click="saveAndRun">▶️ {{ __('workflowSave') }}并执行</button>
          <button class="btn btn-ghost" @click="cancelEdit">← {{ __('workflowBack') }}</button>
        </div>
      </div>
      
      <div class="canvas-area">
        <svg class="dag-svg" ref="wfSvgEl" @click="canvasClick">
          <!-- Edges -->
          <line v-for="(e, i) in edges" :key="'e'+i"
            :x1="getNodeX(e.from)" :y1="getNodeY(e.from)" 
            :x2="getNodeX(e.to)" :y2="getNodeY(e.to)"
            stroke="#4ecdc4" stroke-width="2" stroke-dasharray="5,3"
            :class="{ 'edge-conditional': e.condition }" />
          
          <!-- Nodes -->
          <g v-for="(n, j) in nodes" :key="n.id"
            :transform="'translate(' + (n.x || 100 + j * 180) + ',' + (n.y || 150) + ')'"
            class="dag-node" @click.stop="selectNode(n)"
            :class="{ selected: selectedNode && selectedNode.id === n.id }">
            <rect x="-60" y="-25" width="120" height="50" rx="8"
              :fill="nodeColor(n)" stroke="#4ecdc4" stroke-width="1.5" />
            <text x="0" y="-5" text-anchor="middle" fill="#fff" font-size="11" font-weight="600">{{ n.label }}</text>
            <text x="0" y="8" text-anchor="middle" fill="#8892b0" font-size="9">{{ nodeTypeLabel(n.type) }}</text>
          </g>
        </svg>
        
        <!-- Node Properties Panel -->
        <div v-if="selectedNode" class="node-panel">
          <h4>⚙️ {{ __('workflowNode') }}属性</h4>
          <div class="prop-row">
            <label>{{ __('workflowNodeName') }}</label>
            <input v-model="selectedNode.label" class="prop-input" />
          </div>
          <div class="prop-row">
            <label>{{ __('workflowNodeType') }}</label>
            <select v-model="selectedNode.type" class="prop-input">
              <option value="task">{{ __('workflowTypeTask') }}</option>
              <option value="parallel">{{ __('workflowTypeParallel') }}</option>
              <option value="condition">{{ __('workflowTypeCondition') }}</option>
              <option value="notification">{{ __('workflowTypeNotify') }}</option>
            </select>
          </div>
          <div class="prop-row">
            <label>{{ __('workflowNodeDesc') }}</label>
            <textarea v-model="selectedNode.description" class="prop-input" rows="2"></textarea>
          </div>
          <div class="prop-row">
            <label>预估时长(分)</label>
            <input v-model.number="selectedNode.estimatedMinutes" type="number" class="prop-input" min="1" />
          </div>
          <div class="prop-actions">
            <button class="btn btn-sm btn-danger" @click="deleteNode(selectedNode)">删除{{ __('workflowNode') }}</button>
          </div>
        </div>
      </div>
      
      <!-- Add Node Toolbar -->
      <div class="add-node-bar">
        <button class="btn btn-sm" @click="addNode('task')">+ {{ __('workflowTypeTask') }}</button>
        <button class="btn btn-sm" @click="addNode('parallel')">+ {{ __('workflowTypeParallel') }}</button>
        <button class="btn btn-sm" @click="addNode('condition')">+ {{ __('workflowTypeCondition') }}</button>
        <button class="btn btn-sm" @click="addNode('notification')">+ {{ __('workflowTypeNotify') }}</button>
        <span class="add-hint">点击画布空白处添加{{ __('workflowNode') }}，点击连接线</span>
      </div>
    </div>
  </div>

    </template>
  </div>
</template>

<script>
import { API } from '../main.js'
import { __ } from '../i18n'

function fmtTokens(n) {
  n = Number(n);
  if (!n) return '0';
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1) + 'K';
  return String(n);
}

function fmtTime(t) {
  if (!t) return '-';
  try {
    var d = new Date(t);
    var pad = function(n) { return String(n).padStart(2,'0'); };
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  } catch(e) { return t; }
}

export default {
  data() {
    return {
      // Workflow editor fields
      activeTab: 'loop',
      workflows: [],
      templates: [],
      editing: false,
      editId: null,
      editName: '',
      nodes: [],
      edges: [],
      selectedNode: null,
      nodeCounter: 0,
      // Loop engine fields
      newLoop: {
        goal: '补测试覆盖率到80%',
        module: 'modules/activities.js',
        targetCoverage: 80,
        maxIterations: 10
      },
      loops: [],
      detail: {},
      starting: false,
      startMsg: '',
      pollTimer: null
    }
  },
  mounted() {
    this.loadLoops();
    this.pollTimer = setInterval(this.loadLoops, 5000);
    this.loadWorkflows();
  },
  beforeUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  },
  methods: {
    // Shared utilities
    __, fmtTokens, fmtTime,

    statusText(s) {
      var map = { created: '已创建', running: '运行中', completed: '已完成', aborted: '已终止', error: '错误' };
      return map[s] || s || '-';
    },
    // ===== Loop Engine Methods =====
    statusLabel(s) {
      var map = { created: '已创建', running: '运行中', completed: '已完成', aborted: '已终止', error: '错误' };
      return map[s] || s;
    },
    async loadLoops() {
      try {
        var r = await fetch('/api/loop/list');
        var d = await r.json();
        if (d.ok && Array.isArray(d.data)) {
          this.loops = d.data;
        }
      } catch(e) {}
    },
    async viewDetail(loopId) {
      try {
        var r = await fetch('/api/loop/status/' + loopId);
        var d = await r.json();
        if (d.ok && d.data) {
          this.detail = d.data;
        }
      } catch(e) {
        console.error('Load detail error:', e);
      }
    },
    async startLoop() {
      this.starting = true;
      this.startMsg = '';
      try {
        var r = await fetch('/api/loop/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.newLoop)
        });
        var d = await r.json();
        if (d.ok) {
          this.startMsg = '✅ ' + (d.message || this.__('loopStarted'));
          this.loadLoops();
        } else {
          this.startMsg = '❌ ' + (d.error || '启动失败');
        }
      } catch(e) {
        this.startMsg = '❌ ' + e.message;
      }
      this.starting = false;
      setTimeout(() => { this.startMsg = ''; }, 5000);
    },

    // ===== Workflow Editor Methods =====
    loadWorkflows() {
      API.get('/api/workflows').then(d => {
        if (d.ok) {
          this.workflows = d.workflows || [];
          this.templates = d.templates || [];
        }
      });
    },
    newWorkflow() {
      this.editId = null;
      this.editName = '新工作流';
      this.nodes = [];
      this.edges = [];
      this.selectedNode = null;
      this.nodeCounter = 0;
      this.editing = true;
    },
    createFromTemplate(t) {
      this.editId = null;
      this.editName = t.name;
      this.nodes = JSON.parse(JSON.stringify(t.nodes));
      this.edges = JSON.parse(JSON.stringify(t.edges));
      this.nodes.forEach((n, i) => { if (!n.x) n.x = 100 + i * 180; if (!n.y) n.y = 150; });
      this.nodeCounter = this.nodes.length;
      this.selectedNode = null;
      this.editing = true;
    },
    editWorkflow(wf) {
      this.editId = wf.id;
      this.editName = wf.name;
      this.nodes = JSON.parse(JSON.stringify(wf.nodes));
      this.edges = JSON.parse(JSON.stringify(wf.edges));
      this.nodeCounter = this.nodes.length;
      this.editing = true;
    },
    cancelEdit() {
      this.editing = false;
      this.loadWorkflows();
    },
    canvasClick(e) {
      if (e.target === e.currentTarget || e.target.tagName === 'svg') {
        var svg = this.$refs.wfSvgEl;
        if (!svg) return;
        var rect = svg.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        this.addNode('task', x, y);
      }
    },
    addNode(type, x, y) {
      this.nodeCounter++;
      var id = 'n' + this.nodeCounter;
      var labels = { task: '新任务', parallel: '并行', condition: '条件判断', notification: '通知' };
      var label = labels[type] || '新节点';
      var node = { id, type, label, description: '', estimatedMinutes: 30, x: x || 100 + (this.nodeCounter % 5) * 180, y: y || 100 + Math.floor(this.nodeCounter / 5) * 100 };
      this.nodes.push(node);
      this.selectedNode = node;
    },
    selectNode(n) { this.selectedNode = n; },
    deleteNode(n) {
      this.nodes = this.nodes.filter(x => x.id !== n.id);
      this.edges = this.edges.filter(e => e.from !== n.id && e.to !== n.id);
      this.selectedNode = null;
    },
    getNodeX(id) { var n = this.nodes.find(x => x.id === id); return n ? (n.x || 100) : 100; },
    getNodeY(id) { var n = this.nodes.find(x => x.id === id); return n ? (n.y || 150) : 150; },
    nodeColor(n) {
      return { task: '#1a1740', parallel: '#1a3a5c', condition: '#3a1a5c', notification: '#1a5c3a' }[n.type] || '#1a1740';
    },
    nodeTypeLabel(t) {
      return { task: '任务', parallel: '并行', condition: '条件判断', notification: '通知' }[t] || t;
    },
    validateWorkflow() {
      API.post('/api/workflows/validate', { nodes: this.nodes, edges: this.edges }).then(d => {
        alert(d.validation && d.validation.valid ? '✅ 拓扑验证通过' : '❌ ' + (d.validation && d.validation.error || '验证失败'));
      });
    },
    saveWorkflow() {
      var data = { name: this.editName, description: '', nodes: this.nodes, edges: this.edges };
      var method = this.editId ? 'put' : 'post';
      var url = this.editId ? '/api/workflows/' + this.editId : '/api/workflows';
      API[method](url, data).then(d => {
        if (d.ok) {
          this.editId = d.workflow ? d.workflow.id : this.editId;
          alert('✅ 已保存');
          this.loadWorkflows();
        } else { alert('❌ ' + (d.error || '保存失败')); }
      }).catch(e => alert('❌ ' + e.message));
    },
    saveAndRun() {
      this.saveWorkflow();
      setTimeout(() => {
        if (this.editId) {
          API.post('/api/workflows/' + this.editId + '/execute').then(d => {
            alert(d.ok ? '✅ 工作流已启动' : '❌ ' + (d.result && d.result.error || '执行失败'));
          });
        }
      }, 500);
    },
    runWorkflow(wf) {
      if (wf.status === 'running') return;
      API.post('/api/workflows/' + wf.id + '/execute').then(d => {
        alert(d.ok ? '✅ 工作流已启动' : '❌ ' + (d.result && d.result.error || '执行失败'));
        this.loadWorkflows();
      });
    },
    deleteWorkflow(wf) {
      if (!confirm('确认删除 "' + wf.name + '"？')) return;
      API.del('/api/workflows/' + wf.id).then(d => {
        if (d.ok) { this.loadWorkflows(); }
      });
    }
  }
};
</script>

<style scoped>

.loop-page { padding: 20px 24px; height: 100%; overflow-y: auto; }
.page-hdr { margin-bottom: 20px; }
.page-hdr h2 { font-size: 18px; margin: 0 0 4px; }
.page-desc { color: var(--fg2); font-size: 12px; margin: 0; }

.loop-section {
  background: var(--bg3, #1c1c30);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
}
.section-hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.form-row { display: flex; gap: 12px; flex-wrap: wrap; }
.form-group { flex: 1; min-width: 160px; }
.form-group label { display: block; font-size: 11px; color: var(--fg3); margin-bottom: 4px; }
.form-input {
  width: 100%;
  padding: 8px 10px;
  background: var(--bg2, #15152b);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  font-size: 13px;
  box-sizing: border-box;
}
.form-input:focus { outline: none; border-color: var(--accent, #4ecdc4); }
.form-actions { margin-top: 12px; display: flex; align-items: center; gap: 10px; }
.btn {
  padding: 8px 20px;
  background: var(--accent, #4ecdc4);
  color: #000;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-sm {
  padding: 4px 8px;
  background: var(--bg4);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  cursor: pointer;
  font-size: 12px;
}
.btn-hint { font-size: 12px; color: var(--fg2); }

.loop-table-wrap { overflow-x: auto; }
.loop-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.loop-table th {
  text-align: left;
  padding: 8px 10px;
  color: var(--fg3);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.loop-table td { padding: 8px 10px; border-bottom: 1px solid var(--border2); }
.loop-table tbody tr { cursor: pointer; }
.loop-table tbody tr:hover { background: var(--bg4, #252545); }
.td-id { font-family: monospace; font-size: 11px; color: var(--fg3); }
.td-goal { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-module { font-family: monospace; font-size: 11px; color: var(--accent, #4ecdc4); }
.td-time { font-size: 11px; color: var(--fg3); }

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}
.status-badge.created { background: #1e293b; color: #94a3b8; }
.status-badge.running { background: #1e3a5f; color: #60a5fa; }
.status-badge.completed { background: #064e3b; color: #34d399; }
.status-badge.aborted { background: #451a03; color: #fbbf24; }
.status-badge.error { background: #450a0a; color: #f87171; }

.empty-state { color: var(--fg3); font-size: 13px; padding: 20px; text-align: center; }

.detail-status { margin-bottom: 8px; font-size: 13px; }
.detail-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--fg2); margin-bottom: 12px; }

.round-list { max-height: 400px; overflow-y: auto; }
.round-item {
  padding: 10px;
  margin-bottom: 8px;
  background: var(--bg2, #15152b);
  border-radius: 6px;
  border-left: 3px solid var(--border);
}
.rh-hdr {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 11px;
  color: var(--fg2);
  margin-bottom: 6px;
}
.rh-round { font-weight: 700; color: var(--fg); }
.rh-tokens { font-family: monospace; }
.rh-audit { margin-left: auto; font-weight: 600; }
.rh-audit.pass { color: #34d399; }
.rh-audit.fail { color: #f87171; }
.rh-detail { font-size: 12px; }
.rh-action { margin-bottom: 4px; max-height: 60px; overflow: hidden; color: var(--fg2); }
.rh-result { max-height: 60px; overflow: hidden; color: var(--fg2); }

.result-box {
  margin-top: 12px;
  padding: 16px;
  border-radius: 8px;
  background: var(--bg2);
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.result-icon { font-size: 32px; }
.result-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
.result-detail { font-size: 12px; color: var(--fg2); margin-bottom: 4px; }
.result-stats { font-size: 11px; color: var(--fg3); }


/* Tab Bar */
.tab-bar{display:flex;gap:0;margin-bottom:16px;border-bottom:1px solid var(--border)}
.tab-btn{padding:8px 20px;border:none;background:transparent;color:var(--fg2);cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;transition:all .15s}
.tab-btn.active{color:var(--fg);border-bottom-color:var(--accent);font-weight:600}
.tab-btn:hover{color:var(--fg);background:rgba(255,255,255,0.03)}

/* Reset workflow page for embedded mode */
.workflow-page{padding:0;max-width:none;margin:0;height:auto}
.editor-container{height:500px}
</style>

<style>
/* Workflow editor styles (global for embedded) */

.workflow-page { padding: 20px; max-width: 1200px; margin: 0 auto; }
.page-header { margin-bottom: 20px; }
.page-header h2 { color: #fff; font-size: 20px; display: flex; align-items: center; gap: 8px; }
.desc { color: var(--fg2); font-size: 12px; margin-top: 4px; }
.toolbar { margin-bottom: 16px; }

/* Template Grid */
.template-section, .saved-section { margin-bottom: 24px; }
.template-section h3, .saved-section h3 { color: var(--fg2); font-size: 14px; margin-bottom: 10px; }
.template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.template-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; cursor: pointer; transition: all 0.15s; }
.template-card:hover { border-color: var(--accent); transform: translateY(-1px); }
.t-name { color: #fff; font-size: 14px; font-weight: 600; }
.t-desc { color: var(--fg2); font-size: 11px; margin-top: 4px; }
.t-meta { color: var(--fg3); font-size: 10px; margin-top: 6px; }

/* Workflow Cards */
.wf-card { display: flex; align-items: center; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; }
.wf-info { flex: 1; cursor: pointer; }
.wf-name { color: #fff; font-size: 14px; font-weight: 500; }
.wf-desc { color: var(--fg2); font-size: 11px; margin-top: 2px; }
.wf-meta { display: flex; gap: 12px; margin-top: 4px; font-size: 10px; color: var(--fg3); align-items: center; }
.wf-status { border-radius: 3px; padding: 1px 6px; font-weight: 500; }
.wf-status.draft { color: var(--fg2); background: rgba(255,255,255,0.05); }
.wf-status.running { color: #eab308; background: rgba(234,179,8,0.15); }
.wf-status.completed { color: #22c55e; background: rgba(34,197,94,0.15); }
.wf-status.completed_with_errors { color: #f97316; background: rgba(249,115,22,0.15); }
.wf-actions { display: flex; gap: 4px; margin-left: 12px; }

/* Editor */
.editor-container { display: flex; flex-direction: column; height: calc(100vh - 120px); }
.editor-toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); margin-bottom: 8px; }
.wf-title-input { background: transparent; border: none; color: #fff; font-size: 18px; font-weight: 600; outline: none; flex: 1; }
.editor-actions { display: flex; gap: 6px; }
.canvas-area { flex: 1; display: flex; gap: 12px; overflow: hidden; }
.dag-svg { flex: 1; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; cursor: crosshair; min-height: 400px; }
.dag-node { cursor: pointer; }
.dag-node:hover rect { stroke-width: 2.5; }
.dag-node.selected rect { stroke: var(--accent); stroke-width: 2.5; filter: drop-shadow(0 0 6px rgba(78,205,196,0.4)); }
.edge-conditional { stroke: #eab308; }
.add-node-bar { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
.add-hint { color: var(--fg3); font-size: 11px; margin-left: auto; }

/* Properties Panel */
.node-panel { width: 260px; min-width: 260px; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; overflow-y: auto; }
.node-panel h4 { color: #fff; font-size: 13px; margin-bottom: 10px; }
.prop-row { margin-bottom: 8px; }
.prop-row label { display: block; color: var(--fg2); font-size: 11px; margin-bottom: 2px; }
.prop-input { width: 100%; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--fg); font-size: 12px; outline: none; box-sizing: border-box; }
.prop-input:focus { border-color: var(--accent); }
.prop-input select { cursor: pointer; }
.prop-actions { margin-top: 12px; }

/* Buttons */
.btn { cursor: pointer; border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 500; }
.btn-primary { background: var(--accent); color: #0f0c29; }
.btn-primary:hover { opacity: 0.9; }
.btn-ghost { border: 1px solid var(--border); color: var(--fg2); background: transparent; }
.btn-ghost:hover { background: rgba(255,255,255,0.05); }
.btn-sm { padding: 4px 8px; font-size: 11px; }
.btn-danger { color: #ef4444; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.empty-state { text-align: center; padding: 40px; color: var(--fg3); font-size: 13px; }

</style>
