/**
 * Package-owned invariant companion for `@williamcodebox/omd-session-title-all-prompts-llm`.
 * @module @williamcodebox/omd-session-title-all-prompts-llm/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@williamcodebox/cordis'
import type { InvariantInstaller } from '@williamcodebox/omd-invariants'

const PACKAGE_NAME = '@williamcodebox/omd-session-title-all-prompts-llm'

/** Cordis companion plugin name. */
export const name = 'session-title-all-prompts-llm-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this thin provider delegates request and result validation to the shared
 * title service and LLM helper and retains no independent mutable state.
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
