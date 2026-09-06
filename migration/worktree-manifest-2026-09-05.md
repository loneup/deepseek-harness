# Worktree 补丁清单 · Nexus 兼容层迁移（2026-09-05）

基线 commit：`c02ff3445150ebece9da48ffde717ce600df4f0e`（分支 master，领先 origin 1 提交）。
本清单对应工作树全部 66 项 git status 条目，供人审 commit 时拆分参考。

## A · 本次迁移新增（无基线对应物）

| 路径 | 说明 |
|---|---|
| `packages/host/nexus-dsh-compat/`（整包） | 兼容层：NexusDshPort、类型、NexusPortError、Dsh013Adapter、plugin provider、62 项测试、双语 README |
| `packages/host/nexus-bridge/src/stream.ts` | SSE 流注册表（自 index.ts 原样抽出） |
| `packages/host/nexus-bridge/src/approvals.ts` | 审批 claim/settle（自 index.ts 原样抽出） |
| `packages/host/nexus-bridge/tests/`（8 个 spec + helpers） | command-port 16、admin 8、approvals 8、mapping 6、nexus-bridge 5、subagent-command 9、session-open 4、isolation.gate 16 = 72 项 |
| `packages/client/ui-settings-nexus/tsconfig.host.json` | host leaf 配置（解决跨面 TS6307） |
| `HANDOFF.md` / `KNOWN_ISSUES.md` / `DECISIONS.md` / `CHANGELOG.md` | 项目文档（此前不存在） |
| `.agents/notes/proposed/architecture/2026-09-05-nexus-dsh-port-compat-seam.md` + `.zh.md` | Agent Note（proposed） |
| 本文件 | worktree 清单 |

## B · 本次迁移修改（其中 ⚠ 文件在迁移前已含用户未提交修改，commit 时注意合并）

| 路径 | 本迁移改动 |
|---|---|
| ⚠ `packages/bundle/web-app/cordis.patch.yml` | 在 nexus-bridge 行前插入 `nexus-dsh-compat` provider 行（用户既有修改保留） |
| ⚠ `packages/bundle/web-app/package.json` | dependencies 增加 `@deepseek-ai/dsh-host-nexus-compat` |
| ⚠ `packages/bundle/web-app/tests/startup.spec.ts` | Agent A 新增 3 个 HTTP 面 startup 测试（用户既有修改保留） |
| ⚠ `packages/host/nexus-bridge/src/index.ts` | inject 改 `['webServer','nexusDsh']`、SSE/审批抽出、健康自检 + `/health` 别名（基线即为 M：用户从禁用态恢复） |
| `packages/host/nexus-bridge/MIGRATION_TODO.md` | Agent D 更新迁移状态 |
| ⚠ `tsconfig.host.json` | solution 增加 `nexus-dsh-compat` 与 `ui-settings-nexus/tsconfig.host.json` 两个 reference（用户既有修改保留） |
| `pnpm-lock.yaml` | pnpm install 产物（新包 workspace 链接） |
| ⚠ `tsconfig.base.json` / `tsconfig.client.json` | 未由本迁移直接修改（用户既有修改），但迁移验证依赖其当前状态 |

注：`packages/host/nexus-bridge/src/command.ts` 的 Port 化改动落在**未跟踪**文件上（见 C 组），git 不显示 M。

## C · 用户既有未提交内容（本迁移未触碰或仅部分重叠）

- `apps/cli/reference/README*`（3 个）、`apps/web/tests/expected/plugin-config/section.expected.md`、`scripts/verify-package-readme-model-experience.ts` — 与本迁移无关。
- `packages/client/ui-settings-nexus/*`（除 `tsconfig.host.json` 外全部）— 用户此前恢复的设置 tab 实现；本迁移仅由 Agent A 排查确认其 lib 产物与 404 根因相关，源码未改。
- `packages/host/nexus-bridge/` 未跟踪主体（`package.json`、`src/{admin,command,handshake,protocol,invariant}.ts`、README×3）— 用户此前会话的 Bridge 实现与 apiProxy→SessionController 迁移产物；Agent D 在其上做了 Port 化重构（command.ts/package.json/tsconfig.json），旧文件 `command.ts.disabled`、`command.ts.backup`、`index.ts.disabled`、`index.ts.stub` 原样保留。
- `.agents/notes/proposed/architecture/2026-08-25-*` 与 `2026-09-05-nexus-bridge-sessioncontroller-migration.*` — 用户此前会话的 Agent Note。

## D · 建议的 commit 拆分

1. `feat(nexus): add dsh-host-nexus-compat port seam` — A 组 compat 包 + Agent Note + tsconfig.host.json 的 compat reference。
2. `refactor(nexus): route the bridge through NexusDshPort` — nexus-bridge 全部（含未跟踪主体）+ patch yml + web-app deps + lockfile + ui-settings-nexus tsconfig.host.json。
3. `test(nexus): startup HTTP surface + isolation gates` — startup.spec + gate spec（若希望独立）。
4. `docs(nexus): HANDOFF/KNOWN_ISSUES/DECISIONS/CHANGELOG + worktree manifest`。
5. 用户既有内容（C 组中与本迁移无关的部分）由用户单独处置。

## 第二轮/第三轮收尾追加（2026-09-05 晚）

| 路径 | 类别 | 说明 |
|---|---|---|
| `packages/host/nexus-bridge/tests/{approvals,nexus-bridge,admin,mapping,isolation.gate}.spec.ts`、`tests/helpers.ts` | 迁移新增 | 正式测试归档 + 自动门禁（.disabled/.backup 原样保留） |
| `packages/host/nexus-bridge/src/{stream,approvals}.ts` | 迁移新增 | 自 index.ts 原样抽出（SSE 流注册表 / 审批 claim-settle） |
| `packages/host/nexus-bridge/src/command.ts` | 迁移重构 | Port 化（未跟踪文件，git 不显示 M） |
| `apps/web/tests/queue-actions.e2e.ts` | 迁移修改（测试稳定性） | 失败场景单独加 `{retry:2, timeout:120_000}`；KNOWN_ISSUES #9 |
| `scripts/gen-cordis-catalog.ts` | 迁移修改 | TYPE_LINK_EXEMPTIONS +19（Nexus* 端口类型）、SERVICE_PAGE +`nexusDsh: 'session.md'` |
| `tsconfig.base.json` | ⚠ 迁移修改（叠加用户既有修改） | 手写别名 `@deepseek-ai/dsh-host-nexus-compat` |
| `docs/subsystems/session{,.zh}.md` + `session.i18n.yaml` | 迁移修改（生成器产物） | `pnpm run gen-cordis-catalog` 刷新，纳入 ctx.nexusDsh 目录条目 |
| `packages/host/nexus-dsh-compat/README{,.zh}.md` + `README.i18n.yaml` | 迁移新增/修改 | 补 README 骨架（doc-standard 门禁）+ 双语配对记录 |

## 已清除的意外产物

`packages/util/brand/src/{index.js,index.js.map,index.d.ts,index.d.ts.map}` — 2026-09-05 19:22 一次独立 `tsc -b` 误发射到 src 的编译产物（会让 Vite 解析到旧 .js、破坏测试平面，见仓库既有事故记录），已删除；删除后 14 个测试文件 134 项全过。

## 双环境治理追加（2026-09-06）

| 路径 | 类别 | 说明 |
|---|---|---|
| `packages/host/nexus-bridge/src/environment.ts` | 迁移新增 | 环境解析器（S1） |
| `packages/host/nexus-bridge/tests/{environment,plugin-manifest}.spec.ts` | 迁移新增 | 15 + 6 项 |
| `scripts/run-web-env.ts` + 根 `package.json` web:beta/web:production | 迁移新增 | 双启动入口（S2） |
| `release-manifests/{beta,production}.json` | 迁移新增 | 发布 manifest（S4） |
| `packages/bundle/web-app/cordis.patch.yml` | ⚠ 迁移修改（叠加） | nexus-bridge 行新增 environment/channel/release 环境字段 |
