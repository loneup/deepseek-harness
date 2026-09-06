import { describe, expect, it } from 'vitest'
import { resolveNexusEnvironment, validateManifestForEnvironment } from '../src/environment.ts'

const home = '/Users/tester'

describe('resolveNexusEnvironment explicit environment', () => {
  it('defaults beta to port 3088 and its own dsh home', () => {
    const config = resolveNexusEnvironment({ env: 'beta', homeDir: home })
    expect(config).toMatchObject({
      environment: 'beta',
      port: 3088,
      channel: 'beta',
      dshHome: `${home}/.dsh/nexus-beta`,
      registryPath: `${home}/.dsh/nexus-beta/registry/devices.json`,
      auditPath: `${home}/.dsh/nexus-beta/audit/audit.jsonl`,
      killSwitchPath: `${home}/.dsh/nexus-beta/killswitch/kill-switch.json`,
      manifestPath: `${home}/.dsh/nexus-beta/manifests/release.json`,
    })
  })

  it('defaults production to port 3000 and the stable-candidate channel', () => {
    const config = resolveNexusEnvironment({ env: 'production', homeDir: home })
    expect(config).toMatchObject({
      environment: 'production',
      port: 3000,
      channel: 'stable-candidate',
      dshHome: `${home}/.dsh/nexus-production`,
    })
  })

  it('fails loud when the environment name is missing — the port must never imply it', () => {
    expect(() => resolveNexusEnvironment({ port: 3088, homeDir: home })).toThrow(/NEXUS_ENV is not set/)
    expect(() => resolveNexusEnvironment({ env: '', homeDir: home })).toThrow(/NEXUS_ENV is not set/)
  })

  it('fails loud on an invalid environment name', () => {
    expect(() => resolveNexusEnvironment({ env: 'staging', homeDir: home })).toThrow(/invalid NEXUS_ENV/)
  })

  it('rejects a port that belongs to the other environment', () => {
    expect(() => resolveNexusEnvironment({ env: 'beta', port: 3000, homeDir: home })).toThrow(/belongs to the production environment/)
    expect(() => resolveNexusEnvironment({ env: 'production', port: 3088, homeDir: home })).toThrow(/belongs to the beta environment/)
  })

  it('accepts non-default ports within the environment', () => {
    expect(resolveNexusEnvironment({ env: 'beta', port: 3188, homeDir: home }).port).toBe(3188)
  })

  it('rejects a channel that contradicts the environment', () => {
    expect(() => resolveNexusEnvironment({ env: 'production', channel: 'beta', homeDir: home })).toThrow(/contradicts the production environment/)
    expect(() => resolveNexusEnvironment({ env: 'beta', channel: 'stable', homeDir: home })).toThrow(/contradicts the beta environment/)
    expect(resolveNexusEnvironment({ env: 'production', channel: 'stable', homeDir: home }).channel).toBe('stable')
  })

  it('rejects an invalid channel name', () => {
    expect(() => resolveNexusEnvironment({ env: 'beta', channel: 'canary', homeDir: home })).toThrow(/invalid channel/)
  })

  it('refuses the other environment\'s default dsh home', () => {
    expect(() => resolveNexusEnvironment({ env: 'beta', dshHome: `${home}/.dsh/nexus-production` })).toThrow(/must not share mutable state/)
    expect(() => resolveNexusEnvironment({ env: 'production', dshHome: `${home}/.dsh/nexus-beta` })).toThrow(/must not share mutable state/)
  })

  it('honors an explicit non-colliding dsh home override', () => {
    expect(resolveNexusEnvironment({ env: 'beta', dshHome: '/srv/nexus-beta-home' }).dshHome).toBe('/srv/nexus-beta-home')
  })
})

const betaManifest = {
  schemaVersion: 1,
  environment: 'beta',
  channel: 'beta',
  dshVersion: '0.1.3-alpha.1',
  dshCommit: 'c02ff34',
  adapterId: 'dsh-013',
  protocolVersion: 4,
  plugins: {
    '@deepseek-ai/dsh-client-modules': { version: '0.1.3-alpha.1', sourceCommit: 'c02ff34' },
    '@deepseek-ai/dsh-cordis-client-runner': { version: '0.1.3-alpha.1', sourceCommit: 'c02ff34' },
    '@deepseek-ai/dsh-client-connection': { version: '0.1.3-alpha.1', sourceCommit: 'c02ff34' },
    '@deepseek-ai/dsh-client-ui-settings-nexus': { version: '0.1.3-alpha.1', sourceCommit: 'c02ff34' },
  },
}

describe('validateManifestForEnvironment', () => {
  it('accepts a matching beta manifest and returns its identity fields', () => {
    expect(validateManifestForEnvironment(betaManifest, 'beta')).toEqual({
      dshVersion: '0.1.3-alpha.1',
      dshCommit: 'c02ff34',
      adapterId: 'dsh-013',
      protocolVersion: 4,
      channel: 'beta',
    })
  })

  it('refuses to load a beta manifest into production and vice versa', () => {
    expect(() => validateManifestForEnvironment(betaManifest, 'production')).toThrow(/does not match "production"/)
    const productionManifest = { ...betaManifest, environment: 'production', channel: 'stable-candidate' }
    expect(() => validateManifestForEnvironment(productionManifest, 'beta')).toThrow(/does not match "beta"/)
  })

  it('rejects dynamic tags and range specifiers as plugin versions', () => {
    const bad = { ...betaManifest, plugins: { '@deepseek-ai/dsh-client-modules': { version: 'beta', sourceCommit: 'x' } } }
    expect(() => validateManifestForEnvironment(bad, 'beta')).toThrow(/not an exact version/)
    const ranged = { ...betaManifest, plugins: { '@deepseek-ai/dsh-client-modules': { version: '^0.1.4', sourceCommit: 'x' } } }
    expect(() => validateManifestForEnvironment(ranged, 'beta')).toThrow(/not an exact version/)
  })

  it('refuses the removed dsh-client-runtime package', () => {
    const bad = { ...betaManifest, plugins: { ...betaManifest.plugins, '@deepseek-ai/dsh-client-runtime': { version: '0.1.3-alpha.1', sourceCommit: 'x' } } }
    expect(() => validateManifestForEnvironment(bad, 'beta')).toThrow(/must never reappear/)
  })

  it('rejects a wrong wire protocol version and missing identity fields', () => {
    expect(() => validateManifestForEnvironment({ ...betaManifest, protocolVersion: 3 }, 'beta')).toThrow(/protocolVersion/)
    expect(() => validateManifestForEnvironment({ ...betaManifest, adapterId: '' }, 'beta')).toThrow(/adapterId is required/)
  })
})
