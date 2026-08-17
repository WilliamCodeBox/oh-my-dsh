/**
 * Package-owned invariant companion for `@williamcodebox/omd-client-trajectory-model`.
 * @module @williamcodebox/omd-client-trajectory-model/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@williamcodebox/cordis'
import type { InvariantInstaller } from '@williamcodebox/omd-invariants'

const PACKAGE_NAME = '@williamcodebox/omd-client-trajectory-model'

/** Cordis companion plugin name. */
export const name = 'client-trajectory-model-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure model library — it emits no cordis events and
 * owns no mutable cross-plugin relation; record/layout/timeline semantics are
 * asserted directly by the consuming packages' behavior specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
