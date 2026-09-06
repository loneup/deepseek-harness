/** Nexus protocol v4 handshake over the dsh WebServer route. */

import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { readJsonBody } from './http-body.ts'
import { PROTOCOL_VERSION } from './protocol.ts'

const CHALLENGE_TTL_MS = 60_000
const NONCE_BYTES = 32
const SIGNATURE_BYTES = 64

/** One paired device row as persisted in the registry. */
export interface DeviceRecord {
  readonly deviceId: string
  readonly publicKey: string
  readonly registeredAt?: string
  readonly revokedAt?: string | null
}
interface PairingCodeRecord {
  readonly codeHash: string
  readonly createdAt?: string
  readonly used?: boolean
  readonly usedAt?: string | null
  readonly usedByDeviceId?: string | null
}
interface RegistryFile {
  readonly devices?: readonly DeviceRecord[]
  readonly pairingCodes?: readonly PairingCodeRecord[]
}
interface PendingChallenge {
  readonly nonce: Buffer
  readonly clientId: string
  readonly capabilities: readonly string[]
  readonly expiresAt: number
}

/** Authenticated client state owned by the Nexus data plane. */
export interface AuthenticatedClient {
  readonly deviceId: string
  readonly clientId: string
  readonly capabilities: readonly string[]
}

const KNOWN_CAPABILITIES = new Set(['streaming', 'approval', 'cancel', 'attachments', 'notifications'])
const PUBLIC_KEY_BYTES = 32
const PAIRING_CODE_BYTES = 32

const readJson = (req: IncomingMessage): Promise<unknown> => readJsonBody(req, 64 * 1024)

function reject(res: ServerResponse, reason: string, status = 401): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ type: 'handshake.reject', reason }))
}

/** Minimal v4 handshake owner used by the shared-port route. */
export class NexusHandshake {
  private readonly pending = new Map<string, PendingChallenge>()
  private readonly clients = new Map<string, AuthenticatedClient>()
  private devices = new Map<string, DeviceRecord>()
  private pairingCodes: PairingCodeRecord[] = []
  private writeQueue: Promise<void> = Promise.resolve()

  /** @param registryPath - Nexus `devices.json`; absent means no devices are paired. @param challengeTtlMs - challenge lifetime. */
  constructor(private readonly registryPath: string | undefined, private readonly challengeTtlMs = CHALLENGE_TTL_MS) {}

  /** Resolve a channel token issued by a successful handshake.
   * @param channelToken - Opaque token returned by the handshake.
   * @returns Authenticated client state, or undefined when the token is unknown.
   */
  getClient(channelToken: string): AuthenticatedClient | undefined {
    return this.clients.get(channelToken)
  }

  /**
   * Return device metadata without exposing public keys.
   * @returns every registered device row (revoked included, with revocation time).
   */
  listDevices(): Array<{ deviceId: string; registeredAt?: string; revokedAt?: string | null }> {
    return [...this.devices.values()].map(({ deviceId, registeredAt, revokedAt }) => ({
      deviceId,
      ...(registeredAt === undefined ? {} : { registeredAt }),
      revokedAt: revokedAt ?? null,
    }))
  }

  /** Revoke a device and invalidate all associated handshake state and channel tokens. */
  /**
   * Revoke one paired device and collect the channel tokens to invalidate.
   * @param deviceId - device to revoke.
   * @returns ok with the revoked time and tokens, or a typed failure.
   */
  async revokeDevice(deviceId: string): Promise<{ ok: true; revokedAt: string; tokens: string[] } | { ok: false; error: { code: 'unknown_device' | 'registry_write_failed'; message: string } }> {
    let result!: { ok: true; revokedAt: string; tokens: string[] } | { ok: false; error: { code: 'unknown_device' | 'registry_write_failed'; message: string } }
    this.writeQueue = this.writeQueue.then(async () => {
      const existing = this.devices.get(deviceId)
      if (existing === undefined) { result = { ok: false, error: { code: 'unknown_device', message: 'device does not exist' } }; return }
      if (existing.revokedAt !== undefined && existing.revokedAt !== null) {
        result = { ok: true, revokedAt: existing.revokedAt, tokens: [] }
        return
      }
      const revokedAt = new Date().toISOString()
      this.devices.set(deviceId, { ...existing, revokedAt })
      const tokens: string[] = []
      for (const [token, client] of this.clients) if (client.deviceId === deviceId) { this.clients.delete(token); tokens.push(token) }
      this.pending.delete(deviceId)
      try { await this.saveRegistry(); result = { ok: true, revokedAt, tokens } } catch {
        this.devices.set(deviceId, existing)
        result = { ok: false, error: { code: 'registry_write_failed', message: 'device registry could not be saved' } }
      }
    })
    await this.writeQueue
    return result
  }

  /** Load the public-key registry before serving requests. */
  async load(): Promise<void> {
    if (this.registryPath === undefined) return
    const raw = JSON.parse(await readFile(this.registryPath, 'utf8')) as RegistryFile
    this.devices = new Map((raw.devices ?? []).map(device => [device.deviceId, device]))
    this.pairingCodes = (raw.pairingCodes ?? []).map(code => ({
      ...code,
      used: code.used === true,
      usedAt: code.usedAt ?? null,
      usedByDeviceId: code.usedByDeviceId ?? null,
    }))
  }

  /** Handle a one-time pairing registration without exposing private material.
   * @param req - Incoming HTTP request.
   * @param res - Response writer.
   */
  async handleDeviceRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    let body: unknown
    try { body = await readJson(req) } catch { this.sendRegistration(res, { ok: false, error: { code: 'malformed', message: 'invalid JSON' } }, 400); return }
    if (!isRecord(body) || typeof body.pairingCode !== 'string' || typeof body.publicKey !== 'string') {
      this.sendRegistration(res, { ok: false, error: { code: 'malformed', message: 'pairingCode and publicKey are required' } }, 400); return
    }
    const result = await this.registerDevice(body.pairingCode, body.publicKey)
    this.sendRegistration(res, result)
  }

  /** Create a one-time pairing code for a local operator. */
  /**
   * Create a one-time pairing code for a local operator.
   * @param req - loopback request.
   * @param res - response writer.
   */
  async handlePairingCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    const remote = req.socket.remoteAddress
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      this.sendRegistration(res, { ok: false, error: { code: 'loopback_required', message: 'pairing creation is loopback-only' } }, 403); return
    }
    if (this.registryPath === undefined) { this.sendRegistration(res, { ok: false, error: { code: 'registry_unavailable', message: 'device registry is not configured' } }, 503); return }
    const result = await this.createPairingCode()
    this.sendRegistration(res, result)
  }

  /** Create a pairing code for an already-authorized administrator. */
  /**
   * Create a one-time pairing code.
   * @returns ok with the raw code (shown once to the operator), or a typed failure.
   */
  async createPairingCode(): Promise<object> {
    if (this.registryPath === undefined) return { ok: false, error: { code: 'registry_unavailable', message: 'device registry is not configured' } }
    const rawCode = randomBytes(PAIRING_CODE_BYTES)
    const codeHash = createHash('sha256').update(rawCode).digest('hex')
    this.pairingCodes.push({ codeHash, createdAt: new Date().toISOString(), used: false })
    await this.saveRegistry()
    return { ok: true, pairingCode: rawCode.toString('base64') }
  }

  private sendRegistration(res: ServerResponse, body: unknown, status = 200): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private async registerDevice(pairingCode: string, publicKey: string): Promise<object> {
    if (this.registryPath === undefined) return { ok: false, error: { code: 'registry_unavailable', message: 'device registry is not configured' } }
    const rawCode = decodeBase64(pairingCode)
    const rawKey = decodeBase64(publicKey)
    if (rawCode === null || rawCode.length !== PAIRING_CODE_BYTES) return { ok: false, error: { code: 'invalid_pairing_code', message: 'pairing code is invalid' } }
    if (rawKey === null || rawKey.length !== PUBLIC_KEY_BYTES) return { ok: false, error: { code: 'invalid_public_key', message: 'publicKey must be a 32-byte Ed25519 public key' } }
    let result!: object
    this.writeQueue = this.writeQueue.then(async () => {
      const hash = createHash('sha256').update(rawCode).digest('hex')
      const code = this.pairingCodes.find(item => item.codeHash === hash)
      if (code === undefined) { result = { ok: false, error: { code: 'invalid_pairing_code', message: 'pairing code does not exist' } }; return }
      if (code.used === true) { result = { ok: false, error: { code: 'pairing_code_used', message: 'pairing code has already been used' } }; return }
      let deviceId: string
      do { deviceId = `dev_${randomBytes(12).toString('base64url')}` } while (this.devices.has(deviceId))
      const registeredAt = new Date().toISOString()
      const device: DeviceRecord = { deviceId, publicKey: rawKey.toString('base64'), registeredAt, revokedAt: null }
      this.devices.set(deviceId, device)
      const index = this.pairingCodes.indexOf(code)
      this.pairingCodes[index] = { ...code, used: true, usedAt: registeredAt, usedByDeviceId: deviceId }
      try {
        await this.saveRegistry()
        result = { ok: true, deviceId }
      } catch {
        this.devices.delete(deviceId)
        this.pairingCodes[index] = code
        result = { ok: false, error: { code: 'registry_write_failed', message: 'device registry could not be saved' } }
      }
    })
    await this.writeQueue
    return result
  }

  private async saveRegistry(): Promise<void> {
    if (this.registryPath === undefined) return
    await mkdir(dirname(this.registryPath), { recursive: true })
    const tempPath = `${this.registryPath}.tmp`
    await writeFile(tempPath, JSON.stringify({ devices: [...this.devices.values()], pairingCodes: this.pairingCodes }, null, 2), 'utf8')
    await rename(tempPath, this.registryPath)
  }

  /**
   * Handle one POST `/nexus/handshake` request.
   * @param req - incoming HTTP request.
   * @param res - response writer.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    let body: unknown
    try { body = await readJson(req) } catch { reject(res, 'malformed', 400); return }
    if (!isRecord(body)) { reject(res, 'malformed', 400); return }
    if (body.type === 'handshake.hello') { this.handleHello(body, res); return }
    if (body.type === 'handshake.auth_response') { this.handleAuthResponse(body, res); return }
    reject(res, 'malformed', 400)
  }

  private handleHello(body: Record<string, unknown>, res: ServerResponse): void {
    if (body.protocolVersion !== undefined && body.protocolVersion !== PROTOCOL_VERSION) {
      reject(res, 'unsupported_protocol_version'); return
    }
    const { deviceId, clientId, capabilities } = body
    if (typeof deviceId !== 'string' || deviceId === '' || typeof clientId !== 'string' || clientId === ''
      || body.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(capabilities) || capabilities.some(value => typeof value !== 'string')) {
      reject(res, 'malformed', 400); return
    }
    const device = this.devices.get(deviceId)
    if (device === undefined) { reject(res, 'device_not_paired'); return }
    if (device.revokedAt !== undefined && device.revokedAt !== null) { reject(res, 'device_revoked'); return }
    const nonce = randomBytes(NONCE_BYTES)
    this.pending.set(deviceId, { nonce, clientId, capabilities, expiresAt: Date.now() + this.challengeTtlMs })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'handshake.challenge', nonce: nonce.toString('base64') }))
  }

  private handleAuthResponse(body: Record<string, unknown>, res: ServerResponse): void {
    const { deviceId, signature: signatureText } = body
    if (typeof deviceId !== 'string' || deviceId === '' || typeof signatureText !== 'string') {
      reject(res, 'malformed', 400); return
    }
    const pending = this.pending.get(deviceId)
    this.pending.delete(deviceId)
    const device = this.devices.get(deviceId)
    const signature = decodeBase64(signatureText)
    if (device === undefined || (device.revokedAt !== undefined && device.revokedAt !== null)
      || pending === undefined || pending.expiresAt <= Date.now()
      || signature === null || signature.length !== SIGNATURE_BYTES) { reject(res, 'invalid_signature'); return }
    try {
      const key = createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(device.publicKey, 'base64').toString('base64url') },
        format: 'jwk',
      })
      if (!cryptoVerify(null, pending.nonce, key, signature)) { reject(res, 'invalid_signature'); return }
    } catch { reject(res, 'invalid_signature'); return }
    const acceptedCapabilities = pending.capabilities.filter(capability => KNOWN_CAPABILITIES.has(capability))
    const channelToken = randomBytes(24).toString('base64url')
    this.clients.set(channelToken, { deviceId, clientId: pending.clientId, capabilities: acceptedCapabilities })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'handshake.welcome', protocolVersion: PROTOCOL_VERSION, clientId: pending.clientId,
      channelToken, acceptedCapabilities }))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null
  const decoded = Buffer.from(value, 'base64')
  return decoded.toString('base64') === value ? decoded : null
}
