<template>
  <div class="mem-page">
    <div class="page-hdr"><h2>🧠 {{ __('memoryTitle') }}</h2><p class="page-desc">{{ __('memoryDesc') }}</p></div>
    <div class="mem-tabs">
      <span class="mem-tab" :class="{active:activeTab==='core'}" @click="activeTab='core'">🧠 {{ __('memoryCoreTab') }}</span>
      <span class="mem-tab" :class="{active:activeTab==='kb'}" @click="activeTab='kb'">📚 {{ __('memoryKbTab') }}</span>
      <span class="mem-tab" :class="{active:activeTab==='habits'}" @click="activeTab='habits';loadHabits()">👤 {{ __('harness.habitsTab') }}</span>
    </div>

    <!-- ===== {{ __('memoryCoreTab') }} Tab ===== -->
    <div v-if="activeTab==='core'" class="mem-section">
      <div class="mem-toolbar">
        <div class="mem-search-box"><input v-model="searchQuery" placeholder="搜索记忆…" @input="debounceSearch" /></div>
        <div class="mem-filter">
          <button v-for="t in filterTypes" :key="t" :class="['mem-filter-btn', {active:filterType===t}]" @click="filterType=t">{{ t==='all'?__('memoryFilterAll'):t }}</button>
        </div>
        <div class="mem-stats">共 {{ filteredItems.length }} 条</div>
      </div>
      <div class="mem-list" ref="memList" @scroll="onScroll">
        <div v-for="item in paginatedItems" :key="item.id" class="mem-item" :class="'type-'+item.type">
          <div class="mem-priority" :class="'priority-'+getPriority(item)">{{ getPriorityLabel(item) }}</div>
          <div class="mem-content">{{ item.content || item.text }}</div>
          <div class="mem-meta">
            <span class="mem-type">{{ item.type || 'general' }}</span>
            <span class="mem-tags" v-if="item.tags?.length">🏷️ {{ item.tags.slice(0,3).join(', ') }}</span>
            <span class="mem-time">{{ fmtTime(item.createdAt || item.timestamp) }}</span>
          </div>
        </div>
        <div v-if="!paginatedItems.length" class="mem-empty">{{ __('memoryNoMatch') }}</div>
        <div v-if="loading" class="mem-loading">{{ __('memoryLoading') }}…</div>
      </div>
    </div>

    <!-- ===== {{ __('memoryKbTab') }} Tab ===== -->
    <div v-if="activeTab==='kb'" class="kb-section">
      <div class="kb-toolbar">
        <div class="kb-search-box"><input v-model="kbQuery" :placeholder="__('memoryKbTab')" @keyup.enter="searchKB" /></div>
        <button class="kb-add-btn" @click="showKBForm=true" v-if="!showKBForm">➕ {{ __('memoryNewEntry') }}</button>
      </div>

      <!-- {{ __('memoryEditForm') }} -->
      <div v-if="showKBForm" class="kb-form">
        <input v-model="kbForm.title" placeholder="标题" class="kb-input" />
        <textarea v-model="kbForm.content" placeholder="内容" class="kb-textarea" rows="4"></textarea>
        <input v-model="kbForm.tags" :placeholder="__('memoryTagsPlaceholder') + '（逗号分隔）'" class="kb-input" />
        <input v-model="kbForm.category" placeholder="分类（可选）" class="kb-input" />
        <div class="kb-form-actions">
          <button class="kb-add-btn" @click="saveKB">✅ 保存</button>
          <button class="kb-cancel-btn" @click="showKBForm=false; resetKBForm()">{{ __('memoryCancel') }}</button>
        </div>
      </div>

      <!-- {{ __('memorySearchResult') }} / 列表 -->
      <div class="kb-list">
        <div v-for="item in kbItems" :key="item.id||item._id" class="kb-item">
          <div class="kb-item-title">{{ item.title }}</div>
          <div class="kb-item-content">{{ truncate(item.content,120) }}</div>
          <div class="kb-item-meta">
            <span v-if="item.category" class="kb-cat">{{ item.category }}</span>
            <span v-if="item.tags" class="kb-tags">{{ Array.isArray(item.tags) ? item.tags.join(', ') : item.tags }}</span>
            <span class="kb-time">{{ fmtTime(item.createdAt||item.updatedAt) }}</span>
          </div>
          <div class="kb-item-actions">
            <button class="kb-sm-btn" @click="editKB(item)">{{ __('memoryEdit') }}</button>
            <button class="kb-sm-btn" @click="showVersionHistory(item)">📜 版本</button>
            <button class="kb-sm-btn-del" @click="delKB(item.id||item._id)">{{ __('memoryDelete') }}</button>
          </div>
        </div>
        <div v-if="!kbItems.length && !kbLoading" class="mem-empty">暂无{{ __('memoryKbTab') }}条目</div>
        <div v-if="kbLoading" class="mem-loading">{{ __('memoryLoading') }}…</div>
      </div>
    </div>

    <!-- ===== Habits Tab ===== -->
    <div v-if="activeTab==='habits'" class="tab-content">
      <div class="settings-section">
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          <button @click="habTab='analyze'" :class="{active:habTab==='analyze'}" class="btn btn-ghost" style="font-size:12px;padding:4px 12px">📊 {{ __('harnessTrendAnalysis') }}</button>
          <button @click="habTab='pending'" :class="{active:habTab==='pending'}" class="btn btn-ghost" style="font-size:12px;padding:4px 12px">
            {{ __('harness.pending') }} <span v-if="pendingList.length" style="background:var(--accent);color:#fff;border-radius:10px;padding:0 6px;font-size:10px;margin-left:4px">{{ pendingList.length }}</span>
          </button>
          <button @click="habTab='confirmed'" :class="{active:habTab==='confirmed'}" class="btn btn-ghost" style="font-size:12px;padding:4px 12px">✅ {{ __('harnessConfirmedPrefs') }}</button>
          <button @click="habTab='record'" :class="{active:habTab==='record'}" class="btn btn-ghost" style="font-size:12px;padding:4px 12px">✏️ {{ __('harnessManualRecord') }}</button>
          <button @click="generateConfirmations" class="btn btn-primary" style="margin-left:auto;font-size:11px">{{ __('harness.aiSpeculate') }}</button>
        </div>

        <div v-if="habTab==='analyze'">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="margin:0;font-size:14px">{{ __('harness.habitTrends') }}</h3>
            <button @click="loadAnalysis" class="btn btn-ghost" style="font-size:11px">{{ __('harness.refresh') }}</button>
          </div>
          <div v-if="!analysis" style="text-align:center;padding:24px;color:var(--fg3);font-size:13px">
            <p>{{ __('harnessHintNoData') }}</p>
            <button @click="loadAnalysis" class="btn btn-primary" style="margin-top:8px">📊 {{ __('harnessLoadTrend') }}</button>
          </div>
          <div v-else>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;font-size:12px;color:var(--fg3)">
              <span>{{ __('harness.totalEvents') }}: {{ (analysis.analysis || {}).totalEvents || 0 }}</span>
              <span>{{ __('harness.analysisRange') }}: {{ (analysis.analysis || {}).daysAnalyzed || '-' }} {{ __('harness.days') }}</span>
              <span>{{ __('harness.activeTrends') }}: {{ ((analysis.analysis || {}).topTrends || []).length }} {{ __('harness.trends') }}</span>
              <span>{{ __('harness.confirmedPrefsCounts') }}: {{ (analysis.confirmedPreferences || []).length }} {{ __('harness.prefs') }}</span>
            </div>
            <div v-for="t in ((analysis.analysis || {}).topTrends || [])" :key="t.action" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <span :style="{fontSize:'10px',padding:'1px 6px',borderRadius:'4px',marginRight:'6px',fontWeight:600,color:catColor(t.category)}">{{ catLabel(t.category) }}</span>
                  <span style="font-weight:500;font-size:13px">{{ t.action }}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--fg3)">
                  <span>{{ __('harnessFrequency') }}: {{ t.frequency }}</span>
                  <span>{{ __('harnessWeight') }}: {{ t.weightedScore }}</span>
                  <span v-if="t.lastSeenDaysAgo <= 7" style="color:#22c55e">{{ __('harness.active') }}</span>
                  <span v-else-if="t.lastSeenDaysAgo <= 30" style="color:#eab308">{{ __('harness.recent') }}</span>
                  <span v-else style="color:var(--fg3)">{{ __('harness.decayed') }}</span>
                </div>
              </div>
              <div v-if="(t.samples || []).length" style="font-size:11px;color:var(--fg3);margin-top:2px">
                💡 {{ t.samples.join(' · ') }}
              </div>
            </div>
          </div>
        </div>

        <div v-if="habTab==='pending'">
          <h3 style="font-size:14px;margin-bottom:12px">{{ __('harness.pending') }}的偏好推测 ({{ pendingList.length }})</h3>
          <div v-if="!pendingList.length" style="text-align:center;padding:24px;color:var(--fg3);font-size:13px">
            <p>{{ __('harness.noPendingPrefs') }}</p>
            <button @click="generateConfirmations" class="btn btn-primary">{{ __('harness.aiAnalyzePrefs') }}</button>
          </div>
          <div v-for="p in pendingList" :key="p.id" style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:8px">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
              <div style="flex:1">
                <div style="font-weight:500;font-size:13px">{{ p.inferredLabel }}</div>
                <div style="font-size:11px;color:var(--fg3);margin-top:4px">
                  {{ __('harness.confidence') }}: {{ Math.round((p.confidence || 0) * 100) }}% · 
                  {{ __('harness.occurred') }} {{ ((p.evidence || {}).occurrences || 0) }} 次 · 
                  {{ __('harness.weightedScore') }} {{ ((p.evidence || {}).weightedScore || 0) }}
                </div>
                <div v-if="((p.evidence || {}).samples || []).length" style="font-size:11px;color:var(--fg2);margin-top:4px">
                  {{ __('harness.samples') }}: {{ (p.evidence.samples || []).join(' · ') }}
                </div>
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0">
                <button @click="confirmPreference(p.id, true, '')" style="font-size:11px;padding:4px 10px;background:rgba(34,197,94,0.2);color:#22c55e;border:1px solid #22c55e;border-radius:4px;cursor:pointer">{{ __('harness.confirm') }}</button>
                <button @click="rejectPreference(p.id)" style="font-size:11px;padding:4px 10px;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid #ef4444;border-radius:4px;cursor:pointer">{{ __('harness.deny') }}</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="habTab==='confirmed'">
          <h3 style="font-size:14px;margin-bottom:12px">{{ __('harness.confirmedPrefs') }} ({{ confirmedList.length }})</h3>
          <div v-if="!confirmedList.length" style="text-align:center;padding:24px;color:var(--fg3);font-size:13px">{{ __('harness.noConfirmedPrefs') }}</div>
          <div v-for="p in confirmedList" :key="p.id" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px">
            <div>{{ p.inferredLabel }}</div>
            <div style="font-size:11px;color:var(--fg3)">
              {{ __('harness.confidence') }}: {{ Math.round((p.confidence || 0) * 100) }}% · 
              {{ new Date(p.confirmedAt).toLocaleDateString() }} {{ __('harness.confirmed') }}
              <span v-if="p.note"> · {{ __('harness.note') }}: {{ p.note }}</span>
            </div>
          </div>
        </div>

        <div v-if="habTab==='record'">
          <h3 style="font-size:14px;margin-bottom:12px">{{ __('harness.manualRecord') }}</h3>
          <div style="display:flex;flex-direction:column;gap:8px;max-width:500px">
            <select v-model="recCat" style="padding:8px;border-radius:6px;background:var(--bg2);color:var(--fg);border:1px solid var(--border)">
              <option value="command">{{ __('harness.habitCmd') }}</option>
              <option value="preference">{{ __('harness.habitPref') }}</option>
              <option value="format">{{ __('harness.habitFormat') }}</option>
              <option value="report">{{ __('harness.habitReport') }}</option>
              <option value="workflow">{{ __('harness.habitWorkflow') }}</option>
            </select>
            <input v-model="recAction" placeholder="{{ __('harness.behaviorDesc') }}" style="padding:8px;border-radius:6px;background:var(--bg2);color:var(--fg);border:1px solid var(--border)">
            <input v-model="recNote" placeholder="{{ __('harness.detailOptional') }}" style="padding:8px;border-radius:6px;background:var(--bg2);color:var(--fg);border:1px solid var(--border)">
            <button @click="manualRecord" :disabled="!recAction" class="btn btn-primary" style="align-self:flex-start">{{ __('harness.record') }}</button>
            <div v-if="recMsg" style="font-size:12px;color:#22c55e">{{ recMsg }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <!-- 版本历史弹窗 -->
  <div class="kb-version-overlay" v-if="showVersion" @click.self="showVersion=false">
    <div class="kb-version-panel">
      <div class="kb-version-header">
        <h3>📜 版本历史: {{ versionEntry?.title }}</h3>
        <button class="kb-close-btn" @click="showVersion=false">✕</button>
      </div>
      <div class="kb-version-list">
        <div v-for="(v,i) in versionHistory" :key="i" class="kb-version-item">
          <div class="kb-version-meta">
            <span class="kb-ver">v{{ v.version }}</span>
            <span class="kb-ver-time">{{ fmtTime(v.savedAt) }}</span>
          </div>
          <div class="kb-version-preview">{{ truncate(v.content, 200) }}</div>
          <div class="kb-version-actions">
            <button class="kb-sm-btn" @click="rollbackVersion(v.version)">↩️ 回滚到此版本</button>
          </div>
        </div>
        <div v-if="!versionHistory.length" class="mem-empty">暂无历史版本</div>
      </div>
    </div>
  </div>
</template>

<script>
import { __ } from '../i18n'
var searchTimer = null;
function fmtTime(iso){
  if(!iso)return '';
  try{return new Date(iso).toLocaleString('zh-CN');}catch(e){return iso;}
}
function truncate(s,n){
  if(!s)return '';
  return s.length>n?s.slice(0,n)+'…':s;
}
export default {
  data(){
    return{
      activeTab:'core',
      // core memory
      items:[], searchQuery:'', filterType:'all', loading:false,
      filterTypes:['all','decision','task','knowledge','performance','preference','general'],
      page:1, pageSize:20,
      // kb
      kbQuery:'', kbItems:[], kbLoading:false,
      showKBForm:false, kbForm:{title:'',content:'',tags:'',category:''},
      // habits
      habTab:'analyze',analysis:null,pendingList:[],confirmedList:[],
      recCat:'',recAction:'',recNote:'',recMsg:'',trends:[],
      kbEditId:null
    }
  },
  computed:{
    filteredItems(){
      var q=(this.searchQuery||'').toLowerCase();
      var t=this.filterType;
      return this.items.filter(function(i){
        if(t!=='all'&&(i.type||'general')!==t)return false;
        if(!q)return true;
        var c=(i.content||i.text||'').toLowerCase();
        var tags=(i.tags||[]).join(' ').toLowerCase();
        return c.indexOf(q)!==-1||tags.indexOf(q)!==-1;
      });
    },
    paginatedItems(){
      return this.filteredItems.slice(0,this.page*this.pageSize);
    }
  },
  mounted(){
    this.loadMemory();
    this.loadKB();
  },
  methods:{
    fmtTime,truncate,
    getPriority(i){return i.priority||'medium'},
    getPriorityLabel(i){
      var p=i.priority||'medium';
      return p==='high'?'🔴'+this.__('memoryPriorityHigh'):
        p==='low'?'🟢'+this.__('memoryPriorityLow'):
        '🟡'+this.__('memoryPriorityMedium');
    },
    debounceSearch(){
      clearTimeout(searchTimer);
      var self=this;
      searchTimer=setTimeout(function(){self.page=1},300);
    },
    onScroll(e){
      var el=e.target;
      if(el.scrollHeight-el.scrollTop-el.clientHeight<100&&!this.loading){
        this.page++;
      }
    },
    // === Core Memory ===
    async loadMemory(){
      this.loading=true;
      try{
        var r=await fetch('/api/core-memory/list');
        var d=await r.json();
        if(d.ok)this.items=d.memories||d.items||[];
      }catch(e){console.error(e)}
      this.loading=false;
    },
    // === Knowledge Base ===
    async loadKB(){
      this.kbLoading=true;
      try{
        var url='/api/kb/entries';
        var r=await fetch(url);
        var d=await r.json();
        if(d.ok)this.kbItems=d.items||d.entries||d.data||[];
      }catch(e){console.error('KB load err:',e)}
      this.kbLoading=false;
    },
    async searchKB(){
      this.kbLoading=true;
      try{
        var q=this.kbQuery.trim();
        var url=q?'/api/kb/search?q='+encodeURIComponent(q):'/api/kb/entries';
        var r=await fetch(url);
        var d=await r.json();
        if(d.ok) this.kbItems=d.items||d.entries||d.data||[];
      }catch(e){console.error('KB search err:',e)}
      this.kbLoading=false;
    },
    resetKBForm(){
      this.kbForm={title:'',content:'',tags:'',category:''};
      this.kbEditId=null;
    },
    editKB(item){
      this.kbEditId=item.id||item._id;
      this.kbForm={
        title:item.title||'',
        content:item.content||'',
        tags:Array.isArray(item.tags)?item.tags.join(', '):(item.tags||''),
        category:item.category||''
      };
      this.showKBForm=true;
    },
    async saveKB(){
      if(!this.kbForm.title||!this.kbForm.content)return;
      var body={
        title:this.kbForm.title,
        content:this.kbForm.content,
        tags:this.kbForm.tags.split(',').map(s=>s.trim()).filter(Boolean),
        category:this.kbForm.category
      };
      try{
        var url='/api/kb/entries';
        var method='POST';
        if(this.kbEditId){
          url='/api/kb/entries/'+this.kbEditId;
          method='PUT';
        }
        var r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        var d=await r.json();
        if(d.ok){
          this.showKBForm=false;
          this.resetKBForm();
          this.loadKB();
        }
      }catch(e){console.error('KB save err:',e)}
    },
    async delKB(id){
      if(!id||!confirm('确定'+this.__('memoryDelete')+'这条知识吗？'))return;
      try{
        var r=await fetch('/api/kb/entries/'+id,{method:'DELETE'});
        var d=await r.json();
        if(d.ok)this.loadKB();
      }catch(e){console.error('KB del err:',e)}
    },
    async showVersionHistory(item){
      this.versionEntry=item;
      this.versionHistory=item.history||[];
      this.showVersion=true;
      // 从服务器获取最新历史
      try{
        var r=await fetch('/api/kb/entries/'+item.id+'/history');
        var d=await r.json();
        if(d.ok&&d.history){
          this.versionHistory=d.history;
        }
      }catch(e){}
    },
    async rollbackVersion(ver){
      if(!confirm('确定回滚到版本 v'+ver+'？当前版本将被保存到历史。'))return;
      try{
        var r=await fetch('/api/kb/entries/'+this.versionEntry.id+'/rollback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:ver})});
        var d=await r.json();
        if(d.ok){
          this.showVersion=false;
          this.loadKB();
          alert('已回滚到版本 v'+ver);
        }else{alert('回滚失败: '+(d.error||'未知错误'))}
      }catch(e){alert('网络错误: '+e.message)}
    },
    // === Habits ===
    async loadHabits(){
      await this.loadAnalysis();
      await this.loadPending();
    },
    async loadAnalysis(){
      try{
        var e=await fetch('/api/harness/habits/report?days=90');
        var d=await e.json();
        if(d&&d.data&&d.data.analysis) this.analysis=d.data;
        else if(d&&d.analysis) this.analysis={analysis:d.analysis};
        else this.analysis={analysis:{totalEvents:0}};
      }catch(e){console.error('habits load error',e)}
      try{
        var t=await fetch('/api/harness/habits/trends?days=90');
        var td=await t.json();
        if(td) this.trends=Array.isArray(td)?td:td.trends||[];
      }catch(e){}
    },
    async generateConfirmations(){
      try{
        var e=await fetch('/api/harness/habits/generate',{method:'POST'});
        var d=await e.json();
        if(d&&d.pending) this.pendingList=d.pending;
        await this.loadAnalysis();
        await this.loadPending();
      }catch(e){console.error('generate err',e)}
    },
    async confirmPreference(id,confirmed,note){
      try{
        var r=await fetch('/api/harness/habits/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,confirmed:confirmed!==false,note:note||''})});
        var d=await r.json();
        if(d&&d.ok){
          await this.loadAnalysis();
          await this.loadPending();
        }
      }catch(e){console.error('confirm err',e)}
    },
    rejectPreference(id){this.confirmPreference(id,false,'');},
    async manualRecord(){
      if(!this.recAction) return alert('请填写行为描述');
      try{
        var r=await fetch('/api/harness/habits/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:this.recCat,action:this.recAction,note:this.recNote||''})});
        var d=await r.json();
        if(d&&d.id){
          alert('记录成功');
          this.recCat='';this.recAction='';this.recNote='';this.recMsg='记录成功！';
          await this.loadAnalysis();
        }else alert('记录失败');
      }catch(e){console.error('record err',e)}
    },
    async loadPending(){
      try{
        var e=await fetch('/api/harness/habits/pending');
        var d=await e.json();
        if(d) this.pendingList=Array.isArray(d)?d:d.pending||[];
      }catch(e){}
    },
    catLabel(cat){
      return {command:'命令',preference:'偏好',format:'格式',report:'报表',workflow:'流程',general:'通用'}[cat]||cat;
    },
    catColor(cat){
      return {command:'#3b82f6',preference:'#22c55e',format:'#eab308',report:'#a8557f',workflow:'#f97316',general:'#6b7280'}[cat]||'var(--fg3)';
    }
  }
}
</script>

<style scoped>
.mem-page{padding:20px 24px;height:100%;overflow-y:auto}
.page-hdr{margin-bottom:16px}.page-hdr h2{font-size:18px;margin:0 0 4px}
.page-desc{color:var(--fg2);font-size:12px;margin:0}
.mem-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:8px}
.mem-tab{padding:4px 14px;border-radius:6px;font-size:13px;cursor:pointer;color:var(--fg2);transition:all 0.15s}
.mem-tab:hover{background:var(--bg4);color:var(--fg)}
.mem-tab.active{background:var(--accent,#4ecdc4);color:#000}

/* === Core Memory === */
.mem-section{display:flex;flex-direction:column;height:calc(100% - 60px)}
.mem-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.mem-search-box{flex:1;min-width:150px}
.mem-search-box input{width:100%;padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--fg);font-size:12px;outline:none}
.mem-search-box input:focus{border-color:var(--accent)}
.mem-filter{display:flex;gap:4px;flex-wrap:wrap}
.mem-filter-btn{padding:3px 10px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--fg2);font-size:11px;cursor:pointer;transition:all 0.15s}
.mem-filter-btn.active{background:var(--accent,#4ecdc4);color:#000;border-color:var(--accent)}
.mem-stats{font-size:11px;color:var(--fg3);white-space:nowrap}
.mem-list{flex:1;overflow-y:auto;scrollbar-width:thin;display:flex;flex-direction:column;gap:4px}
.mem-item{display:flex;flex-direction:column;gap:4px;padding:8px 12px;background:var(--bg3,#1c1c30);border-radius:8px;border:1px solid var(--border);transition:all 0.15s}
.mem-item:hover{background:var(--bg4);border-color:var(--accent)}
.mem-item.type-decision{border-left:3px solid #8b5cf6}
.mem-item.type-task{border-left:3px solid #4ecdc4}
.mem-item.type-knowledge{border-left:3px solid #f59e0b}
.mem-item.type-performance{border-left:3px solid #10b981}
.mem-item.type-preference{border-left:3px solid #ec4899}
.mem-priority{font-size:9px;font-weight:600;text-transform:uppercase}
.priority-high{color:#ef4444}
.priority-medium{color:#eab308}
.priority-low{color:#10b981}
.mem-content{font-size:12px;color:var(--fg);line-height:1.4;word-break:break-word}
.mem-meta{display:flex;gap:8px;font-size:10px;color:var(--fg3);flex-wrap:wrap}
.mem-type{background:var(--bg4);padding:1px 6px;border-radius:4px}
.mem-empty,.mem-loading{padding:30px;text-align:center;color:var(--fg3);font-size:13px}

/* === Knowledge Base === */
.kb-section{display:flex;flex-direction:column}
.kb-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.kb-search-box{flex:1;min-width:150px}
.kb-search-box input{width:100%;padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--fg);font-size:12px;outline:none}
.kb-search-box input:focus{border-color:var(--accent)}
.kb-add-btn{padding:6px 14px;border-radius:6px;border:1px solid var(--accent,#4ecdc4);background:transparent;color:var(--accent);cursor:pointer;font-size:11px;transition:all 0.15s;white-space:nowrap}
.kb-add-btn:hover{background:var(--accent);color:#000}
.kb-cancel-btn{padding:6px 14px;border-radius:6px;border:1px solid var(--fg3);background:transparent;color:var(--fg2);cursor:pointer;font-size:11px}
.kb-form{display:flex;flex-direction:column;gap:6px;padding:12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);margin-bottom:10px}
.kb-input{padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg4);color:var(--fg);font-size:12px;outline:none}
.kb-input:focus{border-color:var(--accent)}
.kb-textarea{padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg4);color:var(--fg);font-size:12px;outline:none;resize:vertical;font-family:inherit}
.kb-textarea:focus{border-color:var(--accent)}
.kb-form-actions{display:flex;gap:6px;margin-top:2px}
.kb-list{display:flex;flex-direction:column;gap:6px}
.kb-item{display:flex;flex-direction:column;gap:4px;padding:10px 12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);transition:all 0.15s}
.kb-item:hover{border-color:var(--accent);background:var(--bg4)}
.kb-item-title{font-size:13px;font-weight:600;color:var(--fg)}
.kb-item-content{font-size:11px;color:var(--fg2);line-height:1.4;word-break:break-word}
.kb-item-meta{display:flex;gap:6px;flex-wrap:wrap;font-size:10px;color:var(--fg3)}
.kb-cat{background:var(--bg4);padding:1px 6px;border-radius:4px;color:var(--accent)}
.kb-item-actions{display:flex;gap:4px}
.kb-sm-btn{padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--fg2);font-size:10px;cursor:pointer}
.kb-sm-btn:hover{background:var(--bg4);color:var(--fg)}
.kb-sm-btn-del{padding:2px 8px;border-radius:4px;border:1px solid #ef4444;background:transparent;color:#ef4444;font-size:10px;cursor:pointer}
.kb-sm-btn-del:hover{background:#ef4444;color:#fff}
.kb-version-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center}.kb-version-panel{background:var(--bg2,#15152b);border-radius:12px;padding:20px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;border:1px solid var(--border)}.kb-version-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.kb-version-header h3{margin:0;font-size:15px}.kb-close-btn{background:none;border:none;color:var(--fg3);font-size:18px;cursor:pointer}.kb-close-btn:hover{color:var(--fg)}.kb-version-item{padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:var(--bg3,#1c1c30)}.kb-version-meta{display:flex;gap:10px;margin-bottom:6px}.kb-ver{font-weight:700;color:var(--accent,#4ecdc4);font-size:13px}.kb-ver-time{font-size:11px;color:var(--fg3)}.kb-version-preview{font-size:12px;color:var(--fg2);margin-bottom:8px;white-space:pre-wrap;max-height:80px;overflow:hidden}.kb-version-actions{text-align:right}
</style>