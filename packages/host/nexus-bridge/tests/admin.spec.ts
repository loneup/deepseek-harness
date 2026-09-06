import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { NexusAdminController, NexusAuditLog, NexusKillSwitch, authorizeAdmin } from '../src/admin.ts'
import { NexusHandshake } from '../src/handshake.ts'

function tempFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'nexus-admin-')), name)
}

function fakeReq(options: { method?: string; remoteAddress?: string; authorization?: string; body?: unknown } = {}): IncomingMessage {
  const chunks = options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body))]
  return {
    method: options.method ?? 'GET',
    headers: options.authorization === undefined ? {} : { authorization: options.authorization },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  } as unknown as IncomingMessage
}

function fakeRes(): ServerResponse & { status: number | undefined; body: string } {
  const capture = { status: undefined as number | undefined, body: '' }
  return Object.assign(capture, {
    writeHead(status: number) { capture.status = status; return capture },
    end(body?: string) { capture.body = body ?? '' },
  }) as never
}

describe('authorizeAdmin source and token gate', () => {
  it('authorizes loopback without a configured token', () => {
    expect(authorizeAdmin(fakeReq({ remoteAddress: '127.0.0.1' }), '', [])).toEqual({ ok: true })
    expect(authorizeAdmin(fakeReq({ remoteAddress: '::1' }), '', [])).toEqual({ ok: true })
  })

  it('gates remote sources: token required, then validated', () => {
    const remote = fakeReq({ remoteAddress: '10.1.2.3' })
    expect(authorizeAdmin(remote, '', ['10.0.0.0/8'])).toEqual({ ok: false, status: 401, code: 'admin_token_required' })
    expect(authorizeAdmin(remote, 'secret', ['10.0.0.0/8'] )).toEqual({ ok: false, status: 401, code: 'invalid_admin_token' })
    expect(authorizeAdmin(fakeReq({ remoteAddress: '10.1.2.3', authorization: 'Bearer secret' }), 'secret', ['10.0.0.0/8'])).toEqual({ ok: true })
  })

  it('rejects sources outside the CIDR allowlist even with a valid token', () => {
    expect(authorizeAdmin(fakeReq({ remoteAddress: '192.168.5.5', authorization: 'Bearer secret' }), 'secret', ['10.0.0.0/8']))
      .toEqual({ ok: false, status: 403, code: 'source_not_allowed' })
    expect(authorizeAdmin(fakeReq({ remoteAddress: '192.168.5.5' }), '', [])).toEqual({ ok: false, status: 403, code: 'source_not_allowed' })
  })
})

describe('NexusKillSwitch persistence', () => {
  it('persists engagement and reads it back into a fresh instance', async () => {
    const path = tempFile('kill-switch.json')
    const first = new NexusKillSwitch(path)
    await first.engage('host', 'drill')
    expect(first.engaged).toBe(true)

    const second = new NexusKillSwitch(path)
    await second.load()
    expect(second.engaged).toBe(true)
    expect(second.snapshot().reason).toBe('drill')
    await second.release()
    expect(second.snapshot().engaged).toBe(false)
    expect(second.snapshot().releasedAt).not.toBeNull()
  })

  it('fails closed on a corrupt state file', async () => {
    const path = tempFile('kill-switch-corrupt.json')
    writeFileSync(path, '{not json', 'utf8')
    const instance = new NexusKillSwitch(path)
    await instance.load()
    expect(instance.engaged).toBe(true)
    expect(instance.snapshot().by).toBe('corrupt-file')
  })
})

describe('NexusAdminController device lifecycle', () => {
  it('lists and revokes a registered device, forwarding its tokens to the revoke hook', async () => {
    const registryPath = tempFile('devices.json')
    writeFileSync(registryPath, JSON.stringify({ devices: [], pairingCodes: [] }), 'utf8')
    const handshake = new NexusHandshake(registryPath)
    await handshake.load()
    let revokedTokens: readonly string[] | undefined
    const audit = new NexusAuditLog(tempFile('audit.jsonl'))
    const admin = new NexusAdminController(handshake, new NexusKillSwitch(), audit, '', [], (tokens) => { revokedTokens = tokens })

    const pairing = await handshake.createPairingCode() as { ok: true; pairingCode: string }
    expect(pairing.ok).toBe(true)
    const registerRes = fakeRes()
    await handshake.handleDeviceRegister(fakeReq({ method: 'POST', body: { pairingCode: pairing.pairingCode, publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } }), registerRes)
    expect(JSON.parse(registerRes.body)).toMatchObject({ ok: true })

    const listRes = fakeRes()
    await admin.handle('device.list', fakeReq({ method: 'GET' }), listRes)
    expect(listRes.status).toBe(200)
    const devices = JSON.parse(listRes.body) as { devices: Array<{ deviceId: string }> }
    expect(devices.devices).toHaveLength(1)
    const deviceId = devices.devices[0]!.deviceId

    const revokeRes = fakeRes()
    await admin.handle('device.revoke', fakeReq({ method: 'POST', body: { deviceId } }), revokeRes)
    expect(revokeRes.status).toBe(200)
    expect(JSON.parse(revokeRes.body)).toMatchObject({ ok: true })
    expect(revokedTokens).toEqual([])
    await audit.flush()

    const relistRes = fakeRes()
    await admin.handle('device.list', fakeReq({ method: 'GET' }), relistRes)
    // The revoked device stays listed with its revocation recorded.
    const after = JSON.parse(relistRes.body) as { devices: Array<{ deviceId: string; revokedAt: string | null }> }
    expect(after.devices).toHaveLength(1)
    expect(after.devices[0]).toMatchObject({ deviceId, revokedAt: expect.any(String) as string })
  })

  it('writes redacted audit records for administrative actions', async () => {
    const auditPath = tempFile('audit.jsonl')
    const registryPath = tempFile('devices.json')
    writeFileSync(registryPath, JSON.stringify({ devices: [], pairingCodes: [] }), 'utf8')
    const handshake = new NexusHandshake(registryPath)
    await handshake.load()
    const audit = new NexusAuditLog(auditPath)
    const admin = new NexusAdminController(handshake, new NexusKillSwitch(), audit, '', [])

    const pairingRes = fakeRes()
    await admin.handle('pairing.create', fakeReq({ method: 'POST' }), pairingRes)
    await admin.handle('killswitch.engage', fakeReq({ method: 'POST', body: { reason: 'drill' } }), fakeRes())
    await audit.flush()

    const lines = readFileSync(auditPath, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { action: string; seq: number })
    expect(lines.map(line => line.action)).toEqual(['pairing.created', 'killswitch.engaged'])
    expect(lines.map(line => line.seq)).toEqual([1, 2])
    // Raw pairing codes never reach the audit file.
    expect(readFileSync(auditPath, 'utf8')).not.toContain((JSON.parse(pairingRes.body) as { pairingCode: string }).pairingCode)
  })

  it('rejects unknown admin paths with method_not_allowed', async () => {
    const admin = new NexusAdminController(new NexusHandshake(undefined), new NexusKillSwitch(), new NexusAuditLog(), '', [])
    const res = fakeRes()
    await admin.handle('not.a.route', fakeReq({ method: 'GET' }), res)
    expect(res.status).toBe(405)
  })
})
