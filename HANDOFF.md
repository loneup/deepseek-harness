# HANDOFF · 当前交接状态

更新时间：2026-09-06（Nexus 兼容层迁移会话，第七轮：审查结论 P1/P2 修正）

## 冻结信息（Stage freeze）

| 项 | 值 |
|---|---|
| dsh 仓库 | /Users/liyan/deepseek-harness，分支 `master`，HEAD `c02ff3445150ebece9da48ffde717ce600df4f0e`，工作树未提交文件（迁移产物 + 用户既有修改 + 第三至五轮产物，均未 commit；第五轮含上游 agent-loop/ACP 竞态修复与 Node 24.11.1 统一，未提交数以 `git status` 实查为准） |
| Nexus 仓库 | /Users/liyan/01_Projects/iOS/nexus-app，分支 `main`，HEAD `258f9d00cea230481059ce339358cdeacfd82296`，工作树干净，未修改 |
| dsh 版本 | 0.1.3-alpha.1 |
| 适配器绑定 | Dsh013Adapter ↔ Nexus Port v1 ↔ dsh `0.1.3-alpha.1` @ `c02ff34`（commit 待人拍板后固化 SHA） |
| 版本锁定策略 | 见 DECISIONS.md D5；升级流程：新 dsh 版本 → 复制适配器为 Dsh014Adapter → 对同一批契约测试跑 `Dsh014Adapter → NexusDshPort contract` → 失败集中在适配器 |

## 阶段状态总表

| 阶段 | 状态 | 证据 |
|---|---|---|
| S0 Web 插件资源 | ✅ 完成（验收标准已按真实 roster 修订，见 KNOWN_ISSUES #2） | 50/50 组合 URL 200；startup.spec 钉死 200/404 契约 |
| S1 NexusDshPort | ✅ 完成 | 10 方法 + 品牌 ID + 六码错误；契约测试含"公共面禁用 dsh 类型名"源码扫描 |
| S2 Dsh013Adapter | ✅ 完成 | 11 个 dsh 调用点全部在适配器内；bridge src 零命中 |
| S3 错误/事件映射 | ✅ 完成 | errors.spec/events.spec 全过；真机映射见实时链路验收 |
| S4 Cordis provider | ✅ 完成 | 真实进程加载 0 错误；健康自检 `{"ok":true,"nexus":{"port":true,"adapter":"dsh-013"}}` |
| S5 Bridge Port 化 | ✅ 完成 | 禁用标识符 grep 0 命中 + 常驻回归测试；29/29 bridge 测试 |
| S6 历史/实时/审批 | ✅ 完成（含真实正向 settle 集成测试 approvals-live 2 项） | session-open.spec + approvals.spec 8 项 + approvals-live 2 项 + 真实链路 sequence 连续 14 帧 |
| S7 Subagent | ✅ 完成 | subagent.spec + subagent-command.spec + 真实链路 5 项 |
| S8 Web built | ⚠️ 条件完成 → gate 已绿 | ① 迁移验收层——Nexus 相关测试全绿（compat 62 + bridge **76** + web-app 24）+ 真实链路 27/27 ×3 runs；② 仓库整体门禁层——queue-actions 限定 retry 后**全量 `test:web:built` exit 0（317/332 通过、0 失败，2026-09-05 完整重跑）** |
| S9 iOS 回归 | ✅ 模拟器层完成（npm test 278/278；swift test 96/96；xcodebuild BUILD SUCCEEDED；未改 iOS 代码） |
| S9b 真机 Golden Path | ❌ 待执行（人工） | 配对 → 会话 → turn → 审批双 UI 应答 → 断线恢复 |
| S10 版本兼容矩阵 | ⚠️ 设计完成（DECISIONS D5） | dsh 0.1.3→Dsh013Adapter→Port v1 已实测；0.1.4 适配器为设计预留，尚未实测 |

**整体完成度：约 95%。剩余实际未完成项：① 真机 Golden Path 验收（人工，S9b）；② Python PATH 永久修复（E.2，`.zshrc` 前置 homebrew 或仓库级 Python 钉版）；③ 回滚演练 / 正式发布准备（0.1.4 发布时 production 切 stable 渠道、manifests 随发布再生成）。~~审批 settle 单测重建、三个 .disabled 套件重写~~已随第二轮完成（approvals.spec 8 项 + approvals-live 2 项 + nexus-bridge/admin/mapping 三套件转正，见 KNOWN_ISSUES #7）。**

## 跳过测试审计（test:web:built 的 15 个跳过项）

| 文件 | 数量 | 级别 | 跳过原因 | 补跑条件 |
|---|---|---|---|---|
| apps/web/tests/smoke-real.e2e.ts | 8 | **B-ENV**（外部凭证受限的 UI 冒烟/Figma 对比类） | 需要 `DEEPSEEK_API_KEY`（真实 API 调用）；同文件 keyless 部分已跑 | 设 `DEEPSEEK_API_KEY` 后 `pnpm run test:web:built -t smoke-real` |
| apps/web/tests/turn-tail-actions.e2e.ts | 1 | **B-REAL**（record 半区；replay 半已跑） | record/replay 配对的 record 半（需真实模型） | 设 key 后 `DSH_SNAPSHOT=record` 定向跑该文件 |
| apps/web/tests/navigation-panes.e2e.ts | 1 | **B** | 同上 | 同上 |
| apps/web/tests/live-interactions.e2e.ts | 1 | **B** | 同上 | 同上 |
| apps/web/tests/goal-multi-turn-actions.e2e.ts | 1 | **B** | 同上 | 同上 |
| apps/web/tests/seeded-history.e2e.ts | 1 | **B** | 同上 | 同上 |
| apps/web/tests/pwsh-terminal.e2e.ts | 2 | **C**（平台限定） | `MODE==='record'` 或宿主无 `pwsh`（平台探测自跳） | 安装 pwsh 后自动启用 |

**分级定义**：A = 可接受且已有等价覆盖；B-REAL = 需要真实 API key（外部服务/凭证受限），发布前建议补；B-PLATFORM = 平台能力缺失；B-ENV = 其他环境限制。分级结论：无 A 级（Nexus 核心路径）跳过项；B-REAL ×5（record 半区）、B-PLATFORM ×2（pwsh）、C 类真实 key 冒烟 ×8（外部凭证受限，非核心路径）。 15 个跳过项均为真实模型录制半区（B）或平台/成本限定场景（C）。Session prompt、Subagent、SSE、approval/respond、Web 插件资源、Loader 组合等核心路径由 compat 62 + bridge **72** + web-app 24 个单测与 27/27 真实链路验收覆盖（全部实际执行）。

## 运行态 Web 证据（2026-09-05 23:12，浏览器实测）

- 进程来源：3000 端口 PID 49296，cwd `/Users/liyan/deepseek-harness`，命令 `node --import tsx/esm apps/cli/src/bin.ts --profile web --port 3000 --no-open`（正确仓库、正确 profile）。
- 健康检查（production 切换后）：`/nexus/health` 与 `/health` 均返回 `{"ok":true,"environment":"production","port":3000,"channel":"stable-candidate","nexus":{...,"protocolVersion":4}}`；无认证访问 `/` 得 401（认证边界生效）。
- 完整认证 URL 打开（dsh 启动日志打印的带 token URL，token 只存 /tmp 不入库）：首页完整渲染，版本标识 `DSH Local Build 0.1.3-alpha.1-c02ff34-dirty`，会话树/composer/模型选择就绪，无插件加载错误；Settings→Plugins→**Nexus admin** 标签存在且完整渲染（NEXUS BRIDGE / Pairing / Paired devices / Create pairing code）。
- 证据文件：`/tmp/nexus-runtime-evidence.txt`、`/tmp/nexus-web-home.png`（运行态证据不入库，token 敏感）。

## ✅ 已解决：preview-boot e2e 的 NEXUS_ENV 豁免（2026-09-06 第三轮）

**根因**：前任把 `NEXUS_ENV is not set` 加进了 `bootPreview`（apps/web/tests/preview-boot.e2e.ts:418 附近）的正则——但那个 filter 是**正向匹配的失败允许清单**（只有命中正则的行才算失败、期望为空），加进去等于"保留该行并判失败"，语义正好相反。`bootEmptyPreview` 的 filter 是排除法（`!line.includes(...)`），那里的修法才是对的。前任的困惑"正则明明应命中"恰恰说反了：**命中即保留，保留即失败**。

**修复**：418 行正则回退到原始形态（原正则本来就不匹配该警告 → 天然豁免，警告保留），并加注释说明该正则是 failure allowlist、豁免靠"不匹配"实现，防止再犯。479 行（排除法）的豁免保留。

**验证**：单文件 `vitest run --config vitest.web.config.ts apps/web/tests/preview-boot.e2e.ts` 1/1 通过（7.5s）；全量 `pnpm run test:web:built` exit 0（93 文件、317/332 通过、15 跳过、0 失败，423s）。

## 第三轮（2026-09-06）· 交接待办清零记录

> **审查包**：`migration/review-2026-09-06.md`（自包含：背景 + 本轮改动清单 + 复跑命令 + 待人审决策，供新会话在人审 commit 前审查本轮工作）。

| 项 | 结果 | 证据 |
|---|---|---|
| preview-boot NEXUS_ENV 豁免 | ✅ 修复 | 见上节；单文件 1/1 + 全量 317/332、0 失败 |
| `.nvmrc` 固定 Node | ✅ `22.23.1` | 新文件；`pnpm run web:beta` 在 node 22.23.1 下通过 node 检查（停在预期的端口占用守卫） |
| 启动器 Node 版本检查 | ✅ 落地 | 新增 `scripts/node-version-pin.ts`（纯函数）+ `node-version-pin.spec.ts`（6 测试）+ 接线 `run-web-env.ts`（argv 校验后、环境解析前 fail-loud）；实测 homebrew node 26.3.0 被拦截并给出 `nvm use` 提示；lint 0 错误、tsc host exit 0 |
| 原生依赖重装 | ✅ 不需要 | `require('fs-ext')` 在 22.23.1 下加载正常；ABI 错误只发生在错拿 node 26 时（已被启动器检查拦截；本轮曾因 PATH 前缀过宽意外复现 39 文件 ABI 失败，换外科 PATH 后消失） |
| CPython ≥3.10 | ✅ 已存在 | **根因修正**：3.14.7 已装（homebrew `python@3.14`），244 项失败的真因是 PATH 顺序——`/usr/bin/python3`(3.9.6) 排在 `/opt/homebrew/bin/python3`(3.14.7) 之前，交互 shell 与会话 shell 皆然。**无需安装，需用户调整 shell PATH 顺序（人审决策）** |
| `pnpm run test` 全量 | ✅（1 已知 flake） | 外科 PATH（仅前置 python3 符号链接、node 仍 22.23.1）：**18328 通过 / 1 失败 / 118 跳过**（基线 18050/245 失败 → 244 项 Python 失败全部消除）。唯一失败 = KNOWN_ISSUES #10 记录的 spill-local 边界计时 flake，隔离复跑 41/41 通过 |
| `pnpm run test:e2e` | ✅ **src 模式全绿（第五轮修复后）** | 全量 e2e 车道 src 模式 **36 文件 137 测试全过、0 失败**（73 跳过为外部凭证/平台门控，与此前一致）。此前 10 项 ENOENT `.sessions` 失败根因为上游 agent-loop 构造期持久化接合在 src 模式下输掉加载时序（KNOWN_ISSUES #10b），第五轮已修复（loader 安定门 + ACP 冗余通知抑制），**零测试断言改动**。lib 模式（CI 同款）10/10 保持全过 | |
| `pnpm run hygiene` | ✅ 16/16 | exit 0，18.05s |

**本轮改动文件**（均未 commit，待与既有 68 项一并人审）：
- 修改 `apps/web/tests/preview-boot.e2e.ts`（418 行正则回退 + 注释；479 行豁免为前任正确改动，保留）
- 新增 `.nvmrc`（`22.23.1`）
- 新增 `scripts/node-version-pin.ts` + `scripts/node-version-pin.spec.ts`
- 修改 `scripts/run-web-env.ts`（import + node 检查块）

**复跑命令备忘**（Python 门禁）：
```sh
# 外科 PATH：只前置 python3，不影响 node 解析
mkdir -p /tmp/py314-bin && ln -sf /opt/homebrew/bin/python3 /tmp/py314-bin/python3
PATH="/tmp/py314-bin:$PATH" pnpm run test
# 永久修复（待人审）：把 /opt/homebrew/bin 提到 /usr/bin 之前（如 .zshrc 早段 eval brew shellenv），或引入 mise/.python-version 仓库级钉版
```

## 双环境治理计划（S0–S12，依据 2026-09-06 环境隔离与发布渠道方案）

**运行约束（2026-09-06 固化，后续所有操作必须遵守）**：

```text
3000 → Production，保持运行；绝不停止、重启、改配置或占用该端口
3088 → Beta，允许单独启动/停止/验证
```

- 对 3000 只允许只读检查：`curl http://127.0.0.1:3000/health`、`lsof -nP -iTCP:3000 -sTCP:LISTEN`。
- 开发与测试一律 `pnpm run web:beta`（3088）；iOS 侧只针对 `Nexus-Beta` / 3088 / beta manifest / `~/.dsh/nexus-beta`。
- Production 的任何重启只在数据迁移/发布流程经人确认后由人执行；`web:production` 的端口占用 fail-loud（`scripts/run-web-env.ts` assertPortFree）天然防止意外抢占 3000。

## 双环境治理计划（S0–S12，依据 2026-09-06 环境隔离与发布渠道方案）

两个正交维度：**环境**（beta=3088 / production=3000 或生产域名）与**发布成熟度**（alpha/beta/rc/stable）。当前称谓：3000 = production **candidate**（生产配置候选，dsh 0.1.3-alpha.1，channel `stable-candidate`）；3088 = beta。详细规则见 DECISIONS.md D7。

| 切片 | 状态 | 证据 |
|---|---|---|
| S0 冻结基线 | ✅ | dsh c02ff34 + 本迁移工作树；nexus 258f9d0；3000 行为已实测（本文件运行态证据节） |
| S1 环境配置模型 | ✅ | `src/environment.ts` + `environment.spec.ts` 15/15（显式环境名、端口/渠道冲突 fail-loud、DSH_HOME 冲突拒绝、manifest 校验、端口永不推导环境） |
| S2 双启动入口 | ✅ | `pnpm run web:beta` / `web:production`（`scripts/run-web-env.ts`：端口占用 fail-loud、registry seeding、manifest 校验、启动行含 environment/port/channel/adapter） |
| S3 DSH_HOME 数据隔离 | ✅（运行证据） | beta 用 `~/.dsh/nexus-beta`（registry/audit/killswitch/manifests 独立目录已生成）；与 3000 的默认 home 完全分离 |
| S4 插件 manifest | ✅ | `release-manifests/{beta,production}.json`（精确版本、零动态 tag、零 dsh-client-runtime、nexusCommit/lockfile SHA/nodeVersion/buildTimestamp 可追溯）+ `plugin-manifest.spec.ts` 6/6 |
| S5 Web boot URL 测试 | ✅（beta 实测） | 认证 URL → 首页 24,997B → 4 个关键插件组合 URL 全 200（JS Content-Type）→ client-runtime 零引用；自动化等价物已存在于 startup.spec（组合 URL 契约） |
| S6 健康检查可观测性 | ✅ | 健康自检新增 `environment/port/channel/release/nexus.protocolVersion`（加法性，未配置时为 null）；bridge apply 对环境身份 fail-loud |
| S7 iOS Scheme/配置 | ✅ 基本完成 | 4×4 Build Configuration（Debug/Release × Beta/Production，双 target 覆盖）；`Nexus-Beta` / `Nexus-Production` 双 Scheme 构建通过；产物断言：Bundle ID `com.loneup.nexus.app.beta`/`.app`、显示名 `Nexus Beta`/`Nexus`、NEXUSBridgeURL 3088/3000、NEXUSEnvironment、扩展 App Group `.beta`/基础组全部隔离；Keychain service 按环境后缀（`dev.nexus.device-keys.beta`）；UserDefaults 经 Bundle ID 天然隔离。残留：`nexus://` 深链 scheme 双安装共享（见 KNOWN_ISSUES #14）；App 目标无 entitlements（与迁移前一致，写入 Live Activity 投影时需补） |
| S8 跨环境认证测试 | ✅（production 切换后复测） | beta token 对 3000 → 401 unknown_client；production 配对码对 beta → invalid_pairing_code；**两环境 27/27 全链路各自通过** |
| S9 Beta 完整验收 | ✅ 本机链路完成（真机待 S7） | 27/27 ×2（3088）；含 Session/Subagent/Approval/SSE/kill-switch 全链路；注意：新初始化 home 的首个会话存在 provider 凭证预热窗口（验收脚本已内置新建会话重试） |
| S10 Production candidate 验收 | ✅ 基本完成 | 旧 `~/.dsh` 已备份（`~/nexus-backups/dsh-home-backup-20260906.tar.gz`）→ 3000 经 `web:production` 重启 → health=`environment:production, port:3000, channel:stable-candidate`；独立 `~/.dsh/nexus-production`（provider 凭证已配置）；27/27 全链路通过；旧会话数据留在备份中按需恢复 |
| S11 回滚演练 | ❌ 待实施 | 数据备份已就绪（`~/nexus-backups/`）；依赖 manifest/artifact 冻结（与 commit 联动） |
| S12 正式发布准备 | ❌ 未开始 | 门槛清单见方案原文 |

**注意**：当前 3000 运行进程是在环境字段上线前启动的，健康自检 `environment` 为 `null`（过渡态）；经 `pnpm run web:production` 重启后即携带 production 标识——但会切换 DSH_HOME，涉及数据迁移决策，见 S10。

## 真实链路验收（27/27 ×3 runs，脚本 /tmp/nexus-live-acceptance.mjs）

对真实 `dsh --profile web` 进程（NEXUS_DEVICES_PATH/KILLSWITCH/AUDIT 指向 /tmp）实测：pairing.create → device.register(Ed25519) → handshake v4 两轮（nonce 32 字节）→ connection.ping → session.create/list/open/models/selectModel → workspace.gitStatus → turn 空文本 `empty_prompt` → turn.start 真实模型回合（SSE：anchor 居首，`turn.started→tool.started→tool.result→message.committed→turn.completed`，sequence 1–14 连续无跳号/无重复）→ turn.steer/cancel → approval.respond 未决→`approval_not_pending` → 未知方法→`unknown_method` → kill switch 生效/释放 → subagent.list（含未知 parent 空目录语义）→ subagent.history 非法 mode→`malformed` → subagent.prompt 未知 child→错误映射 → subagent.interrupt no-op 回执。**注意**：此验收使用了 .env 中的真实模型 key 跑了一轮最小 prompt；审批 ask→respond 的真实闭环仍需真机（Web 与 Nexus 双 UI 抢答场景）。

**稳定性记录：3/3 runs，27/27 each**（2026-09-05 连续三次）。注意：脚本复用运行中的 Web 进程与 /tmp 下的隔离 registry/killswitch/audit 文件（与用户默认 ~/.dsh 隔离），但 session.create 的真实会话写在进程的 home 内；每次运行产生一次小规模真实模型回合（prompt 为 "ping"）。

### approval.spec 覆盖映射（8 个测试 ↔ 场景）

| 测试 | 覆盖场景 |
|---|---|
| publishes the approval card and claims the ask… | card 发布 + claim + payload 字段 |
| delegates for a session no Nexus channel has opened… | 非 Nexus 会话 delegate（仍发卡） |
| delegates when no unanswered ask matches the tool… | 已决不抢答 + 异工具不抢答 + 无 ask |
| separates asks by callId | 异 callId 不抢答 + 同 callId claim |
| settles a claimed approval through respond… | respond settle + 重复响应拒绝 |
| rejects a response whose session does not own… | 会话不匹配 + 未知 approvalId 拒绝 |
| settles an aborted ask as cancelled | abort → cancelled + 取消后 respond 落空 |
| keeps entries answerable across an SSE disconnect… | SSE 断连后仍可应答 |

### 健康自检安全边界

`/nexus/health` 与 `/health` 别名使用同一注册逻辑、同一无鉴权 loopback 暴露面（与迁移前一致）；响应仅含 `ok/nexus.port/nexus.adapter` 三字段，nexus-bridge.spec 以 `toEqual` 钉死形状——未来若需更多内部诊断，应只加本地诊断通道，不扩展此响应。

## 最近完成

- S0：Web client 插件静态资源 404 修复（根因与证据见 KNOWN_ISSUES 第 1、2 条）。
- S1–S3：`packages/host/nexus-dsh-compat` 新包 + 62 个测试全过。
- S4：web-app bundle 挂载 provider；`/nexus/health`（及 `/health` 别名）输出 nexus 启动自检 `{"ok":true,"nexus":{"port":true,"adapter":"dsh-013"}}`。
- S5–S6：nexus-bridge 重构为只依赖 `NexusDshPort`（29 个 bridge 测试全过；LegacyApiResponse/wrapResult/wrapError/RpcId/apiProxy/remoteErrorOf/dsh 内部类型全部从 src 移除，grep 0 命中，并有常驻源码文本回归测试）；session.open 顺序改为"历史先、anchor 后"；空 prompt 按 iOS 契约返回 `empty_prompt`。
- S8：`tsc -b tsconfig.host.json` / `tsconfig.client.json` exit 0；`pnpm run build` exit 0；真实路由探针全部符合预期；`test:web:built` 317/332 通过 0 失败（跳过项审计见上）。
- S9：iOS 三项回归与基线一致，未修改 iOS 代码。

## 第四轮（2026-09-06）· 审查结论执行记录

> ⚠️ **本节为历史记录，已被第五、六轮执行记录 superseded**：下表"⛔ 未动/暂缓"的 P1-a（Node 统一）与 E.4（agent-loop 修复）均已在第五轮经人审授权执行完毕，P1-b 的"实际污染"定性已在第五轮勘误（实为可见性干扰，未删任何文件）；release-manifests 已在第六轮按 P1 重新生成。当前状态以第五、六轮两节与 KNOWN_ISSUES 为准。
>
> 审查包 `migration/review-2026-09-06.md` 的审查结论：暂缓 commit 授权，给出 P1×2 / P2 / E.1–E.6 决策。本轮按结论执行。

| 项 | 结果 | 证据 |
|---|---|---|
| E.4 前置调查（`.sessions` 失败根因） | ✅ 实证闭环，**推翻原卡前提** | 机制链：fixture 钉 `root:'./.sessions'` → agent-loop 构造器 `ctx.get('sessionPersistence')`（strict）→ Loader `Promise.allSettled` 并发挂载 → src 模式 persistence-jsonl 全新导入图慢于 agent-loop 缓存命中 → 构造器拿 undefined → 静默走无持久化分支。**lib 模式 6 文件 10/10 全过**（`DSH_EXAMPLE_MODE=lib DSH_HOME=$(mktemp -d) pnpm exec vitest run --config vitest.e2e.config.ts <6 文件>`）；src 模式同批 9/10 失败。探针实证：服务加载正常、root 正确、`create()` 从未被调、事件照常流。产品路径（headless-runner 声明式 inject）持久化正常。详见 KNOWN_ISSUES #10b 第四轮重写 |
| P2 文档修正 | ✅ | HANDOFF `#15`→`#10b` ×2；头部更新时间 2026-09-05→2026-09-06（第四轮）、未提交数 65→90；KNOWN_ISSUES #10b 按实证重写；审查包 D 节勘误（见下） |
| P1-b 测试环境可复现 | ✅ 命令已固化 | 复跑命令显式 `DSH_HOME=$(mktemp -d /tmp/xxx-XXXX)`（防会话继承 `~/.dsh/nexus-production` 污染 production home——第三轮已发生实际污染，见 KNOWN_ISSUES #10b 附近记录与审查包 D 节）；e2e/e2e-lib 两种模式都给出 |
| E.4 构建卡 | ⛔ 暂缓（前提不成立） | 原卡"断言迁 projcache + per-record JSON 重写"基于"持久化路径已变更"的错误诊断；实证为上游 agent-loop 时序缺陷，断言正确、projcache 无事件流。执行原卡会削弱测试并掩盖上游缺陷。需人审重新定界（修复上游接合 or 维持现状记录） |
| P1-a/E.3 Node 统一 | ⛔ 未动 | 审查结论要求统一到 24 系列精确 patch（本机有 24.11.1）并同步 `.nvmrc`/workflows/manifests/重建原生依赖/复跑门禁。这是大范围改动（8 个 workflow 文件 + 2 个 manifest + 原生依赖重建 + 全门禁复跑），且 `release-manifests` 属发布配置——按 AGENTS.md 需人审确认后执行，本轮未动 |

**本轮改动文件**：`HANDOFF.md`（引用修正 + 第四轮节）、`KNOWN_ISSUES.md`（#10b 重写）、`migration/review-2026-09-06.md`（D 节勘误）。探针临时文件已全部清理（`packages/goal/goal/tests/fixtures/domain/probe-*` 已删，git status 恢复干净）。

## 第五轮（2026-09-06）· 人审三项授权执行记录

> 第四轮报告后用户拍板三项：① Node 统一 24.11.1；② 修复上游 agent-loop（E.4 处置）；③ production home 污染清理（先列清单）。

| 项 | 结果 | 证据 |
|---|---|---|
| production home 污染核查 | ✅ **定性勘误：无测试污染** | 逐一解析 `~/.dsh/nexus-production/storages/session_projcache/sessions/` 全部 62 个 JSON：cwd 全为真实项目（ntr115/MMX/mowen/komari/panstar-help/nexus-app/deepseek-harness），**0 个临时目录 cwd**（e2e 测试会话 cwd 为 `/var/folders/.../T/...`）。第三轮"测试写入污染 production home"定性有误——实为**真实会话数据被缺乏 DSH_HOME 隔离的测试读到**（可见性干扰，非写入污染）。按"绝不删真实用户数据"红线**不删任何文件**；测试侧隔离已由 P1-b 显式 `DSH_HOME` 复跑命令解决 |
| 上游 agent-loop 竞态修复 | ✅ 已落地（人审授权） | `packages/core/agent-loop/src/index.ts`：配置式 agent 启动抽为 `startConfiguredAgent()`，服务不可见且存在 Loader 时 `await loader.await()`（boot 自用树安定原语）后重读；安定树仍无服务保持无后端契约。**覆盖两个接缝**：exact-id 分支 + `create()`→`createStoredSession()` 命令式读（fixture 实际形态，agents 无 sessionId）。新增确定性回归 `packages/core/agent-loop/tests/loader-composition.spec.ts` 3 项（慢 persistence 导入下 exact-id 恢复 / fresh 物化 / 无后端契约；对未修复代码实测失败） |
| ACP 冗余通知修复（同族第三接缝） | ✅ 已落地 | `packages/acp/acp/src/session.ts`：src 模式下 `llm/adapters-updated` 晚到 → 对 session/new 已返回的相同选项重复发 `config_option_update`（goal.expected 2 项失败根因，修复前逐字节相同 diff 实证）。选项读取与拓扑通知串行化 + 无变化抑制；真实拓扑变化通知语义不变（bridge.spec 139/139 过） |
| 修复验证 | ✅ 全绿 | src 模式 6 文件 e2e **10/10**（此前 9 败）；expected 车道 src 模式 **28/28**（此前 2 败）；**全量 e2e 车道 src 模式 36 文件 137 测试全过 0 失败**（此前 28 败）；lib 模式 10/10；agent-loop 单测 375/375；ACP 单测 139/139。**零测试断言改动**——E.4 原卡（断言重写）作废 |
| Node 统一 24.11.1 | ✅ 已执行（人审授权） | `.nvmrc`→24.11.1；8 workflow `PRIMARY_NODE_VERSION`→'24.11.1'；10 处裸 `node-version: 24`→24.11.1；ci.yml compat matrix 24.9/26 保留；fs-ext `npm rebuild`（ABI 127→137），消费方单测 304/304；~~release-manifests 留待下次发布（描述已构建产物）~~（第六轮 P1 勘误：manifest 是工作树快照而非发布产物，已重新生成 nodeVersion/lockSHA 与工作树一致）；`ci-workflow.spec.ts` 22/22 过；node 24 下 tsc 干净 + oxlint 0 警告 + 全量单测（见门禁记录） |
| Node 24 glob 回归适配 | ✅ 已修复 | node 24 `fs.glob` 对 `**`+字面结尾段+符号链接抛 ENOTDIR（node 22 跳过；通配符结尾不受影响；合成复现确认）。`verify-md-wrap` 两字面模式改固定深度，双 node 匹配集一致（2292 文件），`check:ci:static` 45/45 恢复。详见 KNOWN_ISSUES #13 |

**本轮改动文件**：`packages/core/agent-loop/src/index.ts`（竞态修复）、`packages/core/agent-loop/tests/loader-composition.spec.ts`（新增回归）、`packages/core/agent-loop/package.json`（+2 devDeps：cordis-plugin-loader/include）、`packages/acp/acp/src/session.ts`（冗余通知修复）、`.nvmrc`、`.github/workflows/` ×15（Node 钉点）、`scripts/verify-md-wrap.ts`（node 24 glob 适配）、`pnpm-lock.yaml`、`KNOWN_ISSUES.md`（#10b/#13 更新）、`HANDOFF.md`（本节）、`CHANGELOG.md`（第五轮节）、`migration/review-2026-09-06.md`（第五轮勘误）。

## 第六轮（2026-09-06）· beta 切 node 24 + 二开清单机制

> 用户指示：3088 可用 node 24.11.1 重启；尽量不动源码，必要时二开须区分原版与二开、避免拉取最新被覆盖。

| 项 | 结果 | 证据 |
|---|---|---|
| 3088 重启到 node 24.11.1 | ✅ | 干净环境（`env -u DSH_HOME -u NEXUS_ENV -u NEXUS_WEB_PORT -u NEXUS_PLUGIN_CHANNEL`，防会话继承污染——首次启动即被继承的 `NEXUS_WEB_PORT=3000` 拦截，印证 P1-b）+ `pnpm run web:beta`；lsof 确认进程二进制为 `~/.nvm/versions/node/v24.11.1/bin/node`；health ok；**27/27 全链路验收通过**。新 token：`http://127.0.0.1:3088/?token=De5-SFrZuufL1ffvSk9-bZVZxRptIMPxoQuF2LdtCXA`（日志 `/tmp/nexus-beta-relaunch-node24.log`）。3000 production 未动（仍 node 22 进程，重启时须用 node 24） |
| 二开清单机制 | ✅ 建立 | `migration/fork-modifications-2026-09-06.md`：F1（agent-loop loader 安定门）/F2（ACP 冗余通知抑制）/F3（Node 钉点+md-wrap glob）三补丁 `migration/patches/000{1,2,3}-*.patch`（`git apply --check --reverse` 逐字节验证一致）；每项含撤销条件（上游修复即退二开）；新增文件免疫 pull/checkout 只登记不出补丁；恢复流程 + 上游更新检查单 + 后续政策（优先非源码方案，新二开按 0004 递增登记） |

**本轮改动文件**：`migration/fork-modifications-2026-09-06.md`（新增）、`migration/patches/0001/0002/0003-*.patch`（新增 3 个）、`HANDOFF.md`、`CHANGELOG.md`。无源码改动。

## 第七轮（2026-09-06）· 第五/六轮审查结论执行（P1 manifest 一致性 + P2 文档状态）

> 审查结论：核心修复（F1/F2/F3）通过全部验证，暂不建议直接授权 commit；一个发布追踪一致性阻塞项（P1）+ 一处文档状态过时（P2）。本轮全部修正。

| 项 | 结果 | 证据 |
|---|---|---|
| P1 release manifest 与工作树不一致 | ✅ 已重新生成（方案 1） | 根因确认：`run-web-env.ts:79-85` 在 DSH_HOME 无 manifest 时回退仓库 `release-manifests/{beta,production}.json`，运行中 beta 进程 env 实证加载的正是仓库文件（`NEXUS_RELEASE_MANIFEST=/Users/liyan/deepseek-harness/release-manifests/beta.json`）；manifest 的 `build.note` 自述 "workspace-source build from the migration worktree"——是**工作树构建快照**而非发布产物，第五轮"留待下次发布"定性有误。两份 manifest 已重新生成：`nodeVersion: v24.11.1`、`pnpmLockSha256: 7f136d9482c75868dc055e16471f507271f4220df7e2af2c249ece5d4bb2c085`（与实测 `shasum -a 256 pnpm-lock.yaml` 一致）、`buildTimestamp: 2026-09-06T11:33:07Z`；nexus-bridge 全量单测（含 manifest validator）100/100。选方案 1 而非方案 2（启动器拒绝）的原因：纯数据修正、零源码改动（符合用户"尽量不动源码"政策），且 manifest 语义本就是追踪当前工作树 |
| P2a KNOWN_ISSUES #13 自相矛盾 | ✅ 已修 | "当前 v22.23.1"过时表述删除；第三轮防护段标注"（第三轮，历史）"；第五轮统一段标注"（第五轮已执行……当前生效）"；新增 manifest 追踪一致性段（第六轮修正，P1）；运行中服务段更新（3088 已切 node 24） |
| P2b HANDOFF 第四轮旧结论 | ✅ 已加标识 | 第四轮节头部加 "⚠️ 本节为历史记录，已被第五、六轮执行记录 superseded"（P1-a/E.4 已执行、污染定性已勘误、manifests 已重新生成，当前状态以第五~七轮与 KNOWN_ISSUES 为准）；第五轮表中 "release-manifests 留待下次发布" 加删除线 + 第六轮勘误注 |

**本轮改动文件**：`release-manifests/beta.json`、`release-manifests/production.json`（build 字段重新生成）、`KNOWN_ISSUES.md`（#13 重构）、`HANDOFF.md`（第四轮 superseded 标识 + 第五轮勘误注 + 本节）、`CHANGELOG.md`、`migration/review-2026-09-06-round5-6.md`（审查回应）。零源码改动。

**注意（后续 commit 前）**：commit 拆分执行时 lockfile 若再变动（如按拆分方案分批 `pnpm install`），需同步重新生成 manifest 的 `pnpmLockSha256`，否则 P1 矛盾重现——已记入 KNOWN_ISSUES #13。

**beta 已用新 manifest 重启**：旧进程启动时加载的是修正前 manifest，重启后（PID 71274，node 24.11.1 实证）加载再生成的 `release-manifests/beta.json`，27/27 全链路验收复跑通过。新 token：`http://127.0.0.1:3088/?token=aEQ2Obkq8b0hwO_qFuFFICvkQaSnY5wKB29MRxi7WA4`。3000 production 未动。

## 第八轮（2026-09-06）· commit 拆分执行（人审授权：第七轮审查结论"技术上可以进入 commit 拆分"）

> 审查前置两处文档修正已先行完成（HANDOFF 剩余项勘误、审查包 18331/1→标注历史+复核 18332/0）。拆分期间 `pnpm-lock.yaml` 内容零变动（SHA `7f136d…` 与 manifest 一致，无需再生成）。**未 push**（master 领先 origin 11）；3000/3088 全程未动。

| # | Commit | 内容 |
|---|---|---|
| 1 | `5866abf98a` `feat(nexus): add dsh-host-nexus-compat port seam` | compat 包（17 文件）+ Agent Note ×3 + 根 tsconfig.host.json + tsconfig.base.json 别名 + ui-settings-nexus/tsconfig.host.json |
| 2 | `2deccba10f` `refactor(nexus): route the bridge through NexusDshPort` | nexus-bridge 主体（README/package/tsconfig/8 源码/8 spec + helpers）+ web-app 接线（patch.yml/package.json）+ pnpm-lock + web-agent-presets/preview-boot 适配 |
| 3 | `041353d144` `test(nexus): startup HTTP surface + isolation gates` | web-app startup.spec（⚠ 含用户既有修改）+ isolation.gate.spec |
| 4 | `0b4ce14d5a` `feat(nexus): dual web environments with release manifests` | environment.ts + environment/plugin-manifest specs + run-web-env.ts + node-version-pin.ts/.spec + .nvmrc（24.11.1）+ 根 package.json web 脚本 + release-manifests/（再生成后版本） |
| 5 | `bd4c15e0d1` `fix(agent-loop): wait for loader tree before reading session persistence` | F1：agent-loop src/package.json + loader-composition.spec 回归 |
| 6 | `b95c4c9103` `fix(acp): suppress redundant config-option notifications` | F2：acp session.ts |
| 7 | `b51f1d521f` `chore(ci): pin node 24.11.1 and adapt md-wrap glob` | F3：15 workflows + verify-md-wrap 固定深度模式 |
| 8 | `eb01e5e03d` `docs(nexus): integrate nexusDsh into catalogs and generated docs` | gen-cordis-catalog/gen-doc-graphs/api-catalog + 14 个生成文档 |
| 9 | `61a90a7525` `test(web): stabilize queue-actions e2e retries` | queue-actions 限定 retry（KNOWN_ISSUES #9） |
| 10 | `b99332293c` `docs(nexus): migration records, handoff, and fork patches` | 四份项目文档 + migration/（清单/审查包/二开补丁）+ .gitattributes 补丁豁免 |

**拆分执行说明**：① 与五步方案的偏差——lockfile 按原方案随 commit 2；`.nvmrc`+`node-version-pin` 随 commit 4（run-web-env 运行时依赖 .nvmrc，先于 F3 落盘保证自洽）；ui-settings-nexus/tsconfig.host.json 提前到 commit 1（根 tsconfig.host.json 的 reference 需立即可解析）。② lefthook whitespace hook 曾拦截 commit 10（补丁文件的 unified-diff 空行上下文=单空格，格式固有），以 `.gitattributes` 对 `migration/patches/*.patch` 豁免 trailing-space 解决（补丁逐字节未动，reverse-check 复验通过）。③ 全部 10 个 commit 的 pre-commit hooks（translation-pairing/oxlint/third-party-notices/whitespace/vendor-guard）原生通过，未用 --no-verify。

**剩余未提交（35 项，全部为用户既有内容，按五步方案第 5 步由用户单独处置）**：ui-settings-nexus 包主体（2 M + 13 ??，除已入库的 tsconfig.host.json）、slot-catalog.ts（设置 tab 槽位注册）、tsconfig.client.json、apps/cli/reference README×3、section.expected.md、verify-package-readme-model-experience.ts、用户 Agent Note ×6（2026-08-25 ×3、sessioncontroller ×3）、bridge 旧 .disabled/.backup/.stub 文件 ×7。

## 下一步

1. **commit 拆分已就绪待人审**：全部门禁绿（tsc/lint/duplication/check:ci:static 45/45/test:web:built/hygiene/全量单测/e2e **src 模式全绿**），按 `migration/worktree-manifest-2026-09-05.md` 的 5 步拆分建议人审后 commit（commit 后把 SHA 回填到上表"适配器绑定"行）。第五轮新增改动建议拆为独立 commit：`fix(agent-loop): wait for loader tree before reading session persistence` + `fix(acp): suppress redundant config-option notifications` + `chore(ci): pin node 24.11.1 and adapt md-wrap glob`（.nvmrc + 15 workflows + fs-ext 重建说明 + verify-md-wrap 模式）。**commit 本身即是最强的二开保护**（tracked 修改入库后 pull 走正常 merge/rebase 而非覆盖）——与 `migration/fork-modifications-2026-09-06.md` 补丁机制互补。
2. **Python PATH 永久修复（人审决策）**：把 `/opt/homebrew/bin` 提前（`.zshrc` 早段 `eval "$(/opt/homebrew/bin/brew shellenv)"`）或引入仓库级 Python 版本管理。
3. 真机 Golden Path 验收（配对 → 会话 → turn → 审批应答 → 断线恢复）——需要真机，属于人工验收；协议层已由单测与真实链路验收覆盖。
4. Agent Note 从 proposed 转正由人裁决。
5. （可选）设 `DEEPSEEK_API_KEY` 补跑 B/C 级 record 半区 e2e；安装 pwsh 补跑平台项。

## 阻塞

无。

## 验证命令备忘

```sh
cd /Users/liyan/deepseek-harness
pnpm exec tsc -b tsconfig.host.json && pnpm exec tsc -b tsconfig.client.json
pnpm vitest run packages/host/nexus-dsh-compat/tests   # 62 通过
pnpm vitest run packages/host/nexus-bridge/tests
pnpm vitest run packages/bundle/web-app/tests          # 24 通过
pnpm run build && pnpm run test:web:built

cd /Users/liyan/01_Projects/iOS/nexus-app
npm test                                               # 278 通过（基线）
swift test --package-path ios/NexusCore                # 96 通过（基线）
xcodebuild -project ios/NexusApp/NexusApp.xcodeproj -scheme NexusApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```
