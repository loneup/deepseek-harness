/**
 * UI Settings Nexus - TEMPORARILY DISABLED
 *
 * This package requires migration after dsh 0.1.3-alpha.1 upgrade.
 * See packages/host/nexus-bridge/MIGRATION_TODO.md for details.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'

export const NS = 'settings.nexus'
export const inject = []

export function apply(_ctx: ClientContext): void {
  console.warn('[ui-settings-nexus] DISABLED: This plugin requires migration. See nexus-bridge/MIGRATION_TODO.md')
  // No-op until migration is complete
}
