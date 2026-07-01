<template>
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
        <svg class="dag-svg" ref="svgEl" @click="canvasClick">
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

<script>
import { __ } from '../i18n'
import { API } from '../main.js'
export default {
  data() {
    return {
      workflows: [],
      templates: [],
      editing: false,
      editId: null,
      editName: '',
      nodes: [],
      edges: [],
      selectedNode: null,
      nodeCounter: 0
    }
  },
  methods: {
    load() {
      API.get('/api/workflows').then(d => {
        if (d.ok) {
          this.workflows = d.workflows || []
          this.templates = d.templates || []
        }
      })
    },
    statusText(s) {
      return { draft: this.__('workflowStatusDraft'), active: this.__('workflowStatusActive'), running: this.__('workflowStatusRunning'), completed: this.__('workflowStatusDone'), failed: '失败' }[s] || s
    },
    newWorkflow() {
      this.editId = null
      this.editName = this.__('workflowNewName')
      this.nodes = []
      this.edges = []
      this.selectedNode = null
      this.nodeCounter = 0
      this.editing = true
    },
    createFromTemplate(t) {
      this.editId = null
      this.editName = t.name
      this.nodes = JSON.parse(JSON.stringify(t.nodes))
      this.edges = JSON.parse(JSON.stringify(t.edges))
      this.nodes.forEach((n, i) => { if (!n.x) n.x = 100 + i * 180; if (!n.y) n.y = 150; })
      this.nodeCounter = this.nodes.length
      this.selectedNode = null
      this.editing = true
    },
    editWorkflow(wf) {
      this.editId = wf.id
      this.editName = wf.name
      this.nodes = JSON.parse(JSON.stringify(wf.nodes))
      this.edges = JSON.parse(JSON.stringify(wf.edges))
      this.nodeCounter = this.nodes.length
      this.editing = true
    },
    cancelEdit() {
      this.editing = false
      this.load()
    },
    canvasClick(e) {
      if (e.target === e.currentTarget || e.target.tagName === 'svg') {
        var svg = this.$refs.svgEl
        var rect = svg.getBoundingClientRect()
        var x = e.clientX - rect.left
        var y = e.clientY - rect.top
        this.addNode('task', x, y)
      }
    },
    addNode(type, x, y) {
      this.nodeCounter++
      var id = 'n' + this.nodeCounter
      var label = { task: '新' + this.__('workflowTypeTask'), parallel: this.__('workflowTypeParallel'), condition: this.__('workflowTypeCondition') + '判断', notification: this.__('workflowTypeNotify') }[type] || '新' + this.__('workflowNode')
      var node = { id, type, label, description: '', estimatedMinutes: 30, x: x || 100 + (this.nodeCounter % 5) * 180, y: y || 100 + Math.floor(this.nodeCounter / 5) * 100 }
      this.nodes.push(node)
      this.selectedNode = node
    },
    selectNode(n) { this.selectedNode = n },
    deleteNode(n) {
      this.nodes = this.nodes.filter(x => x.id !== n.id)
      this.edges = this.edges.filter(e => e.from !== n.id && e.to !== n.id)
      this.selectedNode = null
    },
    getNodeX(id) { var n = this.nodes.find(x => x.id === id); return n ? (n.x || 100) : 100 },
    getNodeY(id) { var n = this.nodes.find(x => x.id === id); return n ? (n.y || 150) : 150 },
    nodeColor(n) {
      return { task: '#1a1740', parallel: '#1a3a5c', condition: '#3a1a5c', notification: '#1a5c3a' }[n.type] || '#1a1740'
    },
    nodeTypeLabel(t) {
      return { task: this.__('workflowTypeTask'), parallel: this.__('workflowTypeParallel'), condition: this.__('workflowTypeCondition'), notification: this.__('workflowTypeNotify') }[t] || t
    },
    validateWorkflow() {
      API.post('/api/workflows/validate', { nodes: this.nodes, edges: this.edges }).then(d => {
        alert(d.validation && d.validation.valid ? '✅ 拓扑' + this.__('workflowValidate') + '通过' : '❌ ' + (d.validation && d.validation.error || this.__('workflowValidate') + '失败'))
      })
    },
    saveWorkflow() {
      var data = { name: this.editName, description: '', nodes: this.nodes, edges: this.edges }
      var method = this.editId ? 'put' : 'post'
      var url = this.editId ? '/api/workflows/' + this.editId : '/api/workflows'
      API[method](url, data).then(d => {
        if (d.ok) {
          this.editId = d.workflow ? d.workflow.id : this.editId
          alert('✅ 已' + this.__('workflowSave'))
          this.load()
        } else { alert('❌ ' + (d.error || this.__('workflowSaveFail'))) }
      }).catch(e => alert('❌ ' + e.message))
    },
    saveAndRun() {
      this.saveWorkflow()
      // After save, trigger execution
      setTimeout(() => {
        if (this.editId) {
          API.post('/api/workflows/' + this.editId + '/execute').then(d => {
            alert(d.ok ? '✅ ' + this.__('workflowStarted') : '❌ ' + (d.result && d.result.error || this.__('workflowExecFail')))
          })
        }
      }, 500)
    },
    runWorkflow(wf) {
      if (wf.status === 'running') return
      API.post('/api/workflows/' + wf.id + '/execute').then(d => {
        alert(d.ok ? '✅ ' + this.__('workflowStarted') : '❌ ' + (d.result && d.result.error || this.__('workflowExecFail')))
        this.load()
      })
    },
    deleteWorkflow(wf) {
      if (!confirm(this.__('workflowConfirmDel') + ' "' + wf.name + '"？')) return
      API.del('/api/workflows/' + wf.id).then(d => {
        if (d.ok) { this.load() }
      })
    }
  },
  mounted() { this.load() }
}
</script>

<style scoped>
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
