/**
 * @deepseek-ai/dsh-tui — the interactive terminal surface bundle. The patch
 * rides over dsh-base without Host, HTTP, or browser rows; this runner creates
 * or resumes one Agent through the core registry, traces its durable events to
 * the terminal, submits user input as follow-up turns (steering while a turn
 * runs), owns raw-mode input through the Ctrl+C state machine, and restores
 * the terminal before requesting process exit.
 *
 * The current surface is line-oriented event tracing (the M0 skeleton); the
 * full-screen renderer, scroll viewport, and the approval / user-questions /
 * commands adapters land in later milestones and stay out of this package's
 * runtime rows until then.
 *
 * @module @deepseek-ai/dsh-tui
 */

import { randomUUID } from 'node:crypto'
import { TextDecoder } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-permission-presets'
// Empty type imports carry the Loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { sanitizeText } from './sanitize.ts'
import { CtrlCController, installCrashRestore, TerminalSession } from './terminal.ts'
import type { CrashEmitter, TerminalDevice } from './terminal.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Core services required before the interactive session can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: startup values resolved from the injected provider service. */
export interface Config {
  /** Persisted session id to resume instead of creating a fresh session. */
  resume?: string
  /** Workspace root; the runner defaults to the invoking directory. */
  workspace?: string
  /** Provider/model pair in `provider/model` form. */
  model?: string
  /** Permission preset applied at session creation. */
  permission?: string
}

export const Config: z<Config> = z.object({
  // Fields are optional by default in schemastery; `resume` etc. arrive from
  // the injected startup provider and may be absent.
  resume: z.string(),
  workspace: z.string(),
  model: z.string(),
  permission: z.string(),
})

/** Process-facing effects of one run: output streams plus the launcher's exit requests. */
interface TuiIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Graceful exit through the launcher: flush, dispose, then exit. */
  exit(code: number): void
  /** Forced exit that skips graceful disposal; only the Ctrl+C escape uses it. */
  hardExit(code: number): void
}

/** The process streams and devices the runner uses; tests substitute captures. */
export const internals: {
  stdout: TuiIo['stdout']
  stderr: TuiIo['stderr']
  device: TerminalDevice
  hardExit: (code: number) => void
  createInput: () => InputSource
  /** Host emitter for the crash-restore handler; tests inject a safe emitter. */
  crashEmitter: CrashEmitter
} = {
  stdout: process.stdout,
  stderr: process.stderr,
  device: {
    isTTY: process.stdin.isTTY,
    setRawMode: raw => process.stdin.setRawMode(raw),
  },
  hardExit: code => process.exit(code),
  createInput: () => new StdinInputSource(process.stdin),
  crashEmitter: process,
}

/** One decoded key from the terminal input source. */
export type TuiKey =
  | { kind: 'char'; char: string }
  | { kind: 'backspace' }
  | { kind: 'submit' }
  | { kind: 'ctrl-c' }

/** Injectable input source; `next()` resolves to `undefined` at EOF. */
export interface InputSource {
  next(): Promise<TuiKey | undefined>
}

/**
 * Raw-stdin byte source. Multi-byte UTF-8 survives chunk boundaries through a
 * streaming decoder; the M0 keymap recognizes Enter, Ctrl+C, backspace, and
 * printable characters, and ignores escape sequences until the keymap
 * milestone.
 */
export class StdinInputSource implements InputSource {
  private readonly decoder = new TextDecoder()
  private queue: TuiKey[] = []
  private waiters: Array<(key: TuiKey | undefined) => void> = []
  private ended = false

  constructor(private readonly stream: NodeJS.ReadStream) {
    this.stream.on('data', (chunk: Buffer) => { this.push(chunk) })
    this.stream.on('end', () => { this.pushEof() })
  }

  /** Decode one raw chunk into keys and drain any pending waiters. */
  private push(chunk: Buffer): void {
    const text = this.decoder.decode(chunk, { stream: true })
    for (const char of text) {
      const code = char.charCodeAt(0)
      if (code === 0x03) this.enqueue({ kind: 'ctrl-c' })
      else if (code === 0x0d || code === 0x0a) this.enqueue({ kind: 'submit' })
      else if (code === 0x7f || code === 0x08) this.enqueue({ kind: 'backspace' })
      else if (code === 0x1b) {
        // ESC begins a key sequence (arrows, alt, modifiers); the M0 keymap
        // does not decode them, so the byte is dropped instead of entering the
        // input line as a control character.
      }
      else if (code >= 0x20) this.enqueue({ kind: 'char', char })
    }
  }

  /** Deliver one key to a waiter, or buffer it for a later `next()`. */
  private enqueue(key: TuiKey): void {
    const waiter = this.waiters.shift()
    if (waiter !== undefined) waiter(key)
    else this.queue.push(key)
  }

  private pushEof(): void {
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter(undefined)
  }

  /** Resolve the next key, or `undefined` after EOF. */
  async next(): Promise<TuiKey | undefined> {
    const queued = this.queue.shift()
    if (queued !== undefined) return queued
    if (this.ended) return undefined
    return await new Promise<TuiKey | undefined>((resolve) => { this.waiters.push(resolve) })
  }

  /** Detach stream listeners; the terminal is restored separately. */
  dispose(): void {
    this.stream.removeAllListeners('data')
    this.stream.removeAllListeners('end')
  }
}

/** Text of all `text` blocks in one content list, trimmed. */
function textOf(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('').trim()
}

/** Turn-end reason kind for the trace line. */
function reasonKind(reason: SessionEvent<'turn/end'>['data']['reason']): string {
  return reason.kind
}

/** One compact durable-event trace line for the line-oriented surface. */
function traceLine(event: SessionEvent): string {
  switch (event.type) {
    case 'user/message': {
      const text = textOf(event.data.content)
      return text === '' ? '[user]' : `[user] ${text}`
    }
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      return chunk.type === 'text-delta' && chunk.text.trim() !== '' ? `[assistant] ${chunk.text}` : ''
    }
    case 'assistant/message': {
      const text = textOf(event.data.message.content)
      return text === '' ? '[assistant]' : `[assistant] ${text}`
    }
    case 'tool/call':
      return `[tool] ${event.data.name} ${event.data.arguments}`
    case 'tool/result':
      return `[tool/result] ${event.data.error !== undefined ? `error ${event.data.error.name}` : 'ok'}`
    case 'turn/start':
      return `[turn/start] ${event.data.turn}`
    case 'turn/end':
      return `[turn/end] ${event.data.turn} ${reasonKind(event.data.reason)}`
    case 'step/start':
      return `[step] ${event.data.turn}.${event.data.step}`
    case 'step/end':
      return `[step/end] ${event.data.turn}.${event.data.step}`
    case 'todo/write':
      return `[todo] ${event.data.todos.length} items`
    default:
      return `[${event.type}]`
  }
}

/** Split a validated `provider/model` pair. */
function parseModel(pair: string): { provider: string; model: string } {
  const index = pair.indexOf('/')
  return { provider: pair.slice(0, index), model: pair.slice(index + 1) }
}

/** Composition-only setup installing the selected model on the agent scope. */
function installSelection(selection: ModelSelectionRef['current']): (agentCtx: Context) => void {
  return (agentCtx) => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
  }
}

/** How the input loop ended, and with which exit code. */
type InputOutcome = { kind: 'quit'; code: number } | { kind: 'hard-exit'; code: number }

/**
 * Drive the key loop until EOF or a Ctrl+C quit. User lines are submitted as
 * follow-up turns while idle and steering while a turn runs; cancellation
 * preserves queued inbox work.
 * @param input - the key source.
 * @param agent - the live agent being driven.
 * @returns the input-loop outcome.
 */
async function driveInput(
  input: InputSource,
  agent: Agent,
): Promise<InputOutcome> {
  let line = ''
  const ctrlC = new CtrlCController()
  while (true) {
    const key = await input.next()
    if (key === undefined) return { kind: 'quit', code: 0 }
    switch (key.kind) {
      case 'char':
        line += key.char
        break
      case 'backspace':
        line = line.slice(0, -1)
        break
      case 'submit': {
        if (line === '') break
        const message = createUserMessage({ content: [{ type: 'text', text: line }], source: { kind: 'user' } })
        if (agent.status === 'running') agent.steer(message)
        else agent.followup(message)
        line = ''
        break
      }
      case 'ctrl-c': {
        const action = ctrlC.press(agent.status === 'running', line === '')
        switch (action) {
          case 'clear-input':
            line = ''
            break
          case 'cancel':
            agent.cancel({ kind: 'user' }, { keepInbox: true })
            break
          case 'quit':
            return { kind: 'quit', code: 0 }
          case 'hard-exit':
            return { kind: 'hard-exit', code: 130 }
        }
        break
      }
    }
  }
}

/**
 * Create or resume one Agent, trace its durable events, drive user input, and
 * request exit. The terminal is restored before the graceful flush so the
 * user's shell returns even while persistence drains.
 */
async function run(ctx: Context, config: Config, io: TuiIo, terminal: TerminalSession, input: InputSource): Promise<void> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  const selection = config.model !== undefined ? parseModel(config.model) : defaultModel.currentSelection()
  const agentOptions = { provider: selection.provider, model: selection.model }
  const setup = installSelection(selection)
  const handle = config.resume !== undefined
    ? await agents.resume({ resumeSessionId: SessionId(config.resume), agentOptions, setup })
    : await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: config.workspace ?? process.cwd() },
      agentOptions,
      setup,
    })
  const { agent } = handle

  const permission = ctx.get('permissionPresets')
  if (config.permission !== undefined) {
    if (permission === undefined) {
      throw new Error('tui-runner: --permission needs the dsh-permission-presets service')
    }
    permission.set(agent.session, config.permission)
  }

  // The shared app-ctx pattern (api-proxy, ACP): one root listener filtered by
  // session, so subagent sessions never trace into the TUI transcript.
  const offEvents = ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (session !== agent.session) return
    const line = traceLine(event)
    if (line !== '') io.stdout.write(sanitizeText(line) + '\n')
  })

  const outcome = await driveInput(input, agent)

  offEvents()
  terminal.restore()
  if (outcome.kind === 'hard-exit') {
    io.hardExit(outcome.code)
    return
  }
  await sessions.flush(agent.session)
  await handle.dispose()
  io.exit(outcome.code)
}

/**
 * Mount the interactive terminal runner.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated startup values.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const terminal = new TerminalSession(internals.device)
  terminal.enter()
  const io: TuiIo = { stdout: internals.stdout, stderr: internals.stderr, exit, hardExit: internals.hardExit }
  const crash = installCrashRestore(() => { terminal.restore() }, (code) => { internals.hardExit(code) }, internals.crashEmitter)
  const input = internals.createInput()
  void run(ctx, config, io, terminal, input).catch((error: unknown) => {
    crash()
    terminal.restore()
    io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
    io.exit(1)
  })
}
