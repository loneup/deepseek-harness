---
description: "Nexus Bridge route-registration plugin for the dsh Web host: health, device pairing, the v4 handshake, authenticated session/turn commands, and the /nexus/events SSE stream on the shared WebServer listener."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-nexus-bridge

English | [中文](README.zh.md)

## Summary

Nexus Bridge route-registration plugin for the dsh Web host. The current slice registers health, one-time device registration, the Nexus v4 handshake, authenticated commands for session and turn control, and an in-process `/nexus/events` SSE stream on the shared `ctx.webServer`; all routes release with the Cordis fiber.

The package owns no Session cache. Administrative routes are registered on the same dsh WebServer listener under `/nexus/admin/*` (with `/admin/*` compatibility aliases). Non-loopback requests require a configured Bearer token and a matching IPv4 CIDR source; loopback is allowed without a token for local bootstrap. Configure `adminAllowedNetworks`, `adminToken`, `killSwitchPath`, and `auditPath` for durable LAN/Tailscale administration without opening a second port.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

### Dev Note

The web-app bundle mounts this package as the `nexus-bridge` host row and supplies `registryPath`, `workspaceRoots`, `killSwitchPath`, `auditPath`, `adminToken`, and `adminAllowedNetworks` from `NEXUS_*` environment variables. `session.open` and `subagent.history` read history through the SessionController `follow` opening snapshot, whose cursor and latest message-aligned records are the only cold-safe window — a literal `page` cursor of `-1` cuts an empty log.

## Model Experience

None, as the Host route plugin exposes transport health and registers nothing model-facing.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- No runtime invariant companion is published: the bridge's behavioral guarantees live in `tests/` (route, isolation, approval, and stream suites); an empty `./invariant` companion would violate the package invariant rules.
- **Replay scope** — live events are broadcast from dsh `session/event` while the process is alive. `session.open` replays the Host history to the requesting, session-scoped SSE channel, including a short setup-race buffer. A `since` query and durable subscriptions remain deferred because dsh `events.mux` currently ignores `since`; clients recover by reconnecting and opening the session again.
- **Pairing code issuance** — this plugin consumes pairing codes created by the existing loopback route; it does not expose a public pairing-code creation route.
- **Administration** — `GET /nexus/admin/device.list`, `POST /nexus/admin/device.revoke`, `POST /nexus/admin/killswitch.engage`, `POST /nexus/admin/killswitch.release`, and `GET /nexus/admin/killswitch.state` are audited and fail closed on unauthorized source/token. Revoke invalidates active channel tokens and closes their SSE streams.
- **No authentication on health** — the endpoint returns only `{ "ok": true }` and must not expose device, workspace, or credential data.
- **Prompt attachments** — `turn.start` accepts ordered text and PNG/JPEG/WebP/GIF image blocks. Image bytes are canonical base64, capped at 5 MiB decoded per image, and forwarded to `sessions.prompt`; unsupported blocks and media types are rejected before the host call. The request body limit is 8 MiB to accommodate base64 expansion. Image data is never logged.
- **Queue and steer** — `turn.start` and `turn.queue` enqueue the next prompt (`sessions.prompt` mode `queue`); `turn.steer` injects a prompt into the active turn's next step (`mode` `steer`). Both use the same kill-switch and content validation as `turn.start`.
- **Subagent catalog** — `subagent.list` exposes dsh's direct-child catalog for a paired parent session. It is read-only and forwards `activity`, `mode`, `label`, and diagnostic rows without synthesizing lifecycle events.
- **Subagent history** — `subagent.history` reads a verified direct child's durable transcript through dsh, preserving `beforeSeq`, `maxMessages`, `hasMore`, and projection fields. It never activates the child or accepts arbitrary session ids.
- **Workspace Git snapshot** — `workspace.gitStatus` and `workspace.gitDiff` execute fixed, read-only Git arguments against the session's Host workspace after the configured whitelist check. Arbitrary paths and Git arguments are never accepted.
- **Workspace branches** — `workspace.gitBranches` returns the current workspace's branch names using a fixed read-only query after the same whitelist check; it does not switch branches or perform any write.
- **Approval events** — the plugin observes the dsh `approval/request` waterfall, emits `approval.requested` without deciding it, and always delegates with `next()`. Durable `approval/decided` events are mapped to `approval.resolved`; approval response commands still use the host approval service.
- **Pre-execution policy** — `enforcePreExecution` (default `true`) installs the dsh `tools/pre-execute` waterfall. The gate covers only sessions a Nexus channel has opened; every other session delegates unchanged so the Web keeps dsh's escalation approval UX. Verified `read-only` Nexus sessions deny write calls before the executor; `workspace-write` denies missing or out-of-root targets. Unknown or absent presets delegate unchanged.
