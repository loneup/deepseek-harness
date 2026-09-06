/** Shared fakes for the Nexus Bridge port-level suites: a recording
 * {@link NexusDshPort}, minimal HTTP stubs, and a command-call helper. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  NexusCancelValue, NexusCreateSessionRequest, NexusCreateSessionValue, NexusDshPort, NexusHistoryAddress,
  NexusHistoryPage, NexusModelCatalog, NexusPromptRequest, NexusPromptValue, NexusSelectModelRequest,
  NexusSelectModelValue, NexusSessionId, NexusSessionListRequest, NexusSessionListValue, NexusSubagentCatalog,
  NexusSubagentInterruptReceipt, NexusSubagentInterruptRequest, NexusSubagentPromptReceipt,
  NexusSubagentPromptRequest,
} from '@deepseek-ai/dsh-host-nexus-compat'
import { nexusSessionId } from '@deepseek-ai/dsh-host-nexus-compat'
import type { AuthenticatedClient } from '../src/handshake.ts'
import type { NexusCommandHandler } from '../src/command.ts'

/** One backwards-history read request; mirrors the unexported port request shape. */
interface FakeHistoryRequest {
  readonly address: NexusHistoryAddress
  readonly beforeSeq?: number
  readonly maxMessages?: number
}

/** Authenticated client handed back for every channel token under test. */
export const CLIENT: AuthenticatedClient = { deviceId: 'dev_test', clientId: 'ios-test', capabilities: ['streaming'] }

/** Resolve every channel token. */
export function resolveClient(): AuthenticatedClient {
  return CLIENT
}

/** Accept every workspace path. */
export function allowAllWorkspaces(): Promise<{ ok: true }> {
  return Promise.resolve({ ok: true })
}

/** Build one POST request whose body is the JSON encoding of `body`. */
export function mockRequest(body: unknown): IncomingMessage {
  const payload = Buffer.from(JSON.stringify(body))
  return {
    method: 'POST',
    [Symbol.asyncIterator]: async function* () { yield payload },
  } as unknown as IncomingMessage
}

/** Minimal response recorder covering the `writeHead`/`end` face the handler uses. */
export class MockResponse {
  status: number | undefined
  headers: Record<string, unknown> | undefined
  private bodyText = ''

  writeHead(status: number, headers?: Record<string, unknown>): void {
    this.status = status
    this.headers = headers
  }

  end(body?: string): void {
    if (typeof body === 'string') this.bodyText += body
  }

  /** The parsed JSON body (empty string responses fail loudly). */
  get json(): Record<string, unknown> {
    if (this.bodyText === '') throw new Error('response ended without a body')
    return JSON.parse(this.bodyText) as Record<string, unknown>
  }
}

/**
 * In-memory port that records every call so suites assert exact pass-through.
 * Set {@link failWith} to make every port method reject with that value.
 */
export class FakePort implements NexusDshPort {
  readonly listSessionsCalls: Array<{ request: NexusSessionListRequest; signal: AbortSignal | undefined }> = []
  readonly createSessionCalls: NexusCreateSessionRequest[] = []
  readonly selectModelCalls: NexusSelectModelRequest[] = []
  readonly promptCalls: Array<{ request: NexusPromptRequest; signal: AbortSignal | undefined }> = []
  readonly cancelSessionCalls: NexusSessionId[] = []
  readonly readHistoryCalls: Array<{ request: FakeHistoryRequest; signal: AbortSignal | undefined }> = []
  readonly listSubagentsCalls: NexusSessionId[] = []
  readonly promptSubagentCalls: Array<{ request: NexusSubagentPromptRequest; signal: AbortSignal | undefined }> = []
  readonly interruptSubagentCalls: NexusSubagentInterruptRequest[] = []

  listSessionsValue: NexusSessionListValue = { items: [] }
  createSessionValue: NexusCreateSessionValue = { sessionId: nexusSessionId('sess_created') }
  modelCatalogValue: NexusModelCatalog = {
    default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routableProviders: ['deepseek-official'],
    groups: [],
    failures: [],
  }
  selectModelValue: NexusSelectModelValue = { selected: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }
  promptValue: NexusPromptValue = { accepted: true }
  readHistoryValue: NexusHistoryPage = { records: [], hasMore: false, cursor: 0 }
  listSubagentsValue: NexusSubagentCatalog = { parentAvailable: true, entries: [] }
  promptSubagentValue: NexusSubagentPromptReceipt = { accepted: true, messageId: 'msg_sub_1' }
  interruptSubagentValue: NexusSubagentInterruptReceipt = { accepted: true }
  failWith: unknown

  /** Total number of port calls observed; zero proves a method stayed local. */
  get totalCalls(): number {
    return this.listSessionsCalls.length + this.createSessionCalls.length + this.selectModelCalls.length
      + this.promptCalls.length + this.cancelSessionCalls.length + this.readHistoryCalls.length
      + this.listSubagentsCalls.length + this.promptSubagentCalls.length + this.interruptSubagentCalls.length
  }

  async listSessions(request: NexusSessionListRequest, signal?: AbortSignal): Promise<NexusSessionListValue> {
    this.listSessionsCalls.push({ request, signal })
    this.maybeFail()
    return this.listSessionsValue
  }

  async createSession(request: NexusCreateSessionRequest): Promise<NexusCreateSessionValue> {
    this.createSessionCalls.push(request)
    this.maybeFail()
    return this.createSessionValue
  }

  async getModelCatalog(): Promise<NexusModelCatalog> {
    this.maybeFail()
    return this.modelCatalogValue
  }

  async selectModel(request: NexusSelectModelRequest): Promise<NexusSelectModelValue> {
    this.selectModelCalls.push(request)
    this.maybeFail()
    return this.selectModelValue
  }

  async prompt(request: NexusPromptRequest, signal?: AbortSignal): Promise<NexusPromptValue> {
    this.promptCalls.push({ request, signal })
    this.maybeFail()
    return this.promptValue
  }

  async cancelSession(sessionId: NexusSessionId): Promise<NexusCancelValue> {
    this.cancelSessionCalls.push(sessionId)
    this.maybeFail()
    return { accepted: true }
  }

  async readHistory(request: FakeHistoryRequest, signal?: AbortSignal): Promise<NexusHistoryPage> {
    this.readHistoryCalls.push({ request, signal })
    this.maybeFail()
    return this.readHistoryValue
  }

  async listSubagents(parentSessionId: NexusSessionId, _signal?: AbortSignal): Promise<NexusSubagentCatalog> {
    this.listSubagentsCalls.push(parentSessionId)
    this.maybeFail()
    return this.listSubagentsValue
  }

  async promptSubagent(request: NexusSubagentPromptRequest, signal?: AbortSignal): Promise<NexusSubagentPromptReceipt> {
    this.promptSubagentCalls.push({ request, signal })
    this.maybeFail()
    return this.promptSubagentValue
  }

  async interruptSubagent(request: NexusSubagentInterruptRequest): Promise<NexusSubagentInterruptReceipt> {
    this.interruptSubagentCalls.push(request)
    this.maybeFail()
    return this.interruptSubagentValue
  }

  private maybeFail(): void {
    if (this.failWith !== undefined) throw this.failWith
  }
}

/** Send one command request through the handler and return status plus parsed body. */
export async function callCommand(
  handler: NexusCommandHandler,
  requestId: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = new MockResponse()
  await handler.handle(
    mockRequest({ type: 'command.request', requestId, method, payload, channelToken: 'tok_test' }),
    res as unknown as ServerResponse,
  )
  return { status: res.status ?? -1, body: res.json }
}
