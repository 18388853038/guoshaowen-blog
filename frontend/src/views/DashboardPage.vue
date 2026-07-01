<template>
  <div class="dash-page">
    <div class="page-hdr"><h2>📊 {{ __('dashboardTitle') }}</h2><p class="page-desc">{{ __('dashboardDesc') }}</p></div>
    <div class="dash-grid">
      <div class="dash-card" style="grid-column:span 2">
        <div class="dc-icon">📊</div>
        <div class="dc-label">{{ __('dashModelDetail') }}</div>
        <div class="token-detail" v-if="detailKeys.length">
          <div class="td-row td-hdr"><span>{{ __('dashColModel') }}</span><span>{{ __('dashColCalls') }}</span><span>{{ __('dashColInput') }}</span><span>{{ __('dashColOutput') }}</span></div>
          <div class="td-row" v-for="k in detailKeys" :key="k">
            <span class="td-model">{{ k }}</span>
            <span>{{ data.tokenUsage.byProvider[k].calls }}</span>
            <span>{{ fmtTokens(data.tokenUsage.byProvider[k].inputTokens) }}</span>
            <span>{{ fmtTokens(data.tokenUsage.byProvider[k].outputTokens) }}</span>
          </div>
        </div>
        <div class="token-detail-empty" v-else>{{ __('dashNoData') }}</div>
      </div>
      <!-- 服务器健康 -->
      <div class="dash-card" style="grid-column:span 2"><div class="dc-icon">❤️</div><div class="dc-label">服务器健康</div><div class="health-server-grid"><div v-for="s in data.statusItems" :key="s.label" class="health-server-item"><span class="health-server-icon">{{ s.icon }}</span><span class="health-server-val" :class="s.ok ? 'ok' : 'wait'">{{ s.label }} {{ s.value }}</span></div></div></div>
      <!-- 流量/请求明细 -->
      <div class="dash-card" style="grid-column:span 2"><div class="dc-icon">📈</div><div class="dc-label">今日流量</div><div class="health-grid-mini"><div class="hs-mini-item"><span class="hs-label">总请求</span><span class="hs-val">{{ (traffic.success||0)+(traffic.failed||0) }}</span></div><div class="hs-mini-item"><span class="hs-label">成功</span><span class="hs-val" style="color:#10b981">{{ traffic.success || 0 }}</span></div><div class="hs-mini-item"><span class="hs-label">失败</span><span class="hs-val" style="color:#ef4444">{{ traffic.failed || 0 }}</span></div><div class="hs-mini-item"><span class="hs-label">成功率</span><span class="hs-val" :style="{color:successRate>=95?'#10b981':successRate>=80?'#eab308':'#ef4444'}">{{ successRate }}%</span></div><div class="hs-mini-item"><span class="hs-label">输入Token</span><span class="hs-val">{{ fmtTokens(data.tokenUsage.totalInput) }}</span></div><div class="hs-mini-item"><span class="hs-label">输出Token</span><span class="hs-val">{{ fmtTokens(data.tokenUsage.totalOutput) }}</span></div><div class="hs-mini-item"><span class="hs-label">总费用</span><span class="hs-val cost-val">{{ fmtCost(data.tokenUsage.totalCost) }}</span></div><div class="hs-mini-item"><span class="hs-label">请求/分钟</span><span class="hs-val">{{ traffic.requestsPerMin || 0 }}</span></div></div></div>
      <!-- 许可证（仅验证有数据时显示） -->
      <div class="dash-card" style="grid-column:span 2" v-if="license.valid !== undefined && license.valid !== false"><div class="dc-icon">🔑</div><div class="dc-label">许可证</div><div class="health-grid-mini"><div class="hs-mini-item"><span class="hs-label">版本</span><span class="hs-val" :style="{color:license.tier==='professional'?'#a855f7':license.tier==='enterprise'?'#f59e0b':'#22c55e',fontWeight:700}">{{ licenseTierLabel(license.tier) }}</span></div><div class="hs-mini-item"><span class="hs-label">状态</span><span class="hs-val" style="color:#22c55e">✅ 有效</span></div><div class="hs-mini-item" v-if="license.message"><span class="hs-label">信息</span><span class="hs-val" style="font-size:11px;color:var(--fg2)">{{ license.message }}</span></div></div></div>
      <div class="dash-card" style="grid-column:span 2"><div class="dc-icon">💻</div><div class="dc-label">系统资源</div><div class="health-grid-mini"><div class="hs-mini-item"><span class="hs-label">Node.js</span><span class="hs-val">{{ sysInfo.node || 'N/A' }}</span></div><div class="hs-mini-item"><span class="hs-label">内存</span><span class="hs-val">{{ sysInfo.memory || data.memoryMB+' MB' }}</span></div><div class="hs-mini-item"><span class="hs-label">运行时长</span><span class="hs-val">{{ data.uptime }}</span></div><div class="hs-mini-item"><span class="hs-label">员工数</span><span class="hs-val">{{ data.activeEmployees }}</span></div><div class="hs-mini-item"><span class="hs-label">今日任务</span><span class="hs-val">{{ data.todayTasks }}</span></div><div class="hs-mini-item"><span class="hs-label">已完成</span><span class="hs-val">{{ data.completedToday }}</span></div><div class="hs-mini-item"><span class="hs-label">渠道在线</span><span class="hs-val">{{ data.channelsOnline }}/{{ data.channelsTotal }}</span></div></div></div>
    </div>
  </div>
</template>
<script>
import { __ } from '../i18n'
function fmtTokens(n){
  n=Number(n)
  if(!n)return '0'
  if(n>=1000000)return (n/1000000).toFixed(1)+'M'
  if(n>=1000)return (n/1000).toFixed(1)+'K'
  return String(n)
}
function fmtCost(n){
  n=Number(n)
  if(!n)return '$0.00'
  if(n<0.01)return '$'+n.toFixed(6)
  return '$'+n.toFixed(4)
}
export default{
  data(){return{
    data:{
      totalMessages: 0,
      activeEmployees: 0,
      todayTasks: 0,
      completedToday: 0,
      channelsOnline: 0,
      channelsTotal: 0,
      uptime: this.__('dashLoading'),
      memoryMB: 0,
      apiCalls: 0,
      tokenUsage: { totalInput:0, totalOutput:0, totalCost:0, calls:0, byProvider:{} },
      statusItems: []
    },
    traffic: { total:0, success:0, failed:0, inputTokens:0, outputTokens:0, cost:'0.00', requestsPerMin:0 },
    sysInfo: { node:'', memory:'' },
    license: { valid:false, tier:'community', message:'' },
    successRate: 100
  }},
  computed:{
    detailKeys(){
      return Object.keys(this.data.tokenUsage.byProvider || {})
    }
  },
  mounted(){
    this.loadDashboard()
  },
  methods:{
    fmtTokens, fmtCost,
    licenseTierLabel(tier) {
      var map = { professional:'专业版', enterprise:'企业版', community:'社区版', ultimate:'旗舰版' };
      return map[tier] || tier || '社区版';
    },
    async loadDashboard(){
      try{
        var r=await fetch('/api/dashboard')
        var d=await r.json()
        if(d.ok && d.data){
          this.data=d.data
        }
      }catch(e){
        console.error(this.__('dashLoadError'), e)
      }
      // 加载额外的健康数据
      try{
        var r2=await fetch('/api/v4/traffic')
        var t=await r2.json()
        if(t.total!==undefined){
          this.traffic=t
          var totalReqs=(t.success||0)+(t.failed||0)
          this.successRate=totalReqs>0?Math.round((t.success||0)/totalReqs*100):100
        }
      }catch(e){}
      try{
        var r3=await fetch('/api/health')
        var h=await r3.json()
        if(h.node) this.sysInfo.node=h.node
        if(h.memory) this.sysInfo.memory=h.memory
      }catch(e){}
      try{
        var r4=await fetch('/api/license/verify', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })
        var l=await r4.json()
        if(l && l.valid!==undefined) this.license=l
      }catch(e){}
    }
  }
}
</script>
<style scoped>
.dash-page{padding:20px 24px;height:100%;overflow-y:auto}
.page-hdr{margin-bottom:20px}.page-hdr h2{font-size:18px;margin:0 0 4px}
.page-desc{color:var(--fg2);font-size:12px;margin:0}
.dash-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.dash-card{padding:20px 16px;background:var(--bg3,#1c1c30);border-radius:10px;border:1px solid var(--border);text-align:center;transition:all 0.2s}
.dash-card:hover{background:var(--bg4);transform:translateY(-2px)}
.dc-icon{font-size:28px;margin-bottom:6px}.dc-label{font-size:11px;color:var(--fg2);margin-bottom:4px}
.dc-val{font-size:24px;font-weight:700;color:var(--accent,#4ecdc4)}
.token-val{font-size:20px;color:var(--fg)}
.cost-val{font-size:18px;color:#f59e0b}
.token-detail{width:100%;font-size:11px;text-align:left;margin-top:6px}
.td-row{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:4px;padding:3px 4px}
.td-hdr{color:var(--fg3);font-weight:600;border-bottom:1px solid var(--border);margin-bottom:2px}
.td-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.token-detail-empty{font-size:11px;color:var(--fg3);margin-top:6px}
.dash-status-bar{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;font-size:12px;margin-top:8px}
.dash-status-bar .ok{color:#10b981}.dash-status-bar .wait{color:#eab308}
.health-server-grid{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;font-size:12px;margin-top:8px}
.health-server-item{display:flex;align-items:center;gap:4px;padding:4px 8px;background:var(--bg2,#15152b);border-radius:6px}
.health-server-icon{font-size:14px}
.health-server-val.ok{color:#10b981}.health-server-val.wait{color:#eab308}
.health-grid-mini{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px}
.hs-mini-item{text-align:center;padding:6px 4px}
.hs-label{display:block;font-size:10px;color:var(--fg3);margin-bottom:2px}
.hs-val{display:block;font-size:16px;font-weight:600;color:var(--fg)}
</style>
