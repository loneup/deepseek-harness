/**
 * Nexus approval claiming: the bridge-side approval/request waterfall step.
 *
 * Extracted verbatim from the bridge plugin body so the claim/settle path can
 * be driven directly by tests. Approval requests are a waterfall side channel
 * rather than session events. The card is published to subscribed Nexus
 * channels, then the ask is answered for sessions a Nexus channel owns: the
 * host's own answerer routes answers by the mux frame's rpcId, which an HTTP
 * command client never sees, so a Nexus approval can only be settled here.
 * Sessions no Nexus channel has opened delegate down the waterfall unchanged
 * (the caller invokes `next()`). Running before the Web approval provider (the
 * terminal answerer) keeps the card published even when this bridge does not
 * claim the ask.
 * @module
 */

import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { NexusEventStreams } from './stream.ts'

/** The shape of one dsh `approval/request` waterfall request this step consumes. */
export interface ApprovalAskRequest {
  readonly agent: {
    readonly session: {
      readonly id: string
      readonly snapshotEvents: () => readonly SessionEvent[]
    }
  }
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly signal?: AbortSignal
}

/** Registry of bridge-claimed approvals awaiting a Nexus `approval.respond`. */
export class NexusApprovals {
  private readonly pending = new Map<string, { sessionId: string; settle: (outcome: ApprovalOutcome) => void }>()

  constructor(private readonly streams: NexusEventStreams) {}

  /**
   * Handle one `approval/request` waterfall tick.
   * @param request - the dsh approval ask.
   * @returns the settle promise when this bridge claims the ask, or null when
   *   the caller must delegate (`next()`): no unanswered ask matches, or the
   *   session was never opened by a Nexus channel.
   */
  request(request: ApprovalAskRequest): Promise<ApprovalOutcome> | null {
    const session = request.agent.session
    const decided = new Set<unknown>()
    let askedId: string | undefined
    const events = session.snapshotEvents()
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index] as SessionEvent
      if (event.type === 'approval/decided') { decided.add(event.data.id); continue }
      if (event.type !== 'approval/asked' || decided.has(event.data.id) || event.data.toolName !== request.toolName) continue
      if ((event.data.callId ?? null) !== (request.callId ?? null)) continue
      askedId = event.data.id
      this.streams.publishPayload(session.id, { kind: 'approval.requested', approvalId: askedId, toolCallId: request.callId, toolName: request.toolName, reason: request.reason })
      break
    }
    if (askedId === undefined || !this.streams.hasNexusSession(session.id)) return null
    const id = askedId
    return new Promise<ApprovalOutcome>((resolve) => {
      const settle = (outcome: ApprovalOutcome): void => {
        if (!this.pending.delete(id)) return
        request.signal?.removeEventListener('abort', onAbort)
        resolve(outcome)
      }
      const onAbort = (): void => {
        settle('cancelled')
      }
      this.pending.set(id, { sessionId: session.id, settle })
      request.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Settle a bridge-claimed approval from an `approval.respond` command.
   * @param sessionId - session the approval belongs to.
   * @param approvalId - audit approvalId echoed by the Nexus card.
   * @param outcome - the user decision.
   * @returns false when no pending entry matches (unknown id, wrong session, or
   *   already settled) so the client can surface a stale-card error.
   */
  respond(sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): boolean {
    const entry = this.pending.get(approvalId)
    if (entry === undefined || entry.sessionId !== sessionId) return false
    entry.settle(outcome)
    return true
  }
}
