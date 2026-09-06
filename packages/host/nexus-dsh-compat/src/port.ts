/**
 * The stable seam between the Nexus Bridge and DeepSeek Harness: every Session,
 * Subagent, and history capability the Bridge consumes, expressed only in the
 * Nexus-owned vocabulary of `./types.ts`.
 *
 * Implementations live in this package (currently the dsh 0.1.3 adapter);
 * `packages/host/nexus-bridge` depends on this interface alone. Live event
 * delivery is deliberately absent: the Bridge keeps its Cordis
 * `session/event` listener so the Web surface and the Nexus surface share one
 * broadcast without double delivery.
 * @module
 */

import type {
  NexusCancelValue, NexusCreateSessionRequest, NexusCreateSessionValue, NexusHistoryRequest,
  NexusHistoryPage, NexusModelCatalog, NexusPromptRequest, NexusPromptValue, NexusSelectModelRequest,
  NexusSelectModelValue, NexusSessionId, NexusSessionListRequest, NexusSessionListValue,
  NexusSubagentCatalog, NexusSubagentInterruptReceipt, NexusSubagentInterruptRequest,
  NexusSubagentPromptReceipt, NexusSubagentPromptRequest,
} from './types.ts'

/** Session, model, history, and Subagent capabilities the Nexus Bridge consumes. */
export interface NexusDshPort {
  /** Diagnostics identity of the bound adapter (e.g. `dsh-013`); absent means unbranded. */
  readonly adapterId?: string

  /**
   * List known Sessions, newest activity first.
   * @param request - optional continuation cursor from a previous page.
   * @param signal - caller-owned cancellation.
   * @returns the list page.
   */
  listSessions(request: NexusSessionListRequest, signal?: AbortSignal): Promise<NexusSessionListValue>

  /**
   * Create (or adopt by explicit id) one Session.
   * @param request - workspace and optional preset of the new Session.
   * @returns the created Session identity.
   */
  createSession(request: NexusCreateSessionRequest): Promise<NexusCreateSessionValue>

  /**
   * Read the host model catalog: routable provider groups, per-model reasoning
   * metadata, load failures, and the default selection used by unconfigured
   * Sessions.
   * @returns the catalog snapshot.
   */
  getModelCatalog(): Promise<NexusModelCatalog>

  /**
   * Select the model for subsequent prompts of one Session.
   * @param request - session and model route to select.
   * @returns the host-resolved selection.
   */
  selectModel(request: NexusSelectModelRequest): Promise<NexusSelectModelValue>

  /**
   * Deliver one human prompt to a Session inbox.
   * @param request - client-minted request identity, address, mode, and content.
   * @param signal - cancellation owning the call until inbox acceptance.
   * @returns the acceptance receipt.
   */
  prompt(request: NexusPromptRequest, signal?: AbortSignal): Promise<NexusPromptValue>

  /**
   * Cancel the active turn of one Session.
   * @param sessionId - session whose live agent is cancelled.
   * @returns the acceptance receipt.
   */
  cancelSession(sessionId: NexusSessionId): Promise<NexusCancelValue>

  /**
   * Read one backwards page of a Session or Subagent journal.
   * @param request - durable address and pagination window.
   * @param signal - caller-owned cancellation.
   * @returns the page with its inclusive log cursor.
   */
  readHistory(request: NexusHistoryRequest, signal?: AbortSignal): Promise<NexusHistoryPage>

  /**
   * List the direct subagent children of one parent.
   * @param parentSessionId - parent whose children are listed.
   * @param signal - caller-owned cancellation.
   * @returns the catalog with the parent availability hint.
   */
  listSubagents(parentSessionId: NexusSessionId, signal?: AbortSignal): Promise<NexusSubagentCatalog>

  /**
   * Deliver one human prompt to a continuable subagent child.
   * @param request - client-minted identity, parent/child address, and content.
   * @param signal - cancellation owning the call until inbox acceptance.
   * @returns the acceptance receipt.
   */
  promptSubagent(request: NexusSubagentPromptRequest, signal?: AbortSignal): Promise<NexusSubagentPromptReceipt>

  /**
   * Interrupt the live subagent child addressed by one parent.
   * @param request - parent/child address to interrupt.
   * @returns the acceptance receipt.
   */
  interruptSubagent(request: NexusSubagentInterruptRequest): Promise<NexusSubagentInterruptReceipt>
}
