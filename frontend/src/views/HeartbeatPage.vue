<template>
  <div class="hb-page">
    <div class="page-hdr"><h2>❤️ {{ __('heartbeatTitle') }}</h2><p class="page-desc">{{ __('heartbeatDesc') }}</p></div>
    <div class="hb-section">
      <div class="hb-card">
        <div class="hb-row"><span>{{ __('heartbeatInterval') }}</span>
          <select v-model="cfg.patrolIntervalMs" class="hb-select">
            <option :value="60000">1 {{ __('heartbeatMinutes') }}</option>
            <option :value="300000">5 {{ __('heartbeatMinutes') }}</option>
            <option :value="600000">10 {{ __('heartbeatMinutes') }}</option>
            <option :value="1800000">30 {{ __('heartbeatMinutes') }}</option>
          </select>
        </div>
        <div class="hb-row"><span>{{ __('heartbeatBeatInterval') }}</span>
          <select v-model="cfg.intervalMs" class="hb-select">
            <option :value="30000">30 秒</option>
            <option :value="60000">1 {{ __('heartbeatMinutes') }}</option>
            <option :value="300000">5 {{ __('heartbeatMinutes') }}</option>
          </select>
        </div>
        <div class="hb-row"><span>CEO巡检</span><label class="hb-toggle"><input type="checkbox" v-model="cfg.patrolEnabled" /><span class="toggle-slider"></span></label></div>
        <div class="hb-row"><span>Agent心跳</span><label class="hb-toggle"><input type="checkbox" v-model="cfg.enabled" /><span class="toggle-slider"></span></label></div>
      </div>
      <div class="hb-card">
        <div class="hb-card-title">{{ __('heartbeatMonitorStatus') }}</div>
        <div class="hb-status-item" v-for="ch in channels" :key="ch.type">
          <span>{{ ch.label }}</span>
          <span :class="ch.status==='online'?'hb-ok':'hb-wait'">{{ ch.status==='online'?__('heartbeatOnline'):__('heartbeatWaitCred') }}</span>
          <span class="hb-lag" v-if="ch.lastHeartbeat">{{ __('heartbeatLastTime') }} {{ timeAgo(ch.lastHeartbeat) }}</span>
        </div>
        <div class="hb-status-item" v-if="channels.length===0"><span>{{ __('heartbeatNoChannel') }}</span></div>
      </div>
      <div class="hb-card" v-if="statusMsg">
        <div class="hb-card-title">{{ __('heartbeatSysStatus') }}</div>
        <div class="hb-status-item"><span>{{ __('heartbeatUptime') }}</span><span class="hb-ok">{{ uptimeText }}</span></div>
        <div class="hb-status-item"><span>CEO巡检次数</span><span>{{ status.status?.ceoPatrolCount || 0 }}</span></div>
        <div class="hb-status-item"><span>{{ __('heartbeatActiveTasks') }}</span><span>{{ status.status?.activeTasks || 0 }}</span></div>
      </div>
      <div class="hb-actions">
        <button class="hb-save-btn" @click="saveSettings" :disabled="saving">{{ saving ? __('heartbeatSaving') : '💾 '+__('heartbeatSave') }}</button>
        <span class="save-feedback" v-if="saveMsg">{{ saveMsg }}</span>
      </div>
    </div>
  </div>
</template>
<script>
import { __ } from '../i18n'
function timeAgo(iso){
  if(!iso)return '';
  var ms=Date.now()-new Date(iso).getTime();
  if(ms<60000)return Math.floor(ms/1000)+'s';
  return Math.floor(ms/60000)+'m';
}
export default{
  data(){return{
    cfg:{patrolIntervalMs:300000,intervalMs:60000,patrolEnabled:true,enabled:true},
    channels:[],statusMsg:'',saving:false,saveMsg:'',uptimeText:'',
    status:{}
  }},
  mounted(){
    this.loadData();
  },
  methods:{
    timeAgo,
    async loadData(){
      try{
        var r=await fetch('/api/heartbeat/status');
        var d=await r.json();
        if(d.ok&&d.config){
          this.cfg=d.config;
          this.channels=d.channels||[];
          this.status=d;
          this.statusMsg=d.status?.lastStatus||'unknown';
          this.uptimeText=this.fmtUptime(d.status?.uptime||0);
        }
      }catch(e){console.error(this.__('heartbeatLoadFail'),e)}
    },
    fmtUptime(sec){
      if(!sec)return this.__('heartbeatJustStart');
      var h=Math.floor(sec/3600);
      var m=Math.floor((sec%3600)/60);
      var s=sec%60;
      return h+'h '+m+'m '+s+'s';
    },
    async saveSettings(){
      this.saving=true;
      this.saveMsg='';
      try{
        var r=await fetch('/api/heartbeat/config',{
          method:'PUT',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(this.cfg)
        });
        var d=await r.json();
        if(d.ok){
          this.saveMsg='✅ '+this.__('heartbeatSaveOk');
          setTimeout(()=>this.saveMsg='',3000);
        }else{
          this.saveMsg='❌ 保存失败: '+(d.error||'未知错误');
        }
      }catch(e){
        this.saveMsg='❌ 网络错误: '+e.message;
      }finally{
        this.saving=false;
      }
    }
  }
}
</script>
<style scoped>
.hb-page{padding:20px 24px;height:100%;overflow-y:auto}
.page-hdr{margin-bottom:20px}.page-hdr h2{font-size:18px;margin:0 0 4px}
.page-desc{color:var(--fg2);font-size:12px;margin:0}
.hb-section{max-width:500px;display:flex;flex-direction:column;gap:12px}
.hb-card{padding:16px;background:var(--bg3,#1c1c30);border-radius:10px;border:1px solid var(--border);display:flex;flex-direction:column;gap:10px}
.hb-card-title{font-size:13px;font-weight:600;color:var(--fg);margin-bottom:4px}
.hb-row{display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--fg)}
.hb-select{padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg4);color:var(--fg);font-size:12px;outline:none}
.hb-select:focus{border-color:var(--accent)}
.hb-toggle{position:relative;width:40px;height:22px;display:inline-block}
.hb-toggle input{opacity:0;width:0;height:0}
.toggle-slider{position:absolute;inset:0;background:var(--fg3);border-radius:11px;cursor:pointer;transition:0.2s}
.toggle-slider::before{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:2px;left:2px;transition:0.2s}
.hb-toggle input:checked+.toggle-slider{background:var(--accent,#4ecdc4)}
.hb-toggle input:checked+.toggle-slider::before{transform:translateX(18px)}
.hb-status-item{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;color:var(--fg)}
.hb-status-item:last-child{border-bottom:none}
.hb-ok{color:#10b981;font-size:11px}
.hb-wait{color:#eab308;font-size:11px}
.hb-lag{color:var(--fg3);font-size:10px;margin-left:auto}
.hb-actions{display:flex;align-items:center;gap:12px}
.hb-save-btn{padding:8px 20px;border-radius:8px;border:none;background:var(--accent,#4ecdc4);color:#000;font-size:13px;cursor:pointer;transition:all 0.15s;align-self:flex-start}
.hb-save-btn:hover{background:#3dbdb5;transform:scale(1.02)}
.hb-save-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none}
.save-feedback{font-size:12px;color:var(--fg2)}
</style>
