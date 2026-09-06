import { describe, expect, expectTypeOf, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NexusPortError, nexusPortErrorOf } from '../src/errors.ts'
import type { NexusDshPort } from '../src/port.ts'
import { nexusRequestId, nexusSessionId } from '../src/types.ts'
import type {
  NexusCancelValue, NexusHistoryRequest, NexusHistoryPage, NexusPromptRequest, NexusPromptValue, NexusRequestId,
  NexusSubagentInterruptReceipt, NexusSubagentPromptReceipt,
} from '../src/types.ts'

const srcRoot = fileURLToPath(new URL('../src', import.meta.url))

/** In-memory port that records every call so contracts assert exact pass-through. */
class RecordingPort implements NexusDshPort {
  readonly prompts: NexusPromptRequest[] = []
  readonly histories: NexusHistoryRequest[] = []

  async listSessions() {
    return { items: [] }
  }

  async createSession(request: { cwd: string }) {
    return { sessionId: nexusSessionId(`sess-${request.cwd}`) }
  }

  async getModelCatalog() {
    return { default: { provider: 'p', model: 'm' }, routableProviders: [], groups: [], failures: [] }
  }

  async selectModel(request: { sessionId: string; provider: string; model: string }) {
    return { selected: { provider: request.provider, model: request.model } }
  }

  async prompt(request: NexusPromptRequest): Promise<NexusPromptValue> {
    this.prompts.push(request)
    return { accepted: true }
  }

  async cancelSession(): Promise<NexusCancelValue> {
    return { accepted: true }
  }

  async readHistory(request: NexusHistoryRequest): Promise<NexusHistoryPage> {
    this.histories.push(request)
    return { records: [], hasMore: false, cursor: 7 }
  }

  async listSubagents() {
    return { parentAvailable: true, entries: [] }
  }

  async promptSubagent(request: { requestId: NexusRequestId }): Promise<NexusSubagentPromptReceipt> {
    return { accepted: true, messageId: `msg-${request.requestId}` }
  }

  async interruptSubagent(): Promise<NexusSubagentInterruptReceipt> {
    return { accepted: true }
  }
}

describe('nexus id brands', () => {
  it('rejects an empty session id', () => {
    expect(() => nexusSessionId('')).toThrow(RangeError)
  })

  it('rejects an empty request id', () => {
    expect(() => nexusRequestId('')).toThrow(RangeError)
  })

  it('brands non-empty ids without changing the value', () => {
    expect(nexusSessionId('sess_1')).toBe('sess_1')
    expect(nexusRequestId('req_1')).toBe('req_1')
  })
})

describe('NexusDshPort contract', () => {
  it('keeps the request id unchanged through prompt', async () => {
    const port = new RecordingPort()
    const request: NexusPromptRequest = {
      requestId: nexusRequestId('req_abc'),
      sessionId: nexusSessionId('sess_abc'),
      mode: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    }
    await port.prompt(request)
    expect(port.prompts).toHaveLength(1)
    expect(port.prompts[0]!.requestId).toBe('req_abc')
    expect(port.prompts[0]!.sessionId).toBe('sess_abc')
  })

  it('keeps queue and steer modes unchanged', async () => {
    const port = new RecordingPort()
    const base = { requestId: nexusRequestId('req_m'), sessionId: nexusSessionId('sess_m'), content: [] as const }
    await port.prompt({ ...base, mode: 'queue' })
    await port.prompt({ ...base, mode: 'steer' })
    expect(port.prompts.map(prompt => prompt.mode)).toEqual(['queue', 'steer'])
  })

  it('keeps history pagination fields unchanged', async () => {
    const port = new RecordingPort()
    const request: NexusHistoryRequest = {
      address: { kind: 'subagent', parentSessionId: nexusSessionId('sess_p'), childSessionId: nexusSessionId('sess_c'), mode: 'continuable' },
      beforeSeq: 42,
      maxMessages: 10,
    }
    const page = await port.readHistory(request)
    expect(port.histories).toHaveLength(1)
    expect(port.histories[0]!.beforeSeq).toBe(42)
    expect(port.histories[0]!.maxMessages).toBe(10)
    expect(page.cursor).toBe(7)
  })

  it('raises NexusPortError with a stable code', () => {
    const error = new NexusPortError('unknown_session', 'session not found')
    expect(error.code).toBe('unknown_session')
    expect(nexusPortErrorOf(error)?.code).toBe('unknown_session')
    expect(nexusPortErrorOf(new Error('plain'))).toBeUndefined()
    expect(nexusPortErrorOf(error)).toBeInstanceOf(Error)
  })
})

describe('public surface stays free of dsh internal types', () => {
  const forbidden = [
    'SessionController',
    'SubagentRuntime',
    'SessionAddress',
    'SessionRequestId',
    'SubagentPromptRequestId',
    'RemoteError',
    'SessionWireEvent',
  ]

  for (const file of ['types.ts', 'port.ts', 'errors.ts']) {
    it(`keeps ${file} free of dsh internal type names`, () => {
      const source = readFileSync(`${srcRoot}/${file}`, 'utf8')
      for (const name of forbidden) {
        expect(source.includes(name), `${file} must not mention ${name}`).toBe(false)
      }
    })
  }

  it('exposes the full port method set', () => {
    expectTypeOf<keyof Omit<NexusDshPort, 'adapterId'>>().toEqualTypeOf<
      | 'listSessions'
      | 'createSession'
      | 'getModelCatalog'
      | 'selectModel'
      | 'prompt'
      | 'cancelSession'
      | 'readHistory'
      | 'listSubagents'
      | 'promptSubagent'
      | 'interruptSubagent'
    >()
  })
})
