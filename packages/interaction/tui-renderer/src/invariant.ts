/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tui-renderer`.
 * @module @deepseek-ai/dsh-tui-renderer/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tui-renderer'

/** Cordis companion plugin name. */
export const name = 'tui-renderer-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the transcript model is a pure fold over the session
 * event stream; the session layer owns event validation, and the runner's
 * contract is process-level (terminal restore) rather than data-level.
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
