/**
 * Nexus environment resolution: the authoritative beta/production split.
 *
 * The environment name (`NEXUS_ENV`) is the single source of truth — the port
 * is configuration and must never be used to infer the environment. Every
 * derived path (device registry, audit log, kill switch, manifest) lives under
 * the environment's own `DSH_HOME`, so two environments share no mutable state.
 * Resolution fails loud at startup: a missing or invalid environment name, a
 * port that belongs to the other environment, a channel that contradicts the
 * environment, or a home directory that collides with the other environment
 * are composition errors, not runtime fallbacks.
 * @module
 */

/** The two Nexus runtime environments. */
export type NexusEnvironment = 'beta' | 'production'

/** Release channels a Nexus deployment may serve. */
export type NexusPluginChannel = 'beta' | 'stable-candidate' | 'stable'

/** Default listen port per environment. */
export const DEFAULT_ENVIRONMENT_PORTS: Readonly<Record<NexusEnvironment, number>> = {
  beta: 3088,
  production: 3000,
}

/** The only channel each environment may serve. */
export const DEFAULT_ENVIRONMENT_CHANNELS: Readonly<Record<NexusEnvironment, NexusPluginChannel>> = {
  beta: 'beta',
  production: 'stable-candidate',
}

/** Ports that belong to the OTHER environment and must never be reused. */
const RESERVED_OTHER_ENVIRONMENT_PORTS: Readonly<Record<NexusEnvironment, number>> = {
  beta: DEFAULT_ENVIRONMENT_PORTS.production,
  production: DEFAULT_ENVIRONMENT_PORTS.beta,
}

/** Fully resolved runtime configuration for one environment. */
export interface NexusEnvironmentConfig {
  readonly environment: NexusEnvironment
  readonly port: number
  readonly channel: NexusPluginChannel
  /** The environment's own dsh home; every mutable path lives under it. */
  readonly dshHome: string
  readonly registryPath: string
  readonly auditPath: string
  readonly killSwitchPath: string
  readonly manifestPath: string
}

/** Raw environment values as read from process.env before resolution. */
export interface ResolveNexusEnvironmentInput {
  /** Explicit environment name; `undefined` or `''` fails loud. */
  readonly env?: string | undefined
  /** Explicit port; defaults to the environment's default. */
  readonly port?: number | undefined
  /** Explicit channel; defaults to the environment's channel. */
  readonly channel?: string | undefined
  /** Explicit dsh home; defaults to `~/.dsh/nexus-<environment>`. */
  readonly dshHome?: string | undefined
  /** The process home directory (injected for testability). */
  readonly homeDir?: string | undefined
}

function fail(message: string): never {
  throw new Error(`nexus environment: ${message}`)
}

function parseEnvironment(env: string | undefined): NexusEnvironment {
  if (env === undefined || env === '') fail('NEXUS_ENV is not set; set it explicitly to beta or production (the port must never imply the environment)')
  if (env !== 'beta' && env !== 'production') fail(`invalid NEXUS_ENV ${JSON.stringify(env)}; expected 'beta' or 'production'`)
  return env
}

function parsePort(environment: NexusEnvironment, port: number | undefined): number {
  if (port === undefined) return DEFAULT_ENVIRONMENT_PORTS[environment]
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`invalid port ${JSON.stringify(port)}`)
  if (port === RESERVED_OTHER_ENVIRONMENT_PORTS[environment]) {
    fail(`port ${port} belongs to the ${environment === 'beta' ? 'production' : 'beta'} environment; the ${environment} environment must not listen on it`)
  }
  return port
}

function parseChannel(environment: NexusEnvironment, channel: string | undefined): NexusPluginChannel {
  if (channel === undefined || channel === '') return DEFAULT_ENVIRONMENT_CHANNELS[environment]
  if (channel !== 'beta' && channel !== 'stable-candidate' && channel !== 'stable') {
    fail(`invalid channel ${JSON.stringify(channel)}; expected 'beta', 'stable-candidate', or 'stable'`)
  }
  const allowed = DEFAULT_ENVIRONMENT_CHANNELS[environment]
  const alternatives = environment === 'production' ? (['stable-candidate', 'stable'] as const) : (['beta'] as const)
  if (!alternatives.includes(channel as never)) {
    fail(`channel ${JSON.stringify(channel)} contradicts the ${environment} environment; expected ${JSON.stringify(allowed)}`)
  }
  return channel
}

function resolveDshHome(environment: NexusEnvironment, dshHome: string | undefined, homeDir: string | undefined): string {
  if (dshHome === undefined || dshHome === '') {
    const home = homeDir ?? ''
    if (home === '') fail('cannot resolve the default DSH_HOME without a process home directory')
    return `${home}/.dsh/nexus-${environment}`
  }
  const otherDefault = `/nexus-${environment === 'beta' ? 'production' : 'beta'}`
  if (dshHome.endsWith(otherDefault)) {
    fail(`DSH_HOME ${JSON.stringify(dshHome)} is the ${environment === 'beta' ? 'production' : 'beta'} environment's default home; environments must not share mutable state`)
  }
  return dshHome
}

/**
 * Validate the environment identity triple without resolving any path.
 * @param env - explicit environment name.
 * @param channel - explicit channel; `undefined` falls back to the environment default.
 * @param port - explicit port; `undefined` falls back to the environment default.
 * @returns the validated identity.
 * @throws Error when the name is missing/invalid or the channel or port
 *   contradicts the environment.
 */
export function validateEnvironmentIdentity(
  env: string | undefined,
  channel: string | undefined,
  port: number | undefined,
): { readonly environment: NexusEnvironment; readonly channel: NexusPluginChannel; readonly port: number } {
  const environment = parseEnvironment(env)
  return { environment, channel: parseChannel(environment, channel), port: parsePort(environment, port) }
}

/**
 * Resolve one environment's full configuration from explicit inputs.
 * @param input - raw environment values (already read from process.env by the caller).
 * @returns the resolved configuration with every derived path.
 * @throws Error when the environment is missing/invalid, the port or channel
 *   contradicts the environment, or the home directory collides across
 *   environments.
 */
export function resolveNexusEnvironment(input: ResolveNexusEnvironmentInput): NexusEnvironmentConfig {
  const environment = parseEnvironment(input.env)
  const port = parsePort(environment, input.port)
  const channel = parseChannel(environment, input.channel)
  const dshHome = resolveDshHome(environment, input.dshHome, input.homeDir)
  return {
    environment,
    port,
    channel,
    dshHome,
    registryPath: `${dshHome}/registry/devices.json`,
    auditPath: `${dshHome}/audit/audit.jsonl`,
    killSwitchPath: `${dshHome}/killswitch/kill-switch.json`,
    manifestPath: `${dshHome}/manifests/release.json`,
  }
}

/**
 * Validate one release manifest against the target environment.
 * @param manifest - parsed manifest JSON (unknown at the boundary).
 * @param environment - the environment the manifest is about to be loaded into.
 * @returns the validated manifest fields the launcher may rely on.
 * @throws Error when the schema version, environment, channel, or plugin
 *   versions contradict the environment (including dynamic tags and the
 *   removed `dsh-client-runtime` package).
 */
export function validateManifestForEnvironment(manifest: unknown, environment: NexusEnvironment): {
  readonly dshVersion: string
  readonly dshCommit: string
  readonly adapterId: string
  readonly protocolVersion: number
  readonly channel: NexusPluginChannel
} {
  if (typeof manifest !== 'object' || manifest === null) fail('release manifest must be a JSON object')
  const m = manifest as Record<string, unknown>
  if (m.schemaVersion !== 1) fail(`unsupported manifest schemaVersion ${JSON.stringify(m.schemaVersion)}`)
  if (m.environment !== environment) {
    fail(`manifest environment ${JSON.stringify(m.environment)} does not match ${JSON.stringify(environment)}`)
  }
  const channel = parseChannel(environment, typeof m.channel === 'string' ? m.channel : undefined)
  const plugins = m.plugins
  if (typeof plugins !== 'object' || plugins === null) fail('manifest plugins must be an object')
  for (const [name, entry] of Object.entries(plugins as Record<string, unknown>)) {
    if (name === '@deepseek-ai/dsh-client-runtime') {
      fail('dsh-client-runtime was removed from the architecture and must never reappear in a manifest')
    }
    if (typeof entry !== 'object' || entry === null) fail(`manifest plugin ${name} must be an object`)
    const version = (entry as { version?: unknown }).version
    if (typeof version !== 'string' || version === '') fail(`manifest plugin ${name} needs an exact version`)
    if (/^[^0-9]/.test(version) || version.includes('^') || version.includes('~') || version === 'latest' || version === '*') {
      fail(`manifest plugin ${name} version ${JSON.stringify(version)} is not an exact version; dynamic tags are not reproducible`)
    }
  }
  for (const field of ['dshVersion', 'dshCommit', 'adapterId'] as const) {
    if (typeof m[field] !== 'string' || (m[field]) === '') fail(`manifest field ${field} is required`)
  }
  if (m.protocolVersion !== 4) fail(`manifest protocolVersion ${JSON.stringify(m.protocolVersion)} does not match the Nexus v4 wire`)
  return {
    dshVersion: m.dshVersion as string,
    dshCommit: m.dshCommit as string,
    adapterId: m.adapterId as string,
    protocolVersion: m.protocolVersion,
    channel,
  }
}
