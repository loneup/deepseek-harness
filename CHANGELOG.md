# CHANGELOG · 稳定完成事项

## 2026-09-05 · Nexus 兼容层迁移 S0–S4（会话进行中，S5–S9 待完成）

### S0 · Web client 插件静态资源恢复

- 根因排查：裸路径 `/plugins/<id>/client.js` 404 为 modules 包设计行为（仅服务 `??` 组合 URL）；历史全局 404 根因为 Web 进程早于 client 构建启动、缺 `lib/` 的包令 modules 行激活失败。
- 新增 `packages/bundle/web-app/tests/startup.spec.ts` HTTP 面测试 3 个（真实 vendored Loader + webserver + modules + ui-settings-nexus + frontend-static 组合，断言组合 URL 200/JS Content-Type/非空响应体、裸路径 404 契约、首页 boot 图注入）。
- 验证：50/50 advertised 组合 URL 返回 200；`/nexus/health` 200；`pnpm vitest run packages/bundle/web-app/tests` 4 文件 24 测试全过；`tsc -b tsconfig.client.json` 通过。

### S1–S3 · nexus-dsh-compat 兼容包

- 新增 `packages/host/nexus-dsh-compat`（`@deepseek-ai/dsh-host-nexus-compat`）：`NexusDshPort` 稳定接口（10 方法）、Nexus 自有品牌类型与 wire 词汇、六码 `NexusPortError`、`Dsh013Adapter`（dsh 0.1.3-alpha.1 调用、品牌转换、`SessionAddress` 内部构造、follow 首帧 cursor 契约、回执映射）、`mapDshError`（`remoteErrorOf` 结构化识别 + 脱敏）、`mapDshEvent`（自 bridge `mapSessionEvent` 原样迁出）。
- 新增测试 62 个：`port.contract.spec.ts`（含公共面禁用 dsh 类型名的源码文本契约）、`dsh-013-adapter.spec.ts`、`errors.spec.ts`（含跨 realm 标记）、`events.spec.ts`、`subagent.spec.ts`、`plugin.spec.ts`（provider 加载/释放/未知 adapter/缺服务 fail loud）。全部通过。
- 包已注册进 `tsconfig.host.json` solution；`pnpm exec tsc -b tsconfig.host.json` 通过。

### S4 · Cordis provider 组合

- `packages/bundle/web-app/cordis.patch.yml` 在 nexus-bridge 行前挂载 `nexus-dsh-compat`；`web-app/package.json` 声明依赖；`scripts/cordis-config-files.spec.ts` 通过。
- 修复 provider 加载：包入口补 default export 与 Context 增补 re-export；补 `lib/` runtime 构建（tsdown host face）。
- 真实验证：`dsh --profile web --port 3000` 启动日志 0 错误、`/nexus/health` 200、client-modules 与 ui-settings-nexus 组合 URL 200。

### S5–S6 · nexus-bridge 只依赖 NexusDshPort

- `src/command.ts` 构造器改收 `NexusDshPort`，全部方法走 Port；删除 `remoteErrorOf` 手写映射链（统一 `nexusPortErrorOf`）；删除全部 dsh 内部类型 import；requestId/sessionId 以 `nexusRequestId`/`nexusSessionId` 品牌构造。
- `src/index.ts` `inject` 改为 `['webServer','nexusDsh']`；SSE/replay/sequence/审批状态抽到内部 `src/stream.ts`，映射调用兼容层 `mapDshEvent`；保留 `ctx.on('session/event')` 广播、approval waterfall（调用 next()）、pre-execute 闸门、kill switch、admin 路由。
- 删除确认（grep src 0 命中，含常驻源码文本回归测试）：LegacyApiResponse、wrapResult、wrapError、RpcId、apiProxy、remoteErrorOf、response.result.ok、SessionController、SubagentRuntime、SessionAddress、SessionRequestId、SubagentPromptRequestId、RemoteError。
- wire 变化：subagent 失败码 `subagent_error` → `unknown_subagent`/`subagent_unauthorized`；session.open 顺序改为"历史种子先、`session.subscribed` anchor 后"；turn 空文本错误码 `malformed` → `empty_prompt`（依据 iOS 契约 test/bridge.test.js 与参照实现 src/bridge/bridge.js）；其余逐字段透传不变。
- 新增 bridge 测试 29 个：`tests/command-port.spec.ts`（16）、`tests/session-open.spec.ts`（4）、`tests/subagent-command.spec.ts`（9）+ `tests/helpers.ts`（FakePort）。旧的 `*.spec.ts.disabled` 未动（仍 mock 已删除的 apiProxy，重写属后续卡）。
- 验证：`tsc -b packages/host/nexus-bridge/tsconfig.json` exit 0；`pnpm vitest run packages/host/nexus-bridge/tests` 29/29；compat 62/62 无回归。

### S8 · 构建与真实组合验证

- `pnpm exec tsc -b tsconfig.host.json` / `tsconfig.client.json` 均 exit 0（新增 `packages/client/ui-settings-nexus/tsconfig.host.json` host leaf 解决跨面 TS6307）。
- `pnpm run build` exit 0（224 个 client 产物）；重启 Web 进程后真实路由探针全部符合预期（见 HANDOFF）。
- `pnpm run test:web:built` exit 0：93 个测试文件通过 / 1 跳过，317 个测试通过 / 15 跳过 / 0 失败（407.88s）。

### S9 · iOS 协议回归（未修改任何 iOS 代码）

- `npm test`：278/278 通过（与基线一致）。
- `swift test --package-path ios/NexusCore`：96/96 通过（与基线一致）。
- `xcodebuild -project ios/NexusApp/NexusApp.xcodeproj -scheme NexusApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build`：BUILD SUCCEEDED（重构后复跑）。

### 第二轮收尾（同日）

- client-runtime 终审：最终 HTML（24,997 字节）中 `dsh-client-runtime` 引用数 **0**；runtime 角色由 `dsh-cordis-client-runner` + `dsh-client-connection` 承担（boot 图内组合 URL 均 200）；iOS 仓库零引用。残留提及仅为文档与 startup.spec 的负向 404 契约断言。
- 审批正式单测：审批逻辑抽为 `src/approvals.ts`（`NexusApprovals`），新增 `tests/approvals.spec.ts` 8 项（card 发布/claim/delegate/respond settle/重复拒绝/会话不匹配/abort→cancelled/跨断连应答）。
- 三个 `.disabled` 套件重写为正式测试：`tests/admin.spec.ts`（8：CIDR/token 门禁、kill switch 持久化+损坏 fail-closed、设备列表/吊销+token 回调、审计脱敏）、`tests/mapping.spec.ts`（6：信封形状与连续 sequence、审批/工具/终态映射、参数与输出零泄漏、未映射事件零推进）、`tests/nexus-bridge.spec.ts`（5：apply 层全路由注册、双健康路径自检、命令 401、SSE 403、kill switch 默认态）。`tests/isolation.gate.spec.ts`（16）作为常驻自动门禁：bridge src 禁用标识符/依赖隔离、compat 公共面、组合挂载顺序。bridge 套件合计 8 文件 72 项。
- 清除意外产物：`packages/util/brand/src/` 下 4 个误发射编译产物（会遮蔽 .ts 破坏测试平面）。
- 跳过测试分级：15 个跳过项 = B 级 record 半区 ×5 + C 级真实 key 冒烟 ×8 + C 级 pwsh 平台 ×2，无 A 级（核心路径）跳过；补跑条件见 HANDOFF。
- worktree 补丁清单：`migration/worktree-manifest-2026-09-05.md`（66 项按迁移新增/迁移修改/用户既有分类 + 建议 commit 拆分）。
- 真实链路验收 27/27：脚本化 Nexus 客户端对真实 Web 进程实测 pairing→device.register→handshake v4→全量命令与错误路径，SSE sequence 1–14 连续、anchor 居首、真实模型回合事件映射正确。
- 启动自检：`/nexus/health` 与新增 `/health` 别名输出 `{"ok":true,"nexus":{"port":true,"adapter":"dsh-013"}}`（加法性；compat 层新增 `adapterId`）。
- queue-actions.e2e flake 甄别与最小修复：证据矩阵（全车道 2 败 + 隔离 2 过 1 败 + 子集全过）确认其为预存计时敏感 golden flake（瞬态 reasoning "partial" 段落 + composer 状态竞态），与迁移无因果路径，记录为 KNOWN_ISSUES #9；已对该场景单独加 `{ retry: 2, timeout: 120_000 }`，修复后 10/10 隔离运行通过。
- 新包触发的三道仓库门禁修复：typert cordis-catalog（port.ts JSDoc 补描述正文 + 19 个 Nexus* 类型登记 TYPE_LINK_EXEMPTIONS + `nexusDsh` 映射 session.md，刷新 docs/subsystems/session{,.zh}.md 产物）、tsconfig paths（tsconfig.base.json 手写别名，包名与目录名不一致无法自动生成）、README 骨架（补 Table of Contents/Dev Note/开发备注，双语配对记录 README.i18n.yaml）。
- 真实链路验收稳定性：27/27 ×3 runs 连续通过（每次含一次小规模真实模型回合）。
- 文档：HANDOFF 冻结信息与 S0–S10 状态总表；DECISIONS D5（版本锁定与升级策略）、D6（健康自检边界）。

### 周边记录

- iOS 仓库基线（未修改）：`npm test` 278/278；`swift test --package-path ios/NexusCore` 96/96；模拟器构建 BUILD SUCCEEDED。
- 文档：新增 `HANDOFF.md`、`KNOWN_ISSUES.md`、`DECISIONS.md`、Agent Note（proposed）`2026-09-05-nexus-dsh-port-compat-seam`（EN/ZH）。

### 第四轮收尾（同日）

- `test:web:built`（queue-actions 限定 retry 后完整重跑）：**exit code 0，93 文件通过/1 跳过，317 测试通过/15 跳过/0 失败**（431s）。
- 真实正向 approval settle 集成测试 `tests/approvals-live.spec.ts`（2 项）：in-process 走完 pairing → device.register → v4 握手 → SSE → session.open（经 Port 读历史）→ `ctx.waterfall` 派发真实 approval ask → card 发布至 SSE → HTTP `approval.respond` → waterfall promise 解析为 allowed-once / rejected；同 id 重复 ask 可重新 claim。bridge 套件增至 76 项。
- 事件类型隔离纳入自动门禁：`SessionEvent` 仅允许出现在 bridge `index.ts`/`approvals.ts` 与 compat `dsh-013-adapter.ts`；`SessionWireEvent` 全桥面禁入；compat lib/types 公共面声明（构建后自动激活）扫描泄漏。
- Python 244 项失败基线证据：237 项为同一错误 `config.pythonBin "/usr/bin/python3" must be CPython 3.10 or newer, got cpython 3.9.6`（本机 /usr/bin/python3=3.9.6，低于包内 MIN_CPYTHON=3.10 硬性版本探针）；`git diff`/`git status` 证实 python 包零改动；其余为同 bootstrap 的探针超时/缺二进制子用例。

### 双环境治理第一批切片（2026-09-06）

- S1 环境解析器：`packages/host/nexus-bridge/src/environment.ts`（`NEXUS_ENV` 显式权威、端口永不推导环境、beta/production 独立 `DSH_HOME` 派生路径、渠道与环境一致性校验、manifest 校验含禁用 `dsh-client-runtime` 与动态 tag）；`environment.spec.ts` 15/15。
- S2 双启动入口：`pnpm run web:beta` / `web:production`（`scripts/run-web-env.ts`——端口占用 fail-loud、registry seeding、manifest 校验、环境身份启动行）；实测 `web:beta` 启动 3088 成功。
- S3/S8 隔离运行证据：beta(3088) 与 production-candidate(3000) 并行运行互不影响；**beta token 对 3000 → 401 unknown_client**；production 配对码对 beta → `invalid_pairing_code`；beta 独立 `~/.dsh/nexus-beta` 目录树生成。
- S4 release manifests：`release-manifests/{beta,production}.json`（schemaVersion 1、精确版本、dsh/nexus SHA、adapterId、protocolVersion 4、lockfile SHA、node 版本、构建时间）+ `plugin-manifest.spec.ts` 6/6。
- S6 健康自检环境字段：`/health` 与 `/nexus/health` 新增 `environment/port/channel/release` + `nexus.protocolVersion`（加法性；未配置环境时为 null）；bridge apply 对环境身份（名称/渠道/端口冲突）fail-loud；bridge 套件增至 11 文件 99 项。
- 文档：DECISIONS D7（双环境正交维度与规则）、KNOWN_ISSUES #11–13（alpha 非 stable、真机禁 localhost、Node ABI 固定）、HANDOFF 双环境计划表（S0–S12 状态）。

### 双环境治理第二批（2026-09-06）

- **Production 环境正式切换**：旧默认 `~/.dsh` 只读备份至 `~/nexus-backups/dsh-home-backup-20260906.tar.gz`（8.4M，含 pairing/storages/.nexus）→ 3000 经 `pnpm run web:production` 重启 → 健康自检 `{"environment":"production","port":3000,"channel":"stable-candidate","nexus":{...protocolVersion:4}}`；独立 `~/.dsh/nexus-production`（provider 凭证已配置）。
- **双环境并行 + 全链路**：beta(3088) 与 production(3000) 同时运行；`/tmp/nexus-live-acceptance.mjs` 参数化 BASE 后**两环境各 27/27**（含跨环境 token/配对码隔离复测）。
- **已知约束**：dsh 设计拒绝绑 0.0.0.0（RCE 防护，startup.spec:149），真机接入走 Tailscale/HTTPS 反代，无 `--lan` 直绑路径；新初始化 home 的首个会话有 provider 凭证预热窗口（验收脚本内置新建会话重试）；beta 渠道当前加载 alpha 版本插件（workspace 源码阶段），如实记录于 KNOWN_ISSUES #11。
- P2 第一步：bridge 对未设置 `NEXUS_ENV` 的旧式启动打印显式警告（硬失败留待 production cut-over 决策）。

### 双环境治理第三批：iOS S7（2026-09-06）

- `NexusApp` 工程新增 4×4 Build Configuration（Debug/Release × Beta/Production，覆盖 project、NexusApp、NexusAppUITests、NexusAppLiveActivity 四个列表），pbxproj 手术经 plutil/xcodebuild 校验。
- 新增 `Nexus-Beta` / `Nexus-Production` 共享 Scheme（LaunchAction 预设 `NEXUS_BRIDGE_URL`）。
- 产物断言（模拟器构建）：Beta=`com.loneup.nexus.app.beta` / `Nexus Beta` / `http://127.0.0.1:3088/nexus` / env=beta / channel=beta；Production=`com.loneup.nexus.app` / `Nexus` / `http://127.0.0.1:3000/nexus` / env=production / channel=stable-candidate；扩展 Bundle ID 跟随前缀（`.beta.liveactivity`）；扩展 App Group 按环境隔离（`group.com.loneup.nexus.share.beta` / 基础组）。
- Swift 环境化：`AppState.defaultBaseURL` 优先读 Info.plist `NEXUSBridgeURL`；`KeychainHelper.service` 按环境后缀（`dev.nexus.device-keys.beta`）；`Attributes.appGroupID` 按环境选择组。UserDefaults 经 Bundle ID 天然隔离。
- 验证：双 Scheme 构建成功（0 error）；NexusCore swift 测试 96/96；残留项记录 KNOWN_ISSUES #14（深链 scheme 共享、App 目标 entitlements 缺失）。

### 交接待办清零（2026-09-06 第三轮）

- **preview-boot e2e 修复**：根因为前任把豁免模式加进 `bootPreview` 的正向匹配 failure-allowlist 正则（命中即保留、保留即失败，语义反转）；418 行正则回退原始形态（天然豁免，警告保留）+ 防再犯注释；`bootEmptyPreview` 的排除法豁免为正确改动、保留。单文件 1/1；全量 `test:web:built` exit 0（317/332、0 失败）。
- **Node 版本钉住**：新增 `.nvmrc`（22.23.1）+ `scripts/node-version-pin.ts`（纯函数校验：运行中 node 必须与 `.nvmrc` 完全一致，否则 fail-loud 并提示 `nvm use`）+ `node-version-pin.spec.ts`（6 项）+ `run-web-env.ts` 接线（argv 校验后、任何环境工作前）；实测 homebrew node 26.3.0 被拦截。fs-ext 在 22.23.1 下正常，无需重装原生依赖。lint 0 错误。
- **CPython 甄别（根因修正）**：3.14.7 已装（homebrew python@3.14）；244 项失败真因是 PATH 顺序（/usr/bin/python3=3.9.6 排在 /opt/homebrew/bin 之前）。外科 PATH（仅前置 python3 符号链接）复跑：code-runtime-python 283/285 通过；全量 `pnpm run test` **18328 通过 / 1 失败（spill 已知 flake，隔离 41/41 过）/ 118 跳过**（基线 18050/245 失败）。
- **`test:e2e` 甄别**：127 通过 / 10 失败 / 73 跳过；10 个失败全部为预存 ENOENT `.sessions` 模式（会话存储已迁 `$DSH_HOME/storages/session_projcache/sessions/*.json`，6 个测试文件断言仍读 `cwd/.sessions/*.jsonl`；文件全部未被迁移触碰），定性为上游存储路径变更后的断言过期，记录 KNOWN_ISSUES #10b，修复走单独构建卡。（**第四轮勘误**：此定性有误，见下节。）
- **`pnpm run hygiene`**：16/16 PASS（exit 0）。
- 教训沉淀（KNOWN_ISSUES #10 注）：PATH 前缀 `/opt/homebrew/bin` 整目录会把 node 一并换成 26.3.0 触发 fs-ext ABI 失败——前置目录必须只含目标二进制。

### 审查结论执行 + e2e 失败根因实证修正（2026-09-06 第四轮）

- **`.sessions` 失败根因实证修正（推翻第三轮定性）**：第三轮"上游持久化路径已迁 projcache、断言过期"的结论错误。实证（子进程 monkey-patch 探针 + 双模式对照矩阵）：fixture 自己把 JSONL root 钉到 `./.sessions`（断言与配置一致）；真实缺陷是上游 agent-loop 配置式 agents 在插件构造器内用 strict `ctx.get('sessionPersistence')` 接合持久化，Loader 并发挂载（`Promise.allSettled`）下 src/tsx 模式导入时序使构造器拿到 `undefined`，会话静默不落盘；lib 模式（CI 的 `DSH_EXAMPLE_MODE=lib`）时序相反——同一批 6 文件 **src 模式 9/10 失败、lib 模式 10/10 全过**，CI 全绿故上游未察觉。修复方向为上游接合方式改声明式/延迟式（需人审），测试断言不应动；E.4 原构建卡前提不成立，暂缓。KNOWN_ISSUES #10b 已按实证重写。
- **P2 文档修正**：HANDOFF 两处 `#15`→`#10b`；头部更新时间与未提交文件数（65→90）；审查包 B.4 勘误 + D 节复跑命令显式 `DSH_HOME=$(mktemp -d)`（防会话继承变量污染 production home——第三轮 e2e 复跑曾把测试会话写入 `~/.dsh/nexus-production/storages/session_projcache/`，属实际污染，已向用户报告）。
- **P1-a/E.3 Node 统一未执行**：审查建议统一到 24 系列（本机有 24.11.1）并同步 8 个 workflow + 2 个 release manifest + 重建原生依赖 + 复跑全门禁；涉及发布配置与大范围改动，按 AGENTS.md 需人审确认，本轮仅完成钉点全貌调查（PRIMARY_NODE_VERSION='24' ×8 文件、裸 node-version: 24 ×5、ci.yml matrix 24.9/26、manifests v22.23.1 ×2、ci-workflow.spec.ts 断言 job 结构不锁字面版本）。
- 探针临时文件（`packages/goal/goal/tests/fixtures/domain/probe-*`、`/tmp/e4-probe*.mts`）全部清理，git status 恢复无探针残留。

### 人审三项授权执行：上游竞态修复 + Node 统一 24.11.1（2026-09-06 第五轮）

- **上游 agent-loop 加载时序竞态修复（人审授权，E.4 处置）**：`packages/core/agent-loop/src/index.ts` 配置式 agent 启动抽为 `startConfiguredAgent()`——sessionPersistence 不可见且存在 Loader 时 `await loader.await()`（boot 自用的树安定原语，等全部 entry fiber 落定）后重读一次；安定树仍无服务保持既有无后端 create 契约（config-session-id.spec 17 项契约全过）。修复覆盖两个接缝：exact-id 分支与 `create()`→`createStoredSession()` 命令式读（fixture 实际形态，agents 无 sessionId）。无 Loader 的顺序组合世界（产品 headless、既有单测）首读即终值，行为不变。
- **ACP 冗余通知修复（同族第三接缝）**：`packages/acp/acp/src/session.ts` src 模式下 `llm/adapters-updated` 晚到，对 session/new 已返回的相同选项重复发 `config_option_update` 通知（goal.expected.e2e 2 项失败根因；修复前 diff 实证为逐字节相同的冗余行）。选项读取（configOptions/setConfig）与拓扑通知串行化 + 序列化无变化抑制；真实拓扑变化（新 provider、provider 消失）通知语义不变，bridge.spec 既有 4 项拓扑测试全过。
- **新增确定性回归**：`packages/core/agent-loop/tests/loader-composition.spec.ts` 3 项——真实 Loader + Include 并发挂载、persistence 导入人为延迟 50ms（确定性复现输掉的挂载顺序）：① 慢导入下 exact-id 恢复且落盘；② 慢导入下 fresh agent 物化（list()=1）；③ 无 persistence 条目的安定树保持无后端契约。反向验证：对未修复代码 ①② 失败、修复后全过（非空转测试）。devDeps 增 cordis-plugin-loader/include（先例：webhook、session-telemetry-otel）。
- **修复战果（零测试断言改动）**：src 模式 6 文件 e2e 9 失败→**10/10 全过**；expected 车道 src 模式 2 失败→**28/28 全过**；**全量 e2e 车道 src 模式 28 失败→36 文件 137 测试全过 0 失败**；lib 模式 10/10、agent-loop 单测 375/375、ACP 单测 139/139 无回归。E.4 原构建卡（断言迁 projcache 重写）前提不成立，作废。
- **Node 统一 24.11.1（人审授权，P1-a/E.3）**：`.nvmrc`→24.11.1；8 workflow `PRIMARY_NODE_VERSION`→'24.11.1'；10 处裸 `node-version: 24`→24.11.1（含 sandbox/landlock 系，第四轮调查漏计）；ci.yml node-compat matrix（24.9/26）为故意多版本兼容车道，保留；fs-ext 在 node 24 下 `npm rebuild`（ABI 127→137），消费方 session-persistence-jsonl 单测 304/304；~~release-manifests 的 v22.23.1 描述已构建发布产物，留待下次发布自然更新~~（第七轮勘误并重新生成，见下）；`run-web-env.ts` 从 `.nvmrc` 读 pin 自动跟随；node 24 下 tsc 干净、oxlint 0 警告、全量单测复跑。
- **Node 24 glob 回归适配**：node 24 的 `fs.glob` 对 `**`+字面结尾段+符号链接组合抛 ENOTDIR（node 22 静默跳过；合成最小复现 `/tmp/globtest` 确认，通配符结尾不受影响），`verify-md-wrap` 的 `snapshots/**/system-prompt.expected.md` 命中（snapshots/acp 下两个符号链接）。修复：两个字面模式改为固定深度（`snapshots/*/*/…`、`packages/*/*/*/*/*/*/…`），双 node 实测匹配集逐字节一致（2292 文件），`check:ci:static` 45/45 恢复。
- **production home "污染"定性勘误**：逐一解析 `~/.dsh/nexus-production/storages/session_projcache/sessions/` 全部 62 个会话 JSON，cwd 全为真实项目（ntr115/MMX/mowen/komari/panstar-help/nexus-app/deepseek-harness），**0 个临时目录 cwd**——第三轮"e2e 测试写入 production home"定性有误，实为真实会话数据被缺乏 DSH_HOME 隔离的测试读到（可见性干扰）。按"绝不删真实用户数据"红线未删任何文件；测试侧隔离已由显式 `DSH_HOME` 复跑命令解决。第四轮 CHANGELOG/审查包中"实际污染"表述据此勘误。

### beta 切 node 24.11.1 + 二开清单机制（2026-09-06 第六轮）

- **3088 重启到 node 24.11.1**（用户授权）：干净环境启动（`env -u DSH_HOME -u NEXUS_ENV -u NEXUS_WEB_PORT -u NEXUS_PLUGIN_CHANNEL pnpm run web:beta`——首次尝试被会话继承的 `NEXUS_WEB_PORT=3000` 拦截，再次印证 P1-b 环境隔离的必要性）；进程二进制经 lsof 确认为 v24.11.1；health ok；27/27 全链路验收通过。3000 production 未动。
- **二开清单机制建立**（用户政策：尽量不动源码；必要二开须区分原版、防 pull 覆盖）：`migration/fork-modifications-2026-09-06.md` 登记 F1/F2/F3 三项二开（agent-loop loader 安定门 / ACP 冗余通知抑制 / Node 钉点+md-wrap glob 适配），每项含撤销条件（上游修复即退二开，F1/F2 建议以 PR 贡献回上游）；补丁集 `migration/patches/000{1,2,3}-*.patch` 经 `git apply --check --reverse` 验证与工作树逐字节一致；untracked 新增文件（回归测试、.nvmrc、补丁自身）对 pull/checkout 免疫只登记；含恢复流程与上游更新检查单。后续政策：优先非源码方案，新二开按 0004 递增登记。
- 本轮零源码改动。

### 审查结论 P1/P2 修正（2026-09-06 第七轮）

- **P1 release manifest 追踪一致性（阻塞项，已修）**：第五/六轮审查指出 `release-manifests/{beta,production}.json` 仍声明 `nodeVersion: v22.23.1` + 旧 lockSHA，而运行中 beta（node 24.11.1 + 当前工作树）经 `run-web-env.ts` 回退逻辑加载的正是该文件（进程 env 实证）——运行时宣传旧构建元数据。定性勘误：manifest 的 `build.note` 自述 "workspace-source build from the migration worktree"，是**工作树构建快照**而非已发布产物，第五轮"留待下次发布自然更新"的解释不成立。已按方案 1 重新生成两份 manifest：`v24.11.1` / `7f136d9482c75868dc055e16471f507271f4220df7e2af2c249ece5d4bb2c085`（实测一致）/ `2026-09-06T11:33:07Z`；nexus-bridge 单测（含 validator）100/100。未选方案 2（启动器拒绝旧 manifest）：纯数据修正零源码改动，符合"尽量不动源码"政策。
- **P2 文档状态修正**：KNOWN_ISSUES #13 删除"当前 v22.23.1"过时表述（第三轮段标"历史"、第五轮段标"当前生效"）；HANDOFF 第四轮节加 "⚠️ 已被第五、六轮 superseded" 标识（P1-a/E.4 已执行、污染定性已勘误）；第五轮表 "release-manifests 留待下次发布" 加删除线勘误注。
- **审查验证结果全部确认**（审查者复跑：定向单测 56/56、6 e2e 10/10、expected 2/2、全量 e2e 137/0 失败、双 node md-wrap 2292、ci:static 45/45、全量单测 18332/0 失败、hygiene 16/16、ci-workflow+manifest 28/28、三补丁 reverse-check、beta 27/27）——与自报矩阵一致，无虚报。
- 本轮零源码改动；commit 拆分授权的阻塞项已清除（剩：commit 时 lockfile 若变需同步再生成 manifest）。
- **beta 已用新 manifest 重启**：旧进程启动时加载的是修正前 manifest；重启后加载再生成的 beta.json（node 24.11.1 进程实证），27/27 全链路验收复跑通过。3000 production 未动。

### commit 拆分落地（2026-09-06 第八轮，人审授权）

- **12 个 commit 入库**（10 个迁移 commit + 1 个拆分记录 commit + 1 个复核修正 commit；拆分时点领先 origin 12，复核修正后为 13 = 基线 1 + 本会话 12，**未 push**）：① `5866abf98a` compat port seam；② `2deccba10f` bridge 经 NexusDshPort（含 lockfile）；③ `dea5dcf2b4` startup HTTP 面 + 隔离门禁；④ `eeabff9e88` 双环境启动器 + release manifest + node-version-pin + .nvmrc；⑤ `647d1ad3a9` agent-loop loader 安定门（F1）；⑥ `44f9717a7a` ACP 冗余通知抑制（F2）；⑦ `7795178dc8` Node 24.11.1 钉点 + md-wrap glob 适配（F3）；⑧ `2cfb7c9efb` nexusDsh 目录/生成文档集成；⑨ `c35e82c5a0` queue-actions e2e 稳定性；⑩ `4b5963abf0` 项目文档 + 迁移记录 + 二开补丁；⑪ `059441b760` 拆分记录文档；⑫ 复核修正（P1 hunk 拆回 + 文档状态同步，SHA 以 `git log -1` 实查为准）。
- **第八轮复核 P1 修正**：commit 3 曾混入两处提交前已有的用户修改（startup.spec 3080→3000，stash 实证未经单独授权），已外科 rebase 拆回工作树（commit 3-11 SHA 相应改写为上表现值）；3080/3000 双版本 startup.spec 各 8/8 通过。
- **拆分期间 lockfile 零变动**：SHA `7f136d…` 与 manifest 保持一致（审查警示条件未触发，无需再生成）。
- **lefthook whitespace 拦截与解决**：补丁文件的 unified-diff 空行上下文（单空格）触发 `git diff --cached --check`；以 `.gitattributes` 对 `migration/patches/*.patch` 豁免 trailing-space（补丁逐字节未动，reverse-check 复验通过）。全部 hooks 原生通过，未用 --no-verify。
- **剩余 36 项未提交全部为用户既有内容**（ui-settings-nexus 包主体、slot-catalog、tsconfig.client.json、cli reference README、用户 Agent Note ×6、bridge 旧 .disabled/.backup/.stub ×7、拆回的 startup.spec 两处 hunk），按五步方案第 5 步由用户单独处置。
- 二开保护升级：commit 为第一层，补丁降级为第二层保险（fork-modifications 清单已更新）。
