# Agent Note: NexusDshPort compatibility seam between nexus-bridge and dsh

Status: proposed

English | [中文](2026-09-05-nexus-dsh-port-compat-seam.zh.md)

## Problem

The 2026-09-05 SessionController migration ([[2026-09-05-nexus-bridge-sessioncontroller-migration]]) left `nexus-bridge` calling `ctx.sessionController` and `ctx.subagents` directly. Every future dsh API change — renamed methods, signature shifts, branded-id vocabulary, error codes, journal event fields — would fan out into the bridge, the Web settings tab, and the iOS client, because all three depend on shapes that only dsh owns.

## Design

`packages/host/nexus-dsh-compat` introduces a one-implementation port:

- **`NexusDshPort`** (`src/port.ts`) is the only consumer face: `listSessions`, `createSession`, `getModelCatalog`, `selectModel`, `prompt`, `cancelSession`, `readHistory`, `listSubagents`, `promptSubagent`, `interruptSubagent`. All request/response types are Nexus-owned (`src/types.ts`, branded `NexusSessionId`/`NexusRequestId`) and JSON-equivalent to the shipped v4 wire, so the bridge serializes port values without reshaping.
- **`Dsh013Adapter`** (`src/dsh-013-adapter.ts`) is the single fix site for dsh 0.1.3-alpha.1: branded-id casts, `SessionAddress` construction, the `follow`-opening-snapshot cursor contract (a literal `page` `throughSeq` of `-1` reads an empty log), and receipt mapping (`SubagentPromptReceipt` gains an additive `accepted: true`).
- **`mapDshError`** recognizes failures structurally via `remoteErrorOf` (never instanceof) and collapses them to six stable codes (`unknown_session`, `unknown_subagent`, `subagent_unauthorized`, `malformed`, `host_cancelled`, `host_error`); `host_error` replaces the original message so internal dsh diagnostics and paths stay host-side. This replaces the per-method code chains in `command.ts` and retires the ad-hoc `subagent_error` wire code.
- **`mapDshEvent`** carries the reducer payload vocabulary (turn lifecycle, message deltas, tool calls, approval outcomes); unknown or non-Nexus events return `undefined` and must not advance the Nexus sequence. It moved verbatim out of `index.ts`.
- **Provider** (`src/plugin.ts`) exposes `ctx.nexusDsh` via `ctx.reflect.provide`, fails loud on an unknown `adapter` config or missing `sessionController`/`subagents`, and releases with the fiber.

Live event delivery deliberately stays on the Cordis bus: the bridge keeps its `ctx.on('session/event')` listener, so the Web and Nexus surfaces share one broadcast. The port has no subscribe method by design; adding one plus `follow()` later would require deduplication against the broadcast.

## Wire changes

Error codes on subagent failures change from `subagent_error` to `unknown_subagent` / `subagent_unauthorized` (the migration plan's mapping; iOS surfaces unenumerated codes by message). Session list/create/models/selectModel and turn receipts pass through JSON-identical. `session.open` order (history records → `session.subscribed` anchor) is unchanged.

## Acceptance evidence

- `pnpm vitest run packages/host/nexus-dsh-compat/tests` — 62 tests across port contract, adapter calls, error mapping (including cross-realm markers), event mapping, subagent flows, and provider load/release.
- `pnpm exec tsc -b tsconfig.host.json` clean; a source-text contract test asserts the public surface never mentions dsh internal type names.
- `packages/bundle/web-app/tests` — 24 tests pass, including the startup HTTP-surface suite verifying the client-modules and ui-settings-nexus bundles serve 200.

## Remaining work

- `subagent.list` entries still pass through dsh's `kind: 'child' | 'diagnostic'` union; the iOS-era fixture (`subagent-v1.json`) shows a flatter `{sessionId, name, status, mode, parentSessionId}` shape. Live-device acceptance passed against the dsh shape, so the fixture, not the bridge, is the stale artifact; reconciling them is a separate decision.
- Future dsh versions add a `Dsh014Adapter` (or later) behind the same port and contract tests; the provider's `adapter` config is the selection point, and unknown names fail loud.

## Proposal

Introduce `packages/host/nexus-dsh-compat` as a single-implementation port:

- `NexusDshPort` (`src/port.ts`) is the only consumer face: ten methods covering Session, model, history, and Subagent capabilities, expressed only in the Nexus-owned vocabulary of `src/types.ts` (branded `NexusSessionId`/`NexusRequestId`, wire-equivalent payloads, six-code `NexusPortError`).
- `Dsh013Adapter` (`src/dsh-013-adapter.ts`) is the only fix site for dsh 0.1.3-alpha.1: branded-id casts, `SessionAddress` construction, the follow-opening-snapshot cursor contract, receipt mapping, and provider wiring via `ctx.reflect.provide` with fail-loud composition.
- `mapDshError` recognizes failures structurally through `remoteErrorOf` and collapses them to six stable codes with message sanitization; `mapDshEvent` carries the reducer payload vocabulary verbatim from the bridge's former `mapSessionEvent`.
- The bridge consumes the port alone; a source-text contract test forbids dsh internal type names in bridge sources and on the port's public face.

## Acceptance criteria

- `pnpm vitest run packages/host/nexus-dsh-compat/tests` passes (62 tests: port contract, adapter calls, error mapping incl. cross-realm, event mapping, subagent flows, provider load/release).
- `pnpm exec tsc -b tsconfig.host.json` is clean with the package in the host solution.
- The bridge grep-clean for `SessionController`/`SubagentRuntime`/`SessionAddress`/`SessionRequestId`/`SubagentPromptRequestId`/`RemoteError`/`apiProxy`/`LegacyApiResponse`/`result.ok` is enforced as a resident regression test.
- Live Nexus acceptance (pairing, handshake v4, full Session/Subagent/turn/kill-switch commands, SSE sequence continuity) passes 27/27 against a real `dsh --profile web` process.

## Risks

- The port types duplicate dsh shapes by hand; drift shows up as adapter compile or contract-test failures rather than runtime surprises, but the duplication is real maintenance surface.
- Subagent error codes change on the wire (`subagent_error` → `unknown_subagent`/`subagent_unauthorized`); older clients that switch on that exact code would misroute, though the shipped iOS client treats unenumerated codes as message-only.
- Live events stay on the Cordis bus by design; a future port subscription method must deduplicate against that broadcast or it will double-deliver.

## Alternatives considered

- **Keep calling `ctx.sessionController`/`ctx.subagents` from the bridge** — zero indirection today, but every dsh rename fans out into the bridge, the Web settings tab, and the iOS client; rejected because the whole point of the seam is absorbing host churn in one file.
- **Method-presence sniffing for forward compatibility** (try new API, fall back to old) — silently mixes adapter generations at runtime and fails the repo's fail-loud rule; rejected in favor of explicit `adapter` configuration that refuses unknown names at load.
- **Two bridge packages (beta/production)** — rejected: the environments differ only in manifest and configuration, never in code; a single port with per-version adapters keeps the dependency graph and the gate surface at one.
