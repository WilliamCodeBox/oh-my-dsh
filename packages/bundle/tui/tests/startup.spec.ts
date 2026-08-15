/**
 * The terminal app's ordinary command-line provider over a real Loader tree:
 * the flags become injected runner config, while help and usage errors leave
 * the consumer pending.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, TUI_STARTUP_SERVICE, type TuiStartupValues } from '../src/startup.ts'

/** What one boot of the fixture tree observed. */
interface Observed {
  exits: number[]
  out: string
  runnerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/**
 * Mount the real provider over a runner stand-in.
 * @param args - the invocation's inner arguments.
 * @returns the resolved service value and observed runner/process effects.
 */
async function bootStartup(args: string[]): Promise<{ values: TuiStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-startup-'))
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'row.mjs'), 'export function apply(_ctx, config) { globalThis.__tuiStartupObserved.runnerConfig = config }\n')
  // Loader imports through Node's resolver, so this fixture delegates to the
  // source-plane plugin already imported by the test.
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'tui-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__tuiStartupApply(ctx)
`)
  const rowUrl = pathToFileURL(join(dir, 'row.mjs')).href
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: tui-runner',
    `  name: ${rowUrl}`,
    `  inject: [${TUI_STARTUP_SERVICE}]`,
    '  config:',
    '    resume: !!js ctx.tuiStartup.resume',
    '    workspace: !!js ctx.tuiStartup.workspace ?? process.cwd()',
    '    model: !!js ctx.tuiStartup.model',
    '    permission: !!js ctx.tuiStartup.permission',
    '- id: tui-startup',
    `  name: ${pathToFileURL(join(dir, 'startup.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __tuiStartupApply: typeof apply
    __tuiStartupObserved: Observed
  }
  globals.__tuiStartupApply = apply
  globals.__tuiStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    values: ctx.get(TUI_STARTUP_SERVICE) as TuiStartupValues | undefined,
    observed,
  }
}

describe('tui command-line provider', () => {
  it('provides the flags as runner config', async () => {
    const { values, observed } = await bootStartup([
      '--workspace', '/tmp/w', '--model', 'deepseek-official/deepseek-v4-pro', '--permission', 'danger-full-access',
    ])
    expect(values).toEqual({
      resume: undefined,
      workspace: '/tmp/w',
      model: 'deepseek-official/deepseek-v4-pro',
      permission: 'danger-full-access',
    })
    expect(observed.runnerConfig).toEqual({
      resume: undefined,
      workspace: '/tmp/w',
      model: 'deepseek-official/deepseek-v4-pro',
      permission: 'danger-full-access',
    })
    expect(observed.exits).toEqual([])
  })

  it('accepts an invocation with only --resume', async () => {
    const { values, observed } = await bootStartup(['--resume', 'session-abc'])
    expect(values).toEqual({ resume: 'session-abc' })
    // The runner row always resolves a workspace (its config defaults to cwd),
    // so the assembled config carries more than the provided flag alone.
    expect(observed.runnerConfig).toMatchObject({ resume: 'session-abc' })
    expect(observed.runnerConfig).toMatchObject({ model: undefined, permission: undefined })
    expect(observed.exits).toEqual([])
  })

  it('rejects a --model without a slash', async () => {
    const { values, observed } = await bootStartup(['--model', 'deepseek-v4-pro'])
    expect(observed.out).toContain('--model must be in provider/model form')
    expect(values).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('prints its own help and leaves the runner pending', async () => {
    const { values, observed } = await bootStartup(['--help'])
    expect(observed.out).toContain('omd --profile tui')
    expect(values).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })
})
