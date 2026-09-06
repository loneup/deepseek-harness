import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { mapDshError } from '../src/dsh-013-adapter.ts'
import { NexusPortError, nexusPortErrorOf } from '../src/errors.ts'

/**
 * Construct a RemoteError with an arbitrary wire code, bypassing the branded
 * details typing: the mapping contract must hold for every code dsh may ship,
 * including codes this build's type map cannot name.
 */
function remoteError(code: string, message = 'dsh diagnostic', details: Record<string, unknown> = {}): unknown {
  return Reflect.construct(RemoteError, [code, message, details])
}

describe('mapDshError known codes', () => {
  const cases: readonly { readonly code: string; readonly expected: NexusPortError['code'] }[] = [
    { code: 'session/not-found', expected: 'unknown_session' },
    { code: 'gateway/bad-request', expected: 'malformed' },
    { code: 'gateway/cancelled', expected: 'host_cancelled' },
    { code: 'subagent/not-found', expected: 'unknown_subagent' },
    { code: 'subagent/unauthorized', expected: 'subagent_unauthorized' },
  ]

  for (const { code, expected } of cases) {
    it(`maps ${code} to ${expected}`, () => {
      const error = mapDshError(remoteError(code), 'fallback')
      expect(error.code).toBe(expected)
      expect(error.message).toBe('dsh diagnostic')
    })
  }
})

describe('mapDshError unknown and hostile failures', () => {
  it('maps an unknown RemoteError code to host_error with the fallback message', () => {
    const error = mapDshError(remoteError('gateway/internal', 'internal detail /Users/liyan/secret'), 'call failed')
    expect(error.code).toBe('host_error')
    expect(error.message).toBe('call failed')
    expect(error.message).not.toContain('secret')
  })

  it('maps a plain Error to host_error without leaking its message', () => {
    const error = mapDshError(new Error('EACCES: /Users/liyan/.ssh/id_ed25519'), 'call failed')
    expect(error.code).toBe('host_error')
    expect(error.message).toBe('call failed')
    expect(error.message).not.toContain('ssh')
    expect(error.cause).toBeDefined()
  })

  it('maps a thrown non-error value to host_error', () => {
    expect(mapDshError('string failure', 'call failed').code).toBe('host_error')
    expect(mapDshError(undefined, 'call failed').code).toBe('host_error')
  })

  it('recognizes a cross-realm RemoteError copy by its structural marker', () => {
    const foreign = {
      isDSHRemoteError: true as const,
      code: 'session/not-found',
      message: 'session not found',
      details: {},
    }
    expect(mapDshError(foreign, 'fallback').code).toBe('unknown_session')
  })

  it('preserves the cause chain for host-side diagnosis', () => {
    const cause = remoteError('session/not-found') as Error
    const error = mapDshError(cause, 'fallback')
    expect(error.cause).toBe(cause)
  })
})

describe('NexusPortError structural recognition', () => {
  it('is recognized across a structural copy', () => {
    const original = new NexusPortError('unknown_session', 'session not found')
    const copy = Object.assign({}, original)
    expect(nexusPortErrorOf(copy)?.code).toBe('unknown_session')
    expect(nexusPortErrorOf({ isNexusPortError: 'no' })).toBeUndefined()
    expect(nexusPortErrorOf(null)).toBeUndefined()
  })
})
