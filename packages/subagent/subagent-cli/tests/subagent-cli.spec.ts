import { describe, expect, it } from 'vitest'
import { Context } from '@williamcodebox/cordis'
import SubagentRuntime from '@williamcodebox/omd-subagent'
import type { Agent } from '@williamcodebox/omd-agent'
import LocalSubprocessRuntime from '@williamcodebox/omd-subprocess-local'
import { textTask, cliStopReason } from '../src/run.ts'
import * as cli from '../src/index.ts'

function fakeCli(script: string): string {
  // A tiny executable shell script that mimics a headless CLI: echoes the
  // positional prompt or reads stdin, per the script's own logic.
  const { writeFileSync, chmodSync, mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'omd-subagent-cli-'))
  const file = join(dir, 'fake-cli')
  writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 })
  chmodSync(file, 0o755)
  return file
}

/** A parent Agent stub. The CLI backend reads exactly one thing off it: the session header's cwd. */
const fakeParent = { id: 'parent', session: { header: { cwd: process.cwd() } } } as unknown as Agent

function request(text = 'fix the typo', signal = new AbortController().signal) {
  return { prompt: [{ type: 'text' as const, text }], parent: fakeParent, signal }
}

async function setup(overrides: Partial<Parameters<typeof cli.apply>[1]> = {}) {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(cli, {
    providerName: 'cli',
    command: '/bin/true',
    args: [],
    promptStrategy: 'positional-tail',
    env: {},
    ...overrides,
  })
  return ctx
}

describe('textTask', () => {
  it('joins non-empty text blocks', () => {
    expect(textTask([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\n\nb')
  })

  it('rejects an empty prompt', () => {
    expect(() => textTask([])).toThrow('refusing an empty task prompt')
    expect(() => textTask([{ type: 'text', text: '' }])).toThrow('refusing an empty task prompt')
  })

  it('rejects non-text blocks', () => {
    expect(() => textTask([{ type: 'image' } as never])).toThrow('text prompts only')
  })
})

describe('cliStopReason', () => {
  it('maps exit 0 with output to completed', () => {
    expect(cliStopReason(0, 'answer text')).toBe('completed')
  })

  it('maps non-zero exit to error', () => {
    expect(cliStopReason(1, 'partial output')).toBe('error')
    expect(cliStopReason(null, 'killed')).toBe('error')
  })

  it('maps empty output on exit 0 to error (never a silent success)', () => {
    expect(cliStopReason(0, '   ')).toBe('error')
    expect(cliStopReason(0, '')).toBe('error')
  })
})

describe('subagent-cli provider', () => {
  it('drives a positional-tail child and returns its final text', async () => {
    const bin = fakeCli('echo "answer: $2"')
    const ctx = await setup({ command: bin, args: ['-p'] })
    const run = await ctx.subagents.start('cli', { label: 'cli', ...request() })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'answer: fix the typo' }])
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('feeds stdin for the stdin strategy', async () => {
    const bin = fakeCli('read -r line; echo "got: $line"')
    const ctx = await setup({ command: bin, promptStrategy: 'stdin' })
    const run = await ctx.subagents.start('cli', { label: 'cli', ...request() })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'got: fix the typo' }])
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('flattens a non-zero exit to an error result', async () => {
    const bin = fakeCli('echo "partial"; exit 1')
    const ctx = await setup({ command: bin })
    const run = await ctx.subagents.start('cli', { label: 'cli', ...request() })
    const result = await run.result
    expect(result.stopReason).toBe('error')
    await run.dispose()
    await ctx.fiber.dispose()
  })

  it('reports error when the child exits 0 with no answer', async () => {
    const ctx = await setup({ command: fakeCli('true') })
    const run = await ctx.subagents.start('cli', { label: 'cli', ...request() })
    const result = await run.result
    expect(result.stopReason).toBe('error')
    await run.dispose()
    await ctx.fiber.dispose()
  })
})
