import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import BridgePlugin from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

class FakeWebServer {
  readonly routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>>()
  register(route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): void {
    if (route.kind === 'exact') this.routes.set(route.path, route.handler)
  }
}

function fakeReq(options: { method?: string; url?: string; body?: unknown } = {}): IncomingMessage {
  const chunks = options.body === undefined ? [] : [Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body))]
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on: (): void => {},
    off: (): void => {},
    once: (): void => {},
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  } as unknown as IncomingMessage
}

function fakeRes(): ServerResponse & { status: number | undefined; body: string } {
  const capture = { status: undefined as number | undefined, body: '' }
  return Object.assign(capture, {
    writeHead(status: number) { capture.status = status; return capture },
    write(chunk: string) { capture.body += chunk; return true },
    end(body?: string) { capture.body += body ?? '' },
  }) as never
}

class SseRecorder {
  readonly frames: Array<Record<string, unknown>> = []
  writable = true
  writeHead(): this { return this }
  // The real handler awaits `finish` after registering; a fake stream is
  // instantly finished, while `close` must never fire or the stream would be
  // torn down mid-test.
  on(event: string, callback: () => void): void { if (event === 'finish') callback() }
  off(): void {}
  once(event: string, callback: () => void): void { if (event === 'finish') callback() }
  end(): void { this.writable = false }
  write(chunk: string): boolean {
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ')) this.frames.push(JSON.parse(line.slice(6)) as Record<string, unknown>)
    }
    return true
  }
}

/** Full composition: pair, handshake, attach SSE, open a Nexus session. */
async function harness(): Promise<{
  ctx: Context
  webServer: FakeWebServer
  command: (method: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  sse: SseRecorder
}> {
  const ctx = new Context()
  contexts.push(ctx)
  const webServer = new FakeWebServer()
  const registryPath = join(mkdtempSync(join(tmpdir(), 'nexus-approval-')), 'devices.json')
  // The handshake loads its registry fail-loud, so the file must pre-exist.
  writeFileSync(registryPath, JSON.stringify({ devices: [], pairingCodes: [] }), 'utf8')
  ctx.reflect.provide('webServer', webServer)
  ctx.reflect.provide('nexusDsh', {
    adapterId: 'dsh-013',
    // session.open reads history through the port; an empty page suffices here.
    readHistory: async () => ({ records: [], hasMore: false, cursor: 0 }),
  })
  await ctx.plugin(BridgePlugin, {
    registryPath,
    challengeTtlMs: 60_000,
    workspaceRoots: [] as string[],
    killSwitchPath: '',
    auditPath: '',
    adminToken: '',
    adminAllowedNetworks: ['127.0.0.1/32'] as string[],
    enforcePreExecution: false,
    environment: '',
    channel: '',
    release: '',
  })

  const pairingRes = fakeRes()
  await webServer.routes.get('/nexus/pairing.create')!(fakeReq({ method: 'POST' }), pairingRes)
  const pairingCode = (JSON.parse(pairingRes.body) as { pairingCode: string }).pairingCode
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' })
  const publicKeyRawBase64 = Buffer.from(jwk.x as string, 'base64url').toString('base64')
  const registerRes = fakeRes()
  await webServer.routes.get('/device.register')!(fakeReq({ method: 'POST', body: { pairingCode, publicKey: publicKeyRawBase64 } }), registerRes)
  const deviceId = (JSON.parse(registerRes.body) as { deviceId: string }).deviceId
  const challengeRes = fakeRes()
  await webServer.routes.get('/nexus/handshake')!(fakeReq({
    method: 'POST',
    body: { type: 'handshake.hello', protocolVersion: 4, clientPlatform: 'ios', clientId: 'approval-settle', deviceId, capabilities: ['approval'] },
  }), challengeRes)
  const nonce = Buffer.from((JSON.parse(challengeRes.body) as { nonce: string }).nonce, 'base64')
  const welcomeRes = fakeRes()
  await webServer.routes.get('/nexus/handshake')!(fakeReq({
    method: 'POST',
    body: JSON.stringify({ type: 'handshake.auth_response', deviceId, signature: sign(null, nonce, privateKey).toString('base64') }),
  }), welcomeRes)
  const token = (JSON.parse(welcomeRes.body) as { channelToken: string }).channelToken

  const sse = new SseRecorder()
  await webServer.routes.get('/nexus/events')!(fakeReq({ url: `/nexus/events?token=${encodeURIComponent(token)}` }), sse as never)

  const command = async (method: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const res = fakeRes()
    await webServer.routes.get('/nexus/command')!(fakeReq({
      method: 'POST',
      body: { type: 'command.request', requestId: `req_${Math.random().toString(36).slice(2, 8)}`, method, payload, channelToken: token },
    }), res)
    return JSON.parse(res.body) as Record<string, unknown>
  }
  const opened = await command('session.open', { sessionId: 'sess_approval' })
  // Surface the real error body if the open fails instead of an opaque match failure.
  expect(opened, JSON.stringify(opened)).toMatchObject({ ok: true, value: { sessionId: 'sess_approval' } })
  return { ctx, webServer, command, sse }
}

/** Dispatch one approval ask with the runtime waterfall (test-side cast past the Scoped-Agent brand). */
function dispatchApproval(ctx: Context, ask: unknown): Promise<string> {
  type Waterfall = (
    carrier: unknown, event: 'approval/request', req: unknown, next: () => Promise<string>,
  ) => Promise<string>
  const waterfall = Reflect.get(ctx, 'waterfall') as Waterfall
  return waterfall.call(ctx, ask, 'approval/request', ask, () => Promise.resolve('unavailable'))
}

describe('approval respond settles a live bridge claim (positive path)', () => {
  it('publishes the card on the real approval/request waterfall and settles allowed-once through approval.respond', async () => {
    const { ctx, command, sse } = await harness()

    // One dsh approval ask, dispatched the way the host approval service does.
    const ask = {
      agent: { session: { id: 'sess_approval', snapshotEvents: () => [{ type: 'approval/asked', seq: 1, time: 1, data: { id: 'apr_live', toolName: 'bash', callId: 'call_1' } }] } },
      toolName: 'bash',
      callId: 'call_1',
      reason: 'run the cleanup command',
    }
    const answer = dispatchApproval(ctx, ask)

    // The card reaches the subscribed Nexus channel.
    await new Promise(resolve => setTimeout(resolve, 20))
    const card = sse.frames.map(frame => frame.payload as Record<string, unknown>)
      .find(payload => payload.kind === 'approval.requested')
    expect(card).toMatchObject({ kind: 'approval.requested', approvalId: 'apr_live', toolName: 'bash', toolCallId: 'call_1', reason: 'run the cleanup command' })

    // The Nexus client answers; the waterfall promise settles with the outcome.
    const responded = await command('approval.respond', { sessionId: 'sess_approval', approvalId: 'apr_live', outcome: 'allowed-once' })
    expect(responded).toMatchObject({ ok: true })
    await expect(answer).resolves.toBe('allowed-once')
  })

  it('settles a rejected outcome and leaves the next identical ask claimable', async () => {
    const { ctx, command, sse } = await harness()
    const askFactory = () => ({
      agent: { session: { id: 'sess_approval', snapshotEvents: () => [{ type: 'approval/asked', seq: 1, time: 1, data: { id: 'apr_live', toolName: 'bash', callId: 'call_1' } }] } },
      toolName: 'bash',
      callId: 'call_1',
      reason: 'run the cleanup command',
    })

    const first = dispatchApproval(ctx, askFactory())
    await new Promise(resolve => setTimeout(resolve, 20))
    const rejected = await command('approval.respond', { sessionId: 'sess_approval', approvalId: 'apr_live', outcome: 'rejected' })
    expect(rejected).toMatchObject({ ok: true })
    await expect(first).resolves.toBe('rejected')

    // A re-issued ask (new replay card) claims again instead of being stuck.
    const second = dispatchApproval(ctx, askFactory())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(sse.frames.filter(frame => (frame.payload as Record<string, unknown>).kind === 'approval.requested').length).toBeGreaterThanOrEqual(2)
    const answered = await command('approval.respond', { sessionId: 'sess_approval', approvalId: 'apr_live', outcome: 'allowed-once' })
    expect(answered).toMatchObject({ ok: true })
    await expect(second).resolves.toBe('allowed-once')
  })
})
