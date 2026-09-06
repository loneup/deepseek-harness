import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const read = (path: string): string => readFileSync(`${repoRoot}${path}`, 'utf8')

/**
 * The dsh names that must never cross the NexusDshPort seam into the Bridge,
 * and must never appear on the compat package's public face.
 */
const FORBIDDEN_ACROSS_SEAM = [
  'SessionController',
  'SubagentRuntime',
  'SessionAddress',
  'SessionRequestId',
  'SubagentPromptRequestId',
  'RemoteError',
  'remoteErrorOf',
] as const

/** dsh packages the Bridge consumed before the port seam; it needs none of them. */
const FORBIDDEN_BRIDGE_DEPENDENCIES = [
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-typert-protocol',
] as const

const BRIDGE_SRC_FILES = ['src/command.ts', 'src/index.ts', 'src/stream.ts', 'src/approvals.ts', 'src/environment.ts', 'src/http-body.ts', 'src/handshake.ts', 'src/admin.ts', 'src/protocol.ts'] as const
const COMPAT_PUBLIC_FILES = ['src/types.ts', 'src/port.ts', 'src/errors.ts'] as const

/**
 * Event-type isolation: the bridge may touch dsh's durable `SessionEvent`
 * vocabulary only where it must (the `session/event` listener in index.ts and
 * the journal scan in approvals.ts); every other bridge file and the compat
 * public face must be free of it. `SessionWireEvent` is adapter-only.
 */
const SESSION_EVENT_ALLOWED_IN_BRIDGE = new Set(['src/index.ts', 'src/approvals.ts'])

describe('port isolation gate: bridge side', () => {
  for (const file of BRIDGE_SRC_FILES) {
    it(`keeps ${file} free of dsh internal type names`, () => {
      const source = read(`packages/host/nexus-bridge/${file}`)
      for (const name of FORBIDDEN_ACROSS_SEAM) {
        expect(source.includes(name), `${file} must not mention ${name}`).toBe(false)
      }
      if (!SESSION_EVENT_ALLOWED_IN_BRIDGE.has(file)) {
        expect(source.includes('SessionEvent'), `${file} must not mention SessionEvent (event types are isolated to ${[...SESSION_EVENT_ALLOWED_IN_BRIDGE].join(', ')})`).toBe(false)
      }
      expect(source.includes('SessionWireEvent'), `${file} must not mention SessionWireEvent`).toBe(false)
      expect(source.includes('apiProxy'), `${file} must not mention apiProxy`).toBe(false)
      expect(source.includes('LegacyApiResponse'), `${file} must not mention LegacyApiResponse`).toBe(false)
      // The legacy apiProxy envelope read `response.result.ok`; a local union
      // discriminator spelled `result.ok` (admin revoke) is unrelated.
      expect(source.includes('response.result.ok'), `${file} must not read the legacy rpc envelope`).toBe(false)
    })
  }

  it('declares no direct dependency on the dsh service packages the port replaces', () => {
    const manifest = JSON.parse(read('packages/host/nexus-bridge/package.json')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const declared = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.devDependencies }
    for (const name of FORBIDDEN_BRIDGE_DEPENDENCIES) {
      expect(declared[name], `${name} must not be a bridge dependency`).toBeUndefined()
    }
    expect(declared['@deepseek-ai/dsh-host-nexus-compat'], 'the bridge must depend on the compat package').toBeDefined()
  })

  it('binds every dsh call inside the compat adapter only', () => {
    const command = read('packages/host/nexus-bridge/src/command.ts')
    expect(/this\.ctx\.(sessionController|subagents)/.test(command), 'the command handler must not reach host services off the port').toBe(false)
    expect(/this\.dsh\./.test(command), 'the command handler must consume the port').toBe(true)
    const adapter = read('packages/host/nexus-dsh-compat/src/dsh-013-adapter.ts')
    expect(adapter.match(/this\.dsh\.(sessionController|subagents)/g)?.length ?? 0).toBeGreaterThanOrEqual(10)
  })
})

describe('port isolation gate: compat public face', () => {
  for (const file of COMPAT_PUBLIC_FILES) {
    it(`keeps ${file} free of dsh internal type names`, () => {
      const source = read(`packages/host/nexus-dsh-compat/${file}`)
      for (const name of FORBIDDEN_ACROSS_SEAM) {
        expect(source.includes(name), `${file} must not mention ${name}`).toBe(false)
      }
      expect(source.includes('SessionEvent'), `${file} must not mention SessionEvent`).toBe(false)
      expect(source.includes('SessionWireEvent'), `${file} must not mention SessionWireEvent`).toBe(false)
    })
  }

  it('keeps dsh event vocabulary confined to the adapter', () => {
    for (const file of ['src/index.ts', 'src/plugin.ts', 'src/port.ts']) {
      const source = read(`packages/host/nexus-dsh-compat/${file}`)
      for (const name of ['SessionEvent', 'SessionWireEvent']) {
        expect(source.includes(name), `compat ${file} must not mention ${name} (only the adapter may)`).toBe(false)
      }
    }
  })

  it('re-exports the Context augmentation from the package root', () => {
    expect(read('packages/host/nexus-dsh-compat/src/index.ts')).toContain('export type {} from \'./plugin.ts\'')
  })

  it('keeps generated declarations free of dsh internal type names (when built)', () => {
    const dtsDir = 'packages/host/nexus-dsh-compat/lib/types'
    // The adapter's own declarations legitimately name dsh types; the public
    // face (what consumers compile against) must not.
    const entries = ['index.d.ts', 'types.d.ts', 'port.d.ts', 'errors.d.ts', 'plugin.d.ts'].filter((entry) => {
      try { readFileSync(`${repoRoot}${dtsDir}/${entry}`, 'utf8'); return true } catch { return false }
    })
    if (entries.length === 0) {
      // Unbuilt checkout: the source-plane scans above are the gate; the
      // declaration scan activates automatically once `pnpm run build` runs.
      console.warn('[isolation.gate] lib/types not built — declaration scan skipped')
      return
    }
    for (const name of entries) {
      const source = read(`${dtsDir}/${name}`)
      for (const forbidden of FORBIDDEN_ACROSS_SEAM) {
        expect(source.includes(forbidden), `${dtsDir}/${name} must not leak ${forbidden}`).toBe(false)
      }
      expect(source.includes('SessionWireEvent'), `${dtsDir}/${name} must not leak SessionWireEvent`).toBe(false)
    }
  })
})

describe('port isolation gate: composition order', () => {
  it('mounts the compat provider before the bridge in the web-app roster', () => {
    const patch = read('packages/bundle/web-app/cordis.patch.yml')
    const compatIndex = patch.indexOf('name: \'@deepseek-ai/dsh-host-nexus-compat\'')
    const bridgeIndex = patch.indexOf('name: \'@deepseek-ai/dsh-host-nexus-bridge\'')
    expect(compatIndex).toBeGreaterThan(-1)
    expect(bridgeIndex).toBeGreaterThan(compatIndex)
  })

  it('declares the compat package as a web-app dependency', () => {
    const manifest = JSON.parse(read('packages/bundle/web-app/package.json')) as { dependencies?: Record<string, string> }
    expect(manifest.dependencies?.['@deepseek-ai/dsh-host-nexus-compat']).toBeDefined()
  })
})
