import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import BridgePlugin from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Captured exact-route table standing in for the shared WebServer service. */
class FakeWebServer {
  port = 3000
  readonly routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>>()
  register(route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): void {
    if (route.kind === 'exact') this.routes.set(route.path, route.handler)
  }
}

function fakeReq(options: { method?: string; url?: string; body?: string } = {}): IncomingMessage {
  const chunks = options.body === undefined ? [] : [Buffer.from(options.body)]
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  } as unknown as IncomingMessage
}

function fakeRes(): ServerResponse & { status: number | undefined; body: string; head: Record<string, string> | undefined } {
  const capture = { status: undefined as number | undefined, body: '', head: undefined as Record<string, string> | undefined }
  return Object.assign(capture, {
    writeHead(status: number, headers?: Record<string, string>) { capture.status = status; capture.head = headers; return capture },
    write(chunk: string) { capture.body += chunk; return true },
    end(body?: string) { capture.body += body ?? '' },
  }) as never
}

async function harness(): Promise<{ ctx: Context; webServer: FakeWebServer }> {
  const ctx = new Context()
  contexts.push(ctx)
  const webServer = new FakeWebServer()
  ctx.reflect.provide('webServer', webServer)
  ctx.reflect.provide('nexusDsh', { adapterId: 'dsh-013' })
  await ctx.plugin(BridgePlugin)
  return { ctx, webServer }
}

describe('nexus-bridge composition', () => {
  it('registers the full Nexus route table on the shared WebServer', async () => {
    const { webServer } = await harness()
    for (const path of [
      '/nexus/health', '/health', '/nexus/handshake', '/nexus/device.register', '/device.register',
      '/nexus/pairing.create', '/nexus/command', '/nexus/events',
      '/nexus/admin/device.list', '/nexus/admin/device.revoke', '/nexus/admin/killswitch.engage',
      '/nexus/admin/killswitch.release', '/nexus/admin/killswitch.state',
    ]) {
      expect(webServer.routes.get(path), `${path} must be registered`).toBeInstanceOf(Function)
    }
  })

  it('serves the startup self-check on both health paths', async () => {
    const { webServer } = await harness()
    for (const path of ['/nexus/health', '/health']) {
      const res = fakeRes()
      await webServer.routes.get(path)!(fakeReq(), res)
      expect(res.status).toBe(200)
      // Unconfigured environment reports nulls (additive, backward compatible).
      expect(JSON.parse(res.body)).toEqual({
        ok: true,
        environment: null,
        port: 3000,
        channel: null,
        release: null,
        nexus: { port: true, adapter: 'dsh-013', protocolVersion: 4 },
      })
    }
  })

  it('reports the configured environment identity on the health self-check', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const webServer = new FakeWebServer()
    ctx.reflect.provide('webServer', webServer)
    ctx.reflect.provide('nexusDsh', { adapterId: 'dsh-013' })
    webServer.port = 3088
    await ctx.plugin(BridgePlugin, {
      registryPath: '',
      challengeTtlMs: 60_000,
      workspaceRoots: [],
      killSwitchPath: '',
      auditPath: '',
      adminToken: '',
      adminAllowedNetworks: ['127.0.0.1/32'],
      enforcePreExecution: false,
      environment: 'beta',
      channel: 'beta',
      release: '0.1.3-alpha.1',
    })
    const res = fakeRes()
    await webServer.routes.get('/nexus/health')!(fakeReq(), res)
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      environment: 'beta',
      port: 3088,
      channel: 'beta',
      release: '0.1.3-alpha.1',
      nexus: { port: true, adapter: 'dsh-013', protocolVersion: 4 },
    })
  })

  it('fails loud on a channel that contradicts the configured environment', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.reflect.provide('webServer', new FakeWebServer())
    ctx.reflect.provide('nexusDsh', { adapterId: 'dsh-013' })
    await expect(ctx.plugin(BridgePlugin, {
      registryPath: '',
      challengeTtlMs: 60_000,
      workspaceRoots: [],
      killSwitchPath: '',
      auditPath: '',
      adminToken: '',
      adminAllowedNetworks: ['127.0.0.1/32'],
      enforcePreExecution: false,
      environment: 'production',
      channel: 'beta',
      release: '',
    } satisfies Config)).rejects.toThrow(/contradicts the production environment/)
  })

  it('answers commands only for authenticated channels', async () => {
    const { webServer } = await harness()
    const res = fakeRes()
    await webServer.routes.get('/nexus/command')!(fakeReq({
      method: 'POST',
      body: JSON.stringify({ type: 'command.request', requestId: 'req_1', method: 'session.list', payload: {}, channelToken: 'bogus' }),
    }), res)
    expect(res.status).toBe(401)
    expect((JSON.parse(res.body) as { error: unknown }).error).toMatchObject({ code: 'unknown_client' })
  })

  it('rejects SSE streams with an unknown channel token', async () => {
    const { webServer } = await harness()
    const res = fakeRes()
    await webServer.routes.get('/nexus/events')!(fakeReq({ url: '/nexus/events?token=bogus' }), res)
    expect(res.status).toBe(403)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'unknown channelToken' })
  })

  it('keeps the kill switch disengaged by default so turns are not blocked', async () => {
    const { webServer } = await harness()
    const res = fakeRes()
    await webServer.routes.get('/nexus/admin/killswitch.state')!(fakeReq(), res)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, engaged: false })
  })
})
