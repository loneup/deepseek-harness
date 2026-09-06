# Agent Note: 将 Nexus Bridge 挂载到 dsh WebServer

Status: proposed

[English](2026-08-25-nexus-bridge-webserver-plugin.md) | 中文

## Problem

当前 Nexus Bridge 是第二个 HTTP 进程，并通过 dsh 浏览器 API 访问 dsh。这会重复传输生命周期；虽然 dsh 已经提供可逆的 WebServer 路由注册服务，手机数据面仍使用独立端口。

## Proposal

将 Nexus Bridge 作为 dsh Host 插件挂载。插件通过 `ctx.webServer` 注册 `/nexus/*`，复用 dsh Session/Event/Approval 服务，并保持 dsh `/api/*` 不变。首个已实现切片只注册 `/nexus/health`；只有在证明服务映射、鉴权、回放和关闭语义后，才增加协议路由。管理面继续只绑定 loopback 的 `3089`，共享 Web 数据面使用 dsh 默认 `3080`。

插件的每个路由和订阅都必须通过 `ctx.effect()` 注册，以便 dsh fiber 销毁时移除路由、SSE 连接和监听器。不得复制 Session 状态，也不得绕过 dsh 信任和权限服务。协议变更必须另行批准并升版。

## Alternatives considered

**保留独立 Bridge 进程。** 这保留当前 Adapter seam，也是回滚路径，但会留下两个生命周期和两个数据面端口，需要分别保护和测试。

**把 Nexus 路由挂到 dsh `/api`。** 现有前缀由 dsh 客户端传输独占，复用会造成所有权冲突；`/nexus` 能为手机协议提供明确命名空间。

**把 dsh 默认端口改为 `3000`。** 当前 dsh Web profile 使用 `3080`；改变默认值会扩大迁移并破坏现有 Web 假设，却不能带来插件收益。

## Acceptance criteria

- 真实 dsh Web profile 在同一监听器上提供 `/api/*` 和插件的 `/nexus/health`。
- 销毁插件后 `/nexus/health` 消失而 dsh Web 继续工作；销毁 dsh 时所有 Nexus 订阅和监听器关闭。
- 后续协议切片保留 Nexus v3 鉴权、事件顺序、幂等、审计脱敏、kill-switch 和 loopback-only 管理，并有真实 dsh 证据。
- 不新增公网监听、凭证存储或敏感健康响应。

## Risks

dsh WebServer 与 Nexus 协议的错误和鉴权契约不同。仅把 `/nexus` 重写到现有 `/api` 处理器可能绕过信任检查或改变响应语义。因此，若无法证明权威 dsh 服务或关闭契约，迁移必须停止。
