/**
 * Nexus SSE stream registry: the per-connection stream table, per-session
 * sequence assignment, replay queueing, and frame delivery.
 *
 * Extracted verbatim from the bridge plugin body so the session-open flow and
 * reconnect ordering can be driven directly by tests; route registration stays
 * in `./index.ts`. Event mapping goes through the compat layer's
 * {@link mapDshEvent}, so unmapped events never advance the Nexus sequence.
 * @module
 */

import type { ServerResponse } from 'node:http'
import { mapDshEvent } from '@deepseek-ai/dsh-host-nexus-compat'
import type { NexusJournalEvent } from '@deepseek-ai/dsh-host-nexus-compat'
import { PROTOCOL_VERSION } from './protocol.ts'

/** One connected SSE stream and the sessions it has opened. */
interface StreamHandle {
  readonly res: ServerResponse
  readonly timer: ReturnType<typeof setInterval>
  readonly sessions: Set<string>
}

/** Registry of live Nexus event streams owned by one bridge composition. */
export class NexusEventStreams {
  private readonly streams = new Map<string, StreamHandle>()
  private readonly pendingReplay = new Map<string, string[]>()
  private readonly sequenceBySession = new Map<string, number>()
  // Sessions a Nexus channel has opened at least once. Approvals for these
  // sessions are answered by this bridge; all others delegate to the host's
  // own answerer (the Web mux provider) so both UIs keep working.
  private readonly nexusSessions = new Set<string>()

  /**
   * Whether a Nexus channel has opened the session at least once.
   * @param sessionId - durable session id to test.
   * @returns true when the session was opened by a Nexus channel.
   */
  hasNexusSession(sessionId: string): boolean {
    return this.nexusSessions.has(sessionId)
  }

  /**
   * Publish one already-mapped payload, advancing the session sequence.
   * @param sessionId - session the payload belongs to.
   * @param payload - Nexus reducer payload (already mapped).
   */
  publishPayload(sessionId: string, payload: Record<string, unknown>): void {
    const sequence = (this.sequenceBySession.get(sessionId) ?? 0) + 1
    this.sequenceBySession.set(sessionId, sequence)
    const envelope = { protocolVersion: PROTOCOL_VERSION, type: 'session.event', sessionId, requestId: null, sequence, timestamp: Date.now(), payload }
    const data = `data: ${JSON.stringify(envelope)}\n\n`
    for (const stream of this.streams.values()) if (stream.sessions.has(sessionId) && stream.res.writable) stream.res.write(data)
  }

  /**
   * Publish one dsh session event, dropping events without a Nexus mapping.
   * @param sessionId - session the event belongs to.
   * @param event - raw dsh session event (type + data).
   */
  publish(sessionId: string, event: { readonly type: string; readonly data: unknown }): void {
    const payload = mapDshEvent(event)
    if (payload === undefined) return
    this.publishPayload(sessionId, payload)
  }

  /**
   * Replay one session's opening history onto one channel, in order. Frames
   * queue on the channel when no SSE stream is connected, so a reconnect
   * receives the backlog before any live event.
   */
  /**
   * Replay one session's opening history onto one channel, in order. Frames
   * queue on the channel when no SSE stream is connected, so a reconnect
   * receives the backlog before any live event.
   * @param token - authenticated channel token.
   * @param sessionId - session being replayed.
   * @param events - journal events from the port's opening history page.
   */
  replaySession(token: string, sessionId: string, events: readonly NexusJournalEvent[]): void {
    const stream = this.streams.get(token)
    const queued: string[] = []
    for (const event of events) {
      const payload = mapDshEvent(event)
      if (payload === undefined) continue
      const sequence = (this.sequenceBySession.get(sessionId) ?? 0) + 1
      this.sequenceBySession.set(sessionId, sequence)
      const envelope = { protocolVersion: PROTOCOL_VERSION, type: 'session.event', sessionId, requestId: null, sequence, timestamp: Date.now(), payload }
      const frame = `data: ${JSON.stringify(envelope)}\n\n`
      if (stream === undefined) queued.push(frame)
      else if (stream.res.writable) stream.res.write(frame)
    }
    if (queued.length > 0) this.pendingReplay.set(token, [...(this.pendingReplay.get(token) ?? []), ...queued])
  }

  /**
   * Mark one session opened on one channel and emit the `session.subscribed`
   * anchor. A freshly opened session may replay history whose sequence numbers
   * are higher than the client's empty reducer. The anchor establishes a
   * baseline so the client can consume the replay in order; without it, every
   * reconnect of an old session is treated as a permanent sequence gap and
   * remains stuck in "正在恢复连接".
   */
  /**
   * Mark one session opened on one channel and emit the `session.subscribed`
   * anchor.
   * @param token - authenticated channel token.
   * @param sessionId - session being opened.
   */
  subscribeSession(token: string, sessionId: string): void {
    this.nexusSessions.add(sessionId)
    this.streams.get(token)?.sessions.add(sessionId)
    const sequence = (this.sequenceBySession.get(sessionId) ?? 0) + 1
    this.sequenceBySession.set(sessionId, sequence)
    const envelope = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'session.event',
      sessionId,
      requestId: null,
      sequence,
      timestamp: Date.now(),
      payload: { kind: 'session.subscribed', lastSeq: sequence },
    }
    const frame = `data: ${JSON.stringify(envelope)}\n\n`
    const stream = this.streams.get(token)
    if (stream?.res.writable === true) stream.res.write(frame)
    else this.pendingReplay.set(token, [...(this.pendingReplay.get(token) ?? []), frame])
  }

  /**
   * Register one SSE connection for a channel token and flush its queued
   * replay frames before any live event can be written.
   * @param token - authenticated channel token.
   * @param res - the SSE response writer.
   * @returns the close callback that stops the heartbeat and detaches the stream.
   */
  open(token: string, res: ServerResponse): () => void {
    const timer = setInterval(() => { if (res.writable) res.write(': ping\n\n') }, 30_000)
    this.streams.set(token, { res, timer, sessions: new Set() })
    const queued = this.pendingReplay.get(token)
    if (queued !== undefined) {
      this.pendingReplay.delete(token)
      for (const frame of queued) if (res.writable) res.write(frame)
    }
    return () => {
      const stream = this.streams.get(token)
      if (stream?.res === res) {
        clearInterval(stream.timer)
        this.streams.delete(token)
      }
    }
  }

  /**
   * Drop queued replay state and terminate the streams of revoked tokens.
   * @param tokens - revoked channel tokens.
   */
  endStreams(tokens: readonly string[]): void {
    for (const token of tokens) {
      this.pendingReplay.delete(token)
      const stream = this.streams.get(token)
      if (stream !== undefined) { clearInterval(stream.timer); this.streams.delete(token); stream.res.end() }
    }
  }
}
