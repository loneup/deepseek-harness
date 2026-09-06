# Agent Note：nexus-bridge 与 dsh 之间的 NexusDshPort 兼容接缝

状态：proposed

[English](2026-09-05-nexus-dsh-port-compat-seam.md) | 中文

## 问题

2026-09-05 的 SessionController 迁移（[[2026-09-05-nexus-bridge-sessioncontroller-migration]]）让 `nexus-bridge` 直接调用 `ctx.sessionController` 与 `ctx.subagents`。此后 dsh 的每次 API 变化——方法重命名、签名变化、品牌 ID 词汇、错误码、日志事件字段——都会扩散到 bridge、Web 设置页和 iOS 客户端，因为三者都依赖只有 dsh 拥有的形状。

## 设计

`packages/host/nexus-dsh-compat` 引入单实现的接缝：

- **`NexusDshPort`**（`src/port.ts`）是唯一消费面：`listSessions`、`createSession`、`getModelCatalog`、`selectModel`、`prompt`、`cancelSession`、`readHistory`、`listSubagents`、`promptSubagent`、`interruptSubagent`。全部请求/响应类型为 Nexus 自有（`src/types.ts`，品牌 `NexusSessionId`/`NexusRequestId`），且与已上线的 v4 wire JSON 等价，bridge 无需重塑即可序列化 Port 值。
- **`Dsh013Adapter`**（`src/dsh-013-adapter.ts`）是 dsh 0.1.3-alpha.1 的唯一修复点：品牌 ID 转换、`SessionAddress` 构造、`follow` 首帧快照的 cursor 契约（`page` 的字面量 `throughSeq: -1` 会切出空日志）、以及回执映射（`SubagentPromptReceipt` 增加加法性的 `accepted: true`）。
- **`mapDshError`** 经 `remoteErrorOf` 结构化识别失败（绝不 instanceof），收敛为六个稳定码（`unknown_session`、`unknown_subagent`、`subagent_unauthorized`、`malformed`、`host_cancelled`、`host_error`）；`host_error` 会替换原始 message，dsh 内部诊断与路径不外泄。它取代了 `command.ts` 中逐方法的手写映射链，并淘汰了临时的 `subagent_error` wire 码。
- **`mapDshEvent`** 承载 reducer payload 词汇（turn 生命周期、消息增量、工具调用、审批结果）；未知或非 Nexus 事件返回 `undefined` 且不得推进 Nexus sequence。它从 `index.ts` 原样迁出。
- **Provider**（`src/plugin.ts`）经 `ctx.reflect.provide` 暴露 `ctx.nexusDsh`，对未知 `adapter` 配置或缺失的 `sessionController`/`subagents` 在加载阶段响亮失败，并随 fiber 释放。

实时事件投递刻意保留在 Cordis 总线上：bridge 保留其 `ctx.on('session/event')` 监听，Web 与 Nexus 两个表面共享一次广播。Port 因此刻意不提供订阅方法；未来若加入订阅加 `follow()`，需要先解决与广播的去重。

## Wire 变化

subagent 失败的错误码从 `subagent_error` 变为 `unknown_subagent` / `subagent_unauthorized`（迁移方案规定的映射；iOS 对未枚举的码按 message 透出）。session list/create/models/selectModel 与 turn 回执 JSON 等价透传。`session.open` 的顺序（历史记录 → `session.subscribed` 锚点）不变。

## 验收证据

- `pnpm vitest run packages/host/nexus-dsh-compat/tests` —— 62 个测试，覆盖 Port 契约、适配器调用、错误映射（含跨 realm 标记）、事件映射、subagent 流程与 provider 加载/释放。
- `pnpm exec tsc -b tsconfig.host.json` 通过；源码文本契约测试断言公共面永不出现 dsh 内部类型名。
- `packages/bundle/web-app/tests` —— 24 个测试通过，含验证 client-modules 与 ui-settings-nexus bundle 以 200 服务的 startup HTTP 面套件。

## 剩余工作

- `subagent.list` 的 entries 仍透传 dsh 的 `kind: 'child' | 'diagnostic'` 联合；iOS 时代的 fixture（`subagent-v1.json`）展示的是更扁平的 `{sessionId, name, status, mode, parentSessionId}` 形状。真机验收是在 dsh 形状下通过的，所以过期的是 fixture 而非 bridge；两者对齐是另一个独立决策。
- 未来 dsh 版本在同一 Port 与同一批契约测试之后新增 `Dsh014Adapter`（或更新）；provider 的 `adapter` 配置是选择点，未知名称响亮失败。

## Proposal

Introduce `packages/host/nexus-dsh-compat` as a single-implementation port:

- `NexusDshPort` (`src/port.ts`) is the only consumer face: ten methods covering Session, model, history, and Subagent capabilities, expressed only in the Nexus-owned vocabulary of `src/types.ts` (branded `NexusSessionId`/`NexusRequestId`, wire-equivalent payloads, six-code `NexusPortError`).
- `Dsh013Adapter` (`src/dsh-013-adapter.ts`) is the only fix site for dsh 0.1.3-alpha.1: branded-id casts, `SessionAddress` construction, the follow-opening-snapshot cursor contract, receipt mapping, and provider wiring via `ctx.reflect.provide` with fail-loud composition.
- `mapDshError` recognizes failures structurally through `remoteErrorOf` and collapses them to six stable codes with message sanitization; `mapDshEvent` carries the reducer payload vocabulary verbatim from the bridge's former `mapSessionEvent`.
- The bridge consumes the port alone; a source-text contract test forbids dsh internal type names in bridge sources and on the port's public face.

## Acceptance criteria

- `pnpm vitest run packages/host/nexus-dsh-compat/tests` passes (62 tests: port contract, adapter calls, error mapping incl. cross-realm, event mapping, subagent flows, provider load/release).
- `pnpm exec tsc -b tsconfig.host.json` is clean with the package in the host solution.
- The bridge grep-clean for `SessionController`/`SubagentRuntime`/`SessionAddress`/`SessionRequestId`/`SubagentPromptRequestId`/`RemoteError`/`apiProxy`/`LegacyApiResponse`/`result.ok` is enforced as a resident regression test.
- Live Nexus acceptance (pairing, handshake v4, full Session/Subagent/turn/kill-switch commands, SSE sequence continuity) passes 27/27 against a real `dsh --profile web` process.

## Risks

- The port types duplicate dsh shapes by hand; drift shows up as adapter compile or contract-test failures rather than runtime surprises, but the duplication is real maintenance surface.
- Subagent error codes change on the wire (`subagent_error` → `unknown_subagent`/`subagent_unauthorized`); older clients that switch on that exact code would misroute, though the shipped iOS client treats unenumerated codes as message-only.
- Live events stay on the Cordis bus by design; a future port subscription method must deduplicate against that broadcast or it will double-deliver.

## Alternatives considered

- **Keep calling `ctx.sessionController`/`ctx.subagents` from the bridge** — zero indirection today, but every dsh rename fans out into the bridge, the Web settings tab, and the iOS client; rejected because the whole point of the seam is absorbing host churn in one file.
- **Method-presence sniffing for forward compatibility** (try new API, fall back to old) — silently mixes adapter generations at runtime and fails the repo's fail-loud rule; rejected in favor of explicit `adapter` configuration that refuses unknown names at load.
- **Two bridge packages (beta/production)** — rejected: the environments differ only in manifest and configuration, never in code; a single port with per-version adapters keeps the dependency graph and the gate surface at one.
