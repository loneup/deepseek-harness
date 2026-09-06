# 真机 Golden Path 执行手册（S9b · 2026-09-07）

> 目标：在 iPhone 真机上完成一次端到端验收——**配对 → 会话 → turn → 审批双 UI 应答 → 断线恢复**。
> 本手册由第九轮准备（连通性已就绪、27/27 验收已通过转发器路径复跑）。执行需要**人持 iPhone 参与**；每阶段证据按 HANDOFF 完成定义归档。
> 参考：iOS 仓库 `DEVICE_ACCEPTANCE_GUIDE.md`（2026-09-05 旧基线版，流程结构可参考，端口/地址以本手册为准）。

## 0 · 连通性（已就绪，勿重复搭建）

| 件 | 状态 | 说明 |
|---|---|---|
| Beta 服务 | ✅ 运行中 | `http://127.0.0.1:3088`（node 24.11.1，PID 见 `lsof -nP -iTCP:3088`）；重启：`env -u DSH_HOME -u NEXUS_ENV -u NEXUS_WEB_PORT -u NEXUS_PLUGIN_CHANNEL pnpm run web:beta` |
| Tailnet 转发器 | ✅ 运行中 | `http://100.107.98.34:3088` → `127.0.0.1:3088`（只绑 Tailscale IP，tailnet 外不可达；`node migration/tools/nexus-beta-forwarder.mjs`，SSE 流式已验证） |
| iOS App 地址 | ✅ 已配置 | Beta target 真机：`NEXUS_BRIDGE_URL[iphoneos] = http://100.107.98.34:3088/nexus`（pbxproj 内置，ATS 白名单已含该 IP） |
| 浏览器备选 | ✅ | `http://127.0.0.1:3088/?token=aEQ2Obkq8b0hwO_qFuFFICvkQaSnY5wKB29MRxi7WA4`（token 随 beta 重启变化，取自 `/tmp/nexus-beta-relaunch-node24.log`） |
| HTTPS 备选 | ⚠️ 未验证于手机 | `https://macmini-m4.tail4239f5.ts.net`（tailscale serve → 3088；本机 MagicDNS 未开，手机端能否解析待验） |

**执行前检查**（Mac 侧）：
```sh
curl -s http://100.107.98.34:3088/health            # 应返回 beta health JSON（转发器活着）
BASE=http://100.107.98.34:3088 node /tmp/nexus-live-acceptance.mjs   # 应 27/27
```

**执行前检查**（iPhone 侧）：
1. **打开 Tailscale App 并连接**（当前 iphone184 已 39 天离线——必须先上线）。
2. Safari 访问 `http://100.107.98.34:3088/health` 应显示 `{"ok":true,...}`（验证 tailnet 通）。
3. Xcode 安装 Beta target 到真机（Bundle ID / 显示名按 S7 双环境隔离）。

## 1 · 配对（一次性 QR / 配对码）

- App 首启进入连接页 → 显示配对请求；Mac 侧 bridge 生成配对码（`~/.dsh/nexus-beta/registry/` 的 `pairingCodes`）。
- **通过**：App 与 Mac 完成配对握手（Ed25519 设备身份写入 registry `devices`）。
- **证据**：App 显示已连接；`cat ~/.dsh/nexus-beta/registry/registry.json` 含新设备条目；Mac 侧审计日志（`~/.dsh/nexus-beta/audit/`）有 pairing 记录。
- **拒绝路径**（可选加分）：配对码输错/过期 → App 收到明确错误码（六码错误词汇，见 DECISIONS D2）。

## 2 · 会话（session open + 历史）

- App 打开/新建会话 → bridge `session.open` → SSE `session.subscribed` anchor 帧。
- **证据**：App 会话列表非空；SSE 首帧为 `session.subscribed`（序列号从 1 连续）；`~/.dsh/nexus-beta/storages/` 下出现该会话的持久化记录（jsonl）。

## 3 · Turn（发送 prompt → 流式回复 → 完成）

- App 输入框发送一条 prompt → `turn.started` → `message.committed`（流式分帧）→ `turn.completed`。
- **证据**：App 端流式渲染完整回复；事件序列号连续无跳号；`turn.completed` 后 UI 回到可输入态。
- **取消路径**（可选加分）：发送中途点停止 → `turn.cancelled`（reason=aborted），无残留半开 turn。

## 4 · 审批双 UI 应答（Web + App 抢答）

- 触发一个需要审批的工具调用（高风险 tool 声明审批）。
- **双 UI 同时可见审批卡片**：iPhone App 审批页 + 浏览器（token URL）审批卡片。
- **抢答语义**（approvals.spec 已固化的契约，真机复验）：第一个应答（allowed-once / rejected）生效并 settle waterfall；另一 UI 对同一 id 的重复应答被拒绝（明确错误，非静默）。
- **证据**：两侧 UI 一侧成功一侧收到"已应答"错误；审计日志含 approval respond 记录；工具按裁决执行/未执行。

## 5 · 断线恢复

- 场景 A（App 侧）：飞行模式 10s → 关闭 → App 自动重连 → SSE 续流（anchor 重新出现，序列号不倒退/不重复）。
- 场景 B（服务侧，可选）：`kill` 转发器进程 → 重启转发器 → App 重连成功（beta 本体不动）。
- **证据**：重连后 App 能继续收事件、发新 turn；会话历史完整（断线期间 Mac 侧产生的 turn 在恢复后可见）。

## 6 · 收尾

- 全部通过 → HANDOFF S9b 行改 ✅ 并附证据摘要；KNOWN_ISSUES #12（真机连通性）标注已按"临时反向代理（tailnet 转发器）"方案落地。
- 发现问题 → 记 KNOWN_ISSUES 新条目（含复现步骤与阶段号），不阻塞其他阶段的问题分开记录。

## 附 · 已知边界

- 转发器是**临时**设施（tailnet-only，进程级）；正式方案仍是 S7 xcconfig + 真正的 LAN/HTTPS 通道（KNOWN_ISSUES #12 优先级序列）。
- 3000 production 全程不动；本手册所有操作只涉及 beta（3088 / `~/.dsh/nexus-beta`）。
- iPhone Tailscale 离线 39 天是当前唯一硬前置；若 tailnet 不可用，退级方案：同一 Wi-Fi 下 Mac 局域网 IP + 转发器改绑 LAN IP（`BIND=<lan-ip> node migration/tools/nexus-beta-forwarder.mjs`，需同步改 ATS 白名单——涉及 iOS 仓库改动，需另行授权）。
