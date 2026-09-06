/**
 * The Node version pin the environment launcher enforces before spawning
 * anything.
 *
 * Native addons in this checkout (fs-ext, the landlock runner) are built for
 * one Node ABI. A PATH that resolves the launcher to another Homebrew Node
 * lets the child die on an ABI loader error far from the cause
 * (KNOWN_ISSUES #13), so the launcher names the mismatch itself, before any
 * port, registry, or manifest work happens.
 * @module
 */

/** Normalise an `.nvmrc` line or `process.versions.node` for comparison. */
function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/, '')
}

/**
 * Assert the running Node is exactly the `.nvmrc` pin.
 * @param running - `process.versions.node` of the launching process.
 * @param pinned - The raw `.nvmrc` file content.
 * @throws When the pin is not one exact `major.minor.patch` version, or the
 * running Node differs from it in any component.
 */
export function assertPinnedNodeVersion(running: string, pinned: string): void {
  const expected = normalizeVersion(pinned)
  if (!/^\d+\.\d+\.\d+$/.test(expected)) {
    throw new Error(`node-version-pin: .nvmrc must pin one exact Node version, found ${JSON.stringify(pinned.trim())}`)
  }
  if (normalizeVersion(running) !== expected) {
    throw new Error(
      `node-version-pin: Node ${normalizeVersion(running)} does not match the pinned ${expected}; run \`nvm use\` in the repository — native modules are built for the pinned version, and any other Node aborts on an ABI loader error`,
    )
  }
}
