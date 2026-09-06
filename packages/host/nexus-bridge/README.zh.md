---
description: "面向 dsh Web Host 的 Nexus Bridge 路由插件：健康检查、设备配对、v4 握手、鉴权的 Session/Turn 命令，以及共享 WebServer 上的 /nexus/events SSE 流。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-nexus-bridge

[English](README.md) | 中文

## 概述

面向 dsh Web Host 的 Nexus Bridge 路由插件。当前切片在共享 `ctx.webServer` 上注册健康检查、一次性设备注册、Nexus v4 握手、鉴权的 Session/Turn 命令，以及进程内 `/nexus/events` SSE 流，并随 Cordis fiber 释放路由。

本包不创建独立的 node HTTP 服务，也不维护 Session 缓存。管理路由注册在共享 WebServer 的 `/nexus/admin/*`（兼容 `/admin/*`），LAN/Tailscale 来源必须命中 `adminAllowedNetworks` 且携带 `adminToken`；未配置 token 时仅允许 loopback，便于本机初始化。`killSwitchPath` 和 `auditPath` 启用持久化停用状态与 JSONL 审计。当前 WebServer 只有单一监听器，因此插件不创建独立的 3089 socket。

## 目录

- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

### 开发备注

web-app bundle 以 `nexus-bridge` host 行挂载本包，并从 `NEXUS_*` 环境变量提供 `registryPath`、`workspaceRoots`、`killSwitchPath`、`auditPath`、`adminToken` 和 `adminAllowedNetworks`。`session.open` 与 `subagent.history` 通过 SessionController `follow` 的首帧快照读取历史——快照携带 cursor 和最新对齐消息的 records，是唯一的冷读安全窗口；把 `-1` 字面量当 `page` 的 `throughSeq` 只会切出空日志。

## Model Experience

无；这是只服务 Host 的路由，只提供传输健康检查，不产生模型可见行为。

#### KV Cache effect

无。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- No runtime invariant companion is published：bridge 的行为保证由 `tests/`（路由、隔离、审批与流套件）持有；空的 `./invariant` companion 会违反包级 invariant 规则。
- **回放范围**：进程存活期间实时事件由 dsh `session/event` 广播；`session.open` 会把 Host 历史发送到发起请求且已按会话隔离的 SSE channel，并处理 SSE 建立竞态。由于 dsh `events.mux` 当前忽略 `since`，`since` 查询和持久订阅仍未提供；客户端通过重连后重新打开会话恢复。
- **配对码生成**：插件消费现有 loopback 管理面生成的配对码；不对外暴露配对码生成路由。
- **管理操作**：`GET /nexus/admin/device.list`、`POST /nexus/admin/device.revoke`、`POST /nexus/admin/killswitch.engage`、`POST /nexus/admin/killswitch.release`、`GET /nexus/admin/killswitch.state` 均写入审计；吊销会立即使设备 channel token 失效并关闭 SSE。
- **健康路由无鉴权**：只返回 `{ "ok": true }`，不得泄露设备、工作区或凭证数据。
- **提示附件**：`turn.start` 接受按顺序排列的文本和 PNG/JPEG/WebP/GIF 图片块。图片数据必须是规范 Base64，每张解码后最多 5 MiB，并在 Host 调用前拒绝未知块或不支持的媒体类型。请求体上限为 8 MiB 以容纳 Base64 膨胀；图片数据不会写入日志。
- **排队与 steer**：`turn.start` 与 `turn.queue` 将下一条提示排入队列（`sessions.prompt` 的 `queue` 模式）；`turn.steer` 将提示插入正在执行的 Turn 的下一步（`steer` 模式）。两者使用与 `turn.start` 相同的紧急停用和内容校验。
- **Subagent 目录**：`subagent.list` 暴露配对父会话的 dsh 直接子级目录。该命令只读，转发 `activity`、`mode`、`label` 和诊断行，不合成生命周期事件。
- **Subagent 历史**：`subagent.history` 通过 dsh 读取并校验直接子 Agent 的持久化转录，保留 `beforeSeq`、`maxMessages`、`hasMore` 和投影字段；不会激活子 Agent，也不接受任意会话 ID。
- **工作区 Git 快照**：`workspace.gitStatus` 与 `workspace.gitDiff` 在通过配置的白名单校验后，针对会话 Host 工作区执行固定的只读 Git 参数。不接受任意路径或 Git 参数。
- **工作区分支**：`workspace.gitBranches` 在相同白名单校验后返回工作区分支名，只读查询，不执行切换或写操作。
- **审批事件**：插件旁路观察 dsh 的 `approval/request` waterfall，发送 `approval.requested` 但不替审批作决定，并始终调用 `next()` 继续链路；持久化的 `approval/decided` 映射为 `approval.resolved`，响应命令仍交给 Host 审批服务。
- **执行前权限**：`enforcePreExecution` 默认开启并注册 dsh `tools/pre-execute` waterfall。该闸门只作用于 Nexus channel 已打开的会话，其余会话原样委托，Web 端保留 dsh 的 escalation 审批体验。已核验的 `read-only` Nexus 会话会在工具执行器前拒绝写操作；`workspace-write` 会拒绝缺失目标或越出工作区根目录的写操作。未知或缺失档位继续委托，不自行推断策略。
