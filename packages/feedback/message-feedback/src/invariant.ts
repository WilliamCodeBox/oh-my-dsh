/** Package-owned invariant companion. @module @williamcodebox/omd-message-feedback/invariant */

/* jscpd:ignore-start */
import type { Context } from '@williamcodebox/cordis'
import type { InvariantInstaller } from '@williamcodebox/omd-invariants'

const PACKAGE_NAME = '@williamcodebox/omd-message-feedback'

/** Cordis companion plugin name. */
export const name = 'message-feedback-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the private typed writer owns current row mutations,
 * the domain schema validates rows on reopen, and no second authority exists.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['messageFeedback'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
