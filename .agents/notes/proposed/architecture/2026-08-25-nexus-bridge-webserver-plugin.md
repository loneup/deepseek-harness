# Agent Note: Mount Nexus Bridge on the dsh WebServer

Status: proposed

English | [中文](2026-08-25-nexus-bridge-webserver-plugin.zh.md)

## Problem

The Nexus Bridge currently runs as a second HTTP process and reaches dsh through its browser API. That duplicates transport lifecycle and keeps the mobile data plane on a separate port even though dsh already exposes a reversible WebServer route-registration service.

## Proposal

Mount Nexus Bridge as a dsh host plugin. The plugin registers `/nexus/*` through `ctx.webServer`, reuses dsh Session/Event/Approval services, and keeps dsh `/api/*` unchanged. The first shipped slice registers only `/nexus/health`; protocol routes are added only after their service mappings, authentication, replay, and shutdown semantics are demonstrated. The management surface remains loopback-only on `3089`, while the shared Web data plane uses the dsh default `3080`.

The plugin must use `ctx.effect()` for every route and subscription so dsh fiber disposal removes routes, SSE connections, and listeners. It must not copy Session state or bypass dsh trust and permission services. Nexus protocol changes require a separate approved decision and version bump.

## Alternatives considered

**Keep the independent Bridge process.** This preserves the current adapter boundary and is the rollback path, but it leaves two lifecycles and two data-plane ports to secure and test.

**Attach Nexus routes to dsh `/api`.** Reusing the existing prefix would collide with dsh client transport ownership and make route ownership ambiguous; `/nexus` gives the mobile protocol an explicit namespace.

**Change dsh's default port to `3000`.** The current dsh Web profile uses `3080`; changing the host default would expand the migration and break existing Web assumptions without providing a plugin benefit.

## Acceptance criteria

- A real dsh Web profile serves `/api/*` and the plugin's `/nexus/health` on one listener.
- Disposing the plugin removes `/nexus/health` without taking down dsh Web; disposing dsh closes every Nexus subscription and listener.
- Later protocol slices preserve Nexus v3 authentication, event ordering, idempotency, audit redaction, kill-switch, and loopback-only administration with real dsh evidence.
- No public listener, credential storage, or sensitive health response is introduced.

## Risks

The dsh WebServer and Nexus protocol have different error and authentication contracts. A path rewrite that merely forwards `/nexus` to the existing `/api` handler could bypass a trust check or alter response semantics. The migration therefore stops when an authoritative dsh service or shutdown contract cannot be proven.
