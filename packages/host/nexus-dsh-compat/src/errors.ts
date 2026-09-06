/**
 * Stable Nexus error vocabulary for the {@link NexusDshPort} seam.
 *
 * Host failures cross this seam only as {@link NexusPortError} with a stable
 * `code`; DeepSeek Harness internal codes, stacks, and paths stay inside the
 * adapter. Discrimination is by `code` and the structural `isNexusPortError`
 * marker, never by instanceof, so cross-realm copies keep working.
 * @module
 */

/** Every error code the port may surface to the Bridge. */
export type NexusPortErrorCode =
  | 'unknown_session'
  | 'unknown_subagent'
  | 'subagent_unauthorized'
  | 'malformed'
  | 'host_cancelled'
  | 'host_error'

/**
 * One port-level failure: a real Error carrying its stable Nexus code.
 * Messages are already sanitized by the adapter — no host stack traces or
 * sensitive paths.
 */
export class NexusPortError extends Error {
  /** Structural marker: cross-realm identification never uses instanceof. */
  readonly isNexusPortError: true = true

  /**
   * @param code - stable failure code from {@link NexusPortErrorCode}.
   * @param message - sanitized, client-safe diagnostic.
   * @param options - standard Error options (`cause` survives in-process only).
   */
  constructor(
    readonly code: NexusPortErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'NexusPortError'
  }
}

/**
 * Structurally identify a {@link NexusPortError} thrown across module or realm
 * copies of this class.
 * @param value - a caught value.
 * @returns the failure when the marker matches, otherwise undefined.
 */
export function nexusPortErrorOf(value: unknown): NexusPortError | undefined {
  if (typeof value === 'object' && value !== null
    && (value as { isNexusPortError?: unknown }).isNexusPortError === true
    && typeof (value as { code?: unknown }).code === 'string') {
    return value as NexusPortError
  }
  return undefined
}
