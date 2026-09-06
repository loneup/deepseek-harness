---
description: "dsh Web 设置中的 Nexus 配对与设备管理页，复用共享 Web 监听器和 Nexus /nexus/admin/* 路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-nexus

[English](README.md) | 中文

## 概述

`dsh-client-ui-settings-nexus` 在 dsh Web 设置界面中渲染 Nexus 远程控制管理页：创建配对码、已配对设备列表、撤销设备以及 kill-switch 状态。它通过共享 Web 监听器上的 Nexus 桥 `/nexus/admin/*` 路由通信，浏览器不打开第二个传输端口，也不保存配对密钥——配对码只显示一次，仅保存在 Host 注册表中。管理页由设置外壳挂载，在同一页面报告桥可达性和操作员动作，让本机操作员在一个位置管理哪些设备可以命令会话。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

### 开发备注

客户端 bundle 声明 `dsh.client`、`platform: web`，并注入 `@deepseek-ai/dsh-client-locale` 与 `@deepseek-ai/dsh-client-ui-settings`；web-app bundle 以 `ui-settings-nexus` 插件行挂载它。管理请求携带操作员 Bearer 令牌，Host 侧执行来源网络 allowlist，因此本机 loopback Web 访问是初始化路径。

## Model Experience

None, as this package only renders Host administration controls and does not contribute model-visible input.

#### KV Cache effect

None; this package does not assemble or send model requests.

## Known Limitations and Deferred Work

- No runtime invariant companion is published：本包只贡献浏览器 Settings tab；原空 `./invariant` 桩按包级 invariant 规则移除，覆盖由 `tests/` 持有。
- Remote administration still requires 对应：远程管理仍需 Host 侧 Bearer token 与来源允许列表；本机回环 Web 访问是引导路径。
- Pairing codes are displayed once 对应：配对码只在 Settings 页显示一次，浏览器不持久化。
