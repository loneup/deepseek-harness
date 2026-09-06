---
description: "Nexus compatibility layer: the stable NexusDshPort seam, Nexus-owned wire vocabulary, and error mapping between the Nexus Bridge and DeepSeek Harness session and subagent APIs."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-nexus-compat

English | [中文](README.zh.md)

## Summary

Stable seam between `@deepseek-ai/dsh-host-nexus-bridge` and DeepSeek Harness. The package defines `NexusDshPort` — every Session, model, history, and Subagent capability the Bridge consumes, expressed only in the Nexus-owned vocabulary of `src/types.ts` — plus the stable `NexusPortError` error vocabulary. Harness-specific adapters (currently `Dsh013Adapter` for dsh 0.1.3-alpha.1) implement the port and own every conversion of host types, branded ids, errors, and journal events.

The Bridge must depend on this interface alone; host API changes are absorbed here instead of propagating into the Bridge, the Web settings tab, or the iOS client.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

### Dev Note

The web-app bundle mounts this package as the `nexus-dsh-compat` host row immediately before the `nexus-bridge` row, so `ctx.nexusDsh` resolves before the bridge's `inject` samples it. Live event delivery is deliberately not on the port: the bridge keeps its Cordis `session/event` listener so the Web and Nexus surfaces share one broadcast without double delivery. The adapter binds `sessionController` and `subagents` at provider composition; a dsh version bump adds a new adapter behind the same port contract tests instead of editing the bridge.

## Model Experience

None, as the package exposes an in-process port seam between the Nexus Bridge and the harness and registers nothing model-facing.

#### KV Cache effect

None; the port holds no prompt-assembly state and no model-visible cache behavior.

## Known Limitations and Deferred Work

- **Live events stay on the Cordis bus** — the port intentionally has no subscription method; the Bridge keeps its `session/event` listener so the Web and Nexus surfaces share one broadcast without double delivery.
- No runtime invariant companion is published: the port has no runtime invariants of its own: every behavioral guarantee is owned and asserted by the contract tests in `tests/` (source-text isolation, manifest validation, and adapter call-through), so an empty `./invariant` companion would violate the package invariant rules.
- **Sanitization is the adapter's job** — `NexusPortError` messages must already be client-safe; the adapter strips host stacks, paths, and internals before raising.
- **Subagent catalog passthrough** — `subagent.list` forwards dsh's `kind: 'child' | 'diagnostic'` entry union unchanged; the iOS-era fixture shows a flatter shape, and reconciling that is a separate decision.
