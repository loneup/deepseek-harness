# Nexus Bridge 迁移待办事项

## 状态
🔄 **S5/S6 进行中（2026-09-05）**——Bridge 已改为只依赖 `NexusDshPort` 兼容接缝（`@deepseek-ai/dsh-host-nexus-compat`），不再 import 任何 dsh 内部 Session/Subagent API、错误类型或品牌 ID。

## 已完成
1. ~~`apiProxy` → `ctx.sessionController` / `ctx.subagents`~~ → 已进一步迁移到 `ctx.nexusDsh`（NexusDshPort，由 nexus-dsh-compat 提供）。`inject` 为 `['webServer', 'nexusDsh']`。
2. `src/command.ts` 全部方法改走 Port：listSessions/createSession/getModelCatalog/selectModel/prompt/cancelSession/readHistory/listSubagents/promptSubagent/interruptSubagent；session.open 的历史读取改用 `dsh.readHistory({kind:'session'}, maxMessages:50)`。
3. 错误处理统一为 `nexusPortErrorOf(err)?.code ?? 'host_error'`；subagent 失败 wire code 从 `subagent_error` 变为 `unknown_subagent` / `subagent_unauthorized`（迁移方案规定的变化）。
4. `turn.start/queue/steer` 空文本按 iOS 契约返回 `empty_prompt`（结构性问题仍 `malformed`）；subagent.prompt 空文本保持 `malformed`（iOS subagent.test.js 规定）。
5. SSE/replay/sequence 机制提取为内部模块 `src/stream.ts`（`NexusEventStreams`），事件映射统一走兼容层 `mapDshEvent`；`ctx.on('session/event')` 广播、approval waterfall、pre-execute 闸门、admin 路由保持不变；未引入 `sessionController.follow()` 双订阅。
6. session.open 顺序调整为：读历史 → replay 历史种子 → 发 `session.subscribed` anchor（S6 规定；anchor 的 lastSeq 覆盖回放事件）。
7. 测试：`tests/command-port.spec.ts`（16）、`tests/session-open.spec.ts`（4）、`tests/subagent-command.spec.ts`（9）；旧 `.disabled` 文件未动。

## 本次迁移发现并修复的坑
- `page({throughSeq: -1})` 返回空窗口；冷读历史由兼容层 adapter 的 follow 首帧快照统一处理，Bridge 不再感知。
- pre-execute 权限闸门只覆盖 Nexus channel 打开的会话（保留）。
- 重连后新 SSE 流在客户端重新 subscribe 前不投递该会话的实时事件（既有行为，测试已固化）；pendingReplay 只 flush 一次，不重复历史。

## 剩余工作
- S7+：`tests/*.spec.ts.disabled` 仍 mock 旧 `apiProxy`（rpcId + result.ok），需按 S8 计划重写（nexus-bridge.spec.ts / admin.spec.ts / mapping.spec.ts）；不要恢复 apiProxy shim。
- `Context.nexusDsh` 的模块增补目前在 bridge 侧 mirror（compat 包把增补声明在其 plugin 模块内，index 面未 re-export）；未来可在 compat index re-export 后移除。
- 真实设备 Golden Path（配对 → 会话 → turn → 审批应答 → 断线恢复）待真机验收（S8/S9）。

## 优先级
P1 → S8 Web Loader 组合测试
