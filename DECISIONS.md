# DECISIONS · 长期技术取舍

## D1 · Nexus Bridge 经 NexusDshPort 单接缝消费 dsh（2026-09-05）

**决策**：新建 `packages/host/nexus-dsh-compat`（`@deepseek-ai/dsh-host-nexus-compat`）。bridge 只依赖 `NexusDshPort` 接口与 Nexus 自有类型（`NexusSessionId`/`NexusRequestId` 品牌、JSON 等价 wire 类型、六码 `NexusPortError`）；dsh 专属调用、品牌 ID 转换、`SessionAddress` 构造、错误识别（`remoteErrorOf` 结构化识别，非 instanceof）、事件映射集中在 `Dsh013Adapter`。

**原因**：dsh 公共 API 处于 pre-stable，逐版本变化不可避免；把变化吸收在单实现适配器里，bridge、Web 设置页与 iOS 客户端不再随 dsh 演进。未来版本以 `adapter: dsh-014` 等配置选择新适配器，未知名称加载阶段响亮失败（不做方法存在性探测的隐式兼容）。

**代价与边界**：一层间接与类型重复（Nexus 类型与 dsh 类型在适配器内手工对齐）；实时事件刻意留在 Cordis 总线（`ctx.on('session/event')`），Port 不提供订阅，避免与 Web 广播双投递。

**证据**：`.agents/notes/proposed/architecture/2026-09-05-nexus-dsh-port-compat-seam.md`；`packages/host/nexus-dsh-compat/tests` 62 测试；`tsconfig.host.json` 通过。

## D2 · 错误词汇收敛为六个稳定码（2026-09-05）

**决策**：兼容层只向 bridge 暴露 `unknown_session`、`unknown_subagent`、`subagent_unauthorized`、`malformed`、`host_cancelled`、`host_error`；`host_error` 替换原始 message（不透传 dsh 内部诊断、堆栈、路径），其他码保留 dsh 已在线上使用的人类可读 message。

**原因**：bridge 不再逐方法映射错误码；脱敏责任落在适配器单点。subagent 失败的旧 wire 码 `subagent_error` 被淘汰——iOS 对未枚举码按 message 透传，行为不劣于现状。

## D3 · 历史读取统一走 follow 首帧快照 + 条件 page（2026-09-05）

**决策**：`readHistory` 在适配器内先取 `sessionController.follow` 的 opening snapshot（cursor + 最新 message 对齐 records），仅在请求带 `beforeSeq` 时再对 snapshot cursor 做 `page`。Port 返回 `{records, hasMore, cursor}`。

**原因**：`page` 的字面量 `throughSeq: -1` 切出空日志（见 [[2026-09-05-nexus-bridge-sessioncontroller-migration]]），cursor 只能来自 follow 首帧。该机制从 bridge 的 `openingSnapshot`/`openingRecords` 原样下沉，`session.open` 与 `subagent.history` 的 wire 行为不变。

## D4 · Web 插件 404 的验收标准按真实 roster 修订（2026-09-05）

**决策**：S0 验收以首页 `__DSH_BOOT__` 图的全部 advertised 组合 URL（50/50 = 200）与 `/nexus/health` 200 为准；`/plugins/<id>/client.js` 裸路径 404 属服务端设计行为；`dsh-client-runtime` 不存在、不创建（见 KNOWN_ISSUES 第 1、2 条）。

**原因**：modules 行只服务 `comboUrl()` 形态资源；为幻影 URL 创建假包只会制造死代码。

## D5 · 版本锁定与升级策略（2026-09-05）

**决策**：版本绑定记录为三元组 —— `dsh 0.1.3-alpha.1`（验证 commit `c02ff34` + 本次迁移工作树）→ `Dsh013Adapter` → `Nexus Port v1`。未来 dsh 0.1.4-alpha.1 升级路径：复制适配器为 `Dsh014Adapter`，对**同一批契约测试**跑 `Dsh014Adapter → NexusDshPort contract`，provider 的 `adapter` 配置选择实现，未知名称加载阶段响亮失败。

**只改适配器即可吸收的变化**：方法重命名、参数字段、signal 参数、品牌 ID、records/events 字段、RemoteError 码、SessionAddress、Subagent API 重组、事件内部字段。
**不能保证只改适配器的变化**：dsh 删除实时事件/历史读取/Subagent 能力、Session 持久化格式变化、事件根本语义变化、Nexus v4 协议变化、sequence 语义变化、iOS 依赖字段变化（此时扩大迁移范围并走新构建卡）。

## D6 · 健康自检为加法性诊断（2026-09-05）

**决策**：`/nexus/health`（新增 `/health` 别名，对齐 iOS 侧 K-010 别名契约）在 `{ok:true}` 基础上加法性输出 `nexus:{port,adapter}`；不暴露设备、workspace 或凭证数据。client 插件资源存在性检查保留在 `startup.spec`（构建时）与首页 boot 图（运行时），不进入 bridge 健康路由。

**原因**：health 无认证，字段必须最小；`port:true` 由 inject 保证、`adapter` 来源于兼容层 `adapterId`，provider 缺失时 bridge 整体不加载（fail loud），因此自检足以定位"静默丢失 provider"的组合错误。

## D7 · 双环境治理：环境维度与发布成熟度维度正交（2026-09-06）

**决策**：建立两个正交维度——
- **环境维度**：`beta`（端口 3088）/ `production`（端口 3000 或生产域名）。
- **发布成熟度维度**：`alpha` / `beta` / `rc` / `stable`。

环境由显式名称（`NEXUS_ENV`）定义，**端口永不推导环境**；每个环境拥有独立的 `DSH_HOME`（`~/.dsh/nexus-beta` / `~/.dsh/nexus-production`），设备注册表、Ed25519 密钥、Session 数据、审计日志、kill-switch、Auth token 全部隔离。插件渠道：beta 环境只服务 `beta`；production 环境 `stable-candidate`（首个正式版发布后切 `stable`）。

**规则**：
1. 插件包名不复制（无 `-beta` 后缀包）；用 SemVer 预发布版本 + 精确版本 manifest（`release-manifests/{beta,production}.json`）锁定，禁用 `latest`/`beta` 等动态 tag。
2. 启动入口 `pnpm run web:beta` / `web:production`（`scripts/run-web-env.ts`）：解析环境、fail-loud 校验端口冲突（beta 禁 3000、production 禁 3088）、seed 注册表、校验 manifest 后再 spawn。
3. Production 候选阶段（当前）不改现有 3000 运行态的 `DSH_HOME`；迁移现有 `~/.dsh` 数据到 `~/.dsh/nexus-production` 是独立决策点。
4. 真正的 Production 必须运行不可变构建产物，不得从未冻结的 dirty worktree 启动（源码启动仅限本地 Beta 开发）。
5. 上游升级优先新增 `DshXXXAdapter`（Beta 先行），`NexusDshPort` 契约测试不变。
6. iOS 侧用独立 Scheme/Bundle ID/Keychain/UserDefaults 隔离双环境（已实施，S7）。
7. **运行态约束（2026-09-06 固化）**：3000 = Production 保持运行，任何后续操作不得停止/重启/改配置/占用该端口，只允许只读检查；3088 = Beta 是唯一可自由启停验证的环境。开发与测试一律使用 `web:beta`；iOS 双环境工作只针对 Nexus-Beta / 3088 / beta manifest / `~/.dsh/nexus-beta`。

## D8 · 不向上游开 PR：fork 内维护二开（2026-09-07）

**决策**：Nexus 迁移与二开修复（F1 agent-loop loader 安定门 / F2 ACP 冗余通知抑制 / F3 Node 24.11.1 钉点 + md-wrap glob 适配）在 fork `loneup/deepseek-harness` 的 `master` 上维护，**不向 `deepseek-ai/deepseek-harness` 开 PR**（用户 2026-09-07 拍板）。

**原因**：
1. 无上游写权限：本地两个身份（git HTTPS 凭证 loneup / gh CLI incvi）对上游均为 403 / `push:false`；且 OAuth token 缺 `workflow` scope，含 workflow 文件的推送走 HTTPS 会被拒，推送只能走 SSH（fork 属主）。
2. F1/F2/F3 已在 fork 内通过完整门禁（全量单测 / e2e / web:built / ci:static / 真机前链路验收）并带确定性回归测试，fork 内可自持。
3. 开 PR 意味着维护节奏受上游评审支配；当前阶段（迁移收尾）优先稳定自持。

**规则**：
1. 上游同步用 `git pull origin master`（merge/rebase），冲突时按 `migration/fork-modifications-2026-09-06.md` 的撤销条件逐项检查上游是否已含等效修复——已含则退二开（`git apply --reverse` 或手动移除）。
2. 二开补丁集（`migration/patches/`）作为第二层保险保留：commit 为第一层（已入库），工作树被硬还原时补丁恢复。
3. 若未来改变决策开 PR：从 fork master 直接开，F1/F2 附回归测试（`loader-composition.spec.ts` 已就绪）。
