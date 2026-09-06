# 审查包 · 第五、六轮工作总结（2026-09-06）

> **审查后记（第七轮）**：审查结论的两项修正已全部执行——
> - **P1（阻塞项，已修，方案 1）**：定性勘误——manifest 的 `build.note` 自述 "workspace-source build from the migration worktree"，是**工作树构建快照**而非已发布产物，本文 B.3 节"留待下次发布自然更新"的解释不成立（审查者正确）。两份 manifest 已重新生成：`nodeVersion: v24.11.1`、`pnpmLockSha256: 7f136d9482c75868dc055e16471f507271f4220df7e2af2c249ece5d4bb2c085`（实测一致）、`buildTimestamp: 2026-09-06T11:33:07Z`；nexus-bridge 单测（含 validator）100/100。运行中 beta 加载仓库 manifest 一事经进程 env 实证（`NEXUS_RELEASE_MANIFEST=…/release-manifests/beta.json`）。**commit 拆分时 lockfile 若再变动须同步再生成**（已记 KNOWN_ISSUES #13）。
> - **P2（已修）**：KNOWN_ISSUES #13 的"当前 v22.23.1"矛盾表述已删（历史段/当前段明确分标）；HANDOFF 第四轮节已加 "⚠️ 已被第五、六轮 superseded" 标识。
> - 审查者验证结果与本包自报矩阵逐项一致，确认无虚报。commit 授权阻塞项已清除。

> **审查对象**：Nexus/dsh 双仓库迁移会话的第五、六轮执行（第四轮报告之后）。
> **审查方法**：按 F 节命令逐项复跑；对源码修复按 B 节机制链核对代码；对定性勘误按各自证据链核对原始数据。
> **前置阅读**：`migration/review-2026-09-06.md`（第一至四轮审查包，本文件是其续篇）。

## A · 背景与授权链

第四轮报告给出三项待决事项，用户于同日逐项拍板：

| 决策项 | 用户选择 | 执行轮次 |
|---|---|---|
| E.4 处置（`.sessions` e2e 失败） | **修复上游 agent-loop**（而非按原卡重写断言、也非仅记录） | 第五轮 |
| E.3/P1-a Node 统一 | **统一到 24.11.1**（审查推荐方案） | 第五轮 |
| production home "污染" | **授权清理（先列清单）** | 第五轮（核查后定性反转，未删任何文件，见 B.1） |
| （追加）3088 重启 | 用 node 24.11.1 重启 | 第六轮 |
| （追加）二开政策 | 尽量不动源码；必要二开须区分原版/二开、防上游拉取覆盖 | 第六轮建立机制 |

**红线全程未破**：3000 只读（每步 curl /health）、未 commit/push、未删测试/未弱化断言（全部修复零断言改动）、未删任何真实用户数据。

## B · 执行内容与机制链

### B.1 production home 污染核查 → 定性勘误（未删任何文件）

**第三轮原定性**：e2e 复跑继承 `DSH_HOME=~/.dsh/nexus-production`，把测试会话"写入"了 production home。

**第五轮核查方法**：逐一解析 `~/.dsh/nexus-production/storages/session_projcache/sessions/` 全部 62 个 JSON 的 `record.identity.cwd`。

**结果**：cwd 全为真实项目（ntr115 / MMX / mowen-app / komari-app / panstar-help / nexus-app / deepseek-harness），**0 个临时目录 cwd**。e2e 测试会话的 cwd 必为 `/var/folders/.../T/...`（vitest 临时目录）——不存在。

**修正后定性**：真实会话数据被缺乏 `DSH_HOME` 隔离的测试**读到**（可见性干扰，可解释 web-agent-presets 的环境残留失败），而非测试**写入**。按"绝不删真实用户数据"红线未删任何文件（其中含用户并行会话当时仍在活跃写入的 ntr115 会话）。测试侧隔离已由 P1-b 显式 `DSH_HOME` 复跑命令解决。

**审查要点**：此勘误推翻了第四轮 CHANGELOG/审查包中"实际污染"表述，相关文档已同步勘误（见 E 节各文件）。

### B.2 agent-loop 加载时序竞态修复（三接缝，零断言改动）

**根因**（第四轮实证，本轮修复）：配置式 agents 的持久化接合是插件构造器内一次性 strict `ctx.get('sessionPersistence')`。Loader 用 `Promise.allSettled` 并发挂载整棵插件树，src/tsx 模式下 persistence-jsonl 全新导入图慢于 agent-loop 缓存命中 → 构造器拿 `undefined` → 会话静默不落盘。lib 模式（CI）时序相反，故 CI 全绿、本地红。

**修复中发现接缝比预想多**——共三个，全部同族（loader 并发挂载时序）：

| 接缝 | 入口 | 修复 |
|---|---|---|
| 1. exact-id 分支 | 构造器内 `ctx.get` 后走 `restoreOrCreateConfigured` | 抽为 `startConfiguredAgent()`：服务不可见且存在 Loader 时 `await loader.await()`（boot 自用的树安定原语）后重读一次 |
| 2. fresh-create | fixture 实际形态（agents **无** sessionId）走 `create()` → `createStoredSession()` 的命令式读——**首轮修复后 e2e 仍红才发现** | 同一 `startConfiguredAgent()` 统一覆盖两个入口 |
| 3. ACP 冗余通知 | src 模式 `llm/adapters-updated` 晚到 → 对 session/new 已返回的相同选项重复发 `config_option_update`（goal.expected 2 项失败根因，修复前 diff 实证为**逐字节相同**的冗余行） | `AcpSession` 选项读取（configOptions/setConfig）与拓扑通知串行化 + 序列化结果无变化抑制 |

**设计安全性论证**（审查重点）：
- `loader.await()` 是 `EntryTree.await()`（vendor/loader/src/config/tree.ts:46）——等全部 entry fiber 落定，boot 自己用它，语义即"树已安定"；
- **无 Loader 的世界**（产品 headless、既有单测、顺序组合）：首读即终值，行为不变（agent-loop 全量单测 375/375 过）；
- **安定树仍无服务**：保持既有无后端 create 契约（config-session-id.spec.ts 17 项契约全过，含"晚挂载后端"与"无后端"两个受保护语义）；
- teardown 竞态：等待经 `ownership.waitWhileActive()`（与 inactive promise race），dispose 不挂死；
- 兄弟条目失败：`loader.await().catch(() => undefined)` 吞掉拒绝，已起来的服务仍决定结果；
- ACP 抑制只作用于**序列化后逐字节相同**的重复；真实拓扑变化（新 provider、provider 消失）通知语义不变（bridge.spec 既有 4 项拓扑测试全过）。

**回归测试**（`packages/core/agent-loop/tests/loader-composition.spec.ts`，3 项）：真实 Loader + Include 并发挂载，persistence 导入人为延迟 50ms（确定性复现输掉的挂载顺序）：① 慢导入下 exact-id 恢复且落盘；② 慢导入下 fresh agent 物化（`list()`=1）；③ 无 persistence 条目的安定树保持无后端契约。**反向验证**：临时中和修复逻辑后测试 ①② 失败、恢复后通过——非空转测试。

**E.4 原卡处置**：原卡（6 个 e2e 断言迁 projcache + per-record JSON 重写）前提不成立（断言正确、projcache 无事件流），修复后 src 模式全绿且**零断言改动**，原卡作废。

### B.3 Node 统一 24.11.1 + node 24 glob 回归适配

**钉点改动**（比第四轮调查多发现 5 处裸钉点）：
- `.nvmrc`：`22.23.1` → `24.11.1`
- 8 个 workflow 的 `PRIMARY_NODE_VERSION: '24'` → `'24.11.1'`（ci / ci-master / build-preview-cloudflare / docs-pages / release / release-publish / release-vendor / release-vendor-publish）
- 10 处裸 `node-version: 24` → `24.11.1`（e2b-e2e / e2e / pi-ai-provider-e2e / sandbox / landlock-run ×2 / landlock-run-release ×3 / build-exe-for-python-sdk）
- ci.yml node-compat matrix（24.9 / 26）为故意多版本兼容车道，**保留**
- `release-manifests/{beta,production}.json` 的 `nodeVersion: v22.23.1` ~~描述已构建发布产物，留待下次发布自然更新（避免伪造构建历史）~~（第七轮勘误：manifest 是工作树构建快照而非发布产物，已重新生成与工作树一致——见文首审查后记）
- `scripts/run-web-env.ts` 从 `.nvmrc` 读 pin，自动跟随；`ci-workflow.spec.ts` 22/22 过（只断言 job 结构不锁字面版本）

**原生依赖**：fs-ext 在 node 24 下 `npm rebuild`（ABI 127→137，node 22 下不再可加载——预期行为）；node-pty/sharp 等为 N-API prebuilt，ABI 稳定无需重建；消费方 session-persistence-jsonl 单测 304/304。

**意外发现：node 24 glob 回归**。node 24 的 `fs.glob` 在 `**` + **字面**结尾段命中**符号链接**时抛 ENOTDIR（node 22 静默跳过）：
- 合成最小复现：`/tmp/globtest`（`**/f.md` + 符号链接 → node 24 崩、node 22 返回全部匹配）；
- 命中点：`verify-md-wrap` 的 `snapshots/**/system-prompt.expected.md`（snapshots/acp 下 2 个符号链接指向 session/ 同名文件）；
- 边界确认：通配符结尾（`**/*.md`）不受影响（md-links / doc-refs / agent-note-tree 全部实测 OK）；packages 下两个同名文件是普通文件（早前 find 输出误读为符号链接，已纠正）；
- 修复：两个字面模式改固定深度（`snapshots/*/*/…`、`packages/*/*/*/*/*/*/…`），**双 node 实测匹配集逐字节一致**（2292 文件），`check:ci:static` 45/45 恢复；
- 已记入 KNOWN_ISSUES #13：未来在 `**`+字面段模式下新增符号链接文件需注意此差异。

### B.4 beta 切 node 24.11.1 + 二开清单机制

**3088 重启**：首次启动被会话继承的 `NEXUS_WEB_PORT=3000` 拦截（启动器 fail-loud，**再次印证 P1-b**）；干净环境（`env -u DSH_HOME -u NEXUS_ENV -u NEXUS_WEB_PORT -u NEXUS_PLUGIN_CHANNEL`）重启成功。lsof 确认进程二进制为 `~/.nvm/versions/node/v24.11.1/bin/node`（PID 7695），health ok，**27/27 全链路验收通过**。3000 production 未动（仍 node 22 进程；下次重启须用 node 24，启动器自动把关）。

**二开清单机制**（用户政策：尽量不动源码；必要二开须区分原版/二开、防 pull 覆盖）：
- 清单 `migration/fork-modifications-2026-09-06.md`：登记 F1/F2/F3 三项二开，每项含**撤销条件**（上游修复即退二开）；
- 补丁集 `migration/patches/000{1,2,3}-*.patch`，`git apply --check --reverse` 验证与工作树**逐字节一致**；
- 覆盖风险区分：tracked 修改有补丁保护；untracked 新增（回归测试、.nvmrc、补丁自身）对 pull/checkout 天然免疫，只登记；
- 后续政策：优先非源码方案；新二开按 0004 递增登记；F1/F2 建议以 PR 贡献回上游（合并后二开清零）。

## C · 验证矩阵（node 24.11.1 下，外科 Python PATH）

| 门禁 | 结果 | 对比基线 |
|---|---|---|
| **全量 e2e 车道 src 模式** | **36 文件 137 测试全过、0 失败**（73 跳过为外部凭证/平台门控） | 此前 28 失败 |
| 6 文件 e2e src 模式 | 10/10 | 此前 9 失败 |
| expected 车道 src 模式 | **28/28** | 此前 2 失败（goal.expected） |
| e2e lib 模式（CI 同款） | 10/10 | 保持全过 |
| agent-loop 单测 | 375/375（20 文件，含新增 3 项回归） | 374/374，无回归 |
| ACP 单测 | 139/139（11 文件） | 无回归 |
| session-persistence-jsonl 单测 | 304/304 | fs-ext 重建后消费方验证 |
| 全量单测 | 18331 通过 / 1 失败（spill 已知 flake，隔离 41/41 过）/ 118 跳过——**第五轮自跑的历史结果**；第七轮审查复核为 **18332 通过 / 0 失败 / 118 跳过**（spill flake 未复现），以复核数据为准 | 与 node 22 基线一致 |
| `test:web:built` | 317/332、0 失败 | 与基线逐项一致 |
| `check:ci:static` | 45/45 | glob 修复后恢复 |
| `hygiene` | 16/16 | — |
| tsc（compile）/ oxlint | 干净 / 0 警告 0 错误 | — |
| `ci-workflow.spec.ts` | 22/22 | Node 钉点改动不破坏断言 |
| 3088 全链路验收 | 27/27（node 24.11.1 进程） | — |
| 3000 health | `{"ok":true,"environment":"production",...}` 全程未动 | — |

**零测试断言改动**：全部修复通过上游源码修复达成；6 个 e2e 测试文件与 expected 快照文件 `git diff` 为空。

## D · 改动文件清单（第五、六轮，共 110 项未提交中的 20 项）

| 类别 | 文件 | 内容 |
|---|---|---|
| 源码修复（F1） | `packages/core/agent-loop/src/index.ts` | `startConfiguredAgent()` + loader 安定门（+46/−10） |
| | `packages/core/agent-loop/package.json` | +2 devDeps（cordis-plugin-loader/include，先例：webhook、session-telemetry-otel） |
| 新增回归（F1 配套） | `packages/core/agent-loop/tests/loader-composition.spec.ts` | 3 项确定性竞态回归 |
| 源码修复（F2） | `packages/acp/acp/src/session.ts` | 选项串行化 + 无变化抑制（+47/−17） |
| Node 钉点（F3） | `.nvmrc`、`.github/workflows/` ×15 | 24.11.1 精确钉定 |
| glob 适配（F3） | `scripts/verify-md-wrap.ts` | 两个字面模式改固定深度（+8/−2） |
| 依赖 | `pnpm-lock.yaml` | 混合状态（迁移既有 + 本轮 devDeps），由 `pnpm install` 再生 |
| 二开机制 | `migration/fork-modifications-2026-09-06.md`、`migration/patches/000{1,2,3}-*.patch` | 清单 + 补丁集 |
| 文档 | `HANDOFF.md`、`KNOWN_ISSUES.md`、`CHANGELOG.md`、`migration/review-2026-09-06.md` | 第五/六轮记录与勘误 |

## E · 文档一致性

- `KNOWN_ISSUES.md`：#10b 标题划线标记已修复 + 修复/验证记录；#13 增统一执行记录 + node 24 glob 差异 + 运行中服务注意事项。
- `HANDOFF.md`：头部第六轮；e2e 行改"src 模式全绿"；第五、六轮执行记录两节；下一步更新（含 commit 拆分建议与二开保护说明）。
- `CHANGELOG.md`：第五轮节（三项授权执行 + 污染勘误）、第六轮节（beta 重启 + 二开机制）。
- `migration/review-2026-09-06.md`：B.4 加第五轮修复记录；D 节命令 6 期望值更新；E 节第 3/4 项标记已执行/作废。
- 无残留过时引用：`#15` 引用仅剩第四轮执行记录中对修正动作本身的历史描述（"HANDOFF `#15`→`#10b` ×2"）；"断言过期"定性均已勘误。

## F · 复跑验证命令（审查会话可逐项执行）

```sh
cd /Users/liyan/deepseek-harness
mkdir -p /tmp/py314-bin && ln -sf /opt/homebrew/bin/python3 /tmp/py314-bin/python3

# 1. 环境前提（node 必须 24.11.1；外科 Python PATH）
export PATH=/Users/liyan/.nvm/versions/node/v24.11.1/bin:/tmp/py314-bin:$PATH
node --version   # v24.11.1

# 2. 新增回归测试（~1s；3 项应全过）
pnpm exec vitest run --config vitest.config.ts packages/core/agent-loop/tests/loader-composition.spec.ts

# 3. 修复主战场：6 文件 e2e src 模式（~15s；应 10/10）
DSH_HOME=$(mktemp -d /tmp/rv-XXXX) pnpm exec vitest run --config vitest.e2e.config.ts \
  packages/goal/goal/tests/goal.e2e.ts \
  packages/context/time-context/tests/time-context.e2e.ts \
  packages/session/session-telemetry-otel/tests/loader-composition.e2e.ts \
  packages/subagent/subagent-acp/tests/loader-composition.e2e.ts \
  packages/subagent/subagent-dsh-sdk/tests/loader-composition.e2e.ts \
  apps/cli/tests/profiles/headless/tests/keyless-smoke.e2e.ts

# 4. ACP 修复验证：goal expected src 模式（~3s；应 2/2）
DSH_HOME=$(mktemp -d /tmp/rv-XXXX) pnpm exec vitest run --config vitest.expected.config.ts \
  apps/cli/tests/profiles/acp/tests/goal.expected.e2e.ts

# 5. 全量 e2e src 模式（~1min；应 36 文件 137 测试全过 0 失败）
PATH="/tmp/py314-bin:$PATH" DSH_HOME=$(mktemp -d /tmp/rv-XXXX) pnpm run test:e2e

# 6. 契约保持：agent-loop + ACP 全量单测（~10s；375/375 + 139/139）
pnpm exec vitest run --config vitest.config.ts packages/core/agent-loop/tests/ packages/acp/acp/tests/

# 7. glob 修复双 node 等价（各 ~10s；两版都应输出 2292 file(s) checked）
pnpm run verify-md-wrap                       # node 24.11.1（当前 PATH）
PATH=$(echo $PATH | sed 's|[^:]*v24.11.1[^:]*:||') pnpm run verify-md-wrap   # node 22

# 8. 静态门禁（~1min；应 45/45）
pnpm run check:ci:static

# 9. 二开补丁完整性（<1s；三条都应无输出即通过）
for p in migration/patches/*.patch; do git apply --check --reverse "$p" && echo "$p OK"; done

# 10. 运行态只读检查（不许动 3000）
curl -s http://127.0.0.1:3000/health   # environment:production（node 22 进程，未动）
curl -s http://127.0.0.1:3088/health   # environment:beta（node 24.11.1 进程）
BASE=http://127.0.0.1:3088 node /tmp/nexus-live-acceptance.mjs   # 27/27

# 11.（可选，~7min）test:web:built 应 317/332、0 失败
pnpm run test:web:built
```

## G · 剩余人审项

1. **commit 授权与拆分**（最重要）：全部门禁绿，建议拆为
   - `fix(agent-loop): wait for loader tree before reading session persistence`（F1 + 回归测试）
   - `fix(acp): suppress redundant config-option notifications`（F2）
   - `chore(ci): pin node 24.11.1 and adapt md-wrap glob`（F3 = .nvmrc + 15 workflows + verify-md-wrap）
   - 其余按 `migration/worktree-manifest-2026-09-05.md` 的 5 步拆分。
   commit 本身即最强二开保护（tracked 修改入库后 pull 走 merge 而非覆盖），与补丁机制互补。
2. **F1/F2 贡献回上游**：本质是上游 bug 修复（含回归测试），建议 PR 给 dsh 仓库；合并后二开清零（撤销条件见清单）。
3. **Python PATH 永久修复**：`.zshrc` 前置 homebrew 或仓库级 Python 钉版（E.2，mise/.python-version）。
4. **3000 重启**：当前仍 node 22 进程；下次维护窗口用 node 24.11.1 重启（启动器自动校验）。
5. 真机 Golden Path 验收（人工）；Agent Note 转正裁决；（可选）设 `DEEPSEEK_API_KEY` 补跑 B/C 级 e2e。

## H · 给审查者的建议关注点

1. **`startConfiguredAgent()` 的等待语义**（B.2 设计安全性论证五条）：重点核对无 Loader 世界不变式（agent-initiator/agent/cancel 等既有 spec 全过即为证据）与 teardown 不挂死（`waitWhileActive`）。
2. **回归测试是否真的复现竞态**：可临时把 `if (persistence === undefined) {` 改 `if (false) {` 中和修复，跑命令 2 应见 ①② 失败（审查者自行复现后请还原）。
3. **ACP 抑制边界**：只抑制序列化逐字节相同的重复；bridge.spec 的 4 项拓扑变化测试（新 provider / provider 消失 / hung discovery / recoverable options）是语义保持的证据。
4. **glob 修复的深度假设**：固定深度模式依赖 snapshots 布局均匀（`<group>/<case>/`）与 fixtures 深度 6；若未来布局变化需同步模式（已在 KNOWN_ISSUES #13 记录差异与风险）。
5. **污染勘误的证据**：62 个文件全量解析、0 临时 cwd；审查者可抽查数个 JSON 的 `record.identity.cwd` 字段。
6. **Node 钉点完整性**：`grep -rn "node-version: 24$" .github/workflows/` 应为 0 行；`PRIMARY_NODE_VERSION` 应全部 `'24.11.1'`；compat matrix 24.9/26 应保留（故意多版本车道）。
