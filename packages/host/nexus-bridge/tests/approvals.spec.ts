import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { NexusApprovals } from '../src/approvals.ts'
import type { ApprovalAskRequest } from '../src/approvals.ts'
import { NexusEventStreams } from '../src/stream.ts'

/** ServerResponse stand-in that records written frames without a socket. */
class FakeResponse {
  readonly writes: string[] = []
  writable = true
  end(): void { this.writable = false }
  write(chunk: string): boolean { this.writes.push(chunk); return true }
}

function harness() {
  const streams = new NexusEventStreams()
  const approvals = new NexusApprovals(streams)
  return { streams, approvals }
}

function askedEvent(id: string, toolName = 'bash', callId?: string): SessionEvent {
  return { type: 'approval/asked', seq: 1, time: 1, data: { id, toolName, ...(callId === undefined ? {} : { callId }) } } as unknown as SessionEvent
}

function decidedEvent(id: string): SessionEvent {
  return { type: 'approval/decided', seq: 2, time: 2, data: { id, outcome: 'allowed-once' } } as unknown as SessionEvent
}

function askRequest(
  sessionId: string,
  events: readonly SessionEvent[],
  options: { toolName?: string; callId?: string; signal?: AbortSignal } = {},
): ApprovalAskRequest {
  return {
    agent: { session: { id: sessionId, snapshotEvents: () => events } },
    toolName: options.toolName ?? 'bash',
    ...(options.callId === undefined ? {} : { callId: options.callId }),
    reason: 'needs approval',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
}

describe('NexusApprovals claim path', () => {
  it('publishes the approval card and claims the ask for a Nexus-opened session', async () => {
    const { streams, approvals } = harness()
    const res = new FakeResponse()
    const close = streams.open('tok', res as never)
    streams.subscribeSession('tok', 'sess_1')
    res.writes.length = 0

    const claimed = approvals.request(askRequest('sess_1', [askedEvent('apr_1')]))
    expect(claimed).toBeInstanceOf(Promise)
    const card = res.writes.map(frame => JSON.parse(frame.replace(/^data: |\\n$/g, '')) as Record<string, unknown>)
    expect(card).toHaveLength(1)
    expect(card[0]).toMatchObject({
      type: 'session.event',
      sessionId: 'sess_1',
      payload: { kind: 'approval.requested', approvalId: 'apr_1', toolName: 'bash', reason: 'needs approval' },
    })
    void close
  })

  it('delegates (null) for a session no Nexus channel has opened, after still publishing the card', () => {
    const { streams, approvals } = harness()
    streams.open('tok', new FakeResponse() as never)
    const claimed = approvals.request(askRequest('sess_web', [askedEvent('apr_1')]))
    expect(claimed).toBeNull()
    void streams
  })

  it('delegates when no unanswered ask matches the tool', () => {
    const { approvals } = harness()
    // The only ask was already decided.
    expect(approvals.request(askRequest('sess_1', [askedEvent('apr_1'), decidedEvent('apr_1')]))).toBeNull()
    // The ask belongs to a different tool.
    expect(approvals.request(askRequest('sess_1', [askedEvent('apr_1', 'write')], { toolName: 'bash' }))).toBeNull()
    // The session log has no asks at all.
    expect(approvals.request(askRequest('sess_1', []))).toBeNull()
  })

  it('separates asks by callId', () => {
    const { streams, approvals } = harness()
    openNexusSession(streams, 'sess_1')
    expect(approvals.request(askRequest('sess_1', [askedEvent('apr_1', 'bash', 'call_1')], { callId: 'call_2' }))).toBeNull()
    expect(approvals.request(askRequest('sess_1', [askedEvent('apr_1', 'bash', 'call_1')], { callId: 'call_1' }))).toBeInstanceOf(Promise)
  })
})

/** Open a stream and mark the session Nexus-owned, as session.open would. */
function openNexusSession(streams: NexusEventStreams, sessionId: string): FakeResponse {
  const res = new FakeResponse()
  streams.open('tok', res as never)
  streams.subscribeSession('tok', sessionId)
  res.writes.length = 0
  return res
}

describe('NexusApprovals settle path', () => {
  it('settles a claimed approval through respond and rejects a duplicate response', async () => {
    const { streams, approvals } = harness()
    openNexusSession(streams, 'sess_1')
    const claimed = approvals.request(askRequest('sess_1', [askedEvent('apr_1')]))
    expect(approvals.respond('sess_1', 'apr_1', 'allowed-once')).toBe(true)
    await expect(claimed).resolves.toBe('allowed-once')
    expect(approvals.respond('sess_1', 'apr_1', 'rejected')).toBe(false)
  })

  it('rejects a response whose session does not own the approval', async () => {
    const { streams, approvals } = harness()
    openNexusSession(streams, 'sess_1')
    const claimed = approvals.request(askRequest('sess_1', [askedEvent('apr_1')]))
    expect(approvals.respond('sess_other', 'apr_1', 'rejected')).toBe(false)
    expect(approvals.respond('sess_1', 'apr_unknown', 'rejected')).toBe(false)
    expect(approvals.respond('sess_1', 'apr_1', 'rejected')).toBe(true)
    await expect(claimed).resolves.toBe('rejected')
  })

  it('settles an aborted ask as cancelled', async () => {
    const { streams, approvals } = harness()
    openNexusSession(streams, 'sess_1')
    const signal = new AbortController()
    const claimed = approvals.request(askRequest('sess_1', [askedEvent('apr_1')], { signal: signal.signal }))
    signal.abort()
    await expect(claimed).resolves.toBe('cancelled')
    // The cancelled entry is gone: a later respond is a stale-card miss.
    expect(approvals.respond('sess_1', 'apr_1', 'allowed-once')).toBe(false)
  })

  it('keeps entries answerable across an SSE disconnect (registry outlives the stream)', async () => {
    const { streams, approvals } = harness()
    streams.open('tok', new FakeResponse() as never)
    streams.subscribeSession('tok', 'sess_1')
    const claimed = approvals.request(askRequest('sess_1', [askedEvent('apr_1')]))
    streams.endStreams(['tok'])
    expect(approvals.respond('sess_1', 'apr_1', 'allowed-once')).toBe(true)
    await expect(claimed).resolves.toBe('allowed-once')
  })
})
