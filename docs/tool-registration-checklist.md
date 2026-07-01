# 工具注册三通道同步清单

> 最后更新: 2026-07-01

## 概览

eCompanyClaw 中，每个可执行工具需要在 **三个通道** 中同步注册，缺一不可：

| 通道 | 文件 | 作用 |
|:----:|:----|:------|
| ① Handler | `modules/executor-tools.js` | 工具的实际执行逻辑 |
| ② Schema | `modules/tools-registry.js` | CEO_TOOLS 数组中的 schema 定义 |
| ③ CEO 可见列表 | `modules/agent-executor.js` | availableTools + 路由表 |

## 通道详解

### 通道① — executor-tools.js (Handler)

**方式**: 调用 `_registerExecutorTool(toolName, handlerFunction)`

```js
_registerExecutorTool('tool_name', async function(args) {
  // 实现逻辑
  return { ok: true, result: ... };
});
```

**作用**: 定义工具的实际行为，`execCEOTool(name, args)` 按名称查找并执行。

**已知工具**: 约50+ 个，包括 call_llm、memory_search、exec_command、sessions_spawn 等。

### 通道② — tools-registry.js (Schema/CEO_TOOLS)

**方式**: 在 `CEO_TOOLS` 数组中新增元素

```js
{ type: 'function', function: {
  name: 'tool_name',
  description: '工具描述（CEO 看到后知道何时调用）',
  parameters: { type: 'object', properties: { ... }, required: [...] }
}},
```

**作用**: ceo-orchestrator.js 的 getTools() 从此处读取工具定义，用于 CEO 计划拆解阶段。**⚠️ 不是 CEO SSE 对话的工具源**。

### 通道③ — agent-executor.js (CEO 可见列表 + 路由表)

分为两部分：

**A. availableTools 注入** (L951-1080):

```js
availableTools.push({
  id: 'tool_name',
  name: 'tool_name',
  description: '工具描述',
  parameters: { type: 'object', properties: { ... }, required: [...] },
  permission: 'basic' 或 'advanced'
});
```

**B. 路由表** (L1250-1300):

```js
else if (['exec_command', 'sessions_spawn', ..., 'tool_name'].indexOf(funcName) !== -1) {
  try {
    var exeTools = require('./executor-tools');
    result = await exeTools.execCEOTool(funcName, funcArgs);
  } catch(...) { ... }
}
```

**作用**: 这是 CEO SSE 对话直接使用的工具列表。`executeAgent` 入口 → `callAIWithTools` → AI 决定调用工具 → 根据路由表分发。

---

## 已注册工具同步状态 (2026-07-01)

### 三通道已完成 ✅

| 工具名称 | ① Handler | ② Schema | ③ availableTools | ③ 路由表 |
|:---------|:--------:|:--------:|:----------------:|:--------:|
| call_llm | ✅ | — | — | — |
| exec_command | ✅ | ✅ | ✅ | ✅ |
| sessions_spawn | ✅ | ✅ | ✅ | ✅ |
| sessions_list | ✅ | ✅ | ✅ | ✅ |
| sessions_kill | ✅ | ✅ | ✅ | ✅ |
| execute_openclaw_skill | ✅ | ✅ | ✅ | ✅ |
| delete_file | ✅ | ✅ | ✅ | ✅ |
| move_file | ✅ | ✅ | ✅ | ✅ |
| rename_file | ✅ | ✅ | ✅ | ✅ |
| create_task | ✅ | ✅ | ✅ | ✅ |
| memory_save | ✅ | ✅ | ✅ | ✅ |
| memory_search | ✅ | ✅ | ✅ | ✅ |
| kb_search | — | ✅ | ✅ ✅（硬编码注入+路由） | — |
| read_file / write_file | — | ✅ | ✅ (FILE_SYSTEM_TOOLS) | — |
| list_directory | — | — | ✅ (FILE_SYSTEM_TOOLS) | — |
| query_experience etc. | — | — | ✅ (TEAM_MEMORY_TOOLS) | ✅ |

### 缺失项 ❌

| 工具名称 | 缺失通道 | 影响 |
|:---------|:--------|:-----|
| memory_list | 全部 | ⚠️ 未注册，无此工具 |
| memory_delete | 全部 | ⚠️ 未注册，无此工具 |
| list_directory | ② Schema | 🔸 CEO_TOOLS 中无 schema，但 availableTools 有 |

### 待注册建议

建议未来新工具手工核对清单时，在 agent-executor.js 中搜索 `if (funcName === 'tool_name')` 或 `['exec_command', 'sessions_spawn', ...]` 找到路由表行，在字符串数组中追加新工具名。

---

## 排查工具缺失时的快速步骤

```js
// 1. 检查 Handler
node -e "var m = require('./modules/executor-tools'); console.log(!!m.execCEOTool, typeof m.execCEOTool)"

// 2. 检查 Schema (CEO_TOOLS)
node -e "var t = require('./modules/tools-registry'); console.log(t.CEO_TOOLS.find(x=>x.function.name==='tool_name'))"

// 3. 检查 availableTools + 路由表
node -e "
var fs=require('fs');
var c=fs.readFileSync('./modules/agent-executor.js','utf8');
console.log('availableTools:', c.includes(\"name: 'tool_name'\"));
console.log('route table:', /exec_command[^]*?tool_name/.test(c));
"
```

---

## 架构说明

```
用户消息
    ↓
SseServer (server-modern.js)
    ↓
executeAgent()  →  callAIWithTools(messages, availableTools, options)
                        ↓
                    AI 决定调用工具
                        ↓
                    _handleAIWithTools(funcName, funcArgs)
                        ↓
                    ┌─ 文件操作 → executeFileTool()
                    ├─ 团队记忆 → teamMemory.executeTeamMemoryTool()
                    ├─ executor 工具 → execCEOTool() ← executor-tools.js
                    ├─ kb_search → knowledge-engine.js
                    └─ (其他内置工具 → 内联函数)
```

注意: `ceo-orchestrator.js` 的 `process()` 使用 CEO_TOOLS schema，但走的是不同的 `_runStep` → `execCEOTool` 路径，不需要通过 `agent-executor.js`。
