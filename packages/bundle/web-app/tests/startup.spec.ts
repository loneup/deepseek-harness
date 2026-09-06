/**
 * The Web command-line provider over a real Loader tree: its ordinary service
 * releases a consumer whose config reads `ctx.webStartup` directly.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import ClientModuleRegistry from '@deepseek-ai/dsh-client-modules'
import uiSettingsNexusNode from '@deepseek-ai/dsh-client-ui-settings-nexus'
import * as frontendStatic from '@deepseek-ai/dsh-host-frontend-static'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, WEB_STARTUP_SERVICE, type WebStartupValues } from '../src/startup.ts'

/** What one fixture boot observed. */
interface Observed {
  exits: number[]
  out: string
  readerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

/** Fixture tree roots, removed after their booted tree has been disposed. */
const tempDirs: string[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/**
 * Mount the real provider and a consumer using injection-ordered config.
 * @param args - the invocation's inner arguments.
 * @returns the service value and observed consumer/process effects.
 */
async function bootProvider(args: string[]): Promise<{
  values: WebStartupValues | undefined
  observed: Observed
}> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-web-startup-'))
  tempDirs.push(dir)
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'reader.mjs'), `
export function apply(_ctx, config) { globalThis.__webStartupObserved.readerConfig = config }
`)
  // Node imports the fixture row outside Vite's source resolver, so delegate
  // to the source-plane plugin already imported by this test.
  writeFileSync(join(dir, 'provider.mjs'), `
export const name = 'web-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__webStartupApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: reader',
    `  name: ${pathToFileURL(join(dir, 'reader.mjs')).href}`,
    `  inject: [${WEB_STARTUP_SERVICE}]`,
    '  config:',
    "    host: !!js ctx.webStartup.host ?? '127.0.0.1'",
    '    openBrowser: !!js ctx.webStartup.openBrowser',
    '    port: !!js ctx.webStartup.port ?? 3080',
    '    trustedHosts: !!js ctx.webStartup.trustedHosts',
    '- id: provider',
    `  name: ${pathToFileURL(join(dir, 'provider.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __webStartupApply: typeof apply
    __webStartupObserved: Observed
  }
  globals.__webStartupApply = apply
  globals.__webStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    values: ctx.get(WEB_STARTUP_SERVICE) as WebStartupValues | undefined,
    observed,
  }
}

describe('web command-line provider', () => {
  it('publishes each flag and releases direct service expressions', async () => {
    const { values, observed } = await bootProvider([
      '--host', '127.0.0.1',
      '--no-open',
      '--port', '8080',
      '--trusted-host', 'lab.internal', 'lab-2.internal',
      '--trusted-host', '10.0.0.9',
    ])
    expect(values).toEqual({
      host: '127.0.0.1',
      openBrowser: false,
      port: 8080,
      trustedHosts: ['lab.internal', 'lab-2.internal', '10.0.0.9'],
    })
    expect(observed.readerConfig).toEqual(values)
    expect(observed.exits).toEqual([])
  })

  it('leaves deployment values to each consumer when flags omit them', async () => {
    const { values, observed } = await bootProvider([])
    expect(values).toEqual({ openBrowser: true, trustedHosts: [] })
    expect(observed.readerConfig).toEqual({
      host: '127.0.0.1',
      openBrowser: true,
      port: 3080,
      trustedHosts: [],
    })
  })

  it('prints its own help and leaves the consumer pending', async () => {
    const { values, observed } = await bootProvider(['--help'])
    expect(observed.out).toContain('dsh --profile web')
    expect(observed.out).toContain('--no-open')
    expect(observed.out).toContain('--trusted-host')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('rejects a non-numeric port before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--port', 'abc'])
    expect(observed.out).toContain('--port must be a number')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('rejects the intentionally unsupported all-interfaces host before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--host', '0.0.0.0'])
    expect(observed.out).toContain('--host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
})

// ── Web startup HTTP surface ─────────────────────────────────────────────────
//
// REAL-composition coverage of the boot surface the `--profile web` command
// serves: webserver + client-modules (the /plugins node half) + the
// ui-settings-nexus browser roster row + the frontend-static fallback seat
// over a fixture dist, booted through the vendored Loader exactly like the
// webserver suite. It pins the /plugins URL contract — served resources are
// `??` combo URLs with a rev query; a bare `/plugins/<id>/client.js` is an
// unknown resource — and that the homepage injects the composed boot graph
// with non-empty JavaScript bundles for every advertised script.

const MODULES_ID = '@deepseek-ai/dsh-client-modules'
const NEXUS_SETTINGS_ID = '@deepseek-ai/dsh-client-ui-settings-nexus'

/** The workspace package roots the fixture tree resolves the client rows to. */
function workspacePackageRoot(packageName: string): string {
  const manifest = createRequire(import.meta.url).resolve(`${packageName}/package.json`)
  return join(manifest, '..')
}

interface StartedWeb {
  /** The OS-assigned listening port of the booted webserver. */
  port: number
  /** The composed boot graph entries by plugin id. */
  entries: Map<string, { url: string }>
  homepage: string
}

/**
 * Boot the real web surface over a fixture dist: webserver (port 0), the
 * client-modules node half scanning the two real workspace client packages,
 * and the frontend-static fallback seat. The connection service is stubbed to
 * the authorized case because authentication is a Connection node-half concern,
 * not part of this startup surface.
 */
async function bootWebSurface(): Promise<StartedWeb> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-web-startup-http-'))
  tempDirs.push(root)
  // The fixture tree resolves client rows through its own node_modules, so the
  // real workspace packages (and their built lib/client.js artifacts) are
  // linked in — a missing build fails the composition loud, exactly like a
  // real `dsh --profile web` launch before `pnpm run build:lib:client`.
  for (const packageName of [MODULES_ID, NEXUS_SETTINGS_ID]) {
    const scope = join(root, 'node_modules', ...packageName.split('/').slice(0, -1))
    mkdirSync(scope, { recursive: true })
    symlinkSync(workspacePackageRoot(packageName), join(scope, packageName.split('/').at(-1)!), 'dir')
  }
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true })
  const distIndex = join(root, 'dist', 'index.html')
  writeFileSync(distIndex, '<!doctype html><html><head><title>fixture dist</title></head><body><div id="root"></div><script type="module" src="./assets/main.js"></script></body></html>')
  writeFileSync(join(root, 'dist', 'assets', 'main.js'), 'console.log("fixture dist");\n')
  const configPath = join(root, 'cordis.yml')
  writeFileSync(configPath, [
    '- id: webserver',
    "  name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    '- id: connection-stub',
    '  name: connection-stub',
    '- id: modules',
    `  name: '${MODULES_ID}'`,
    '- id: ui-settings-nexus',
    `  name: '${NEXUS_SETTINGS_ID}'`,
    '- id: frontend-static',
    "  name: '@deepseek-ai/dsh-host-frontend-static'",
    '  config:',
    `    distIndex: ${JSON.stringify(distIndex)}`,
    '',
  ].join('\n'))

  const connectionStub = {
    name: 'connection-stub',
    inject: [] as const,
    apply: (ctx: Context): void => {
      ctx.provide('connection', { authorizeIndex: () => true })
    },
  }
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['connection-stub', connectionStub],
    [MODULES_ID, ClientModuleRegistry],
    [NEXUS_SETTINGS_ID, uiSettingsNexusNode],
    ['@deepseek-ai/dsh-host-frontend-static', frontendStatic],
  ])
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })

  const webServer = ctx.webServer
  const graph = ctx.clientModules.graph()
  const entries = new Map(graph.entries.map(entry => [entry.id, { url: entry.url }]))
  const homepage = await (await fetch(`http://127.0.0.1:${String(webServer.port)}/`)).text()
  return { port: webServer.port, entries, homepage }
}

describe('web startup HTTP surface', () => {
  it('serves the composed roster: client-modules and ui-settings-nexus bundles answer 200 with non-empty JavaScript', async () => {
    const started = await bootWebSurface()
    for (const id of [MODULES_ID, NEXUS_SETTINGS_ID]) {
      const entry = started.entries.get(id)
      expect(entry, `${id} must be composed into the boot graph`).toBeDefined()
      const response = await fetch(`http://127.0.0.1:${String(started.port)}${entry!.url}`)
      expect(response.status, `${entry!.url} must answer 200`).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
      const body = await response.text()
      expect(body.length, `${entry!.url} must serve a non-empty bundle`).toBeGreaterThan(0)
      expect(body).toContain('window.__ModuleLoader__.load(')
      expect(body).toContain(`id: ${JSON.stringify(id)}`)
    }
  })

  it('keeps the /plugins URL contract: bare single-plugin paths and unknown ids are unknown resources', async () => {
    const started = await bootWebSurface()
    // The served form is always the `??` combo URL with a rev query (what the
    // homepage injects); the bare `/plugins/<id>/client.js` shape is 404.
    for (const path of [
      `/plugins/${MODULES_ID}/client.js`,
      `/plugins/${NEXUS_SETTINGS_ID}/client.js`,
      '/plugins/@deepseek-ai/dsh-client-runtime/client.js',
      started.entries.get(MODULES_ID)!.url.replace(/^\/plugins\/\?\?/, '/plugins/'),
    ]) {
      const response = await fetch(`http://127.0.0.1:${String(started.port)}${path}`)
      expect(response.status, `${path} must be an unknown resource`).toBe(404)
    }
  })

  it('injects the full boot graph into the homepage so the page can start every roster plugin', async () => {
    const started = await bootWebSurface()
    expect(started.homepage).toContain('__DSH_BOOT__')
    for (const id of [MODULES_ID, NEXUS_SETTINGS_ID]) {
      const entry = started.entries.get(id)
      expect(entry, `${id} must be composed into the boot graph`).toBeDefined()
      // The homepage advertises the plugin both as a preload and as the
      // executed script tag, with the exact served URL.
      expect(started.homepage).toContain(entry!.url)
    }
  })
})
