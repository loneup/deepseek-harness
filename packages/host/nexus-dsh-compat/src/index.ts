/**
 * Public face of the Nexus compatibility layer: the stable {@link NexusDshPort}
 * seam, its Nexus-owned wire vocabulary, and its stable error type.
 * @module
 */

export { NexusPortError, nexusPortErrorOf } from './errors.ts'
export type { NexusPortErrorCode } from './errors.ts'
export { Dsh013Adapter, mapDshError, mapDshEvent } from './dsh-013-adapter.ts'
export type { Dsh013Services } from './dsh-013-adapter.ts'
export type { NexusDshPort } from './port.ts'
export { apply, Config, inject, name } from './plugin.ts'
import plugin from './plugin.ts'
export default plugin

// Re-export the plugin's Context augmentation so consumers of the package root
// see `ctx.nexusDsh`; only the root face is on the consumer import path.
export type {} from './plugin.ts'
export {
  nexusRequestId,
  nexusSessionId,
} from './types.ts'
export type {
  NexusCancelValue,
  NexusCreateSessionRequest,
  NexusCreateSessionValue,
  NexusHistoryAddress,
  NexusHistoryPage,
  NexusHistoryRecord,
  NexusHistoryRequest,
  NexusImageMediaType,
  NexusJournalEvent,
  NexusModelCatalog,
  NexusModelCatalogFailure,
  NexusModelCatalogModel,
  NexusModelProviderGroup,
  NexusModelReasoning,
  NexusModelReasoningEffort,
  NexusPromptContentPart,
  NexusPromptMode,
  NexusPromptRequest,
  NexusPromptValue,
  NexusRequestId,
  NexusSelectModelRequest,
  NexusSelectModelValue,
  NexusSessionId,
  NexusSessionListRequest,
  NexusSessionListValue,
  NexusSessionSummary,
  NexusSubagentCatalog,
  NexusSubagentEntry,
  NexusSubagentInterruptReceipt,
  NexusSubagentInterruptRequest,
  NexusSubagentMode,
  NexusSubagentPromptReceipt,
  NexusSubagentPromptRequest,
  NexusJsonValue,
} from './types.ts'
