/**
 * agent-orchestrator-core.js — Agent 架构现状与待办差距
 *
 * =========================================================================
 * 当前状态（2026-06-29 22:20 更新）
 * =========================================================================
 *
 * ✅ 已修复：agent_execute 已走 LLM 链路
 *   - execCEOTool('agent_execute') 的 handler 现在会读取 prompt，
 *     根据 agentType 调用大模型（greeting/chat → LLM 回复，
 *     analyst/executor → 真实工具调用 + 数据聚合）
 *   - 知识库已集成到 _runStep 的 agentPrompt 构建中
 *     （step.description 自动搜索知识库 top3 注入）
 *   - 日志已纳入 getLogger 级别控制体系
 *
 * ✅ 已修复：cognitive-state.json 去重
 *   - crossLinks 使用 deduped 数组，同 type+detail 替换而非追加
 *   - 已验证：实际运行中 crossLinks 只有 1 条（非重复膨胀）
 *
 * ✅ 已修复：proactive-scheduler 启动 bug
 *   - listen 回调中 require 后 .start()，健康检查/P95/摸底任务正常执行
 *
 * ✅ 已完成：Agent 命名治理
 *   - agent-overrides.json 中 ceo 死配置已移除，仅保留 xiaolong + ai_ceo
 *   - agents.json → xiaolong/cto-agent/security-agent/pm-agent
 *   - scheduler-status.json → ceo/cto/security（调度器兼容命名，功能正常）
 *
 * ✅ 已完成：冗余文件清理
 *   - 删除 8 个 server-modern 备份变体（~2MB 释放）
 *   - 删除 187MB crash.log（仅 EADDRINUSE 累积，无有用信息）
 *   - harness-preferences.json 中测试备注已清除
 *
 * ⚠️ 仍存在的问题
 *
 * 1. createSandbox 只是内存对象，没有真正的隔离沙箱
 *    当前 FileSandbox/ProcessSandbox 仅提供基本的路径校验，
 *    没有 chroot/jail/容器级隔离。高风险工具调用无 sandbox 防护。
 *
 * 2. horizontal 协作模式未实现
 *    子 Agent 之间不能直接通信协作，所有交互必须经过 OrchestratorCore
 *    中转。多 Agent 协作场景（如 CTO + Security 联合排查）受限。
 *
 * 3. _summarizePlan 输出仍有简化
 *    部分意图的输出仍为模板化摘要（如 "系统检查完成，状态正常。"），
 *    未充分展示工具返回的真实数据。clarification 字段在 SSE 路由中
 *    被静默忽略。
 *
 * =========================================================================
 * 后续改进方向（按优先级）
 * =========================================================================
 *
 * P2: 知识库利用率闭环
 *   - cognitive 模块每 10 分钟报警 knowledge_unused，但
 *     OrchestratorCore 的 _runStep 已通过 knowledge-repo 注入了知识库
 *   - 需要在 cognitive 模块中感知到这一覆盖路径的存在
 *
 * P3: Sandbox 隔离
 *   - 文件沙箱增加真实路径限制（白名单模式）
 *   - 进程沙箱考虑子进程 cgroups 或容器化
 *
 * P4: horizontal 协作模式
 *   - 子 Agent 间直接消息通道
 *   - 联合排查工作流支持
 */
