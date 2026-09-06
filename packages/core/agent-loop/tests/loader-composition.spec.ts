/**
 * Real-composition guard for the configured-agent persistence seam: the
 * factory and a JSONL persistence provider boot concurrently through the
 * actual Loader + Include path, with the persistence import artificially
 * delayed so the factory starts while the service is still mounting. The
 * configured exact-identity agent must still restore-or-create through the
 * backend (session materialized on disk), not silently fall into a
 * backend-less fresh create. A settled tree without a persistence entry
 * keeps the backend-less contract.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'

/** Import delay that reliably outlives the agent-loop entry's own import. */
const PERSISTENCE_IMPORT_DELAY_MS = 50

const PERSISTENCE_SPECIFIER = '@deepseek-ai/dsh-session-persistence-jsonl'

const MODULES = new Map<string, unknown>([
  ['@deepseek-ai/dsh-llm', LlmRuntime],
  ['@deepseek-ai/dsh-session', SessionStore],
  ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
  ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
  ['@deepseek-ai/dsh-tools', ToolRuntime],
  ['@deepseek-ai/dsh-agent', AgentRegistry],
  ['@deepseek-ai/dsh-agent-loop', AgentLoop],
  [PERSISTENCE_SPECIFIER, JsonlSessionPersistence],
])

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(
  options: { withPersistence?: boolean; exactSessionId?: boolean } = {},
): Promise<Context> {
  const withPersistence = options.withPersistence ?? true
  const exactSessionId = options.exactSessionId ?? true
  root = await mkdtemp(join(tmpdir(), 'dsh-agent-loop-composition-'))

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: '@deepseek-ai/dsh-llm'",
    '- id: session-store',
    "  name: '@deepseek-ai/dsh-session'",
    '- id: session-projection',
    "  name: '@deepseek-ai/dsh-session-projection'",
    '- id: system-prompt',
    "  name: '@deepseek-ai/dsh-system-prompt'",
    '- id: tools',
    "  name: '@deepseek-ai/dsh-tools'",
    '- id: agent-registry',
    "  name: '@deepseek-ai/dsh-agent'",
    ...(withPersistence ? [
      '- id: session-persistence',
      `  name: '${PERSISTENCE_SPECIFIER}'`,
      '  config:',
      `    root: ${JSON.stringify(join(root, '.sessions'))}`,
    ] : []),
    '- id: agent-loop',
    "  name: '@deepseek-ai/dsh-agent-loop'",
    '  config:',
    '    agents:',
    '      - id: main',
    ...(exactSessionId ? ["        sessionId: 'loader-race-session'"] : []),
    "        model: 'mock'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === PERSISTENCE_SPECIFIER) {
        // Force the losing side of the mount-order race deterministically:
        // the factory's constructor runs while this import is still pending.
        await new Promise(resolve => setTimeout(resolve, PERSISTENCE_IMPORT_DELAY_MS))
      }
      if (!MODULES.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return MODULES.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

describe('agent-loop real loader composition', () => {
  it('restores a configured exact identity through a concurrently mounted, slower persistence provider', async () => {
    const ctx = await loadComposition()

    // The factory started before the persistence import resolved; the
    // configured agent must nevertheless be created through the backend.
    await expect.poll(() => ctx.agents.get(SessionId('loader-race-session'))).toBeDefined()
    await expect.poll(async () => {
      const snapshots = await ctx.sessionPersistence.list()
      return snapshots.some(snapshot => snapshot.header.id === 'loader-race-session')
    }).toBe(true)
  })

  it('keeps the backend-less create when the settled tree has no persistence entry', async () => {
    const ctx = await loadComposition({ withPersistence: false })

    await expect.poll(() => ctx.agents.get(SessionId('loader-race-session'))).toBeDefined()
    expect(ctx.get('sessionPersistence')).toBeUndefined()
  })

  it('materializes a fresh configured agent through a concurrently mounted, slower persistence provider', async () => {
    const ctx = await loadComposition({ exactSessionId: false })

    // Fresh configured agents have random identities; assert the agent came
    // up and exactly its session materialized in the backend.
    await expect.poll(async () => {
      const agents = ctx.agents.list()
      return agents.length === 1 ? agents[0] : undefined
    }).toBeDefined()
    await expect.poll(async () => {
      const snapshots = await ctx.sessionPersistence.list()
      return snapshots.length
    }).toBe(1)
  })
})
