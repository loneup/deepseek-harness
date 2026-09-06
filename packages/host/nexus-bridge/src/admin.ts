import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readJsonBody } from './http-body.ts'
import type { NexusHandshake } from './handshake.ts'

/** Persisted emergency-stop state. A malformed file is fail-closed. */
export interface KillSwitchSnapshot {
  readonly engaged: boolean
  readonly engagedAt: string | null
  readonly by: string | null
  readonly reason: string | null
  readonly releasedAt: string | null
}

interface AuditRecord {
  readonly seq: number
  readonly timestamp: string
  readonly actorType: 'host' | 'device' | 'bridge'
  readonly action: string
  readonly outcome?: 'ok' | 'denied' | 'error' | 'warn'
  readonly detail?: Record<string, unknown>
}

/** Small JSONL audit sink used by administrative state changes. */
export class NexusAuditLog {
  private seq = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath?: string) {}

  /** Load the last sequence number before serving requests. */
  async load(): Promise<void> {
    if (this.filePath === undefined) return
    try {
      const text = await readFile(this.filePath, 'utf8')
      const lines = text.trim().split('\n').filter(Boolean)
      const lastLine = lines[lines.length - 1]
      const last = lastLine === undefined ? undefined : JSON.parse(lastLine) as { seq?: unknown }
      if (typeof last?.seq === 'number' && Number.isSafeInteger(last.seq) && last.seq >= 0) this.seq = last.seq
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  /**
   * Append one redacted administrative record.
   * @param action - dotted action name (e.g. `device.revoked`).
   * @param detail - structured fields; sensitive keys are redacted.
   * @param outcome - record outcome (ok/denied/error/warn).
   */
  emit(action: string, detail: Record<string, unknown> = {}, outcome: AuditRecord['outcome'] = 'ok'): void {
    const record: AuditRecord = { seq: ++this.seq, timestamp: new Date().toISOString(), actorType: 'host', action, outcome, detail: redact(detail) }
    if (this.filePath === undefined) return
    const filePath = this.filePath
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true })
      await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
    })
  }

  /** Wait for queued writes (used by tests and orderly shutdown). */
  async flush(): Promise<void> { await this.queue }
}

/** Durable kill-switch state. Corrupt state is treated as engaged. */
export class NexusKillSwitch {
  private state: KillSwitchSnapshot = { engaged: false, engagedAt: null, by: null, reason: null, releasedAt: null }
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath?: string) {}

  /**
   * Copy the current kill-switch state for callers that must not observe later mutations.
   * @returns a copy of the current kill-switch state.
   */
  snapshot(): KillSwitchSnapshot { return { ...this.state } }

  /** Whether new turn execution must be rejected. */
  get engaged(): boolean { return this.state.engaged }

  /** Load persisted state, failing closed on malformed JSON. */
  async load(): Promise<void> {
    if (this.filePath === undefined) return
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<KillSwitchSnapshot>
      if (parsed.engaged === true && !parsed.releasedAt) {
        this.state = { engaged: true, engagedAt: parsed.engagedAt ?? new Date().toISOString(), by: parsed.by ?? 'unknown', reason: parsed.reason ?? null, releasedAt: null }
      } else {
        this.state = {
          engaged: false,
          engagedAt: parsed.engagedAt ?? null,
          by: parsed.by ?? null,
          reason: parsed.reason ?? null,
          releasedAt: parsed.releasedAt ?? null,
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.state = { engaged: true, engagedAt: new Date().toISOString(), by: 'corrupt-file', reason: 'kill-switch state unreadable', releasedAt: null }
    }
  }

  /**
   * Engage once; repeated calls preserve the original event.
   * @param by - actor engaging the switch.
   * @param reason - free-text reason recorded in the snapshot.
   * @returns the engaged snapshot.
   */
  async engage(by: string, reason: string | null): Promise<KillSwitchSnapshot> {
    if (!this.state.engaged) {
      this.state = { engaged: true, engagedAt: new Date().toISOString(), by, reason, releasedAt: null }
      await this.persist()
    }
    return this.snapshot()
  }

  /**
   * Release the stop state; idempotent.
   * @returns the released snapshot.
   */
  async release(): Promise<KillSwitchSnapshot> {
    if (this.state.engaged) {
      this.state = { ...this.state, engaged: false, releasedAt: new Date().toISOString() }
      await this.persist()
    }
    return this.snapshot()
  }

  private async persist(): Promise<void> {
    if (this.filePath === undefined) return
    const data = JSON.stringify(this.state, null, 2)
    const filePath = this.filePath
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true })
      const temp = `${filePath}.tmp`
      await writeFile(temp, data, 'utf8')
      await rename(temp, filePath)
    })
    await this.queue
  }
}

/**
 * Source and bearer-token gate for administrative routes.
 * @param req - incoming admin request.
 * @param token - configured admin bearer token ('' allows loopback only).
 * @param allowlist - IPv4 CIDR allowlist for remote sources.
 * @returns ok, or the rejection status and code.
 */
export function authorizeAdmin(
  req: IncomingMessage,
  token: string,
  allowlist: readonly string[],
): { ok: true } | { ok: false; status: number; code: string } {
  const source = normalizeAddress(req.socket.remoteAddress)
  if (!isAllowedAddress(source, allowlist)) return { ok: false, status: 403, code: 'source_not_allowed' }
  if (token === '') {
    if (isLoopback(source)) return { ok: true }
    return { ok: false, status: 401, code: 'admin_token_required' }
  }
  const value = req.headers.authorization
  const presented = typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : ''
  const expected = Buffer.from(token)
  const actual = Buffer.from(presented)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, status: 401, code: 'invalid_admin_token' }
  return { ok: true }
}

function normalizeAddress(value: string | undefined): string { return (value ?? '').replace(/^::ffff:/, '').toLowerCase() }
function isLoopback(value: string): boolean { return value === '127.0.0.1' || value === '::1' }

function isAllowedAddress(address: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return isLoopback(address)
  return allowlist.some(item => inCidr(address, item))
}

function inCidr(address: string, cidr: string): boolean {
  const [network, bitsText] = cidr.split('/')
  const bits = Number(bitsText)
  if (!network || !Number.isInteger(bits)) return false
  const value = ipv4(address); const base = ipv4(network)
  if (value === null || base === null || bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (value & mask) === (base & mask)
}

function ipv4(value: string): number | null {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part, index) => !Number.isInteger(part) || part < 0 || part > 255 || String(part) !== value.split('.')[index])) return null
  const [a, b, c, d] = parts
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null
  return (((a << 24) >>> 0) | (b << 16) | (c << 8) | d) >>> 0
}

function redact(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) result[key] = /token|secret|private|pairing|signature|nonce/i.test(key) ? '<redacted>' : item
  return result
}

/**
 * Write a JSON response.
 * @param res - admin response writer.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
export function sendAdmin(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/**
 * Parse a bounded JSON request body.
 * @param req - incoming admin request.
 * @returns the parsed object body.
 * @throws Error when the body exceeds 64 KiB or is not an object.
 */
export async function readAdminJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parsed = await readJsonBody(req, 64 * 1024)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('body must be an object')
  return parsed as Record<string, unknown>
}

/** Registry/device management route adapter. */
export class NexusAdminController {
  constructor(
    private readonly handshake: NexusHandshake,
    private readonly killSwitch: NexusKillSwitch,
    private readonly audit: NexusAuditLog,
    private readonly adminToken: string,
    private readonly allowlist: readonly string[],
    private readonly onRevoke?: (tokens: readonly string[]) => void,
  ) {}

  /**
   * Handle one admin route.
   * @param path - admin action name (e.g. `device.list`).
   * @param req - incoming request.
   * @param res - response writer.
   */
  async handle(path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = authorizeAdmin(req, this.adminToken, this.allowlist)
    if (!auth.ok) { sendAdmin(res, auth.status, { ok: false, error: auth.code }); return }
    try {
      if (path === 'device.list' && req.method === 'GET') { const devices = this.handshake.listDevices(); this.audit.emit('device.list', { count: devices.length }); sendAdmin(res, 200, { ok: true, devices }); return }
      if (path === 'pairing.create' && req.method === 'POST') { const result = await this.handshake.createPairingCode(); this.audit.emit('pairing.created', {}, 'ok'); sendAdmin(res, 'ok' in result && result.ok === true ? 200 : 503, result); return }
      if (path === 'device.revoke' && req.method === 'POST') {
        const body = await readAdminJson(req); const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
        if (deviceId === '') { sendAdmin(res, 400, { ok: false, error: 'device_id_required' }); return }
        const result = await this.handshake.revokeDevice(deviceId)
        if (result.ok) this.onRevoke?.(result.tokens)
        this.audit.emit('device.revoked', { deviceId, ...(result.ok ? { revokedAt: result.revokedAt } : {}) }, result.ok ? 'ok' : 'denied')
        sendAdmin(res, result.ok ? 200 : 404, result)
        return
      }
      if (path === 'killswitch.engage' && req.method === 'POST') {
        const body: Record<string, unknown> = await readAdminJson(req).catch(() => ({})); const reason = typeof body.reason === 'string' ? body.reason.slice(0, 256) : null
        const snapshot = await this.killSwitch.engage('host', reason); this.audit.emit('killswitch.engaged', { engagedAt: snapshot.engagedAt, reason }); sendAdmin(res, 200, { ok: true, ...snapshot }); return
      }
      if (path === 'killswitch.release' && req.method === 'POST') { const snapshot = await this.killSwitch.release(); this.audit.emit('killswitch.released', { releasedAt: snapshot.releasedAt }); sendAdmin(res, 200, { ok: true, ...snapshot }); return }
      if (path === 'killswitch.state' && req.method === 'GET') { sendAdmin(res, 200, { ok: true, ...this.killSwitch.snapshot() }); return }
      sendAdmin(res, 405, { ok: false, error: 'method_not_allowed' })
    } catch { this.audit.emit(`admin.${path}`, {}, 'error'); sendAdmin(res, 400, { ok: false, error: 'malformed_request' }) }
  }
}
