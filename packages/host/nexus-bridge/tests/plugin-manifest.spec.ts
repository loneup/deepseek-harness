import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateManifestForEnvironment } from '../src/environment.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const read = (path: string): string => readFileSync(`${repoRoot}${path}`, 'utf8')

const BETA = JSON.parse(read('release-manifests/beta.json')) as Record<string, unknown>
const PRODUCTION = JSON.parse(read('release-manifests/production.json')) as Record<string, unknown>

/** The client plugins the Nexus Web surface must serve; the removed runtime package must never appear. */
const REQUIRED_PLUGINS = [
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-cordis-client-runner',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-settings-nexus',
] as const

describe('release manifests', () => {
  it('beta manifest validates against the beta environment', () => {
    expect(validateManifestForEnvironment(BETA, 'beta')).toMatchObject({
      dshVersion: '0.1.3-alpha.1',
      dshCommit: 'c02ff3445150ebece9da48ffde717ce600df4f0e',
      adapterId: 'dsh-013',
      protocolVersion: 4,
      channel: 'beta',
    })
  })

  it('production manifest validates against the production environment as stable-candidate', () => {
    expect(validateManifestForEnvironment(PRODUCTION, 'production')).toMatchObject({
      channel: 'stable-candidate',
      adapterId: 'dsh-013',
      protocolVersion: 4,
    })
  })

  it('cross-loads fail: a beta manifest never enters production and vice versa', () => {
    expect(() => validateManifestForEnvironment(BETA, 'production')).toThrow(/does not match/)
    expect(() => validateManifestForEnvironment(PRODUCTION, 'beta')).toThrow(/does not match/)
  })

  it('every manifest pins exact plugin versions and covers the required client roster', () => {
    for (const [name, manifest] of [['beta', BETA], ['production', PRODUCTION]] as const) {
      const plugins = manifest.plugins as Record<string, { version: string }>
      for (const required of REQUIRED_PLUGINS) {
        expect(plugins[required], `${name} manifest must cover ${required}`).toBeDefined()
        expect(plugins[required]!.version, `${required} must pin an exact version`).toMatch(/^\d+\.\d+\.\d+/)
      }
      expect(Object.keys(plugins).some(key => key.includes('client-runtime')), `${name} must not list dsh-client-runtime`).toBe(false)
    }
  })

  it('records traceability fields: nexus commit, build metadata, and lockfile hash', () => {
    for (const [name, manifest] of [['beta', BETA], ['production', PRODUCTION]] as const) {
      expect(typeof manifest.nexusCommit, `${name} nexusCommit`).toBe('string')
      const build = manifest.build as Record<string, unknown>
      expect(typeof build.nodeVersion, `${name} nodeVersion`).toBe('string')
      expect(build.pnpmLockSha256, `${name} pnpmLockSha256`).toMatch(/^[0-9a-f]{64}$/)
      expect(typeof build.buildTimestamp, `${name} buildTimestamp`).toBe('string')
    }
  })

  it('keeps the two channels distinct: beta never ships stable, production never ships beta', () => {
    expect(BETA.channel).toBe('beta')
    expect(PRODUCTION.channel).toBe('stable-candidate')
  })
})
