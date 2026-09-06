# Agent Note: Nexus Bridge migration to SessionController acceptance

Status: proposed

English | [中文](2026-09-05-nexus-bridge-sessioncontroller-migration.zh.md)

## Problem

After dsh 0.1.3-alpha.1 removed `@deepseek-ai/dsh-host-apiproxy` and `@deepseek-ai/dsh-client-runtime`, the nexus-bridge migration to `ctx.sessionController` / `ctx.subagents` compiled but failed live verification: `session.open` replayed no history, and mounting the bridge in the web-app bundle broke the host's recorded approval escalation flow. See [[2026-08-25-nexus-bridge-webserver-plugin]] for the mount decision.

## Proposal

**`page` with a literal `throughSeq` of `-1` reads an empty log.** `paginate` cuts its window at `throughSeq + 1`, so `-1` yields `end = 0` regardless of log length. The documented cold-read pattern is the `sessionController.follow` opening frame, which carries the current cursor and the latest message-aligned records in one snapshot; `page` is for paging backwards from that cursor. `session.open` and `subagent.history` now read through the follow snapshot (`openingSnapshot`/`openingRecords` in `command.ts`).

**The pre-execution gate must be Nexus-scoped.** The bridge's `tools/pre-execute` handler denied writes for `read-only` sessions before dsh's sandbox could return its escalation hint, so no `sandbox_permissions` retry, approval ask, or decision could ever happen. Every Web e2e approval snapshot failed with the bridge's hard-deny text. The gate now applies only to sessions a Nexus channel has opened (`nexusSessions`), mirroring the approval handler's ownership check; Web sessions keep dsh's escalation UX, and Nexus sessions keep the deny-first posture the bridge README documents.

**`ui-settings-nexus` was never API-blocked.** The Settings tab depends only on slots/locale/ui-renderer types and the `/nexus/admin/*` routes, none of which the 0.1.3 upgrade removed. The stub and its console warning are replaced by the restored tab; the `plugin-config` e2e golden now lists the `Nexus 管理` tab.

**Compiled output in `src/` breaks the test plane.** A misconfigured build had emitted `.js`/`.d.ts`/`.map` next to 31 packages' `.ts` sources. Vite resolves the directory mapping to the stale `.js`, so tests loaded two module instances and `instanceof` checks failed repo-wide. The 516 stray files (each shadowing a same-named `.ts`) were removed; `pnpm dsh` source launch via tsx was unaffected because tsx prefers `.ts`.

## Acceptance criteria

- Pairing, v4 handshake, `session.list/open/create/models/selectModel`, `turn.start/queue/cancel`, `subagent.list/history/prompt/interrupt`, and SSE anchor/replay/reconnect verified live against a real `dsh --profile web` process with scripted Nexus clients.
- One-shot and continuable subagent children both verified end to end (history, pagination, follow-up prompt, interrupt).
- The six previously failing Web e2e files pass; full `npm test` shows only the pre-existing `code-runtime-python` environment failure (fails identically on a clean HEAD worktree); `swift test` (NexusCore) passes 96/96 and the iOS Simulator build succeeds.

## Risks

- The follow-snapshot cold read and the Nexus-scoped pre-execution gate are behavior-bearing changes; regressions surface in Web approval e2e and device reconnect flows rather than at compile time.
- `tests/*.spec.ts.disabled` still pins the removed apiProxy shape until rewritten against SessionController.

## Alternatives considered

- **Vendor a compatibility layer that reimplements the removed `apiproxy` API surface** — would have kept the bridge and tests unchanged, but it permanently duplicates host internals the release deliberately deleted and re-creates the coupling the removal was meant to end.
- **Per-call method sniffing with apiProxy-style fallbacks** — softens the migration in the short term but silently mixes two generations of host behavior at runtime and violates the fail-loud misconfiguration rule.
- **Wait for the host to restore an equivalent facade** — no such facade existed in 0.1.3-alpha.1, and the bridge's pairing, handshake, and administration surfaces were already released against the shared port.

## Remaining work

- `tests/*.spec.ts.disabled` still mocks the removed `apiProxy` shape (rpcId + `result.ok`) and needs a rewrite against SessionController before re-enabling; restoring the shim is explicitly out of scope.
- The live approval answer path (`approval.respond` against a real `approval.asked`) awaits the on-device Golden Path.
