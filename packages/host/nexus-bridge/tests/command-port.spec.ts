/** S5 coverage: the command handler drives every Session/Subagent capability
 * through the `NexusDshPort` seam only, with exact request pass-through and
 * stable error codes. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { NexusKillSwitch } from '../src/admin.ts'
import { NexusCommandHandler } from '../src/command.ts'
import { FakePort, allowAllWorkspaces, callCommand, resolveClient } from './helpers.ts'
import { nexusSessionId } from '@deepseek-ai/dsh-host-nexus-compat'

const srcRoot = fileURLToPath(new URL('../src', import.meta.url))

function makeHandler(
  port: FakePort,
  options: {
    checkWorkspace?: (path: string) => Promise<{ ok: true } | { ok: false; reason: string }>
    killSwitch?: NexusKillSwitch
  } = {},
): NexusCommandHandler {
  return new NexusCommandHandler(
    port,
    resolveClient,
    options.checkWorkspace ?? allowAllWorkspaces,
    options.killSwitch,
  )
}

describe('session commands through the port', () => {
  it('session.list passes the requestId through and returns the port items', async () => {
    const port = new FakePort()
    port.listSessionsValue = {
      items: [{ sessionId: nexusSessionId('sess_listed'), updatedAt: 42, running: false, blank: true, cwd: '/tmp/w' }],
    }
    const { status, body } = await callCommand(makeHandler(port), 'req-list', 'session.list', { cursor: 'cur_1' })
    expect(status).toBe(200)
    expect(body).toEqual({
      type: 'command.response',
      requestId: 'req-list',
      ok: true,
      value: { items: [{ sessionId: 'sess_listed', updatedAt: 42, running: false, blank: true, cwd: '/tmp/w' }] },
    })
    expect(port.listSessionsCalls).toHaveLength(1)
    expect(port.listSessionsCalls[0]!.request).toEqual({ cursor: 'cur_1' })
  })

  it('session.create forwards cwd to the port and returns the created identity', async () => {
    const port = new FakePort()
    port.createSessionValue = { sessionId: nexusSessionId('sess_new'), agentPreset: 'default' }
    const { body } = await callCommand(makeHandler(port), 'req-create', 'session.create', { cwd: '/tmp/allowed' })
    expect(body).toEqual({
      type: 'command.response',
      requestId: 'req-create',
      ok: true,
      value: { sessionId: 'sess_new', agentPreset: 'default' },
    })
    expect(port.createSessionCalls).toHaveLength(1)
    expect(port.createSessionCalls[0]!.cwd).toBe('/tmp/allowed')
  })

  it('session.create keeps the workspace whitelist in front of the port', async () => {
    const port = new FakePort()
    const checkWorkspace = vi.fn(async (path: string) => path === '/tmp/allowed'
      ? { ok: true as const }
      : { ok: false as const, reason: 'outside_workspace_roots' })
    const handler = makeHandler(port, { checkWorkspace })
    const blocked = await callCommand(handler, 'req-blocked', 'session.create', { cwd: '/tmp/elsewhere' })
    expect(blocked.body.ok).toBe(false)
    expect((blocked.body.error as { code: string }).code).toBe('whitelist_blocked')
    expect(port.createSessionCalls).toHaveLength(0)
    const allowed = await callCommand(handler, 'req-allowed', 'session.create', { cwd: '/tmp/allowed' })
    expect(allowed.body.ok).toBe(true)
    expect(port.createSessionCalls).toHaveLength(1)
  })

  it('session.models returns the port catalog unchanged', async () => {
    const port = new FakePort()
    const { body } = await callCommand(makeHandler(port), 'req-models', 'session.models', { sessionId: 'sess_any' })
    expect(body).toEqual({
      type: 'command.response',
      requestId: 'req-models',
      ok: true,
      value: {
        default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        routableProviders: ['deepseek-official'],
        groups: [],
        failures: [],
      },
    })
  })

  it('session.selectModel forwards the session and model route to the port', async () => {
    const port = new FakePort()
    const { body } = await callCommand(makeHandler(port), 'req-select', 'session.selectModel', {
      sessionId: 'sess_route', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high',
    })
    expect(body).toEqual({
      type: 'command.response',
      requestId: 'req-select',
      ok: true,
      value: { selected: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    })
    expect(port.selectModelCalls[0]!.sessionId).toBe('sess_route')
    expect(port.selectModelCalls[0]!.provider).toBe('deepseek-official')
    expect(port.selectModelCalls[0]!.model).toBe('deepseek-v4-flash')
    expect(port.selectModelCalls[0]!.reasoningEffort).toBe('high')
  })
})

describe('turn commands through the port', () => {
  it.each([
    ['turn.start', 'queue'],
    ['turn.queue', 'queue'],
    ['turn.steer', 'steer'],
  ] as const)('%s delivers the prompt in %s mode with the wire requestId', async (method, mode) => {
    const port = new FakePort()
    const requestId = `req-${method}`
    const { body } = await callCommand(makeHandler(port), requestId, method, {
      sessionId: 'sess_turn', content: [{ type: 'text', text: 'hello' }],
    })
    expect(body).toEqual({ type: 'command.response', requestId, ok: true, value: { accepted: true } })
    expect(port.promptCalls).toHaveLength(1)
    expect(port.promptCalls[0]!.request.mode).toBe(mode)
    expect(port.promptCalls[0]!.request.requestId).toBe(requestId)
    expect(port.promptCalls[0]!.request.sessionId).toBe('sess_turn')
    expect(port.promptCalls[0]!.request.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('turn.cancel calls cancelSession with the session id', async () => {
    const port = new FakePort()
    const { body } = await callCommand(makeHandler(port), 'req-cancel', 'turn.cancel', { sessionId: 'sess_turn' })
    expect(body).toEqual({ type: 'command.response', requestId: 'req-cancel', ok: true, value: {} })
    expect(port.cancelSessionCalls).toEqual(['sess_turn'])
  })

  it('a structurally valid but textless prompt returns empty_prompt and never reaches the port', async () => {
    const port = new FakePort()
    const empty = await callCommand(makeHandler(port), 'req-empty', 'turn.start', {
      sessionId: 'sess_turn', content: [{ type: 'text', text: '   ' }],
    })
    expect(empty.body.ok).toBe(false)
    expect((empty.body.error as { code: string }).code).toBe('empty_prompt')
    expect(port.totalCalls).toBe(0)
    const blank = await callCommand(makeHandler(port), 'req-blank', 'turn.steer', {
      sessionId: 'sess_turn', content: '   ',
    })
    expect((blank.body.error as { code: string }).code).toBe('empty_prompt')
    expect(port.totalCalls).toBe(0)
  })

  it('structural prompt problems stay malformed', async () => {
    const port = new FakePort()
    const handler = makeHandler(port)
    const missingSession = await callCommand(handler, 'req-no-session', 'turn.start', { content: [{ type: 'text', text: 'hi' }] })
    expect((missingSession.body.error as { code: string }).code).toBe('malformed')
    const badContent = await callCommand(handler, 'req-bad-content', 'turn.queue', { sessionId: 'sess_turn', content: 42 })
    expect((badContent.body.error as { code: string }).code).toBe('malformed')
    const badImage = await callCommand(handler, 'req-bad-image', 'turn.start', {
      sessionId: 'sess_turn', content: [{ type: 'image', mediaType: 'image/heic', data: 'AA==' }],
    })
    expect((badImage.body.error as { code: string }).code).toBe('malformed')
    expect(port.totalCalls).toBe(0)
  })
})

describe('kill switch and dispatch', () => {
  it('an engaged kill switch rejects new turns before the port is touched', async () => {
    const port = new FakePort()
    const killSwitch = new NexusKillSwitch()
    await killSwitch.engage('tester', 'test')
    const { body } = await callCommand(makeHandler(port, { killSwitch }), 'req-kill', 'turn.start', {
      sessionId: 'sess_turn', content: [{ type: 'text', text: 'hello' }],
    })
    expect(body.ok).toBe(false)
    expect((body.error as { code: string }).code).toBe('kill_switch_engaged')
    expect(port.totalCalls).toBe(0)
  })

  it('an unknown method returns unknown_method', async () => {
    const port = new FakePort()
    const { body } = await callCommand(makeHandler(port), 'req-unknown', 'session.frobnicate', {})
    expect(body.ok).toBe(false)
    expect((body.error as { code: string }).code).toBe('unknown_method')
    expect(port.totalCalls).toBe(0)
  })

  it('connection.ping answers locally without touching the port', async () => {
    const port = new FakePort()
    const { body } = await callCommand(makeHandler(port), 'req-ping', 'connection.ping', {})
    expect(body).toEqual({ type: 'command.response', requestId: 'req-ping', ok: true, value: { pong: true } })
    expect(port.totalCalls).toBe(0)
  })
})

describe('bridge source stays free of dsh internal types', () => {
  const forbidden = [
    'SessionController',
    'SubagentRuntime',
    'SessionAddress',
    'SessionRequestId',
    'SubagentPromptRequestId',
    'RemoteError',
    'remoteErrorOf',
  ]

  for (const file of ['command.ts', 'index.ts']) {
    it(`keeps src/${file} free of dsh internal identifiers`, () => {
      const source = readFileSync(`${srcRoot}/${file}`, 'utf8')
      for (const name of forbidden) {
        expect(source.includes(name), `${file} must not mention ${name}`).toBe(false)
      }
    })
  }
})
