/**
 * Package-owned invariant companion for `@williamcodebox/omd-tui`.
 * @module @williamcodebox/omd-tui/invariant
 */

import type { Context } from '@williamcodebox/cordis'
import type { InvariantInstaller } from '@williamcodebox/omd-invariants'

const PACKAGE_NAME = '@williamcodebox/omd-tui'

/** Cordis companion plugin name. */
export const name = 'tui-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the runner is an interactive driver over the API
 * carrier whose observable contract (traced events on stdout, restore-before-
 * exit, Ctrl+C semantics) is process-level and owned by the assembled
 * application; it registers nothing and holds no mutable relation to audit
 * inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
