/** S6 coverage: session.open replays history through the port before the
 * subscription anchor, unmapped events never advance the sequence, and a
 * reconnect receives the queued replay before any live event. */

import type { ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { NexusJournalEvent, NexusHistoryRecord } from '@deepseek-ai/dsh-host-nexus-compat'
import { NexusCommandHandler } from '../src/command.ts'
import { NexusEventStreams } from '../src/stream.ts'
import { FakePort, allowAllWorkspaces, callCommand, resolveClient } from './helpers.ts'

const HISTORY_RECORDS: readonly NexusHistoryRecord[] = [
  { type: 'event', event: { type: 'turn/start', seq: 1, time: 1, data: { turn: 3 } } },
  { type: 'event', event: { type: 'unknown/thing', seq: 2, time: 2, data: { internal: true } } },
  { type: 'event', event: { type: 'turn/end', seq: 3, time: 3, data: { reason: { kind: 'completed' }, turn: 3 } } },
]

/** A response recorder covering the `writable`/`write` face the stream registry uses. */
function fakeStreamRes(): { res: ServerResponse; chunks: string[] } {
  const chunks: string[] = []
  const res = {
    writable: true,
    write: (chunk: string) => { chunks.push(chunk) },
  } as unknown as ServerResponse
  return { res, chunks }
}

/** Parse the `data: ` SSE frames of one captured stream. */
function envelopes(chunks: readonly string[]): Array<Record<string, unknown>> {
  return chunks.filter(chunk => chunk.startsWith('data: ')).map(chunk => JSON.parse(chunk.slice('data: '.length)) as Record<string, unknown>)
}

function makeHandler(port: FakePort, streams: NexusEventStreams): NexusCommandHandler {
  return new NexusCommandHandler(
    port,
    resolveClient,
    allowAllWorkspaces,
    undefined,
    (token, sessionId, events) =>{  streams.replaySession(token, sessionId, events) },
    (token, sessionId) =>{  streams.subscribeSession(token, sessionId) },
  )
}

describe('session.open', () => {
  it('reads history through the port, replays it in order, then emits the anchor', async () => {
    const port = new FakePort()
    port.readHistoryValue = { records: [...HISTORY_RECORDS], hasMore: false, cursor: 3 }
    const streams = new NexusEventStreams()
    const callOrder: string[] = []
    const handler = new NexusCommandHandler(
      port,
      resolveClient,
      allowAllWorkspaces,
      undefined,
      (token, sessionId, events) => {
        callOrder.push('replay')
        streams.replaySession(token, sessionId, events)
      },
      (token, sessionId) => {
        callOrder.push('subscribe')
        streams.subscribeSession(token, sessionId)
      },
    )
    const { body } = await callCommand(handler, 'req-open', 'session.open', { sessionId: 'sess_open' })
    expect(body).toEqual({ type: 'command.response', requestId: 'req-open', ok: true, value: { sessionId: 'sess_open' } })
    // The history read goes through the port with the v4 window (50 events).
    expect(port.readHistoryCalls).toHaveLength(1)
    expect(port.readHistoryCalls[0]!.request.address).toEqual({ kind: 'session', sessionId: 'sess_open' })
    expect(port.readHistoryCalls[0]!.request.maxMessages).toBe(50)
    // History seeds first, anchor second.
    expect(callOrder).toEqual(['replay', 'subscribe'])
  })

  it('keeps history order, skips unmapped events in the sequence, and puts the anchor after the backlog', async () => {
    const port = new FakePort()
    port.readHistoryValue = { records: [...HISTORY_RECORDS], hasMore: false, cursor: 3 }
    const streams = new NexusEventStreams()
    const handler = makeHandler(port, streams)
    // The stream is already connected, so the replay and the anchor stream
    // live instead of queueing.
    const { res, chunks } = fakeStreamRes()
    const close = streams.open('tok_test', res)
    const { body } = await callCommand(handler, 'req-open', 'session.open', { sessionId: 'sess_open' })
    expect(body).toEqual({ type: 'command.response', requestId: 'req-open', ok: true, value: { sessionId: 'sess_open' } })

    const frames = envelopes(chunks)
    // turn/start → sequence 1; the unmapped event is dropped without
    // advancing; turn/end → sequence 2; the anchor closes the backlog.
    expect(frames.map(frame => (frame.payload as { kind: string }).kind)).toEqual([
      'turn.started', 'turn.completed', 'session.subscribed',
    ])
    expect(frames.map(frame => frame.sequence)).toEqual([1, 2, 3])
    expect((frames[2]!.payload as { lastSeq: number }).lastSeq).toBe(3)
    // No raw dsh journal event name ever reaches the wire.
    expect(JSON.stringify(frames)).not.toContain('turn/start')
    expect(JSON.stringify(frames)).not.toContain('unknown/thing')

    // Live events continue after the anchor with the next sequence.
    streams.publish('sess_open', { type: 'assistant/chunk', data: { turn: 3, step: 0, chunk: { type: 'text-delta', text: 'hi' } } })
    const live = envelopes(chunks).slice(3)
    expect(live).toHaveLength(1)
    expect((live[0]!.payload as { kind: string }).kind).toBe('message.delta')
    expect(live[0]!.sequence).toBe(4)
    close()
  })

  it('replays the queued backlog before live events on reconnect and never duplicates it', async () => {
    const port = new FakePort()
    port.readHistoryValue = { records: [...HISTORY_RECORDS], hasMore: false, cursor: 3 }
    const streams = new NexusEventStreams()
    const handler = makeHandler(port, streams)
    await callCommand(handler, 'req-open', 'session.open', { sessionId: 'sess_reconnect' })

    // First connection: the queued backlog flushes before anything else.
    const first = fakeStreamRes()
    const closeFirst = streams.open('tok_test', first.res)
    expect(envelopes(first.chunks).map(frame => (frame.payload as { kind: string }).kind)).toEqual([
      'turn.started', 'turn.completed', 'session.subscribed',
    ])
    closeFirst()

    // Between connections the queue is drained, not refilled by open alone.
    const second = fakeStreamRes()
    const closeSecond = streams.open('tok_test', second.res)
    expect(envelopes(second.chunks)).toEqual([])

    // A live event for a session the new stream has not subscribed yet is
    // not delivered (it still consumes the next sequence number, so the
    // reducer never sees a gap); after the client re-subscribes, the anchor
    // re-establishes the baseline and only then does the live event flow.
    streams.publish('sess_reconnect', { type: 'turn/end', data: { reason: { kind: 'completed' }, turn: 4 } })
    expect(envelopes(second.chunks)).toEqual([])
    streams.subscribeSession('tok_test', 'sess_reconnect')
    streams.publish('sess_reconnect', { type: 'turn/end', data: { reason: { kind: 'completed' }, turn: 4 } })
    const frames = envelopes(second.chunks)
    expect(frames.map(frame => (frame.payload as { kind: string }).kind)).toEqual(['session.subscribed', 'turn.completed'])
    expect(frames.map(frame => frame.sequence)).toEqual([5, 6])
    closeSecond()

    // Opening again without new replay state produces no history duplication.
    const third = fakeStreamRes()
    const closeThird = streams.open('tok_test', third.res)
    expect(envelopes(third.chunks)).toEqual([])
    closeThird()
  })

  it('surfaces a port failure as unknown_session without replaying or subscribing', async () => {
    const port = new FakePort()
    port.readHistoryValue = { records: [...HISTORY_RECORDS], hasMore: false, cursor: 3 }
    port.failWith = Object.assign(new Error('session not found'), {
      isNexusPortError: true as const, code: 'unknown_session',
    })
    const replayed: NexusJournalEvent[][] = []
    const handler = new NexusCommandHandler(
      port,
      resolveClient,
      allowAllWorkspaces,
      undefined,
      (_token, _sessionId, events) => { replayed.push([...events]) },
      () => { throw new Error('subscribe must not run after a failed open') },
    )
    const { body } = await callCommand(handler, 'req-open', 'session.open', { sessionId: 'sess_missing' })
    expect(body.ok).toBe(false)
    expect((body.error as { code: string }).code).toBe('unknown_session')
    expect(replayed).toHaveLength(0)
  })
})
