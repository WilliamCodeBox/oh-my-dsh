import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@williamcodebox/cordis'
import Loader from '@williamcodebox/cordis-plugin-loader'
import Include from '@williamcodebox/cordis-plugin-include'
import { CallId } from '@williamcodebox/omd-llm'
import { Session, SessionId } from '@williamcodebox/omd-session'
import AgentRegistry, { Inbox } from '@williamcodebox/omd-agent'
import type { Agent } from '@williamcodebox/omd-agent'
import SystemPrompt from '@williamcodebox/omd-system-prompt'
import ToolRuntime from '@williamcodebox/omd-tools'
import TerminalSessionService from '@williamcodebox/omd-terminal'
import SandboxProvider from '@williamcodebox/omd-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@williamcodebox/omd-sandbox'
import SandboxPolicyService from '@williamcodebox/omd-sandbox-policy'
import LocalSubprocessRuntime from '@williamcodebox/omd-subprocess-local'
import * as TerminalLocal from '@williamcodebox/omd-terminal-bash'
import * as ToolPty from '@williamcodebox/omd-tool-terminal'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('pty-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('terminal real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and preserves shell state across real tool calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pty-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@williamcodebox/omd-agent'",
      "- name: '@williamcodebox/omd-system-prompt'",
      "- name: '@williamcodebox/omd-tools'",
      "- name: '@williamcodebox/omd-terminal'",
      "- name: '@williamcodebox/omd-test-sandbox'",
      "- name: '@williamcodebox/omd-sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@williamcodebox/omd-subprocess-local'",
      "- name: '@williamcodebox/omd-terminal-bash'",
      '  config:',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 250',
      '    handoffGraceMs: 250',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@williamcodebox/omd-tool-terminal'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@williamcodebox/omd-agent', AgentRegistry],
      ['@williamcodebox/omd-system-prompt', SystemPrompt],
      ['@williamcodebox/omd-tools', ToolRuntime],
      ['@williamcodebox/omd-terminal', TerminalSessionService],
      ['@williamcodebox/omd-test-sandbox', PassthroughSandbox],
      ['@williamcodebox/omd-sandbox-policy', SandboxPolicyService],
      ['@williamcodebox/omd-subprocess-local', LocalSubprocessRuntime],
      ['@williamcodebox/omd-terminal-bash', TerminalLocal],
      ['@williamcodebox/omd-tool-terminal', ToolPty],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = agent(context)
    const signal = new AbortController().signal
    const spawn = await context.tools.execute({
      signal, callId: CallId('spawn'), name: 'terminal_open', arguments: { type: 'shell', name: 'main', cwd: root }, agent: owner,
    })
    expect(resultText(spawn)).toContain('started terminal session pty-1 (main)')

    await context.tools.execute({
      signal, callId: CallId('state'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'export KEEP=loader; cd /' }, agent: owner,
    })
    const read = await context.tools.execute({
      signal, callId: CallId('read'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"' }, agent: owner,
    })
    expect(resultText(read)).toContain('cwd=/ keep=loader')
    expect(context.terminals.list(owner)).toHaveLength(1)
  }, 15_000)
})
