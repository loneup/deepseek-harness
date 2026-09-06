---
description: "Nexus 兼容层：稳定的 NexusDshPort 接缝、Nexus 自有 wire 词汇，以及 Nexus Bridge 与 DeepSeek Harness Session/Subagent API 之间的错误映射。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-nexus-compat

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-host-nexus-bridge` 与 DeepSeek Harness 之间的稳定接缝。本包定义 `NexusDshPort` —— Bridge 消费的全部 Session、模型、历史和 Subagent 能力，只用 `src/types.ts` 中的 Nexus 自有词汇表达 —— 以及稳定的 `NexusPortError` 错误词汇。Harness 专属适配器（当前为面向 dsh 0.1.3-alpha.1 的 `Dsh013Adapter`）实现该 Port，并独占宿主类型、品牌 ID、错误与日志事件的全部转换。

Bridge 只允许依赖该接口；宿主 API 变化在此吸收，不再扩散到 Bridge、Web 设置页或 iOS 客户端。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

### 开发备注

web-app bundle 将本包挂载为 `nexus-dsh-compat` host 行，且位于 `nexus-bridge` 行之前，使 `ctx.nexusDsh` 在 bridge 的 `inject` 采样前就绪。实时事件刻意不经 Port：bridge 保留其 Cordis `session/event` 监听，使 Web 与 Nexus 两个表面共享一次广播、不重复投递。适配器在 provider 组合时绑定 `sessionController` 与 `subagents`；dsh 升版本时在同一批 Port 契约测试之后新增适配器，而不是修改 bridge。

## Model Experience

None, as the package exposes an in-process port seam between the Nexus Bridge and the harness and registers nothing model-facing.

#### KV Cache effect

None; the port holds no prompt-assembly state and no model-visible cache behavior.

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- **实时事件保留在 Cordis 总线** —— Port 刻意不提供订阅方法；Bridge 保留其 `session/event` 监听，使 Web 与 Nexus 两个表面共享一次广播、不重复投递。
- **无 invariant companion** —— Port 自身没有运行时不变量：全部行为保证由 `tests/` 中的契约测试持有（源码隔离扫描、manifest 校验、适配器调用断言），空的 `./invariant` companion 会违反包级 invariant 规则。
- **脱敏是适配器的职责** —— `NexusPortError` 的 message 必须已经对客户端安全；适配器在抛出前剥离宿主堆栈、路径与内部信息。
- **Subagent 目录透传** —— `subagent.list` 原样转发 dsh 的 `kind: 'child' | 'diagnostic'` 条目联合；iOS 时代的 fixture 展示的是更扁平的形状，两者对齐是独立决策。
