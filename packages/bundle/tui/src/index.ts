/**
 * @deepseek-ai/dsh-tui — the interactive terminal surface bundle. The patch
 * rides over `dsh-base`: the runner creates or resumes one Agent through
 * `ctx.agents`, folds its durable `session/event` stream into the renderer's
 * transcript, and drives the surface. On a TTY the pi-tui presenter owns the
 * full-screen terminal (raw mode, alternate screen, input editor); a non-TTY
 * stdin is driven as a pipe with the line-oriented tracer.
 */

import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { TuiPresenter, Transcript, formatStatus, processTerminal, sanitizeText } from '@deepseek-ai/dsh-tui-renderer'
import type {} from '@deepseek-ai/dsh-permission-presets'
// The approval/request waterfall declaration rides the ApprovalService merge;
// the empty import registers the Context augmentation for ctx.on typing.
import type {} from '@deepseek-ai/dsh-user-approval'
// Empty type imports carry the Loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'

import { CtrlCController, installCrashRestore } from './terminal.ts'
import type { CrashEmitter } from './terminal.ts'
import { Keymap } from './keymap.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Core services required before the interactive session can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: startup values resolved from the injected provider service. */
export interface Config {
  /** Resume this persisted session instead of creating a fresh one. */
  resume?: string
  /** Session workspace root; defaults to the invoking directory. */
  workspace?: string
  /** `provider/model` pair for this session; defaults to the current selection. */
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
  /** Whether stdin is interactive; the presenter runs only on a TTY. */
  isTTY: boolean
  hardExit: (code: number) => void
  createInput: () => InputSource
  /** The pi-tui terminal backend; tests inject an in-memory device. */
  createTerminal: () => ReturnType<typeof processTerminal>
  /** Host emitter for the crash-restore handler; tests inject a safe emitter. */
  crashEmitter: CrashEmitter
} = {
  stdout: process.stdout,
  stderr: process.stderr,
  isTTY: process.stdin.isTTY,
  hardExit: code => process.exit(code),
  createInput: () => new StdinInputSource(process.stdin),
  createTerminal: () => processTerminal(),
  crashEmitter: process,
}

/** Presenter active in the current run; the crash handler stops it. */
let activePresenter: TuiPresenter | undefined

/** One decoded key from the pipe input source. */
export type TuiKey =
  | { kind: 'char'; char: string }
  | { kind: 'backspace' }
  | { kind: 'delete' }
  | { kind: 'submit' }
  | { kind: 'ctrl-c' }
  | { kind: 'escape' }
  | { kind: 'left' }
  | { kind: 'right' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'home' }
  | { kind: 'end' }
  | { kind: 'page-up' }
  | { kind: 'page-down' }

/** Injectable input source; `next()` resolves to `undefined` at EOF. */
export interface InputSource {
  next(): Promise<TuiKey | undefined>
}

/**
 * Raw-stdin byte source for the pipe path. Multi-byte UTF-8 survives chunk
 * boundaries through a streaming decoder; the keymap recognizes Enter,
 * Ctrl+C, backspace, printable characters, and the ESC sequences the keymap
 * decodes (arrows, Home/End, PgUp/PgDn, Delete).
 */
export class StdinInputSource implements InputSource {
  private readonly decoder = new TextDecoder()
  private readonly keymap = new Keymap()
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
    for (const key of this.keymap.push(text)) this.enqueue(key)
  }

  /** Deliver one key to a waiter, or buffer it for a later `next()`. */
  private enqueue(key: TuiKey): void {
    const waiter = this.waiters.shift()
    if (waiter !== undefined) waiter(key)
    else this.queue.push(key)
  }

  private pushEof(): void {
    for (const key of this.keymap.flush()) this.enqueue(key)
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

  /** Detach stream listeners; the presenter owns terminal restore separately. */
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

/** One compact durable-event trace line for the pipe surface. */
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

/** Submit one user line: steering while a turn runs, a follow-up turn otherwise. */
function submitLine(agent: Agent, line: string): void {
  const message = createUserMessage({ content: [{ type: 'text', text: line }], source: { kind: 'user' } })
  if (agent.status === 'running') agent.steer(message)
  else agent.followup(message)
}

/** How the input loop ended, and with which exit code. */
type InputOutcome = { kind: 'quit'; code: number } | { kind: 'hard-exit'; code: number }

/**
 * Drive the presenter path: the pi-tui editor submits lines and the Ctrl+C
 * raw-key machine owns cancel/clear/quit. The outcome resolves on a Ctrl+C
 * quit; the presenter keeps running until the caller stops it.
 */
async function drivePresenter(presenter: TuiPresenter, agent: Agent): Promise<InputOutcome> {
  const ctrlC = new CtrlCController()
  return await new Promise<InputOutcome>((resolve) => {
    presenter.onKey((data) => {
      if (data !== '\x03') return false
      // While an approval modal is asking, Ctrl+C resolves the modal's cancel
      // binding instead of driving the quit machine: the modal owns the key
      // until the user decides.
      if (presenter.approvalPending) return false
      const action = ctrlC.press(agent.status === 'running', presenter.getInput() === '')
      switch (action) {
        case 'clear-input':
          presenter.setInput('')
          break
        case 'cancel':
          agent.cancel({ kind: 'user' }, { keepInbox: true })
          break
        case 'quit':
          // A user interrupt quits with the SIGINT convention code; the quit
          // is graceful (presenter stop, flush, terminal restore), not the
          // crash-restore hard exit.
          resolve({ kind: 'quit', code: 130 })
          break
        case 'hard-exit':
          resolve({ kind: 'hard-exit', code: 130 })
          break
      }
      return true
    })
  })
}

/**
 * Drive the pipe path until EOF or a Ctrl+C quit. User lines are submitted as
 * follow-up turns while idle and steering while a turn runs; cancellation
 * preserves queued inbox work. The line editor supports cursor movement
 * (arrows/Home/End), Delete, Escape to clear, and up/down history recall.
 * @param input - the key source.
 * @param agent - the live agent being driven.
 * @returns the input-loop outcome.
 */
async function driveInput(
  input: InputSource,
  agent: Agent,
): Promise<InputOutcome> {
  let line = ''
  let cursor = 0
  const history: string[] = []
  let historyIndex = -1
  let draft = ''
  const ctrlC = new CtrlCController()
  while (true) {
    const key = await input.next()
    if (key === undefined) return { kind: 'quit', code: 0 }
    switch (key.kind) {
      case 'char':
        line = `${line.slice(0, cursor)}${key.char}${line.slice(cursor)}`
        cursor += key.char.length
        break
      case 'backspace':
        if (cursor > 0) {
          line = `${line.slice(0, cursor - 1)}${line.slice(cursor)}`
          cursor -= 1
        }
        break
      case 'delete':
        if (cursor < line.length) {
          line = `${line.slice(0, cursor)}${line.slice(cursor + 1)}`
        }
        break
      case 'left':
        cursor = Math.max(0, cursor - 1)
        break
      case 'right':
        cursor = Math.min(line.length, cursor + 1)
        break
      case 'home':
        cursor = 0
        break
      case 'end':
        cursor = line.length
        break
      case 'up': {
        if (historyIndex === -1) draft = line
        if (historyIndex < history.length - 1) {
          historyIndex += 1
          // Bounded by the guard above; the undefined check is a logic-slip
          // net, not a reachable branch.
          const recalled = history[history.length - 1 - historyIndex]
          if (recalled !== undefined) {
            line = recalled
            cursor = line.length
          }
        }
        break
      }
      case 'down': {
        if (historyIndex === 0) {
          historyIndex = -1
          line = draft
          cursor = line.length
        } else if (historyIndex > 0) {
          historyIndex -= 1
          const recalled = history[history.length - 1 - historyIndex]
          if (recalled !== undefined) {
            line = recalled
            cursor = line.length
          }
        }
        break
      }
      case 'page-up':
      case 'page-down':
        // A single-line buffer has nothing to page; consume without editing.
        break
      case 'escape':
        line = ''
        cursor = 0
        break
      case 'submit': {
        if (line === '') break
        submitLine(agent, line)
        history.push(line)
        historyIndex = -1
        draft = ''
        line = ''
        cursor = 0
        break
      }
      case 'ctrl-c': {
        const action = ctrlC.press(agent.status === 'running', line === '')
        switch (action) {
          case 'clear-input':
            line = ''
            cursor = 0
            break
          case 'cancel':
            agent.cancel({ kind: 'user' }, { keepInbox: true })
            break
          case 'quit':
            // A user interrupt quits with the SIGINT convention code; the
            // pipe path has no presenter to restore, so the quit is direct.
            return { kind: 'quit', code: 130 }
          case 'hard-exit':
            return { kind: 'hard-exit', code: 130 }
        }
        break
      }
    }
  }
}

/**
 * Create or resume one Agent, fold its durable events into the transcript,
 * drive the surface, and request exit. The presenter is stopped before the
 * graceful flush so the user's shell returns even while persistence drains.
 */
async function run(ctx: Context, config: Config, io: TuiIo, input: InputSource | undefined): Promise<void> {
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

  const transcript = new Transcript()
  // Resume replays stored seed events first: constructor seeds never emit
  // through `session/event`, so a resumed transcript starts from storage.
  for (const event of agent.session.events) transcript.fold(event)

  // The shared app-ctx pattern (api-proxy, ACP): one root listener filtered by
  // session, so subagent sessions never trace into the TUI transcript.
  const offEvents = ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (session !== agent.session) return
    transcript.fold(event)
    if (activePresenter === undefined) {
      const line = traceLine(event)
      if (line !== '') io.stdout.write(sanitizeText(line) + '\n')
    }
  })

  const interactive = internals.isTTY
  let presenter: TuiPresenter | undefined
  if (interactive) {
    presenter = new TuiPresenter(internals.createTerminal(), transcript, {
      onSubmit: (line) => { submitLine(agent, line) },
      statusLine: () => formatStatus(transcript.state),
    })
    activePresenter = presenter
  }

  // The TUI answers every approval the composed surface asks (subagents
  // included: the user is in front of this terminal). Without a presenter the
  // pipe path has no answerer, so the waterfall falls through to its
  // fail-closed `'unavailable'`.
  const offApproval = ctx.on('approval/request', async (req, next) => {
    if (activePresenter === undefined || !activePresenter.isStarted) return next()
    return activePresenter.askApproval(req.toolName, req.reason)
  })

  try {
    presenter?.start()
    const outcome = presenter !== undefined
      ? await drivePresenter(presenter, agent)
      : await driveInput(input as InputSource, agent)

    // Stop the presenter before the graceful flush so the shell is usable
    // while persistence drains; the pipe path has no presenter.
    offEvents()
    offApproval()
    presenter?.stop()
    activePresenter = undefined

    if (outcome.kind === 'hard-exit') {
      io.hardExit(outcome.code)
      return
    }
    await sessions.flush(agent.session)
    await handle.dispose()
    io.exit(outcome.code)
  } catch (error) {
    offEvents()
    offApproval()
    presenter?.stop()
    activePresenter = undefined
    throw error
  }
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
  const io: TuiIo = { stdout: internals.stdout, stderr: internals.stderr, exit, hardExit: internals.hardExit }
  const crash = installCrashRestore(
    () => { activePresenter?.stop() },
    (code) => { internals.hardExit(code) },
    internals.crashEmitter,
  )
  // The pipe input source owns process.stdin's data listeners; on a TTY the
  // presenter's terminal owns them, so a pipe source must never mount there
  // (it would also mis-decode pi-tui's utf8-encoded data events).
  const input = internals.isTTY ? undefined : internals.createInput()
  void run(ctx, config, io, input).catch((error: unknown) => {
    // Report before the crash restore: the restore path hard-exits.
    io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
    crash()
    io.exit(1)
  })
}
