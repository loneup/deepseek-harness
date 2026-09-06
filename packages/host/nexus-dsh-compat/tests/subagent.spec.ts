import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { Dsh013Adapter } from '../src/dsh-013-adapter.ts'
import { nexusPortErrorOf } from '../src/errors.ts'
import { nexusRequestId, nexusSessionId } from '../src/types.ts'

/** Construct a RemoteError with an arbitrary wire code (see errors.spec.ts). */
function remoteError(code: string, message: string, details: Record<string, unknown> = {}): unknown {
  return Reflect.construct(RemoteError, [code, message, details])
}

class FakeSubagentRuntime {
  readonly calls = new Map<string, unknown[]>()
  listResult: { parentAvailable: boolean; entries: unknown[] } = { parentAvailable: true, entries: [] }
  listError: unknown
  promptError: unknown
  interruptError: unknown

  async remoteExportList(parentSessionId: unknown, signal: unknown) {
    this.calls.set('remoteExportList', [parentSessionId, signal])
    if (this.listError !== undefined) throw this.listError
    return this.listResult
  }

  async prompt(request: unknown, signal: unknown) {
    this.calls.set('prompt', [request, signal])
    if (this.promptError !== undefined) throw this.promptError
    return { messageId: 'msg_1' }
  }

  interruptByParent(...args: unknown[]) {
    this.calls.set('interruptByParent', args)
    if (this.interruptError !== undefined) throw this.interruptError
    return { accepted: true }
  }
}

const emptyController = {} as object

function harness(runtime: FakeSubagentRuntime): Dsh013Adapter {
  return new Dsh013Adapter({
    sessionController: emptyController as never,
    subagents: runtime as never,
  })
}

const promptRequest = {
  requestId: nexusRequestId('req_sub_1'),
  parentSessionId: nexusSessionId('sess_parent'),
  childSessionId: nexusSessionId('sess_child'),
  mode: 'continuable' as const,
  content: [{ type: 'text' as const, text: 'continue the review' }],
}

describe('subagent.list through the adapter', () => {
  it('calls remoteExportList with the parent id and signal', async () => {
    const runtime = new FakeSubagentRuntime()
    runtime.listResult = {
      parentAvailable: true,
      entries: [{ kind: 'child', id: 'sess_child', activity: 'running', hasChildren: false, mode: 'continuable', label: 'reviewer' }],
    }
    const signal = new AbortController().signal
    const catalog = await harness(runtime).listSubagents(nexusSessionId('sess_parent'), signal)
    expect(runtime.calls.get('remoteExportList')).toEqual(['sess_parent', signal])
    expect(catalog.parentAvailable).toBe(true)
    expect(catalog.entries).toEqual([
      { kind: 'child', id: 'sess_child', activity: 'running', hasChildren: false, mode: 'continuable', label: 'reviewer' },
    ])
  })

  it('returns an empty catalog unchanged', async () => {
    const runtime = new FakeSubagentRuntime()
    const catalog = await harness(runtime).listSubagents(nexusSessionId('sess_parent'))
    expect(catalog).toEqual({ parentAvailable: true, entries: [] })
  })

  it('preserves diagnostic rows as-is', async () => {
    const runtime = new FakeSubagentRuntime()
    runtime.listResult = {
      parentAvailable: false,
      entries: [{ kind: 'diagnostic', id: 'sess_broken', reason: 'corrupt' }],
    }
    const catalog = await harness(runtime).listSubagents(nexusSessionId('sess_parent'))
    expect(catalog.entries).toEqual([{ kind: 'diagnostic', id: 'sess_broken', reason: 'corrupt' }])
    expect(catalog.parentAvailable).toBe(false)
  })

  it('maps a missing parent to unknown_session', async () => {
    const runtime = new FakeSubagentRuntime()
    runtime.listError = remoteError('session/not-found', 'session not found')
    const error = await harness(runtime).listSubagents(nexusSessionId('sess_missing')).catch((cause: unknown) => cause)
    expect(nexusPortErrorOf(error)?.code).toBe('unknown_session')
  })
})

describe('subagent.prompt through the adapter', () => {
  it('calls subagents.prompt with the branded request id and continuable mode', async () => {
    const runtime = new FakeSubagentRuntime()
    const signal = new AbortController().signal
    const receipt = await harness(runtime).promptSubagent(promptRequest, signal)
    expect(runtime.calls.get('prompt')).toEqual([{
      requestId: 'req_sub_1',
      parentSessionId: 'sess_parent',
      childSessionId: 'sess_child',
      mode: 'continuable',
      content: [{ type: 'text', text: 'continue the review' }],
    }, signal])
    expect(receipt).toEqual({ accepted: true, messageId: 'msg_1' })
  })

  it('keeps the request id stable across the call', async () => {
    const runtime = new FakeSubagentRuntime()
    await harness(runtime).promptSubagent(promptRequest)
    expect(runtime.calls.get('prompt')?.[0]).toMatchObject({ requestId: 'req_sub_1' })
  })

  it('maps an unauthorized child to subagent_unauthorized', async () => {
    const runtime = new FakeSubagentRuntime()
    runtime.promptError = remoteError('subagent/unauthorized', 'subagent does not belong to this parent', { childSessionId: 'sess_child' })
    const error = await harness(runtime).promptSubagent(promptRequest).catch((cause: unknown) => cause)
    expect(nexusPortErrorOf(error)?.code).toBe('subagent_unauthorized')
    expect((error as Error).message).toBe('subagent does not belong to this parent')
  })

  it('maps an unknown child to unknown_subagent', async () => {
    const runtime = new FakeSubagentRuntime()
    runtime.promptError = remoteError('subagent/not-found', 'subagent not found', {
      parentSessionId: 'sess_parent', childSessionId: 'sess_child',
    })
    const error = await harness(runtime).promptSubagent(promptRequest).catch((cause: unknown) => cause)
    expect(nexusPortErrorOf(error)?.code).toBe('unknown_subagent')
  })

  it('maps a one-shot child prompt refusal (not-resumable) to host_error', async () => {
    const runtime = new FakeSubagentRuntime()
    runtime.promptError = remoteError('subagent/not-resumable', 'subagent cannot take a continuation', { childSessionId: 'sess_child' })
    const error = await harness(runtime).promptSubagent(promptRequest).catch((cause: unknown) => cause)
    expect(nexusPortErrorOf(error)?.code).toBe('host_error')
  })

  it('maps an unavailable parent to host_error', async () => {
    const runtime = new FakeSubagentRuntime()
    runtime.promptError = remoteError('subagent/parent-unavailable', 'no live agent carries the parent', { parentSessionId: 'sess_parent' })
    const error = await harness(runtime).promptSubagent(promptRequest).catch((cause: unknown) => cause)
    expect(nexusPortErrorOf(error)?.code).toBe('host_error')
  })
})

describe('subagent.interrupt through the adapter', () => {
  it('calls interruptByParent with child, parent, and continuable', async () => {
    const runtime = new FakeSubagentRuntime()
    const receipt = await harness(runtime).interruptSubagent({
      parentSessionId: nexusSessionId('sess_parent'),
      childSessionId: nexusSessionId('sess_child'),
      mode: 'continuable',
    })
    expect(runtime.calls.get('interruptByParent')).toEqual(['sess_child', 'sess_parent', 'continuable'])
    expect(receipt).toEqual({ accepted: true })
  })

  it('accepts a repeated interrupt as a no-op receipt', async () => {
    const runtime = new FakeSubagentRuntime()
    const adapter = harness(runtime)
    await adapter.interruptSubagent({
      parentSessionId: nexusSessionId('sess_parent'),
      childSessionId: nexusSessionId('sess_child'),
      mode: 'continuable',
    })
    const receipt = await adapter.interruptSubagent({
      parentSessionId: nexusSessionId('sess_parent'),
      childSessionId: nexusSessionId('sess_child'),
      mode: 'continuable',
    })
    expect(receipt).toEqual({ accepted: true })
    expect(runtime.calls.get('interruptByParent')).toHaveLength(3)
  })

  it('maps an unauthorized interrupt to subagent_unauthorized', async () => {
    const runtime = new FakeSubagentRuntime()
    runtime.interruptError = remoteError('subagent/unauthorized', 'subagent does not belong to this parent', { childSessionId: 'sess_child' })
    const error = await harness(runtime).interruptSubagent({
      parentSessionId: nexusSessionId('sess_parent'),
      childSessionId: nexusSessionId('sess_other'),
      mode: 'continuable',
    }).catch((cause: unknown) => cause)
    expect(nexusPortErrorOf(error)?.code).toBe('subagent_unauthorized')
  })
})

describe('subagent history paging through the adapter', () => {
  it('builds the subagent SessionAddress internally and pages records', async () => {
    const followFrames = [{
      type: 'snapshot',
      header: { version: 2, id: 'sess_child', createdAt: 1, isSeeded: false },
      cursor: 55,
      records: [{ type: 'event', event: { type: 'message/user', seq: 50, time: 1, data: {} } }],
      hasMore: true,
      projections: { asOfSeq: 55, values: {} },
    }]
    const calls: unknown[][] = []
    const controller = {
      async *follow(request: unknown): AsyncIterable<Record<string, unknown>> {
        calls.push(['follow', request])
        yield followFrames[0]!
      },
      async page(request: unknown, signal: unknown) {
        calls.push(['page', request, signal])
        return {
          records: [{ type: 'event', event: { type: 'assistant/message', seq: 40, time: 1, data: {} } }],
          hasMore: true,
        }
      },
    }
    const adapter = new Dsh013Adapter({
      sessionController: controller as never,
      subagents: new FakeSubagentRuntime() as never,
    })
    const page = await adapter.readHistory({
      address: {
        kind: 'subagent',
        parentSessionId: nexusSessionId('sess_parent'),
        childSessionId: nexusSessionId('sess_child'),
        mode: 'continuable',
      },
      beforeSeq: 45,
      maxMessages: 20,
    })
    expect(calls[0]).toEqual(['follow', { address: { kind: 'subagent', parentSessionId: 'sess_parent', childSessionId: 'sess_child', mode: 'continuable' }, maxMessages: 20 }])
    expect(calls[1]?.[1]).toEqual({
      address: { kind: 'subagent', parentSessionId: 'sess_parent', childSessionId: 'sess_child', mode: 'continuable' },
      throughSeq: 55,
      beforeSeq: 45,
      maxMessages: 20,
    })
    expect(page.records).toEqual([
      { type: 'event', event: { type: 'assistant/message', seq: 40, time: 1, data: {} } },
    ])
    expect(page.cursor).toBe(55)
    expect(page.hasMore).toBe(true)
  })
})
