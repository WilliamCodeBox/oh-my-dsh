import { describe, expect, it } from 'vitest'
import { Context } from '@williamcodebox/cordis'
import * as SlotsInvariant from '@williamcodebox/omd-client-ui-slots/invariant'
import InvariantRegistry from '@williamcodebox/omd-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(SlotsInvariant).await()).resolves.toBeDefined()
  })
})
