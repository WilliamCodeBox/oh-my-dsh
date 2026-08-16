/**
 * Package-owned invariant companion for
 * `@williamcodebox/omd-subagent-claude-code`.
 * @module @williamcodebox/omd-subagent-claude-code/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@williamcodebox/cordis'
import type { InvariantInstaller } from '@williamcodebox/omd-invariants'

const PACKAGE_NAME = '@williamcodebox/omd-subagent-claude-code'

/** Cordis companion plugin name. */
export const name = 'subagent-claude-code-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: lifecycle pairing belongs to the shared subagent
 * service and process-tree ownership belongs to the subprocess service.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
