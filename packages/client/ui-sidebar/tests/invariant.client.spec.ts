import { describe, expect, it } from 'vitest'
import { Context } from '@williamcodebox/cordis'
import * as SidebarInvariant from '@williamcodebox/omd-client-ui-sidebar/invariant'
import InvariantRegistry from '@williamcodebox/omd-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(SidebarInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('@williamcodebox/omd-client-ui-sidebar')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
