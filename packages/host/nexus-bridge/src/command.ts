import type { IncomingMessage, ServerResponse } from 'node:http'
import { readJsonBody, sendJson } from './http-body.ts'
import type { AuthenticatedClient } from './handshake.ts'
import type { NexusKillSwitch } from './admin.ts'
import type { NexusDshPort, NexusJournalEvent, NexusPromptContentPart } from '@deepseek-ai/dsh-host-nexus-compat'
import { nexusPortErrorOf, nexusRequestId, nexusSessionId } from '@deepseek-ai/dsh-host-nexus-compat'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

interface CommandRequest {
  readonly type: 'command.request'
  readonly requestId: string
  readonly method: string
  readonly payload: Record<string, unknown>
  readonly channelToken?: string
}

const MAX_REQUEST_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
type NexusImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
const IMAGE_MEDIA_TYPES = new Set<NexusImageMediaType>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const execFileAsync = promisify(execFile)
const MAX_GIT_OUTPUT = 200_000

type WorkspaceCheck = (path: string) => Promise<{ ok: true } | { ok: false; reason: string }>
/** Replay the opening history of one session onto one channel as Nexus journal events. */
type SessionOpenReplay = (channelToken: string, sessionId: string, events: readonly NexusJournalEvent[]) => void
type SessionSubscribe = (channelToken: string, sessionId: string) => void
/** Settle a bridge-claimed approval; false when no pending entry matches. */
type ApprovalResponder = (sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected') => boolean

const readJson = (req: IncomingMessage): Promise<unknown> => readJsonBody(req, MAX_REQUEST_BYTES)
const send = sendJson

function error(requestId: string | null, code: string, message: string): object {
  return { type: 'command.response', requestId, ok: false, error: { code, message } }
}

/** Stable error code of one port failure; anything the seam did not classify is a host error. */
function portErrorCode(err: unknown): string {
  return nexusPortErrorOf(err)?.code ?? 'host_error'
}

/** Client-safe message of one port failure; non-port failures keep the generic fallback. */
function portErrorMessage(err: unknown, fallback: string): string {
  return nexusPortErrorOf(err)?.message ?? fallback
}

/** Minimal Nexus command adapter for the shared dsh WebServer. */
export class NexusCommandHandler {
  constructor(
    private readonly dsh: NexusDshPort,
    private readonly resolveClient: (token: string) => AuthenticatedClient | undefined,
    private readonly checkWorkspace: WorkspaceCheck = () => Promise.resolve({ ok: true }),
    private readonly killSwitch?: NexusKillSwitch,
    private readonly replaySession: SessionOpenReplay = () => {},
    private readonly subscribeSession: SessionSubscribe = () => {},
    private readonly respondApproval: ApprovalResponder = () => false,
  ) {}

  /** Handle one POST `/nexus/command` request.
   * @param req - Incoming HTTP request.
   * @param res - Response writer.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') { send(res, 405, { error: 'method_not_allowed' }); return }
    let raw: unknown
    try { raw = await readJson(req) } catch { send(res, 400, error(null, 'malformed', 'invalid JSON')); return }
    if (!isRecord(raw)) { send(res, 400, error(null, 'malformed', 'command must be an object')); return }
    const requestId = typeof raw.requestId === 'string' && raw.requestId !== '' ? raw.requestId : null
    if (raw.type !== 'command.request' || requestId === null || typeof raw.method !== 'string'
      || !isRecord(raw.payload) || typeof raw.channelToken !== 'string') {
      send(res, 400, error(requestId, 'malformed', 'invalid command request')); return
    }
    const client = this.resolveClient(raw.channelToken)
    if (client === undefined) { send(res, 401, error(requestId, 'unknown_client', 'unknown channel token')); return }
    const channelToken: string = raw.channelToken
    const command = raw as unknown as CommandRequest
    if (command.method === 'connection.ping') {
      send(res, 200, { type: 'command.response', requestId, ok: true, value: { pong: true } }); return
    }
    if (command.method === 'workspace.gitStatus' || command.method === 'workspace.gitDiff' || command.method === 'workspace.gitBranches') {
      const sessionId = typeof command.payload.sessionId === 'string' ? command.payload.sessionId : ''
      if (sessionId === '') { send(res, 200, error(requestId, 'malformed', `${command.method} requires sessionId`)); return }
      try {
        const listed = await this.dsh.listSessions({}, new AbortController().signal)
        const item = listed.items.find(candidate => String(candidate.sessionId) === sessionId)
        const cwd = item?.cwd
        if (typeof cwd !== 'string' || cwd === '') { send(res, 200, error(requestId, 'workspace_required', 'session 工作目录未知')); return }
        const check = await this.checkWorkspace(cwd)
        if (!check.ok) { send(res, 200, error(requestId, 'whitelist_blocked', check.reason)); return }
        const args = command.method === 'workspace.gitStatus'
          ? ['--no-pager', 'status', '--short']
          : command.method === 'workspace.gitDiff'
            ? ['--no-pager', 'diff', '--no-ext-diff', '--unified=3', '--', '.']
            : ['--no-pager', 'branch', '--format=%(refname:short)']
        const result = await execFileAsync('git', args, { cwd, timeout: 10_000, maxBuffer: MAX_GIT_OUTPUT, windowsHide: true })
        const kind = command.method === 'workspace.gitStatus' ? 'status' : command.method === 'workspace.gitDiff' ? 'diff' : 'branches'
        send(res, 200, { type: 'command.response', requestId, ok: true, value: { kind, cwd, output: result.stdout.slice(0, MAX_GIT_OUTPUT) } })
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, `${command.method} failed`))); return
      }
      return
    }
    if (command.method === 'session.open') {
      const sessionId = typeof command.payload.sessionId === 'string' ? command.payload.sessionId : ''
      if (sessionId === '') { send(res, 200, error(requestId, 'malformed', 'session.open requires sessionId')); return }
      try {
        // Opening validates the session through the host history API; live
        // events continue over the already-established SSE stream.
        const signal = new AbortController().signal
        const history = await this.dsh.readHistory({
          address: { kind: 'session', sessionId: nexusSessionId(sessionId) },
          maxMessages: 50,
        }, signal)
        // History seeds first, then the subscription anchor, so the anchor's
        // lastSeq covers the replayed events and the client consumes the
        // backlog in order before any live event.
        this.replaySession(channelToken, sessionId, history.records.map(record => record.event))
        this.subscribeSession(channelToken, sessionId)
        send(res, 200, { type: 'command.response', requestId, ok: true, value: {
          sessionId,
        } }); return
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'session.open failed'))); return
      }
    }
    if (command.method === 'session.models') {
      const sessionId = typeof command.payload.sessionId === 'string' ? command.payload.sessionId : ''
      if (sessionId === '') { send(res, 200, error(requestId, 'malformed', 'session.models requires sessionId')); return }
      try {
        const value = await this.dsh.getModelCatalog()
        send(res, 200, { type: 'command.response', requestId, ok: true, value }); return
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'session.models failed'))); return
      }
    }
    if (command.method === 'session.selectModel') {
      const sessionId = typeof command.payload.sessionId === 'string' ? command.payload.sessionId : ''
      const provider = typeof command.payload.provider === 'string' ? command.payload.provider : ''
      const model = typeof command.payload.model === 'string' ? command.payload.model : ''
      const reasoningEffort = typeof command.payload.reasoningEffort === 'string' ? command.payload.reasoningEffort : undefined
      if (sessionId === '' || provider === '' || model === '') {
        send(res, 200, error(requestId, 'malformed', 'session.selectModel requires sessionId, provider and model')); return
      }
      try {
        const value = await this.dsh.selectModel({
          sessionId: nexusSessionId(sessionId), provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        })
        send(res, 200, { type: 'command.response', requestId, ok: true, value }); return
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'session.selectModel failed'))); return
      }
    }
    if (command.method === 'session.permission') {
      const sessionId = typeof command.payload.sessionId === 'string' ? command.payload.sessionId : ''
      const preset = typeof command.payload.preset === 'string' ? command.payload.preset : ''
      if (sessionId === '' || preset === '') {
        send(res, 200, error(requestId, 'malformed', 'session.permission requires sessionId and preset')); return
      }
      try {
        const signal = new AbortController().signal
        const value = await this.dsh.prompt({
          requestId: nexusRequestId(requestId),
          sessionId: nexusSessionId(sessionId),
          mode: 'queue',
          content: [{ type: 'text', text: `/permission ${preset}` }],
        }, signal)
        send(res, 200, { type: 'command.response', requestId, ok: true, value }); return
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'session.permission failed'))); return
      }
    }
    if (command.method === 'turn.start' || command.method === 'turn.queue' || command.method === 'turn.steer') {
      if (this.killSwitch?.engaged === true) { send(res, 200, error(requestId, 'kill_switch_engaged', 'new turns are disabled')); return }
      const sessionId = typeof command.payload.sessionId === 'string' ? command.payload.sessionId : ''
      const parsed = parsePromptContent(command.payload.content)
      if (!parsed.ok || sessionId === '') {
        send(res, 200, error(requestId, 'malformed', parsed.ok ? `${command.method} requires sessionId and content` : parsed.reason)); return
      }
      if (!parsed.content.some(part => part.type === 'text' && part.text.trim() !== '')) {
        // iOS contract (nexus-app test/bridge.test.js): structurally valid but
        // textless prompts are empty_prompt; structural problems stay malformed.
        send(res, 200, error(requestId, 'empty_prompt', `${command.method} 内容为空`)); return
      }
      try {
        const mode = command.method === 'turn.steer' ? 'steer' : 'queue'
        const signal = new AbortController().signal
        const value = await this.dsh.prompt({
          requestId: nexusRequestId(requestId),
          sessionId: nexusSessionId(sessionId), mode, content: parsed.content,
        }, signal)
        send(res, 200, { type: 'command.response', requestId, ok: true, value }); return
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, `${command.method} failed`))); return
      }
    }
    if (command.method === 'turn.cancel') {
      const sessionId = typeof command.payload.sessionId === 'string' ? command.payload.sessionId : ''
      if (sessionId === '') { send(res, 200, error(requestId, 'malformed', 'turn.cancel requires sessionId')); return }
      try {
        await this.dsh.cancelSession(nexusSessionId(sessionId))
        send(res, 200, { type: 'command.response', requestId, ok: true, value: {} }); return
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'turn.cancel failed'))); return
      }
    }
    if (command.method === 'subagent.list') {
      const parentSessionId = typeof command.payload.parentSessionId === 'string' ? command.payload.parentSessionId : ''
      if (parentSessionId === '') { send(res, 200, error(requestId, 'malformed', 'subagent.list requires parentSessionId')); return }
      try {
        const signal = new AbortController().signal
        const value = await this.dsh.listSubagents(nexusSessionId(parentSessionId), signal)
        send(res, 200, { type: 'command.response', requestId, ok: true, value }); return
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'subagent.list failed'))); return
      }
    }
    if (command.method === 'subagent.history') {
      const parentSessionId = typeof command.payload.parentSessionId === 'string' ? command.payload.parentSessionId : ''
      const childSessionId = typeof command.payload.childSessionId === 'string' ? command.payload.childSessionId : ''
      const mode: 'continuable' | 'one-shot' | '' = command.payload.mode === 'continuable' || command.payload.mode === 'one-shot' ? command.payload.mode : ''
      const beforeSeq = command.payload.beforeSeq
      const maxMessages = command.payload.maxMessages
      const modeValid = mode !== ''
      if (parentSessionId === '' || childSessionId === '' || !modeValid
        || (beforeSeq !== undefined && (!Number.isInteger(beforeSeq) || Number(beforeSeq) < 1))
        || (maxMessages !== undefined && (!Number.isInteger(maxMessages) || Number(maxMessages) < 1))) {
        send(res, 200, error(requestId, 'malformed', 'subagent.history requires parentSessionId, childSessionId, mode and valid pagination')); return
      }
      try {
        const signal = new AbortController().signal
        const page = await this.dsh.readHistory({
          address: {
            kind: 'subagent',
            parentSessionId: nexusSessionId(parentSessionId),
            childSessionId: nexusSessionId(childSessionId),
            mode,
          },
          ...(typeof beforeSeq === 'number' ? { beforeSeq } : {}),
          ...(typeof maxMessages === 'number' ? { maxMessages } : {}),
        }, signal)
        send(res, 200, { type: 'command.response', requestId, ok: true, value: { events: page.records.map(record => record.event) } }); return
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'subagent.history failed'))); return
      }
    }
    if (command.method === 'subagent.prompt') {
      const parentSessionId = typeof command.payload.parentSessionId === 'string' ? command.payload.parentSessionId : ''
      const childSessionId = typeof command.payload.childSessionId === 'string' ? command.payload.childSessionId : ''
      const parsed = parsePromptContent(command.payload.content)
      if (parentSessionId === '' || childSessionId === '' || command.payload.mode !== 'continuable' || !parsed.ok || !parsed.content.some(part => part.type === 'text' && part.text.trim() !== '')) {
        send(res, 200, error(requestId, 'malformed', parsed.ok ? 'subagent.prompt requires parentSessionId, childSessionId, mode=continuable and content' : parsed.reason)); return
      }
      try {
        const textContent = parsed.content.filter((part): part is Extract<NexusPromptContentPart, { type: 'text' }> => part.type === 'text')
          .map(part => ({ type: 'text' as const, text: part.text }))
        const signal = new AbortController().signal
        const value = await this.dsh.promptSubagent({
          requestId: nexusRequestId(requestId),
          parentSessionId: nexusSessionId(parentSessionId),
          childSessionId: nexusSessionId(childSessionId),
          mode: 'continuable', content: textContent,
        }, signal)
        send(res, 200, { type: 'command.response', requestId, ok: true, value }); return
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'subagent.prompt failed'))); return
      }
    }
    if (command.method === 'subagent.interrupt') {
      const parentSessionId = typeof command.payload.parentSessionId === 'string' ? command.payload.parentSessionId : ''
      const childSessionId = typeof command.payload.childSessionId === 'string' ? command.payload.childSessionId : ''
      if (parentSessionId === '' || childSessionId === '' || command.payload.mode !== 'continuable') {
        send(res, 200, error(requestId, 'malformed', 'subagent.interrupt requires parentSessionId, childSessionId and mode=continuable')); return
      }
      try {
        await this.dsh.interruptSubagent({
          parentSessionId: nexusSessionId(parentSessionId),
          childSessionId: nexusSessionId(childSessionId),
          mode: 'continuable',
        })
        send(res, 200, { type: 'command.response', requestId, ok: true, value: {} }); return
      } catch (err) {
        send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'subagent.interrupt failed'))); return
      }
    }
    if (command.method === 'approval.respond') {
      const sessionId = typeof command.payload.sessionId === 'string' ? command.payload.sessionId : ''
      const approvalId = typeof command.payload.approvalId === 'string' ? command.payload.approvalId : ''
      const outcome = command.payload.outcome === 'allowed-once' || command.payload.outcome === 'rejected' ? command.payload.outcome : ''
      if (sessionId === '' || approvalId === '' || outcome === '') { send(res, 200, error(requestId, 'malformed', 'approval.respond requires sessionId, approvalId, outcome')); return }
      // Bridge-claimed approvals settle through the bridge registry keyed by
      // the audit approvalId; the host mux answerer's rpcId echo cannot be
      // produced by an HTTP command client.
      if (!this.respondApproval(sessionId, approvalId, outcome)) {
        send(res, 200, error(requestId, 'approval_not_pending', 'approval is not pending on this bridge (expired, cancelled, or already answered)')); return
      }
      send(res, 200, { type: 'command.response', requestId, ok: true }); return
    }
    if (command.method !== 'session.list') {
      if (command.method === 'session.create') {
        const cwd = typeof command.payload.cwd === 'string' ? command.payload.cwd : ''
        if (cwd === '') { send(res, 200, error(requestId, 'workspace_required', 'session.create requires cwd')); return }
        try {
          const check = await this.checkWorkspace(cwd)
          if (!check.ok) { send(res, 200, error(requestId, 'whitelist_blocked', check.reason)); return }
          const value = await this.dsh.createSession({
            cwd,
            ...(typeof command.payload.sessionId === 'string' ? { sessionId: nexusSessionId(command.payload.sessionId) } : {}),
            ...(typeof command.payload.agentPreset === 'string' ? { agentPreset: command.payload.agentPreset } : {}),
          })
          send(res, 200, { type: 'command.response', requestId, ok: true, value }); return
        } catch (err) {
          send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'session.create failed'))); return
        }
      }
      send(res, 200, error(requestId, 'unknown_method', `unregistered method: ${command.method}`)); return
    }
    try {
      const signal = new AbortController().signal
      const value = await this.dsh.listSessions({
        ...(typeof command.payload.cursor === 'string' ? { cursor: command.payload.cursor } : {}),
      }, signal)
      send(res, 200, { type: 'command.response', requestId, ok: true, value }); return
    } catch (err) {
      send(res, 200, error(requestId, portErrorCode(err), portErrorMessage(err, 'session.list failed'))); return
    }
  }
}

/** Parse Nexus prompt content without logging or otherwise copying image bytes. */
function parsePromptContent(value: unknown): { ok: true; content: NexusPromptContentPart[] } | { ok: false; reason: string } {
  if (typeof value === 'string') return { ok: true, content: [{ type: 'text', text: value }] }
  if (!Array.isArray(value) || value.length === 0) return { ok: false, reason: 'turn.start content must be text or content blocks' }
  const content: NexusPromptContentPart[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== 'string') return { ok: false, reason: 'unsupported content block' }
    if (item.type === 'text' && typeof item.text === 'string') {
      content.push({ type: 'text', text: item.text })
      continue
    }
    if (item.type === 'image' && typeof item.mediaType === 'string' && IMAGE_MEDIA_TYPES.has(item.mediaType as never)
      && typeof item.data === 'string' && isCanonicalBase64(item.data)) {
      const bytes = Buffer.byteLength(item.data, 'base64')
      if (bytes > MAX_IMAGE_BYTES) return { ok: false, reason: 'image attachment exceeds 5 MiB limit' }
      content.push({ type: 'image', mediaType: item.mediaType as NexusImageMediaType, data: item.data,
        ...(typeof item.name === 'string' ? { name: item.name } : {}) })
      continue
    }
    return { ok: false, reason: item.type === 'image' ? 'invalid or unsupported image attachment' : 'unsupported content block' }
  }
  return { ok: true, content }
}

function isCanonicalBase64(value: string): boolean {
  if (value === '' || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  return Buffer.from(value, 'base64').toString('base64') === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
