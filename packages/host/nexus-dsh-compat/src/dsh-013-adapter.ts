/**
 * dsh 0.1.3 adapter: implements {@link NexusDshPort} over the dsh
 * 0.1.3-alpha.1 `SessionController` and `SubagentRuntime` services.
 *
 * Every dsh-specific call, branded id cast, `SessionAddress` construction,
 * error recognition, and journal event mapping lives here. Public returns use
 * only the Nexus vocabulary of `./types.ts`; failures are raised as
 * `NexusPortError` through {@link mapDshError}. When dsh renames a method,
 * changes a signature, or reshapes an event, this file is the fix site.
 * @module
 */

import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type {
  SessionAddress, SessionCreateRequest, SessionFollowRequest, SessionListRequest, SessionListValue,
  SessionPageRequest, SessionPromptRequest, SessionRequestId, SessionSelectModelRequest,
  SessionSummary, SessionWireEvent,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SubagentRuntime, SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent'
import { NexusPortError } from './errors.ts'
import type { NexusPortErrorCode } from './errors.ts'
import type { NexusDshPort } from './port.ts'
import type {
  NexusCancelValue, NexusCreateSessionRequest, NexusCreateSessionValue, NexusHistoryAddress,
  NexusHistoryPage, NexusHistoryRequest, NexusJsonValue, NexusModelCatalog, NexusPromptRequest,
  NexusPromptValue, NexusRequestId, NexusSelectModelRequest, NexusSelectModelValue, NexusSessionId,
  NexusSessionListRequest, NexusSessionListValue, NexusSessionSummary, NexusSubagentCatalog,
  NexusSubagentInterruptReceipt, NexusSubagentInterruptRequest, NexusSubagentPromptReceipt,
  NexusSubagentPromptRequest,
} from './types.ts'

/** The dsh services one adapter instance is bound to at provider composition. */
export interface Dsh013Services {
  /** Host Session business API (dsh 0.1.3 `ctx.sessionController`). */
  readonly sessionController: SessionController
  /** Host Subagent runtime (dsh 0.1.3 `ctx.subagents`). */
  readonly subagents: SubagentRuntime
}

/**
 * Convert across the two id vocabularies. Both are opaque brand wrappers over
 * `string`, so the runtime value passes through unchanged; only the compile-time
 * brand name differs, which no structural conversion can express.
 */
function toDshSessionId(id: NexusSessionId): SessionId {
  return id as unknown as SessionId
}

/** Dual of {@link toDshSessionId}; see there for the cast rationale. */
function toNexusSessionId(id: SessionId): NexusSessionId {
  return id as unknown as NexusSessionId
}

/** Dual request-id conversion; see {@link toDshSessionId} for the cast rationale. */
function toDshRequestId(id: NexusRequestId): SessionRequestId {
  return id as unknown as SessionRequestId
}

/** Map one Nexus history address into the dsh SessionAddress vocabulary. */
function toDshAddress(address: NexusHistoryAddress): SessionAddress {
  if (address.kind === 'session') return { kind: 'session', sessionId: toDshSessionId(address.sessionId) }
  return {
    kind: 'subagent',
    parentSessionId: toDshSessionId(address.parentSessionId),
    childSessionId: toDshSessionId(address.childSessionId),
    mode: address.mode,
  }
}

/** Project one dsh Session list row into the Nexus vocabulary. */
function toNexusSummary(item: SessionSummary): NexusSessionSummary {
  return {
    updatedAt: item.updatedAt,
    running: item.running,
    blank: item.blank,
    ...(item.parentSessionId === undefined ? {} : { parentSessionId: toNexusSessionId(item.parentSessionId) }),
    ...(item.origin === undefined ? {} : { origin: item.origin }),
    ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
    ...(item.projections === undefined ? {} : { projections: item.projections as unknown as NexusJsonValue }),
    sessionId: toNexusSessionId(item.sessionId),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow one history record to its event entry. */
function isEventEntry(record: unknown): record is { readonly type: 'event'; readonly event: SessionWireEvent } {
  return isRecord(record) && record.type === 'event' && isRecord(record.event)
}

/** Carry one dsh wire event into the Nexus journal vocabulary. */
function toJournalEvent(event: SessionWireEvent): { type: string; seq: number; time: number; data: NexusJsonValue; ignorable?: true } {
  return {
    type: event.type,
    seq: event.seq,
    time: event.time,
    data: event.data,
    ...(event.ignorable === undefined ? {} : { ignorable: event.ignorable }),
  }
}

/**
 * Map one caught dsh failure to a stable {@link NexusPortError}.
 *
 * Recognition is structural via `remoteErrorOf`, never instanceof, so
 * cross-realm copies keep mapping. `host_error` replaces the original message
 * (internal dsh diagnostics stay host-side); every other dsh code keeps its
 * wire-sanitized message.
 * @param error - the caught value.
 * @param fallback - client-safe message used when the failure is not a dsh
 *   RemoteError or maps to `host_error`.
 * @returns the error to raise on the port.
 */
export function mapDshError(error: unknown, fallback: string): NexusPortError {
  const failure = remoteErrorOf(error)
  if (failure === undefined) return new NexusPortError('host_error', fallback, { cause: error })
  const code: NexusPortErrorCode =
    failure.code === 'session/not-found' ? 'unknown_session'
      : failure.code === 'gateway/bad-request' ? 'malformed'
        : failure.code === 'gateway/cancelled' ? 'host_cancelled'
          : failure.code === 'subagent/not-found' ? 'unknown_subagent'
            : failure.code === 'subagent/unauthorized' ? 'subagent_unauthorized'
              : 'host_error'
  return new NexusPortError(code, code === 'host_error' ? fallback : failure.message, { cause: error })
}

/**
 * Map one dsh Session event to a Nexus reducer payload, or undefined when the
 * event has no Nexus representation (which must not advance the Nexus
 * sequence). The mapping mirrors the vocabulary the Nexus v4 wire shipped:
 * turn lifecycle, message deltas, tool calls, and approval outcomes.
 * @param event - a durable dsh Session event.
 * @returns the Nexus payload, or undefined to drop the event.
 */
export function mapDshEvent(event: { readonly type: string; readonly data: unknown }): Record<string, unknown> | undefined {
  const data = isRecord(event.data) ? event.data : {}
  switch (event.type) {
    case 'turn/start': return { kind: 'turn.started', turn: data.turn }
    case 'assistant/chunk': {
      const chunk = isRecord(data.chunk) ? data.chunk : undefined
      if (chunk === undefined) return undefined
      return chunk.type === 'text-delta'
        ? { kind: 'message.delta', turn: data.turn, step: data.step, text: chunk.text }
        : undefined
    }
    case 'assistant/message': {
      const message = isRecord(data.message) ? data.message : undefined
      const content = Array.isArray(message?.content) ? message.content : undefined
      let text = ''
      if (content !== undefined) {
        text = content
          .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === 'text')
          .map(item => item.text)
          .join('')
      }
      return { kind: 'message.committed', turn: data.turn, step: data.step, text }
    }
    case 'approval/decided': {
      const outcome = data.outcome
      if (outcome === 'allowed-once') return { kind: 'approval.resolved', approvalId: data.id, decision: 'allow' }
      if (outcome === 'rejected' || outcome === 'cancelled' || outcome === 'unavailable') {
        const cause = outcome === 'rejected' ? 'user_denied' : outcome === 'cancelled' ? 'host_cancelled' : 'unavailable'
        return { kind: 'approval.resolved', approvalId: data.id, decision: 'deny', cause }
      }
      return undefined
    }
    case 'turn/end': {
      const reason = isRecord(data.reason) ? data.reason : undefined
      if (reason === undefined) return undefined
      const kind = reason.kind
      if (kind === 'completed') return { kind: 'turn.completed', turn: data.turn }
      // dsh persists interrupted turns (for example an approval timeout or
      // host shutdown) as a terminal event. Omitting this mapping leaves the
      // iOS reducer in `running` forever when the session is reopened.
      if (kind === 'aborted' || kind === 'interrupted' || kind === 'disposed') return { kind: 'turn.cancelled', turn: data.turn }
      if (kind === 'error') {
        const detail = isRecord(reason.error) ? reason.error : undefined
        return { kind: 'turn.failed', turn: data.turn, error: { code: 'host_error', message: detail?.message ?? 'host error' } }
      }
      return undefined
    }
    case 'tool/call': return { kind: 'tool.started', turn: data.turn, step: data.step, toolCallId: data.callId, name: data.name }
    case 'tool/result': {
      const message = isRecord(data.message) ? data.message : undefined
      const source = isRecord(message?.source) ? message.source : undefined
      const failed = message?.isError === true || data.isError === true
      return { kind: 'tool.result', turn: data.turn, step: data.step, toolCallId: source?.callId, ok: !failed, output: '' }
    }
    default: return undefined
  }
}

/** dsh 0.1.3-alpha.1 implementation of {@link NexusDshPort}. */
export class Dsh013Adapter implements NexusDshPort {
  /** Diagnostics identity surfaced by the health self-check. */
  readonly adapterId = 'dsh-013'

  /**
   * @param dsh - the dsh services to bind. The adapter holds no fallbacks:
   *   a missing service is a composition error, not a runtime branch.
   */
  constructor(private readonly dsh: Dsh013Services) {}

  /** @inheritDoc */
  async listSessions(request: NexusSessionListRequest, signal?: AbortSignal): Promise<NexusSessionListValue> {
    try {
      const dshRequest: SessionListRequest = { ...(request.cursor === undefined ? {} : { cursor: request.cursor }) }
      const value: SessionListValue = await this.dsh.sessionController.list(dshRequest, signal ?? new AbortController().signal)
      return { items: value.items.map(toNexusSummary) }
    } catch (error) {
      throw mapDshError(error, 'session.list failed')
    }
  }

  /** @inheritDoc */
  async createSession(request: NexusCreateSessionRequest): Promise<NexusCreateSessionValue> {
    try {
      const dshRequest: SessionCreateRequest = {
        cwd: request.cwd,
        ...(request.sessionId === undefined ? {} : { sessionId: toDshSessionId(request.sessionId) }),
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
      }
      const value = await this.dsh.sessionController.create(dshRequest)
      return {
        sessionId: toNexusSessionId(value.sessionId),
        ...(value.agentPreset === undefined ? {} : { agentPreset: value.agentPreset }),
      }
    } catch (error) {
      throw mapDshError(error, 'session.create failed')
    }
  }

  /** @inheritDoc */
  async getModelCatalog(): Promise<NexusModelCatalog> {
    try {
      return await this.dsh.sessionController.modelCatalog()
    } catch (error) {
      throw mapDshError(error, 'session.models failed')
    }
  }

  /** @inheritDoc */
  async selectModel(request: NexusSelectModelRequest): Promise<NexusSelectModelValue> {
    try {
      const dshRequest: SessionSelectModelRequest = {
        sessionId: toDshSessionId(request.sessionId),
        provider: request.provider,
        model: request.model,
        ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
      }
      return await this.dsh.sessionController.selectModel(dshRequest)
    } catch (error) {
      throw mapDshError(error, 'session.selectModel failed')
    }
  }

  /** @inheritDoc */
  async prompt(request: NexusPromptRequest, signal?: AbortSignal): Promise<NexusPromptValue> {
    try {
      const dshRequest: SessionPromptRequest = {
        requestId: toDshRequestId(request.requestId),
        sessionId: toDshSessionId(request.sessionId),
        mode: request.mode,
        content: request.content,
      }
      return await this.dsh.sessionController.prompt(dshRequest, signal ?? new AbortController().signal)
    } catch (error) {
      throw mapDshError(error, 'turn.start failed')
    }
  }

  /** @inheritDoc */
  async cancelSession(sessionId: NexusSessionId): Promise<NexusCancelValue> {
    try {
      return await Promise.resolve(this.dsh.sessionController.cancel({ sessionId: toDshSessionId(sessionId) }))
    } catch (error) {
      throw mapDshError(error, 'turn.cancel failed')
    }
  }

  /**
   * Read one backwards page of a Session or Subagent journal.
   *
   * dsh `page` cuts its window at an inclusive `throughSeq` cursor, so a
   * literal `-1` pages an empty log; the cursor comes from the follow opening
   * frame, which carries it and the latest message-aligned records in one
   * read. Without `beforeSeq` the opening records are the answer; with it the
   * requested window is paged against the opening cursor.
   */
  async readHistory(request: NexusHistoryRequest, signal?: AbortSignal): Promise<NexusHistoryPage> {
    const carrier = signal ?? new AbortController().signal
    try {
      const followRequest: SessionFollowRequest = {
        address: toDshAddress(request.address),
        ...(request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages }),
      }
      let cursor = 0
      let openingRecords: readonly SessionWireEvent[] = []
      let hasMore = false
      for await (const frame of this.dsh.sessionController.follow(followRequest, carrier)) {
        if (frame.type !== 'snapshot') break
        cursor = frame.cursor
        openingRecords = frame.records.filter(isEventEntry).map(record => record.event)
        hasMore = frame.hasMore
        break
      }
      if (request.beforeSeq === undefined) {
        return { records: openingRecords.map(event => ({ type: 'event' as const, event: toJournalEvent(event) })), hasMore, cursor }
      }
      const pageRequest: SessionPageRequest = {
        address: toDshAddress(request.address),
        throughSeq: cursor,
        beforeSeq: request.beforeSeq,
        ...(request.maxMessages === undefined ? {} : { maxMessages: request.maxMessages }),
      }
      const page = await this.dsh.sessionController.page(pageRequest, carrier)
      return {
        records: page.records.filter(isEventEntry).map(record => ({ type: 'event' as const, event: toJournalEvent(record.event) })),
        hasMore: page.hasMore,
        cursor,
      }
    } catch (error) {
      throw mapDshError(error, 'history read failed')
    }
  }

  /** @inheritDoc */
  async listSubagents(parentSessionId: NexusSessionId, signal?: AbortSignal): Promise<NexusSubagentCatalog> {
    try {
      const catalog = await this.dsh.subagents.remoteExportList(toDshSessionId(parentSessionId), signal ?? new AbortController().signal)
      return {
        parentAvailable: catalog.parentAvailable,
        entries: catalog.entries.map(entry => ({ ...entry, id: toNexusSessionId(entry.id) })),
      }
    } catch (error) {
      throw mapDshError(error, 'subagent.list failed')
    }
  }

  /** @inheritDoc */
  async promptSubagent(request: NexusSubagentPromptRequest, signal?: AbortSignal): Promise<NexusSubagentPromptReceipt> {
    try {
      const receipt = await this.dsh.subagents.prompt({
        requestId: request.requestId as unknown as SubagentPromptRequestId,
        parentSessionId: toDshSessionId(request.parentSessionId),
        childSessionId: toDshSessionId(request.childSessionId),
        mode: 'continuable',
        content: request.content,
      }, signal ?? new AbortController().signal)
      return { accepted: true, messageId: receipt.messageId }
    } catch (error) {
      throw mapDshError(error, 'subagent.prompt failed')
    }
  }

  /** @inheritDoc */
  async interruptSubagent(request: NexusSubagentInterruptRequest): Promise<NexusSubagentInterruptReceipt> {
    try {
      await Promise.resolve(this.dsh.subagents.interruptByParent(toDshSessionId(request.childSessionId), toDshSessionId(request.parentSessionId), 'continuable'))
      return { accepted: true }
    } catch (error) {
      throw mapDshError(error, 'subagent.interrupt failed')
    }
  }
}
