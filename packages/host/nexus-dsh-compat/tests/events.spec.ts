import { describe, expect, it } from 'vitest'
import { mapDshEvent } from '../src/dsh-013-adapter.ts'

describe('mapDshEvent known dsh events', () => {
  it('maps turn/start to turn.started', () => {
    expect(mapDshEvent({ type: 'turn/start', data: { turn: 3 } })).toEqual({ kind: 'turn.started', turn: 3 })
  })

  it('maps a text-delta assistant chunk to message.delta', () => {
    expect(mapDshEvent({ type: 'assistant/chunk', data: { turn: 1, step: 2, chunk: { type: 'text-delta', text: 'hi' } } }))
      .toEqual({ kind: 'message.delta', turn: 1, step: 2, text: 'hi' })
  })

  it('drops non-text assistant chunks', () => {
    expect(mapDshEvent({ type: 'assistant/chunk', data: { turn: 1, step: 2, chunk: { type: 'reasoning', text: 'x' } } }))
      .toBeUndefined()
    expect(mapDshEvent({ type: 'assistant/chunk', data: { turn: 1, step: 2 } })).toBeUndefined()
  })

  it('maps assistant/message to message.committed with joined text blocks', () => {
    expect(mapDshEvent({
      type: 'assistant/message',
      data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'a' }, { type: 'image', source: {} }, { type: 'text', text: 'b' }] } },
    })).toEqual({ kind: 'message.committed', turn: 1, step: 2, text: 'ab' })
  })

  it('maps turn/end completed to turn.completed', () => {
    expect(mapDshEvent({ type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } }))
      .toEqual({ kind: 'turn.completed', turn: 4 })
  })

  it('maps aborted, interrupted, and disposed turn ends to turn.cancelled', () => {
    for (const kind of ['aborted', 'interrupted', 'disposed']) {
      expect(mapDshEvent({ type: 'turn/end', data: { turn: 4, reason: { kind } } }))
        .toEqual({ kind: 'turn.cancelled', turn: 4 })
    }
  })

  it('maps turn/end error to turn.failed with a host_error code', () => {
    expect(mapDshEvent({ type: 'turn/end', data: { turn: 4, reason: { kind: 'error', error: { message: 'boom' } } } }))
      .toEqual({ kind: 'turn.failed', turn: 4, error: { code: 'host_error', message: 'boom' } })
    expect(mapDshEvent({ type: 'turn/end', data: { turn: 4, reason: { kind: 'error' } } }))
      .toEqual({ kind: 'turn.failed', turn: 4, error: { code: 'host_error', message: 'host error' } })
  })

  it('maps approval/decided outcomes to approval.resolved', () => {
    expect(mapDshEvent({ type: 'approval/decided', data: { id: 'apr_1', outcome: 'allowed-once' } }))
      .toEqual({ kind: 'approval.resolved', approvalId: 'apr_1', decision: 'allow' })
    expect(mapDshEvent({ type: 'approval/decided', data: { id: 'apr_1', outcome: 'rejected' } }))
      .toEqual({ kind: 'approval.resolved', approvalId: 'apr_1', decision: 'deny', cause: 'user_denied' })
    expect(mapDshEvent({ type: 'approval/decided', data: { id: 'apr_1', outcome: 'cancelled' } }))
      .toEqual({ kind: 'approval.resolved', approvalId: 'apr_1', decision: 'deny', cause: 'host_cancelled' })
    expect(mapDshEvent({ type: 'approval/decided', data: { id: 'apr_1', outcome: 'unavailable' } }))
      .toEqual({ kind: 'approval.resolved', approvalId: 'apr_1', decision: 'deny', cause: 'unavailable' })
    expect(mapDshEvent({ type: 'approval/decided', data: { id: 'apr_1', outcome: 'allowed-always' } }))
      .toBeUndefined()
  })

  it('maps tool/call to tool.started and tool/result to tool.result', () => {
    expect(mapDshEvent({ type: 'tool/call', data: { turn: 1, step: 1, callId: 'call_1', name: 'bash' } }))
      .toEqual({ kind: 'tool.started', turn: 1, step: 1, toolCallId: 'call_1', name: 'bash' })
    expect(mapDshEvent({
      type: 'tool/result',
      data: { turn: 1, step: 1, message: { source: { callId: 'call_1' }, isError: false } },
    })).toEqual({ kind: 'tool.result', turn: 1, step: 1, toolCallId: 'call_1', ok: true, output: '' })
    expect(mapDshEvent({
      type: 'tool/result',
      data: { turn: 1, step: 1, message: { source: { callId: 'call_1' }, isError: true } },
    })).toEqual({ kind: 'tool.result', turn: 1, step: 1, toolCallId: 'call_1', ok: false, output: '' })
    expect(mapDshEvent({ type: 'tool/result', data: { turn: 1, step: 1, isError: true } }))
      .toEqual({ kind: 'tool.result', turn: 1, step: 1, toolCallId: undefined, ok: false, output: '' })
  })
})

describe('mapDshEvent unknown and malformed events', () => {
  it('returns undefined for unknown event names', () => {
    expect(mapDshEvent({ type: 'workspace/compacted', data: {} })).toBeUndefined()
    expect(mapDshEvent({ type: 'future/event', data: { x: 1 } })).toBeUndefined()
  })

  it('returns undefined for malformed payloads instead of throwing', () => {
    expect(mapDshEvent({ type: 'assistant/chunk', data: 'not-an-object' })).toBeUndefined()
    expect(mapDshEvent({ type: 'turn/end', data: {} })).toBeUndefined()
    expect(mapDshEvent({ type: 'approval/decided', data: {} })).toBeUndefined()
  })
})
