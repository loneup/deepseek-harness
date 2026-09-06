/** S5/S7 coverage: subagent command parsing, pagination validation, response
 * shapes, and stable port error codes over the `NexusDshPort` seam. */

import { describe, expect, it } from 'vitest'
import { NexusPortError, nexusSessionId } from '@deepseek-ai/dsh-host-nexus-compat'
import { NexusCommandHandler } from '../src/command.ts'
import { FakePort, allowAllWorkspaces, callCommand, resolveClient } from './helpers.ts'

function makeHandler(port: FakePort): NexusCommandHandler {
  return new NexusCommandHandler(port, resolveClient, allowAllWorkspaces)
}

describe('subagent.list', () => {
  it('returns the port catalog entries unchanged', async () => {
    const port = new FakePort()
    port.listSubagentsValue = {
      parentAvailable: true,
      entries: [
        { kind: 'child', id: nexusSessionId('child_1'), activity: 'running', hasChildren: false, mode: 'continuable', label: '继续' },
        { kind: 'diagnostic', id: nexusSessionId('child_x'), reason: 'corrupt' },
      ],
    }
    const { body } = await callCommand(makeHandler(port), 'req-subs', 'subagent.list', { parentSessionId: 'parent_1' })
    expect(body).toEqual({
      type: 'command.response',
      requestId: 'req-subs',
      ok: true,
      value: {
        parentAvailable: true,
        entries: [
          { kind: 'child', id: 'child_1', activity: 'running', hasChildren: false, mode: 'continuable', label: '继续' },
          { kind: 'diagnostic', id: 'child_x', reason: 'corrupt' },
        ],
      },
    })
    expect(port.listSubagentsCalls).toEqual(['parent_1'])
  })

  it('requires parentSessionId', async () => {
    const port = new FakePort()
    const { body } = await callCommand(makeHandler(port), 'req-subs-bad', 'subagent.list', {})
    expect(body.ok).toBe(false)
    expect((body.error as { code: string }).code).toBe('malformed')
    expect(port.totalCalls).toBe(0)
  })
})

describe('subagent.history', () => {
  it('reads the subagent journal page through the port and returns its events', async () => {
    const port = new FakePort()
    const events = [
      { type: 'user/message', seq: 4, time: 4, data: { text: 'continue' } },
      { type: 'assistant/message', seq: 5, time: 5, data: { message: { content: [{ type: 'text', text: 'ok' }] } } },
    ]
    port.readHistoryValue = { records: events.map(event => ({ type: 'event' as const, event })), hasMore: false, cursor: 5 }
    const { body } = await callCommand(makeHandler(port), 'req-sub-hist', 'subagent.history', {
      parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'continuable', beforeSeq: 42, maxMessages: 10,
    })
    expect(body).toEqual({
      type: 'command.response',
      requestId: 'req-sub-hist',
      ok: true,
      value: { events },
    })
    expect(port.readHistoryCalls).toHaveLength(1)
    expect(port.readHistoryCalls[0]!.request.address).toEqual({
      kind: 'subagent', parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'continuable',
    })
    expect(port.readHistoryCalls[0]!.request.beforeSeq).toBe(42)
    expect(port.readHistoryCalls[0]!.request.maxMessages).toBe(10)
  })

  it('rejects a missing address, an unknown mode, and invalid pagination as malformed', async () => {
    const port = new FakePort()
    const handler = makeHandler(port)
    for (const [requestId, payload] of [
      ['req-no-parent', { childSessionId: 'child_1', mode: 'continuable' }],
      ['req-no-child', { parentSessionId: 'parent_1', mode: 'continuable' }],
      ['req-bad-mode', { parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'bogus' }],
      ['req-bad-before', { parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'continuable', beforeSeq: 0 }],
      ['req-bad-max', { parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'continuable', maxMessages: 1.5 }],
    ] as const) {
      const { body } = await callCommand(handler, requestId, 'subagent.history', payload)
      expect(body.ok, requestId).toBe(false)
      expect((body.error as { code: string }).code, requestId).toBe('malformed')
    }
    expect(port.totalCalls).toBe(0)
  })
})

describe('subagent.prompt', () => {
  it('delivers the text prompt to the continuable child and returns the receipt with messageId', async () => {
    const port = new FakePort()
    port.promptSubagentValue = { accepted: true, messageId: 'msg_sub_1' }
    const { body } = await callCommand(makeHandler(port), 'req-sub-prompt', 'subagent.prompt', {
      parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'continuable',
      content: [{ type: 'text', text: '请继续' }],
    })
    expect(body).toEqual({
      type: 'command.response',
      requestId: 'req-sub-prompt',
      ok: true,
      value: { accepted: true, messageId: 'msg_sub_1' },
    })
    expect(port.promptSubagentCalls).toHaveLength(1)
    expect(port.promptSubagentCalls[0]!.request.requestId).toBe('req-sub-prompt')
    expect(port.promptSubagentCalls[0]!.request.parentSessionId).toBe('parent_1')
    expect(port.promptSubagentCalls[0]!.request.childSessionId).toBe('child_1')
    expect(port.promptSubagentCalls[0]!.request.mode).toBe('continuable')
    expect(port.promptSubagentCalls[0]!.request.content).toEqual([{ type: 'text', text: '请继续' }])
  })

  it('keeps empty content, wrong mode, and missing address malformed', async () => {
    const port = new FakePort()
    const handler = makeHandler(port)
    const empty = await callCommand(handler, 'req-empty', 'subagent.prompt', {
      parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'continuable', content: [{ type: 'text', text: '   ' }],
    })
    expect((empty.body.error as { code: string }).code).toBe('malformed')
    const oneShot = await callCommand(handler, 'req-one-shot', 'subagent.prompt', {
      parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'one-shot', content: [{ type: 'text', text: 'go' }],
    })
    expect((oneShot.body.error as { code: string }).code).toBe('malformed')
    const noChild = await callCommand(handler, 'req-no-child', 'subagent.prompt', {
      parentSessionId: 'parent_1', mode: 'continuable', content: [{ type: 'text', text: 'go' }],
    })
    expect((noChild.body.error as { code: string }).code).toBe('malformed')
    expect(port.totalCalls).toBe(0)
  })

  it('maps port failures to their stable codes', async () => {
    const port = new FakePort()
    const handler = makeHandler(port)
    const payload = {
      parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'continuable', content: [{ type: 'text', text: 'go' }],
    }
    port.failWith = new NexusPortError('subagent_unauthorized', 'child is not continuable')
    const unauthorized = await callCommand(handler, 'req-unauth', 'subagent.prompt', payload)
    expect(unauthorized.body.ok).toBe(false)
    expect((unauthorized.body.error as { code: string }).code).toBe('subagent_unauthorized')
    port.failWith = new Error('unexpected host crash')
    const crash = await callCommand(handler, 'req-crash', 'subagent.prompt', payload)
    expect(crash.body.ok).toBe(false)
    expect((crash.body.error as { code: string }).code).toBe('host_error')
  })
})

describe('subagent.interrupt', () => {
  it('interrupts through the port under the durable parent address', async () => {
    const port = new FakePort()
    const { body } = await callCommand(makeHandler(port), 'req-sub-int', 'subagent.interrupt', {
      parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'continuable',
    })
    expect(body).toEqual({ type: 'command.response', requestId: 'req-sub-int', ok: true, value: {} })
    expect(port.interruptSubagentCalls).toHaveLength(1)
    expect(port.interruptSubagentCalls[0]).toEqual({
      parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'continuable',
    })
  })

  it('requires parentSessionId, childSessionId and mode=continuable', async () => {
    const port = new FakePort()
    const handler = makeHandler(port)
    const oneShot = await callCommand(handler, 'req-int-mode', 'subagent.interrupt', {
      parentSessionId: 'parent_1', childSessionId: 'child_1', mode: 'one-shot',
    })
    expect((oneShot.body.error as { code: string }).code).toBe('malformed')
    const noChild = await callCommand(handler, 'req-int-child', 'subagent.interrupt', {
      parentSessionId: 'parent_1', mode: 'continuable',
    })
    expect((noChild.body.error as { code: string }).code).toBe('malformed')
    expect(port.totalCalls).toBe(0)
  })
})
