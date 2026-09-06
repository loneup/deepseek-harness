/**
 * Launch the Nexus Web surface in an explicitly named environment.
 *
 * Usage: `pnpm run web:beta` or `pnpm run web:production` (equivalent to
 * `tsx scripts/run-web-env.ts <environment>`). The environment name is the
 * authority: this script resolves the environment's port, channel, and its own
 * `DSH_HOME` (every mutable path — device registry, audit log, kill switch —
 * lives under it), validates the release manifest when one is present, checks
 * that the port is free, and only then spawns `pnpm dsh --profile web`. Any
 * conflict fails loud before a child process exists.
 * @module
 */

import { mkdirSync } from 'node:fs'
import { existsSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveNexusEnvironment,
  validateManifestForEnvironment,
} from '@deepseek-ai/dsh-host-nexus-bridge'
import { assertPinnedNodeVersion } from './node-version-pin.ts'

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message: string): never {
  console.error(`run-web-env: ${message}`)
  process.exit(1)
}

/** Probe whether the port is already listening; a bound port is a launch conflict. */
function assertPortFree(port: number): Promise<void> {
  return new Promise<void>((resolveProbe) => {
    const probe = createServer()
    probe.once('error', () => fail(`port ${port} is already in use; stop the other process first (a running environment must never be silently reused)`))
    probe.listen(port, '127.0.0.1', () => { probe.close(() => { resolveProbe() }) })
  })
}

const environmentName = process.argv[2]
if (environmentName !== 'beta' && environmentName !== 'production') {
  fail(`usage: tsx scripts/run-web-env.ts <beta|production> (received ${JSON.stringify(process.argv[2] ?? '')})`)
}
// The Node pin fails before any environment work: a wrong-Node child dies on
// a native-module ABI loader error far from the cause (KNOWN_ISSUES #13).
const nvmrcPath = join(repoRoot, '.nvmrc')
if (!existsSync(nvmrcPath)) {
  fail(`no .nvmrc at ${nvmrcPath}; the launcher requires the Node version pin`)
}
try {
  assertPinnedNodeVersion(process.versions.node, readFileSync(nvmrcPath, 'utf8'))
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
void (async () => {
  // Port conflicts must fail before the child spawns; the resolver itself
  // rejects the other environment's port.
  const config = resolveNexusEnvironment({
    env: environmentName,
    port: process.env.NEXUS_WEB_PORT === undefined ? undefined : Number(process.env.NEXUS_WEB_PORT),
    channel: process.env.NEXUS_PLUGIN_CHANNEL,
    dshHome: process.env.DSH_HOME,
    homeDir: process.env.HOME,
  })
  await assertPortFree(config.port)

  // Environment-owned mutable state lives under its own DSH_HOME. The device
  // registry loads fail-loud, so an empty registry is seeded on first boot.
  for (const dir of ['registry', 'audit', 'killswitch', 'manifests'] as const) {
    mkdirSync(`${config.dshHome}/${dir}`, { recursive: true })
  }
  if (!existsSync(config.registryPath)) {
    writeFileSync(config.registryPath, JSON.stringify({ devices: [], pairingCodes: [] }), 'utf8')
  }

  // Validate the release manifest when one is present for this environment.
  const repoManifestPath = `${repoRoot}/release-manifests/${config.environment}.json`
  const manifestPath = existsSync(config.manifestPath) ? config.manifestPath : (existsSync(repoManifestPath) ? repoManifestPath : undefined)
  if (manifestPath === undefined) {
    fail(`no release manifest found for ${config.environment} (looked at ${config.manifestPath} and ${repoManifestPath})`)
  }
  const manifest = validateManifestForEnvironment(JSON.parse(readFileSync(manifestPath, 'utf8')), config.environment)
  if (manifest.channel !== config.channel) {
    fail(`manifest channel ${JSON.stringify(manifest.channel)} does not match the environment channel ${JSON.stringify(config.channel)}`)
  }

  console.log(`[nexus:${config.environment}] environment=${config.environment} port=${config.port} channel=${config.channel} adapter=${manifest.adapterId} dsh=${manifest.dshVersion}@${manifest.dshCommit} dshHome=${config.dshHome}`)

  const child = spawn('pnpm', ['dsh', '--profile', 'web', '--port', String(config.port), '--no-open'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEXUS_ENV: config.environment,
      NEXUS_PLUGIN_CHANNEL: config.channel,
      NEXUS_WEB_PORT: String(config.port),
      DSH_HOME: config.dshHome,
      NEXUS_DEVICES_PATH: config.registryPath,
      NEXUS_AUDIT_PATH: config.auditPath,
      NEXUS_KILLSWITCH_PATH: config.killSwitchPath,
      NEXUS_RELEASE_MANIFEST: manifestPath,
      NEXUS_RELEASE: manifest.dshVersion,
    },
    stdio: 'inherit',
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { child.kill(signal) })
  }
  child.once('exit', (code, signalName) => { process.exit(code ?? (signalName === 'SIGINT' ? 130 : 1)) })
})().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
