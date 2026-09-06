/**
 * Nexus Bridge route plugin for the dsh Web host: device pairing, the v4
 * handshake, authenticated Session/Subagent/turn/approval commands, the
 * `/nexus/events` SSE stream, environment-scoped health self-checks, and the
 * audited `/nexus/admin/*` surface. All dsh Session/Subagent capability is
 * reached through the stable `NexusDshPort` seam provided by
 * `@deepseek-ai/dsh-host-nexus-compat`.
 * @module @deepseek-ai/dsh-host-nexus-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution, PreToolDecision } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-host-nexus-compat'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { realpath } from 'node:fs/promises'
import { dirname, normalize, relative } from 'node:path'
import { NexusHandshake } from './handshake.ts'
import { NexusCommandHandler } from './command.ts'
import { NexusAdminController, NexusAuditLog, NexusKillSwitch } from './admin.ts'
import { NexusApprovals } from './approvals.ts'
import { validateEnvironmentIdentity } from './environment.ts'
import { PROTOCOL_VERSION } from './protocol.ts'
import { NexusEventStreams } from './stream.ts'
export {
  DEFAULT_ENVIRONMENT_CHANNELS,
  DEFAULT_ENVIRONMENT_PORTS,
  resolveNexusEnvironment,
  validateManifestForEnvironment,
} from './environment.ts'
export type { NexusEnvironment, NexusEnvironmentConfig, NexusPluginChannel } from './environment.ts'

/** Stable Cordis plugin name. */
export const name = 'nexus-bridge'

/** Required host services: route registration and the Nexus port seam. */
export const inject = ['webServer', 'nexusDsh']

/** Plugin configuration for the read-only Nexus device registry. */
export interface Config {
  /** Absolute path to Nexus `devices.json`; omitted means no device is paired. */
  registryPath: string
  /** Challenge lifetime in milliseconds. */
  challengeTtlMs: number
  /** Absolute workspace roots allowed for session creation; empty preserves unrestricted development mode. */
  workspaceRoots: string[]
  /** Durable kill-switch state file; empty disables persistence. */
  killSwitchPath: string
  /** Durable JSONL audit file; empty disables persistence. */
  auditPath: string
  /** Bearer token required for non-loopback administrative requests. */
  adminToken: string
  /** IPv4 CIDR allowlist for administrative requests (loopback is implicit). */
  adminAllowedNetworks: string[]
  /** Enable the Nexus policy gate on dsh's pre-execution waterfall. */
  enforcePreExecution: boolean
  /**
   * Explicit environment name (`beta` or `production`); empty preserves the
   * legacy unconfigured shape. Never inferred from the port.
   */
  environment: string
  /** Release channel served by this environment; must match {@link environment}. */
  channel: string
  /** Released software version reported by the health self-check. */
  release: string
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  registryPath: z.string().default(''),
  challengeTtlMs: z.natural().default(60_000),
  workspaceRoots: z.array(z.string()).default([]),
  killSwitchPath: z.string().default(''),
  auditPath: z.string().default(''),
  adminToken: z.string().default(''),
  adminAllowedNetworks: z.array(z.string()).default(['127.0.0.1/32', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10']),
  enforcePreExecution: z.boolean().default(true),
  environment: z.string().default(''),
  channel: z.string().default(''),
  release: z.string().default(''),
})

async function checkWorkspacePath(path: string, roots: readonly string[]): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (roots.length === 0) return { ok: true }
  if (path === '' || /[\u0000-\u001f\u007f]/.test(path)) return { ok: false, reason: 'invalid_workspace_path' }
  let candidate = path
  while (true) {
    try {
      const target = await realpath(candidate)
      for (const root of roots) {
        const rootReal = await realpath(root)
        const rel = relative(rootReal, target)
        if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && normalize(rel) !== '')) return { ok: true }
      }
      return { ok: false, reason: 'outside_workspace_roots' }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, reason: 'workspace_realpath_failed' }
      const parent = dirname(normalize(candidate))
      if (parent === candidate) return { ok: false, reason: 'workspace_not_found' }
      candidate = parent
    }
  }
}

/** Register the first shared-port Nexus route. */
export async function apply(
  ctx: Context,
  config: Config = {
    registryPath: '',
    challengeTtlMs: 60_000,
    workspaceRoots: [],
    killSwitchPath: '',
    auditPath: '',
    adminToken: '',
    adminAllowedNetworks: ['127.0.0.1/32', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'],
    enforcePreExecution: true,
    environment: '',
    channel: '',
    release: '',
  },
): Promise<void> {
  // Environment resolution is authoritative-by-name and fails loud: an invalid
  // name, a channel that contradicts the environment, or a port that belongs to
  // the other environment aborts composition before any route registers.
  if (config.environment !== '') {
    validateEnvironmentIdentity(config.environment, config.channel === '' ? undefined : config.channel, ctx.webServer.port)
  } else {
    // Legacy unconfigured start: allowed for local development, but the
    // supported entries are `pnpm run web:beta` / `web:production`.
    console.warn('[nexus-bridge] NEXUS_ENV is not set — booting the legacy unconfigured environment; use `pnpm run web:beta` or `web:production`')
  }
  const workspaceRoots = (config.workspaceRoots as string[] | undefined) ?? []
  const handshake = new NexusHandshake(config.registryPath === '' ? undefined : config.registryPath, config.challengeTtlMs)
  const killSwitch = new NexusKillSwitch(config.killSwitchPath === '' ? undefined : config.killSwitchPath)
  const audit = new NexusAuditLog(config.auditPath === '' ? undefined : config.auditPath)
  const streams = new NexusEventStreams()
  // Bridge-owned pending approvals, keyed by the audit approvalId. Entries
  // survive SSE disconnects so a replayed approval card stays answerable; the
  // ask's abort signal settles them as 'cancelled'.
  const approvals = new NexusApprovals(streams)
  const commands = new NexusCommandHandler(
    ctx.nexusDsh,
    token => handshake.getClient(token),
    path => checkWorkspacePath(path, workspaceRoots),
    killSwitch,
    (token, sessionId, events) => { streams.replaySession(token, sessionId, events) },
    (token, sessionId) => { streams.subscribeSession(token, sessionId) },
    (sessionId, approvalId, outcome) => approvals.respond(sessionId, approvalId, outcome),
  )
  ctx.on('session/event', (session, event) => {
    streams.publish(session.id, event)
  })
  if (config.enforcePreExecution) {
    ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
      const session = exec.agent?.session
      if (session === undefined) return next()
      // The gate replaces dsh's escalation flow (sandbox hint → retry with
      // sandbox_permissions → approval) with a hard deny, so it must only
      // cover sessions a Nexus channel owns; ordinary Web sessions keep the
      // host's approval UX the recorded snapshots assert.
      if (!streams.hasNexusSession(session.id)) return next()
      let preset: string | undefined
      const events = session.snapshotEvents()
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index] as SessionEvent
        if ((event as { type: string }).type !== 'permission/preset') continue
        const raw = event as unknown as { data?: Record<string, unknown> }
        const value = raw.data?.preset ?? raw.data?.permissionPreset ?? raw.data?.value
        if (typeof value === 'string') { preset = value; break }
      }
      if (preset !== 'read-only' && preset !== 'workspace-write') return next()
      const tool = exec.name.toLowerCase()
      const args = exec.arguments
      const directWrite = ['write', 'edit', 'notebookedit'].includes(tool)
      const command = typeof args === 'string' ? args : (typeof args === 'object' && args !== null && 'command' in args && typeof args.command === 'string' ? args.command : '')
      const shellWrite = (tool === 'bash' || tool === 'shell') && /(?:>|>>|\b(?:rm|mv|cp|mkdir|rmdir|touch|tee|chmod|chown|ln)\b)/i.test(command)
      if (!directWrite && !shellWrite) return next()
      if (preset === 'read-only') {
        const reason = 'This session is read-only (permissionPreset: read-only). Write operations are not allowed.'
        audit.emit('tool.blocked', { sessionId: session.id, tool: exec.name, reason: 'read_only' }, 'denied')
        return { kind: 'deny', reason }
      }
      const objectArgs = typeof args === 'object' && args !== null ? args as Record<string, unknown> : undefined
      // dsh's bash/fs tools own the one-shot escalation flow: they validate
      // `sandbox_permissions` + `justification`, ask the approval service, and
      // retry under the approved mode before executing. Nexus must not deny
      // that request at its outer observer, otherwise an explicit user
      // approval can never reach the real sandbox provider.
      const requestedSandboxMode = objectArgs?.sandbox_permissions
      const hasEscalationRequest = typeof requestedSandboxMode === 'string'
        && typeof objectArgs?.justification === 'string'
        && objectArgs.justification.trim() !== ''
      if (hasEscalationRequest) return next()
      const candidate = objectArgs !== undefined
        ? ['file_path', 'filePath', 'notebook_path', 'notebookPath', 'path'].map(key => typeof objectArgs[key] === 'string' ? objectArgs[key] : undefined).find(Boolean)
        : (/>>?\s*([^\s;&|<>]+)/.exec(command)?.[1])
      if (candidate === undefined || (workspaceRoots.length > 0 && !(await checkWorkspacePath(candidate, workspaceRoots)).ok)) {
        const reason = 'Path outside workspace boundaries (permissionPreset: workspace-write). The write target could not be determined.'
        audit.emit('tool.blocked', { sessionId: session.id, tool: exec.name, reason: 'outside_workspace', attemptedPath: candidate }, 'denied')
        return { kind: 'deny', reason }
      }
      return next()
    })
  }
  // Approval requests are a waterfall side channel rather than session events;
  // see `./approvals.ts` for the claim/settle boundary.
  ctx.on('approval/request', (request, next) => {
    const claimed = approvals.request(request)
    return claimed === null ? next() : claimed
  }, { prepend: true })
  await handshake.load()
  await killSwitch.load()
  await audit.load()
  const admin = new NexusAdminController(handshake, killSwitch, audit, config.adminToken, config.adminAllowedNetworks, (tokens) => {
    streams.endStreams(tokens)
  })
  // Startup self-check (additive fields; consumers assert only HTTP 200 +
  // `ok`): reports the environment identity and the bound compat adapter so a
  // composition that silently lost its provider, or booted in the wrong
  // environment, is diagnosable from the health route alone. Never carries
  // tokens, pairing codes, keys, or file paths.
  const nexusHealth = {
    ok: true,
    environment: config.environment === '' ? null : config.environment,
    port: ctx.webServer.port,
    channel: config.channel === '' ? null : config.channel,
    release: config.release === '' ? null : config.release,
    nexus: { port: true, adapter: ctx.nexusDsh.adapterId ?? null, protocolVersion: PROTOCOL_VERSION },
  }
  for (const path of ['/nexus/health', '/health'] as const) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(nexusHealth))
      },
    }), `nexus-bridge: ${path}`)
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/nexus/handshake',
    handler: (req, res) => handshake.handle(req, res),
  }), 'nexus-bridge: /nexus/handshake')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/nexus/device.register',
    handler: (req, res) => handshake.handleDeviceRegister(req, res),
  }), 'nexus-bridge: /nexus/device.register')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/device.register',
    handler: (req, res) => handshake.handleDeviceRegister(req, res),
  }), 'nexus-bridge: /device.register')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/nexus/pairing.create',
    handler: (req, res) => handshake.handlePairingCreate(req, res),
  }), 'nexus-bridge: /nexus/pairing.create')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/nexus/command',
    handler: (req, res) => commands.handle(req, res),
  }), 'nexus-bridge: /nexus/command')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/nexus/events',
    handler: async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      const token = new URL(req.url ?? '', 'http://127.0.0.1').searchParams.get('token')
      if (token === null || handshake.getClient(token) === undefined) { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unknown channelToken' })); return }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write(':ok\n\n')
      const close = streams.open(token, res)
      req.on('close', close)
      res.on('close', close)
      await new Promise<void>(resolve => res.on('finish', resolve))
    },
  }), 'nexus-bridge: /nexus/events')
  for (const [path] of [
    ['pairing.create', 'POST'], ['device.list', 'GET'], ['device.revoke', 'POST'], ['killswitch.engage', 'POST'], ['killswitch.release', 'POST'], ['killswitch.state', 'GET'],
  ] as const) {
    for (const prefix of ['/nexus/admin/', '/admin/']) {
      ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: `${prefix}${path}`,
        handler: (req, res) => admin.handle(path, req, res),
      }), `nexus-bridge: ${prefix}${path}`)
    }
  }
}

/** Default plugin export for Loader composition. */
export default { name, inject, apply }
