/**
 * Nexus-owned wire vocabulary for the stable {@link NexusDshPort} seam.
 *
 * Every type here is JSON-equivalent to what the Nexus Bridge has shipped on
 * the v4 wire, so the Bridge can serialize port values without reshaping. No
 * DeepSeek Harness internal Session, Subagent, error, or journal type may
 * appear in this module or in `port.ts` (enforced by
 * `tests/port.contract.spec.ts`); adapters in this package own that mapping.
 * @module
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity of one Session as seen by a Nexus client. */
export type NexusSessionId = Branded<'nexus-session-id'>

/**
 * Client-minted command identity echoed on the wire. The Bridge takes it from
 * the incoming command envelope, so prompt persistence keeps one identity from
 * the Nexus request through the durable user message.
 */
export type NexusRequestId = Branded<'nexus-request-id'>

/**
 * Brand a non-empty session id string for the port.
 * @param value - raw session id string.
 * @returns the branded {@link NexusSessionId}.
 * @throws RangeError when the value is empty.
 */
export function nexusSessionId(value: string): NexusSessionId {
  if (value === '') throw new RangeError('session id must not be empty')
  return value as NexusSessionId
}

/**
 * Brand a non-empty request id string for the port.
 * @param value - raw request id string.
 * @returns the branded {@link NexusRequestId}.
 * @throws RangeError when the value is empty.
 */
export function nexusRequestId(value: string): NexusRequestId {
  if (value === '') throw new RangeError('request id must not be empty')
  return value as NexusRequestId
}

/** JSON-safe value handed through the port unchanged (projection hints, raw journal data). */
export type NexusJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly NexusJsonValue[]
  | { readonly [key: string]: NexusJsonValue }

/** Image media type accepted on the Nexus prompt wire. */
export type NexusImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** One Nexus prompt content part; the wire admits text and inline images. */
export type NexusPromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
    readonly type: 'image'
    readonly mediaType: NexusImageMediaType
    readonly data: string
    readonly name?: string
  }

/** Prompt delivery mode for one ordinary Session. */
export type NexusPromptMode = 'queue' | 'steer'

/** Subagent address discriminator. */
export type NexusSubagentMode = 'continuable' | 'one-shot'

/** One Session list row, JSON-equivalent to the shipped SessionSummary wire. */
export interface NexusSessionSummary {
  readonly sessionId: NexusSessionId
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly parentSessionId?: NexusSessionId
  readonly origin?: 'subagent'
  readonly cwd?: string
  /** Cached projection hints passed through untouched. */
  readonly projections?: NexusJsonValue
}

/** Session list response value. */
export interface NexusSessionListValue {
  readonly items: readonly NexusSessionSummary[]
}

/** Session list request. */
export interface NexusSessionListRequest {
  readonly cursor?: string
}

/** Session creation request. */
export interface NexusCreateSessionRequest {
  readonly cwd: string
  /** Explicit id adoption; omitted lets the host mint one. */
  readonly sessionId?: NexusSessionId
  readonly agentPreset?: string
}

/** Session creation response value. */
export interface NexusCreateSessionValue {
  readonly sessionId: NexusSessionId
  readonly agentPreset?: string
}

/** One reasoning effort selectable on one model route. */
export interface NexusModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** Selectable reasoning metadata for one model route. */
export interface NexusModelReasoning {
  readonly efforts: readonly NexusModelReasoningEffort[]
  readonly defaultEffort?: string
}

/** One model inside its provider group. */
export interface NexusModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: NexusModelReasoning
}

/** One provider and its loaded model catalog. */
export interface NexusModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly NexusModelCatalogModel[]
}

/** One provider whose model catalog lookup failed. */
export interface NexusModelCatalogFailure {
  readonly id: string
  readonly name: string
  readonly message: string
}

/** Model catalog response value. */
export interface NexusModelCatalog {
  readonly default: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  }
  readonly routableProviders: readonly string[]
  readonly groups: readonly NexusModelProviderGroup[]
  readonly failures: readonly NexusModelCatalogFailure[]
}

/** Model selection request for one Session. */
export interface NexusSelectModelRequest {
  readonly sessionId: NexusSessionId
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Accepted model selection after host resolution. */
export interface NexusSelectModelValue {
  readonly selected: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  }
}

/** Prompt request for one ordinary Session. */
export interface NexusPromptRequest {
  readonly requestId: NexusRequestId
  readonly sessionId: NexusSessionId
  readonly mode: NexusPromptMode
  readonly content: readonly NexusPromptContentPart[]
}

/** Receipt after one prompt enters the target agent inbox. */
export interface NexusPromptValue {
  readonly accepted: true
}

/** Receipt after cancellation is admitted to the live agent. */
export interface NexusCancelValue {
  readonly accepted: true
}

/**
 * One raw journal event as replayed to a Nexus client. History consumers own
 * event-name recognition; the port carries the envelope fields untouched.
 */
export interface NexusJournalEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: NexusJsonValue
  readonly ignorable?: true
}

/** One history record; only the `event` variant is produced. */
export type NexusHistoryRecord = {
  readonly type: 'event'
  readonly event: NexusJournalEvent
}

/** Durable address of one history read, in Nexus vocabulary. */
export type NexusHistoryAddress =
  | { readonly kind: 'session'; readonly sessionId: NexusSessionId }
  | {
    readonly kind: 'subagent'
    readonly parentSessionId: NexusSessionId
    readonly childSessionId: NexusSessionId
    readonly mode: NexusSubagentMode
  }

/** One backwards-history read request. */
export interface NexusHistoryRequest {
  readonly address: NexusHistoryAddress
  /** Exclusive upper cut obtained from an earlier page or subscription. */
  readonly beforeSeq?: number
  readonly maxMessages?: number
}

/**
 * One history page. `cursor` is the inclusive log cut the page was taken at,
 * so a follow-up `beforeSeq` window can be served without reopening the log.
 */
export interface NexusHistoryPage {
  readonly records: readonly NexusHistoryRecord[]
  readonly hasMore: boolean
  readonly cursor: number
}

/** One subagent direct-child row, JSON-equivalent to the shipped catalog wire. */
export type NexusSubagentEntry =
  | {
    readonly kind: 'child'
    readonly id: NexusSessionId
    readonly activity: 'running' | 'inactive'
    readonly hasChildren: boolean
  } & (
    | { readonly mode: 'one-shot'; readonly label?: string }
    | { readonly mode: 'continuable'; readonly label: string }
  )
  | {
    readonly kind: 'diagnostic'
    readonly id: NexusSessionId
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/** Subagent list response value for one parent. */
export interface NexusSubagentCatalog {
  readonly parentAvailable: boolean
  readonly entries: readonly NexusSubagentEntry[]
}

/** Subagent prompt request for one continuable child. */
export interface NexusSubagentPromptRequest {
  readonly requestId: NexusRequestId
  readonly parentSessionId: NexusSessionId
  readonly childSessionId: NexusSessionId
  readonly mode: 'continuable'
  readonly content: readonly NexusPromptContentPart[]
}

/** Receipt after one subagent prompt is accepted into the child inbox. */
export interface NexusSubagentPromptReceipt {
  readonly accepted: true
  /** Inbox identity of the accepted message; additive to the shipped wire. */
  readonly messageId: string
}

/** Subagent interrupt request under one durable parent address. */
export interface NexusSubagentInterruptRequest {
  readonly parentSessionId: NexusSessionId
  readonly childSessionId: NexusSessionId
  readonly mode: 'continuable'
}

/** Receipt after one interrupt request is admitted. */
export interface NexusSubagentInterruptReceipt {
  readonly accepted: true
}
