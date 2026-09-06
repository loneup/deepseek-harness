# Agent Note: Nexus Bridge 迁移到 SessionController 验收

Status: proposed

[English](2026-09-05-nexus-bridge-sessioncontroller-migration.md) | 中文

## 问题

dsh 0.1.3-alpha.1 移除 `@deepseek-ai/dsh-host-apiproxy` 与 `@deepseek-ai/dsh-client-runtime` 后，nexus-bridge 迁到 `ctx.sessionController` / `ctx.subagents` 虽然编译通过，但实测不达标：`session.open` 重放不出历史，且把桥挂进 web-app bundle 后破坏了宿主录制快照里的审批 escalation 流程。挂载决策见 [[2026-08-25-nexus-bridge-webserver-plugin]]。

## 发现

**`page` 传字面量 `throughSeq: -1` 读到的是空日志。** `paginate` 以 `throughSeq + 1` 切窗口，`-1` 得到 `end = 0`，与日志长度无关。文档约定的冷读模式是 `sessionController.follow` 首帧快照——一次读出当前 cursor 和最新对齐消息的 records；`page` 只用于从该 cursor 向前翻页。`session.open` 与 `subagent.history` 已改走 follow 快照（`command.ts` 的 `openingSnapshot`/`openingRecords`）。

**执行前闸门必须限定 Nexus 会话。** 桥的 `tools/pre-execute` 处理器在 dsh sandbox 返回 escalation 提示之前就拒绝 `read-only` 会话的写操作，`sandbox_permissions` 重试、approval/asked、审批决议都不可能发生，所有 Web 审批 e2e 快照全部出现桥的硬拒绝文案。闸门现在只覆盖 Nexus channel 打开的会话（`nexusSessions`），与审批处理器的归属判断一致；Web 会话保留 dsh 的 escalation 体验，Nexus 会话保留桥 README 记录的拒绝优先姿态。

**`ui-settings-nexus` 从未被 API 阻塞。** 设置页只依赖 slots/locale/ui-renderer 类型和 `/nexus/admin/*` 路由，0.1.3 都没有移除。stub 与告警已替换为恢复的真实设置页；`plugin-config` e2e golden 现在列出「Nexus 管理」页签。

**`src/` 里的编译产物会破坏测试平面。** 一次误配置构建在 31 个包的 `.ts` 源旁输出了 `.js`/`.d.ts`/`.map`。Vite 把目录映射解析到陈旧 `.js`，测试加载出两个模块实例，`instanceof` 全仓库失败。516 个残留文件（每个都与同名 `.ts` 对应）已删除；`pnpm dsh` 经 tsx 源码启动不受影响，因为 tsx 优先解析 `.ts`。

## 验收证据

- 配对、v4 握手、`session.list/open/create/models/selectModel`、`turn.start/queue/cancel`、`subagent.list/history/prompt/interrupt`、SSE anchor/重放/断线恢复，均通过脚本化 Nexus 客户端对真实 `dsh --profile web` 进程实测。
- one-shot 与 continuable 子代理均端到端验证（历史、分页、续聊、中断）。
- 之前失败的 6 个 Web e2e 文件全部通过；完整 `npm test` 仅剩 `code-runtime-python` 环境性失败（干净 HEAD worktree 上同样失败）；`swift test`（NexusCore）96/96 通过，iOS 模拟器构建成功。

## Risks

- follow 快照冷读与 Nexus 域 pre-execution 闸门是承载行为的改动；回归会出现在 Web 审批 e2e 与设备重连流程，而非编译期。
- `tests/*.spec.ts.disabled` 仍锁定已移除的 apiProxy 形状，需按 SessionController 重写。

## Alternatives considered

- ** vendors 一个兼容层重新实现被移除的 `apiproxy` API 面** —— bridge 与测试本可不变，但这会永久复制本次发布刻意删除的宿主内部实现，并重建这次移除想要终结的耦合。
- **逐调用方法嗅探 + apiProxy 式回退** —— 短期弱化迁移，但会在运行时静默混用两代宿主行为，违反 fail-loud 配置错误规则。
- **等待宿主恢复等价门面** —— 0.1.3-alpha.1 中不存在这样的门面，且 bridge 的配对、握手与管理面已按共享端口发布。

## Remaining work

- `tests/*.spec.ts.disabled` 仍锁定被移除的 `apiProxy` 形状（rpcId + `result.ok`），需按 SessionController 重写。
- 真实审批应答路径（对真实 `approval.asked` 的 `approval.respond`）待真机 Golden Path 验收。
