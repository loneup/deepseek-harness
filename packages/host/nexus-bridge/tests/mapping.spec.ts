import { describe, expect, it } from 'vitest'
import { NexusEventStreams } from '../src/stream.ts'

/** The parsed Nexus SSE envelope as the publish path writes it. */
interface Frame {
  protocolVersion: number
  type: string
  sessionId: string
  requestId: string | null
  sequence: number
  timestamp: number
  payload: Record<string, unknown>
}

class FakeResponse {
  readonly writes: string[] = []
  writable = true
  end(): void { this.writable = false }
  write(chunk: string): boolean { this.writes.push(chunk); return true }
}

function harness(): { streams: NexusEventStreams; res: FakeResponse; frames: () => Frame[] } {
  const streams = new NexusEventStreams()
  const res = new FakeResponse()
  streams.open('tok', res as never)
  streams.subscribeSession('tok', 'sess_1')
  res.writes.length = 0
  return { streams, res, frames: () => res.writes.map(frame => JSON.parse(frame.replace(/^data: /, '').trim()) as Frame) }
}

describe('bridge publish mapping (through the compat mapDshEvent)', () => {
  it('writes Nexus envelopes with contiguous sequence and no dsh event names', () => {
    const { streams, frames } = harness()
    streams.publish('sess_1', { type: 'turn/start', data: { turn: 1 } })
    streams.publish('sess_1', { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'hi' } } })
    streams.publish('sess_1', { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    const written = frames()
    expect(written.map(frame => frame.sequence)).toEqual([2, 3, 4])
    for (const frame of written) {
      expect(frame.protocolVersion).toBe(4)
      expect(frame.type).toBe('session.event')
      expect(frame.sessionId).toBe('sess_1')
      expect(frame.requestId).toBeNull()
      expect(typeof frame.timestamp).toBe('number')
      expect(frame.payload.kind).toBeDefined()
    }
    expect(written.map(frame => frame.payload.kind)).toEqual(['turn.started', 'message.delta', 'turn.completed'])
  })

  it('maps approval decisions to the resolved vocabulary without leaking dsh outcome strings', () => {
    const { streams, frames } = harness()
    streams.publish('sess_1', { type: 'approval/decided', data: { id: 'apr_1', outcome: 'rejected' } })
    streams.publish('sess_1', { type: 'approval/decided', data: { id: 'apr_2', outcome: 'cancelled' } })
    expect(frames().map(frame => frame.payload)).toEqual([
      { kind: 'approval.resolved', approvalId: 'apr_1', decision: 'deny', cause: 'user_denied' },
      { kind: 'approval.resolved', approvalId: 'apr_2', decision: 'deny', cause: 'host_cancelled' },
    ])
  })

  it('closes interrupted and disposed historical turns instead of leaving them running', () => {
    const { streams, frames } = harness()
    for (const kind of ['aborted', 'interrupted', 'disposed']) {
      streams.publish('sess_1', { type: 'turn/end', data: { turn: 9, reason: { kind } } })
      expect(frames().at(-1)).toMatchObject({ payload: { kind: 'turn.cancelled', turn: 9 } })
    }
  })

  it('emits tool facts without arguments or output content', () => {
    const { streams, frames } = harness()
    streams.publish('sess_1', { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call_1', name: 'bash', arguments: { command: 'rm -rf /' } } })
    streams.publish('sess_1', { type: 'tool/result', data: { turn: 1, step: 1, message: { source: { callId: 'call_1' }, content: 'secret output', isError: true } } })
    const [started, result] = frames() as unknown as [Frame, Frame]
    expect(started.payload).toEqual({ kind: 'tool.started', turn: 1, step: 1, toolCallId: 'call_1', name: 'bash' })
    expect(started.payload).not.toHaveProperty('arguments')
    expect(result.payload).toEqual({ kind: 'tool.result', turn: 1, step: 1, toolCallId: 'call_1', ok: false, output: '' })
    expect(JSON.stringify(frames())).not.toContain('rm -rf')
    expect(JSON.stringify(frames())).not.toContain('secret output')
  })

  it('drops unmapped events without writing a frame or advancing the sequence', () => {
    const { streams, frames } = harness()
    streams.publish('sess_1', { type: 'turn/start', data: { turn: 1 } })
    streams.publish('sess_1', { type: 'future/host/event', data: { internal: true } })
    streams.publish('sess_1', { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'reasoning', text: 'hidden' } } })
    streams.publish('sess_1', { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    const written = frames()
    expect(written).toHaveLength(2)
    expect(written.map(frame => frame.sequence)).toEqual([2, 3])
    expect(written.map(frame => frame.payload.kind)).toEqual(['turn.started', 'turn.completed'])
  })

  it('publishes manual payloads (approval cards) with the same envelope contract', () => {
    const { streams, frames } = harness()
    streams.publishPayload('sess_1', { kind: 'approval.requested', approvalId: 'apr_1', toolName: 'bash' })
    expect(frames()[0]).toMatchObject({
      protocolVersion: 4,
      type: 'session.event',
      sessionId: 'sess_1',
      requestId: null,
      sequence: 2,
      payload: { kind: 'approval.requested', approvalId: 'apr_1' },
    })
  })
})
