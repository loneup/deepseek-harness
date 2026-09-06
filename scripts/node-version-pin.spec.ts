import { expect, it } from 'vitest'
import { assertPinnedNodeVersion } from './node-version-pin.ts'

it('accepts a running Node that exactly matches the pin', () => {
  expect(() => { assertPinnedNodeVersion('22.23.1', '22.23.1\n') }).not.toThrow()
})

it('accepts the leading v and surrounding whitespace both sides write', () => {
  expect(() => { assertPinnedNodeVersion('v22.23.1', '  v22.23.1  \n') }).not.toThrow()
})

it('rejects a major mismatch with both versions named', () => {
  expect(() => { assertPinnedNodeVersion('26.3.0', '22.23.1\n') })
    .toThrow(/Node 26\.3\.0 does not match the pinned 22\.23\.1.*nvm use/s)
})

it('rejects a minor mismatch, the silent near-miss a PATH swap produces', () => {
  expect(() => { assertPinnedNodeVersion('22.19.0', '22.23.1\n') })
    .toThrow(/Node 22\.19\.0 does not match the pinned 22\.23\.1/)
})

it('rejects a patch mismatch so the pin stays exact', () => {
  expect(() => { assertPinnedNodeVersion('22.23.0', '22.23.1\n') })
    .toThrow(/Node 22\.23\.0 does not match the pinned 22\.23\.1/)
})

it('rejects a pin that is not one exact version', () => {
  for (const loose of ['22\n', 'lts/jod\n', '>=22.19.0\n', '\n']) {
    expect(() => { assertPinnedNodeVersion('22.23.1', loose) })
      .toThrow(/\.nvmrc must pin one exact Node version/)
  }
})
