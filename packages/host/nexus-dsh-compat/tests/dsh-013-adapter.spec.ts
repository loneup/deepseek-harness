import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { Dsh013Adapter } from '../src/dsh-013-adapter.ts'
import { nexusPortErrorOf } from '../src/errors.ts'
import { nexusRequestId, nexusSessionId } from '../src/types.ts'

/** Construct a RemoteError with an arbitrary wire code (see errors.spec.ts). */
function remoteError(code: string, message = 'dsh diagnostic'): unknown {
  return Reflect.construct(RemoteError, [code, message, {}])
}

/** Minimal structural stand-in for the dsh SessionController. */
class FakeSessionController {
  readonly calls = new Map<string, unknown[]>()
  listResult: { items: unknown[] } = { items: [] }
  followFrame: Record<string, unknown> = {
    type: 'snapshot',
    header: { version: 2, id: 'sess_1', createdAt: 1, isSeeded: false },
    cursor: 100,
    records: [{ type: 'event', event: { type: 'turn/start', seq: 3, time: 1, data: { turn: 1 } } }],
    hasMore: false,
    projections: { asOfSeq: 100, values: {} },
  }
  pageResult: { records: unknown[]; hasMore: boolean } = {
    records: [{ type: 'event', event: { type: 'assistant/message', seq: 2, time: 1, data: {} } }],
    hasMore: true,
  }

  async list(request: unknown, signal: unknown) {
    this.calls.set('list', [request, signal])
    return this.listResult
  }

  async create(request: unknown) {
    this.calls.set('create', [request])
    return { sessionId: 'sess_new', agentPreset: 'standard' }
  }

  modelCatalog(...args: unknown[]) {
    this.calls.set('modelCatalog', args)
    return { default: { provider: 'deepseek', model: 'deepseek-chat' }, routableProviders: ['deepseek'], groups: [], failures: [] }
  }

  async selectModel(request: unknown) {
    this.calls.set('selectModel', [request])
    return { selected: { provider: 'deepseek', model: 'deepseek-reasoner' } }
  }

  async prompt(request: unknown, signal: unknown) {
    this.calls.set('prompt', [request, signal])
    if ((signal as AbortSignal | undefined)?.aborted === true) {
      throw remoteError('gateway/cancelled', 'request cancelled')
    }
    return { accepted: true }
  }

  cancel(...args: unknown[]) {
    this.calls.set('cancel', args)
    return { accepted: true }
  }

  async page(request: unknown, signal: unknown) {
    this.calls.set('page', [request, signal])
    return this.pageResult
  }

  async *follow(request: unknown, _signal: unknown): AsyncIterable<Record<string, unknown>> {
    this.calls.set('follow', [request])
    yield this.followFrame
  }
}

/** Minimal structural stand-in for the dsh SubagentRuntime. */
class FakeSubagentRuntime {
  readonly calls = new Map<string, unknown[]>()

  async remoteExportList(parentSessionId: unknown, signal: unknown) {
    this.calls.set('remoteExportList', [parentSessionId, signal])
    return {
      parentAvailable: true,
      entries: [
        { kind: 'child', id: 'sess_child', activity: 'running', hasChildren: false, mode: 'continuable', label: 'reviewer' },
        { kind: 'diagnostic', id: 'sess_broken', reason: 'corrupt' },
      ],
    }
  }

  async prompt(request: unknown, signal: unknown) {
    this.calls.set('prompt', [request, signal])
    return { messageId: 'msg_1' }
  }

  interruptByParent(...args: unknown[]) {
    this.calls.set('interruptByParent', args)
    return { accepted: true }
  }
}

function harness(): { adapter: Dsh013Adapter; controller: FakeSessionController; subagents: FakeSubagentRuntime } {
  const controller = new FakeSessionController()
  const subagents = new FakeSubagentRuntime()
  const adapter = new Dsh013Adapter({
    sessionController: controller as never,
    subagents: subagents as never,
  })
  return { adapter, controller, subagents }
}

const promptRequest = {
  requestId: nexusRequestId('req_1'),
  sessionId: nexusSessionId('sess_1'),
  mode: 'queue' as const,
  content: [{ type: 'text' as const, text: 'hello' }],
}

describe('Dsh013Adapter session calls', () => {
  it('calls sessionController.list with an empty request and the signal', async () => {
    const { adapter, controller } = harness()
    const signal = new AbortController().signal
    const value = await adapter.listSessions({}, signal)
    expect(controller.calls.get('list')).toEqual([{}, signal])
    expect(value.items).toEqual([])
  })

  it('forwards the list cursor unchanged', async () => {
    const { adapter, controller } = harness()
    await adapter.listSessions({ cursor: 'cur_9' })
    expect(controller.calls.get('list')?.[0]).toEqual({ cursor: 'cur_9' })
  })

  it('maps create parameters and the branded session id back', async () => {
    const { adapter, controller } = harness()
    const value = await adapter.createSession({ cwd: '/tmp', agentPreset: 'standard' })
    expect(controller.calls.get('create')).toEqual([{ cwd: '/tmp', agentPreset: 'standard' }])
    expect(value.sessionId).toBe('sess_new')
    expect(value.agentPreset).toBe('standard')
  })

  it('calls modelCatalog with no arguments', async () => {
    const { adapter, controller } = harness()
    const value = await adapter.getModelCatalog()
    expect(controller.calls.get('modelCatalog')).toEqual([])
    expect(value.default).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('passes provider, model, and optional reasoningEffort to selectModel', async () => {
    const { adapter, controller } = harness()
    await adapter.selectModel({ sessionId: nexusSessionId('sess_1'), provider: 'deepseek', model: 'deepseek-reasoner' })
    expect(controller.calls.get('selectModel')).toEqual([
      { sessionId: 'sess_1', provider: 'deepseek', model: 'deepseek-reasoner' },
    ])
    await adapter.selectModel({ sessionId: nexusSessionId('sess_1'), provider: 'deepseek', model: 'm', reasoningEffort: 'high' })
    expect(controller.calls.get('selectModel')?.[0]).toEqual({
      sessionId: 'sess_1', provider: 'deepseek', model: 'm', reasoningEffort: 'high',
    })
  })

  it('passes requestId, sessionId, mode, content, and signal to prompt', async () => {
    const { adapter, controller } = harness()
    const signal = new AbortController().signal
    const value = await adapter.prompt(promptRequest, signal)
    expect(controller.calls.get('prompt')).toEqual([{
      requestId: 'req_1',
      sessionId: 'sess_1',
      mode: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    }, signal])
    expect(value).toEqual({ accepted: true })
  })

  it('calls cancel with only the session request — never a signal', async () => {
    const { adapter, controller } = harness()
    const value = await adapter.cancelSession(nexusSessionId('sess_1'))
    expect(controller.calls.get('cancel')).toEqual([{ sessionId: 'sess_1' }])
    expect(controller.calls.get('cancel')).toHaveLength(1)
    expect(value).toEqual({ accepted: true })
  })

  it('reads the ordinary session history through the follow opening snapshot', async () => {
    const { adapter, controller } = harness()
    const page = await adapter.readHistory({
      address: { kind: 'session', sessionId: nexusSessionId('sess_1') },
      maxMessages: 50,
    })
    expect(controller.calls.get('follow')).toEqual([{
      address: { kind: 'session', sessionId: 'sess_1' },
      maxMessages: 50,
    }])
    expect(page.cursor).toBe(100)
    expect(page.hasMore).toBe(false)
    expect(page.records).toEqual([
      { type: 'event', event: { type: 'turn/start', seq: 3, time: 1, data: { turn: 1 } } },
    ])
  })

  it('pages an explicit beforeSeq window against the opening cursor and returns records', async () => {
    const { adapter, controller } = harness()
    const page = await adapter.readHistory({
      address: { kind: 'session', sessionId: nexusSessionId('sess_1') },
      beforeSeq: 90,
      maxMessages: 10,
    })
    const pageCall = controller.calls.get('page')!
    expect(pageCall[0]).toEqual({
      address: { kind: 'session', sessionId: 'sess_1' },
      throughSeq: 100,
      beforeSeq: 90,
      maxMessages: 10,
    })
    expect(pageCall[1]).toBeInstanceOf(AbortSignal)
    expect(page.records).toEqual([
      { type: 'event', event: { type: 'assistant/message', seq: 2, time: 1, data: {} } },
    ])
    expect(page.hasMore).toBe(true)
    expect(page.cursor).toBe(100)
  })

  it('maps an aborted prompt to host_cancelled', async () => {
    const { adapter } = harness()
    const controller = new AbortController()
    controller.abort()
    const error = await adapter.prompt(promptRequest, controller.signal).catch((cause: unknown) => cause)
    expect(nexusPortErrorOf(error)?.code).toBe('host_cancelled')
  })
})
