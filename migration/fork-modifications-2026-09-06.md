# dsh 二开（fork）修改清单 · 2026-09-06

> **2026-09-06 更新（第八轮 commit 拆分后）**：F1/F2/F3 已全部入库——`647d1ad3a9`（F1 agent-loop loader 安定门）、`44f9717a7a`（F2 ACP 冗余通知抑制）、`7795178dc8`（F3 Node 钉点 + md-wrap glob）。**commit 已成为二开的第一层保护**（pull 走正常 merge/rebase 而非覆盖）；本清单的补丁降级为第二层保险（工作树被 `git checkout`/`reset` 硬还原时使用）。撤销条件与恢复流程继续有效。
>
> **政策**（用户指示）：尽量不修改 dsh 上游源码——每次上游更新都要跟着改。确有必要时可以二开，但**必须登记本清单**并区分原版与二开，避免 `git pull` / `git checkout` 时被覆盖后无从恢复。
>
> **机制**：所有对**已跟踪（tracked）上游文件**的二开修改都存有补丁（`migration/patches/*.patch`，已验证与工作树逐字节一致）。工作树被意外还原时，从仓库根执行 `git apply migration/patches/<补丁>.patch` 即可恢复。**新增（untracked）文件**对 pull/checkout 免疫，无需补丁，只在下表登记。

## 一、源码级二开（上游 bug 修复，理想归宿是贡献回上游）

| # | 补丁 | 文件 | 内容 | 撤销条件（二开退出） |
|---|---|---|---|---|
| F1 | `0001-agent-loop-loader-settle.patch` | `packages/core/agent-loop/src/index.ts`、`packages/core/agent-loop/package.json` | 配置式 agent 启动抽为 `startConfiguredAgent()`：sessionPersistence 不可见且存在 Loader 时 `await loader.await()` 后重读，消除并发挂载下会话静默不落盘的竞态（src 模式 10 项 e2e 失败根因）；package.json 增 cordis-plugin-loader/include devDeps | 上游 agent-loop 以任何形式修复构造期持久化接合时序（验证：src 模式全量 e2e 137/137 且本补丁逻辑已在上游存在） |
| F2 | `0002-acp-config-option-suppression.patch` | `packages/acp/acp/src/session.ts` | 选项读取与拓扑通知串行化 + 无变化抑制：src 模式下 `llm/adapters-updated` 晚到不再对 session/new 已返回的相同选项重复发 `config_option_update`（goal.expected 2 项失败根因） | 上游 ACP 层以任何形式消除冗余通知（验证：expected 车道 src 模式 28/28 且上游含等效抑制） |
| F3 | `0003-node-pin-24.11.1-and-mdwrap-glob.patch` | `.github/workflows/` ×15、`scripts/verify-md-wrap.ts` | ① Node 钉点 24→24.11.1（8 处 `PRIMARY_NODE_VERSION` + 10 处裸 `node-version`；compat matrix 24.9/26 保留）；② verify-md-wrap 两个字面 glob 模式改固定深度——node 24 的 `fs.glob` 对 `**`+字面结尾段+符号链接抛 ENOTDIR（node 22 静默跳过） | ① 上游自行钉精确 patch 时；② node 修复 glob 符号链接行为（跟踪 node 发布说明）或上游改用固定深度模式 |

**F1/F2 配套新增文件**（untracked，免疫 pull/checkout）：
- `packages/core/agent-loop/tests/loader-composition.spec.ts` —— 确定性回归（3 项；对未修复代码实测失败，防上游修复后测试空转）
- `pnpm-lock.yaml` 的 diff 为**混合状态**（迁移既有 nexus workspace 链接 + 本轮 devDeps），不单独出补丁；还原后 `pnpm install --filter @deepseek-ai/dsh-agent-loop` 再生

## 二、配置级新增（untracked，免疫 pull/checkout）

| 文件 | 内容 | 说明 |
|---|---|---|
| `.nvmrc` | `24.11.1` | 第三轮创建、第五轮更新；`run-web-env.ts` 自动跟随 |
| `migration/patches/*.patch` | 本清单的补丁集 | 自身也是 untracked，免疫覆盖 |
| `scripts/node-version-pin.ts` / `.spec.ts` / `run-web-env.ts` 接线 | 第三轮产物 | 已在审查包 C 节登记 |

## 三、恢复流程（工作树被还原后）

```sh
cd /Users/liyan/deepseek-harness
git apply migration/patches/0001-agent-loop-loader-settle.patch
git apply migration/patches/0002-acp-config-option-suppression.patch
git apply migration/patches/0003-node-pin-24.11.1-and-mdwrap-glob.patch
pnpm install --filter @deepseek-ai/dsh-agent-loop   # 再生 lock 与 workspace 链接
# node 24 下重建原生模块（若 fs-ext ABI 不符）：
PATH=/Users/liyan/.nvm/versions/node/v24.11.1/bin:$PATH npm rebuild fs-ext
# 复跑验证（src 模式全量 e2e 应 137/137）：
PATH=/tmp/py314-bin:$PATH DSH_HOME=$(mktemp -d /tmp/e2e-verify-XXXX) pnpm run test:e2e
```

## 四、上游更新时的检查单

1. `git pull` 前确认本清单补丁对应文件无未提交改动丢失风险（tracked 修改遇上游同区域改动会冲突——冲突即人工合并机会，检查上游是否已含等效修复）。
2. pull 后逐项跑撤销条件验证（F1/F2/F3 的"验证"命令）；上游已修复的项从本清单与工作树移除（`git apply --reverse` 或手动）。
3. F1/F2 属上游 bug 修复，**建议以 PR 形式贡献回 dsh 仓库**（含回归测试）；合并后本二开自然清零。

## 五、后续政策

- 优先非源码方案（配置、测试、fixture、文档）；确需改上游源码时：改动最小化、同步生成补丁入 `migration/patches/`、登记本清单、注明撤销条件。
- 每次新增二开，补丁文件名按序号递增（下一个为 `0004-*.patch`）。
