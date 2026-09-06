/**
 * Cordis provider that exposes the {@link NexusDshPort} seam as
 * `ctx.nexusDsh`, bound to the dsh services of this process.
 *
 * Composition fails loud: an unknown adapter name, or a fiber missing
 * `sessionController`/`subagents`, rejects at load before any route depends on
 * the service. The binding releases with the providing fiber.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-subagent'
import { Dsh013Adapter } from './dsh-013-adapter.ts'
import type { NexusDshPort } from './port.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Stable Nexus seam over this process's dsh Session and Subagent services. */
    nexusDsh: NexusDshPort
  }
}

/** Stable Cordis plugin name. */
export const name = 'nexus-dsh-compat'

/** Required host services the adapter binds to. */
export const inject = ['sessionController', 'subagents']

/** Provider configuration. */
export interface Config {
  /** Adapter implementation this build provides; only `dsh-013` exists. */
  adapter: string
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  adapter: z.string().default('dsh-013'),
})

/** Provide `ctx.nexusDsh` for the composition. */
export function apply(ctx: Context, config: Config = { adapter: 'dsh-013' }): void {
  // Misconfiguration fails loud at load: an unknown adapter name must never
  // silently fall back to a different Harness version's assumptions.
  if (config.adapter !== 'dsh-013') {
    throw new Error(`unknown nexus-dsh adapter "${config.adapter}"; this build provides 'dsh-013'`)
  }
  // `inject` enforces these for Loader composition; the guard keeps a direct
  // apply() call (tests, scripted composition) failing loud too.
  const sessionController: unknown = ctx.get('sessionController')
  const subagents: unknown = ctx.get('subagents')
  if (sessionController === undefined || subagents === undefined) {
    const missing = [
      ...(sessionController === undefined ? ['sessionController'] : []),
      ...(subagents === undefined ? ['subagents'] : []),
    ].join(', ')
    throw new Error(`nexus-dsh-compat requires the ${missing} service(s)`)
  }
  const adapter = new Dsh013Adapter({
    sessionController: ctx.sessionController,
    subagents: ctx.subagents,
  })
  ctx.reflect.provide('nexusDsh', adapter)
  ctx.effect(() => () => {
    // Release drops the port so a disposed composition cannot keep serving
    // stale service references.
    ctx.reflect.provide('nexusDsh', undefined)
  }, 'nexus-dsh-compat: release')
}

/** Default plugin export for Loader composition. */
export default { name, inject, Config, apply }
