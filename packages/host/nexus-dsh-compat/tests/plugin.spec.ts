import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CompatPlugin from '../src/plugin.ts'
import type { NexusDshPort } from '../src/port.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const fakeSessionController = { marker: 'sessionController' }
const fakeSubagents = { marker: 'subagents' }

async function harness(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.reflect.provide('sessionController', fakeSessionController)
  ctx.reflect.provide('subagents', fakeSubagents)
  await ctx.plugin(CompatPlugin)
  return ctx
}

describe('nexus-dsh-compat provider', () => {
  it('provides ctx.nexusDsh bound to the composed services', async () => {
    const ctx = await harness()
    const port: NexusDshPort = ctx.nexusDsh
    expect(port).toBeDefined()
    expect(typeof port.listSessions).toBe('function')
    expect(typeof port.readHistory).toBe('function')
  })

  it('rejects an unknown adapter at load', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.reflect.provide('sessionController', fakeSessionController)
    ctx.reflect.provide('subagents', fakeSubagents)
    await expect(ctx.plugin(CompatPlugin, { adapter: 'dsh-014' })).rejects.toThrow(/unknown nexus-dsh adapter/)
  })

  it('fails loud when sessionController is missing', () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.reflect.provide('subagents', fakeSubagents)
    expect(() =>{  CompatPlugin.apply(ctx, { adapter: 'dsh-013' }) }).toThrow(/sessionController/)
  })

  it('fails loud when subagents is missing', () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.reflect.provide('sessionController', fakeSessionController)
    expect(() =>{  CompatPlugin.apply(ctx, { adapter: 'dsh-013' }) }).toThrow(/subagents/)
  })

  it('releases the port with the fiber', async () => {
    const ctx = await harness()
    expect(ctx.nexusDsh).toBeDefined()
    await ctx.fiber.dispose()
    const after = (() => {
      try {
        return (ctx as unknown as { nexusDsh?: NexusDshPort }).nexusDsh
      } catch {
        return undefined
      }
    })()
    expect(after).toBeUndefined()
  })
})
