---
description: "Nexus pairing and device administration tab for the dsh Web Settings surface, served over the shared Web listener and the Nexus /nexus/admin/* routes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-nexus

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-settings-nexus` renders the Nexus remote-control administration tab inside the dsh Web Settings surface: pairing-code creation, the paired-device list, device revocation, and kill-switch state. It talks to the Nexus bridge's `/nexus/admin/*` routes on the shared Web listener, so the browser never opens a second transport or stores pairing secrets — pairing codes are displayed once and kept only in the Host registry. The tab is mounted by the settings shell and reports bridge reachability and operator actions through the same page, giving the local operator a single place to manage which devices may command sessions.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

### Dev Note

The client bundle declares `dsh.client` with `platform: web` and injects `@deepseek-ai/dsh-client-locale` plus `@deepseek-ai/dsh-client-ui-settings`; the web-app bundle mounts it as the `ui-settings-nexus` plugin row. Administration requests carry the operator Bearer token, and the Host enforces the source network allowlist, so loopback Web access is the bootstrap path.

## Model Experience

None, as this package only renders Host administration controls and does not contribute model-visible input.

#### KV Cache effect

None; this package does not assemble or send model requests.

## Known Limitations and Deferred Work

- No runtime invariant companion is published: this package only contributes a browser Settings tab; the former empty `./invariant` stub was removed per the package invariant rules, and coverage lives in `tests/`.
- Remote administration still requires the Host-side Bearer token and source allowlist; local loopback Web access is the bootstrap path.
- Pairing codes are displayed once in the Settings page and are not persisted by the browser.
