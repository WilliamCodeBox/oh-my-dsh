/**
 * @williamcodebox/omd-tui — the interactive terminal surface bundle. The patch
 * rides over `dsh-base`: the runner creates or resumes one Agent through
 * `ctx.agents`, folds its durable `session/event` stream into the renderer's
 * transcript, and drives the surface. On a TTY the pi-tui presenter owns the
 * full-screen terminal (raw mode, alternate screen, input editor); a non-TTY
 * stdin is driven as a pipe with the line-oriented tracer.
 */

import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@williamcodebox/cordis'
import z from '@williamcodebox/schemastery'
import { installModelSelection } from '@williamcodebox/omd-agent'
import type { Agent, ModelSelectionRef } from '@williamcodebox/omd-agent'
import type {} from '@williamcodebox/omd-agent-default-model'
import { createUserMessage } from '@williamcodebox/omd-llm'
import { SessionId } from '@williamcodebox/omd-session'
import type { Session, SessionEvent } from '@williamcodebox/omd-session'
import { TuiPresenter, KeybindingRegistry, Transcript, detectTerminalScheme, formatStatus, processTerminal, sanitizeText, themeForScheme, workspaceAutocomplete } from '@williamcodebox/omd-tui-renderer'
import type { MetaRowData } from '@williamcodebox/omd-tui-renderer'
import type { ReasoningEffortId } from '@williamcodebox/omd-llm'
import { watchGitStatus, type GitStatus } from './git.ts'
import type {} from '@williamcodebox/omd-permission-presets'
// The approval/request waterfall declaration rides the ApprovalService merge;
// the empty import registers the Context augmentation for ctx.on typing.
import type {} from '@williamcodebox/omd-user-approval'
// The userQuestions provider service and the command/run + command/done
// session event shapes ride their packages' merges.
import type {} from '@williamcodebox/omd-user-questions'
import type {} from '@williamcodebox/omd-commands'
import type {} from '@williamcodebox/omd-session-persistence'
import { parseCommand } from '@williamcodebox/omd-commands'
// Empty type imports carry the Loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@williamcodebox/cordis-plugin-loader'
import type {} from '@williamcodebox/omd-cmdline'

import { CtrlCController, installCrashRestore } from './terminal.ts'
import type { CrashEmitter } from './terminal.ts'
import { Keymap } from './keymap.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Core services required before the interactive session can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'userQuestions', 'commands', 'sessionPersistence']

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
  /** USD per input token for the session cost display; absent hides the cost. */
  costPerInputToken?: number
  /** USD per output token for the session cost display; absent hides the cost. */
  costPerOutputToken?: number
}

export const Config: z<Config> = z.object({
  // Fields are optional by default in schemastery; `resume` etc. arrive from
  // the injected startup provider and may be absent.
  resume: z.string(),
  workspace: z.string(),
  model: z.string(),
  permission: z.string(),
  costPerInputToken: z.number(),
  costPerOutputToken: z.number(),
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
  /** Run the external editor over a temp file; tests inject a fake. */
  runEditor: (file: string) => number
} = {
  stdout: process.stdout,
  stderr: process.stderr,
  isTTY: process.stdin.isTTY,
  hardExit: code => process.exit(code),
  createInput: () => new StdinInputSource(process.stdin),
  createTerminal: () => processTerminal(),
  crashEmitter: process,
  runEditor: (file) => {
    const editor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || 'vi'
    const result = spawnSync(editor, [file], { stdio: 'inherit', shell: true })
    return result.status ?? 1
  },
}

/** Presenter active in the current run; the crash handler stops it. */
let activePresenter: TuiPresenter | undefined

/** Format a session cost in USD with a compact unit. */
function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`
  if (cost >= 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(6)}`
}

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
    case 'command/run': {
      const args = (event.data.args ?? '').trim()
      return `[command] /${event.data.name}${args === '' ? '' : ` ${args}`}`
    }
    case 'command/done':
      return event.data.text !== undefined
        ? `[command] ${event.data.kind === 'error' ? 'error ' : ''}${event.data.text}`
        : `[command] ${event.data.kind}`
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
function installSelection(selection: ModelSelectionRef): (agentCtx: Context) => void {
  return (agentCtx) => {
    installModelSelection(agentCtx, selection)
  }
}

/** Submit one user line: steering while a turn runs, a follow-up turn otherwise. */
function submitLine(agent: Agent, line: string): void {
  const message = createUserMessage({ content: [{ type: 'text', text: line }], source: { kind: 'user' } })
  if (agent.status === 'running') agent.steer(message)
  else agent.followup(message)
}

/** How the input loop ended, and with which exit code. */
type InputOutcome = { kind: 'quit'; code: number } | { kind: 'hard-exit'; code: number } | { kind: 'switch'; resumeId: SessionId }

/**
 * Drive the presenter path: the pi-tui editor submits lines and the Ctrl+C
 * raw-key machine owns cancel/clear/quit. The outcome resolves on a Ctrl+C
 * quit; the presenter keeps running until the caller stops it.
 */
async function drivePresenter(presenter: TuiPresenter, agent: Agent): Promise<InputOutcome> {
  const ctrlC = new CtrlCController()
  return await new Promise<InputOutcome>((resolve) => {
    // One registry for every raw key the presenter sees; the help overlay
    // lists the same bindings, so key discovery never drifts from behavior.
    const registry = new KeybindingRegistry()
    registry.register({
      key: '\x1b[5~',
      display: 'PgUp',
      description: 'page back through the transcript',
      handler: () => { presenter.pageTranscript(-1) },
    })
    registry.register({
      key: '\x1b[5;2~',
      display: 'Shift+PgUp',
      description: 'page back through the transcript',
      handler: () => { presenter.pageTranscript(-1) },
    })
    registry.register({
      key: '\x1b[6~',
      display: 'PgDn',
      description: 'page forward; end-following resumes at the bottom',
      handler: () => { presenter.pageTranscript(1) },
    })
    registry.register({
      key: '\x1b[6;2~',
      display: 'Shift+PgDn',
      description: 'page forward; end-following resumes at the bottom',
      handler: () => { presenter.pageTranscript(1) },
    })
    registry.register({
      key: '?',
      display: '?',
      description: 'show this keybinding help',
      handler: () => {
        // Without a modal the key falls through to the editor so '?' stays
        // typeable; with a modal the help would fight the modal's focus.
        if (presenter.interactionPending) return false
        presenter.showHelp(registry.list().map(binding => ({ key: binding.display ?? binding.key, description: binding.description })))
      },
    })
    registry.register({
      key: '\x03',
      display: 'Ctrl+C',
      description: 'clear input / cancel / quit (three-step)',
      handler: () => {
      // While an interaction modal is asking, Ctrl+C resolves the modal's
      // cancel binding instead of driving the quit machine: the modal owns
      // the key until the user decides.
      if (presenter.interactionPending) return false
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
    },
    })
    presenter.setHaltHandler((outcome) => {
      const payload = outcome as { resumeId?: unknown }
      if (typeof payload.resumeId === 'string') {
        resolve({ kind: 'switch', resumeId: SessionId(payload.resumeId) })
      }
    })
    presenter.onKey((data) => {
      return registry.dispatch(data)
    })
  })
}

/**
 * Drive the pipe path until EOF or a Ctrl+C quit. Lines dispatch through the
 * shared line handler (slash commands vs follow-up turns); cancellation
 * preserves queued inbox work. The line editor supports cursor movement
 * (arrows/Home/End), Delete, Escape to clear, and up/down history recall.
 * @param input - the key source.
 * @param agent - the live agent being driven.
 * @param dispatch - the shared submitted-line dispatcher.
 * @returns the input-loop outcome.
 */
async function driveInput(
  input: InputSource,
  agent: Agent,
  dispatch: (line: string) => void,
): Promise<InputOutcome> {
  let line = ''
  let cursor = 0
  const history: string[] = []
  let historyIndex = -1
  let draft = ''
  const ctrlC = new CtrlCController()
  while (true) {
    const key = await input.next()
    if (key === undefined) {
      // EOF: drain any in-flight follow-up turn before quitting, so piped
      // input (`echo task | omd --profile tui`) runs to completion.
      await agent.whenIdle()
      return { kind: 'quit', code: 0 }
    }
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
        dispatch(line)
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
async function runOnce(ctx: Context, config: Config, io: TuiIo, input: InputSource | undefined, resumeId: SessionId | undefined): Promise<{ kind: 'switch'; resumeId: SessionId } | { kind: 'exit'; code: number }> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return { kind: 'exit', code: 1 }

  const selection = config.model !== undefined ? parseModel(config.model) : defaultModel.currentSelection()
  // The mutable ref lets /model switch the next prompt's model at runtime;
  // the assembly listener reads ref.current per request.
  const selectionRef: ModelSelectionRef = { current: selection, assembled: undefined }
  const agentOptions = { provider: selection.provider, model: selection.model }
  const setup = installSelection(selectionRef)
  const handle = resumeId !== undefined
    ? await agents.resume({ resumeSessionId: resumeId, agentOptions, setup })
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
  const commands = ctx.get('commands')
  const commandAbort = new AbortController()
  // Input-context row data: model/thinking from the selection ref, cwd,
  // git worktree state (polled), context usage from the transcript.
  const workspace = config.workspace ?? process.cwd()
  const home = homedir()
  const displayCwd = workspace === home ? '~' : workspace.startsWith(`${home}/`) ? `~${workspace.slice(home.length)}` : workspace
  let gitState: GitStatus | undefined
  const metaData = (): MetaRowData => {
    const current = selectionRef.current
    const ctxInfo = transcript.state.context
    const usage = transcript.state.usage
    const total = usage.inputTokens + usage.outputTokens
    return {
      ...(current !== undefined ? { model: { provider: current.provider, model: current.model } } : {}),
      ...(current?.reasoningEffort !== undefined ? { thinking: current.reasoningEffort } : {}),
      cwd: displayCwd,
      ...(gitState !== undefined ? { git: gitState } : {}),
      ...(ctxInfo?.contextWindow !== undefined && total > 0
        ? { context: { ratio: total / ctxInfo.contextWindow, window: ctxInfo.contextWindow, used: total } }
        : {}),
    }
  }
  // Transient user-facing notice shown in the presenter status row (and the
  // pipe line stream): unknown slash commands report here instead of leaking
  // into the model or vanishing.
  const notice = { text: '' }
  // Spinner frame over wall-clock time; the status row re-reads per render.
  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const statusLine = (): string => {
    const base = formatStatus(transcript.state)
    let text = notice.text === '' ? base : base === '' ? notice.text : `${base} | ${notice.text}`
    // Session cost, only when the deployment configures per-token prices.
    const inputPrice = config.costPerInputToken
    const outputPrice = config.costPerOutputToken
    if (inputPrice !== undefined || outputPrice !== undefined) {
      const usage = transcript.state.usage
      const cost = (usage.inputTokens * (inputPrice ?? 0)) + (usage.outputTokens * (outputPrice ?? 0))
      if (cost > 0) text = text === '' ? formatCost(cost) : `${text} | ${formatCost(cost)}`
    }
    return text
  }
  // Transient right status: a spinner while a turn runs, plus the escape
  // hint so a long silent turn never looks hung. Also drives the terminal
  // task-progress indicator (idempotent per status change). While a turn
  // runs, a ~100ms timer re-renders so the spinner animates even without
  // transcript events (rendering itself is throttled by pi-tui).
  let lastProgress: boolean | undefined
  let spinnerTimer: NodeJS.Timeout | undefined
  const stopSpinner = (): void => {
    if (spinnerTimer !== undefined) {
      clearInterval(spinnerTimer)
      spinnerTimer = undefined
    }
  }
  const transient = (): string => {
    const running = agent.status === 'running'
    if (running !== lastProgress) {
      lastProgress = running
      presenter?.setProgress(running)
      if (running) {
        stopSpinner()
        spinnerTimer = setInterval(() => presenter?.requestRender(), 100)
      } else {
        stopSpinner()
      }
    }
    if (!running) return ''
    const frame = SPINNER_FRAMES[Math.floor(Date.now() / 100) % SPINNER_FRAMES.length]
    return `${frame} running · esc to interrupt`
  }

  /**
   * Dispatch one submitted line: slash commands run through the command
   * runtime (never the model); everything else submits as a follow-up turn or
   * steering. The command's settled error card renders from the transcript's
   * command/run + command/done fold; an unknown command reports via notice.
   */
  const dispatchLine = (line: string): void => {
    // Empty submits (bare Enter) must not start a turn; the pipe path
    // guards the same case.
    if (line.trim() === '') return
    // Built-in model switching lives outside the commands runtime so it can
    // mutate the selection ref directly; everything else rides the runtime.
    const modelMatch = /^\/model(?:\s+(\S+))?$/.exec(line)
    if (modelMatch !== null) {
      const pair = modelMatch[1]
      if (pair === undefined) {
        const current = selectionRef.current
        notice.text = current === undefined ? 'no model selected' : `model ${current.provider}/${current.model}`
      } else if (!pair.includes('/')) {
        // Fail loud: a bare name would silently misroute the next request.
        notice.text = 'model must be provider/model'
      } else {
        const parsed = parseModel(pair)
        selectionRef.current = parsed
        notice.text = `model ${parsed.provider}/${parsed.model}`
      }
      return
    }
    const thinkingMatch = /^\/thinking(?:\s+(\S+))?$/.exec(line)
    if (thinkingMatch !== null) {
      const level = thinkingMatch[1]
      if (level === undefined) {
        const current = selectionRef.current
        notice.text = current?.reasoningEffort === undefined ? 'no thinking level' : `thinking ${current.reasoningEffort}`
      } else if (selectionRef.current !== undefined) {
        selectionRef.current = { ...selectionRef.current, reasoningEffort: level as ReasoningEffortId }
        notice.text = `thinking ${level}`
      }
      return
    }
    if (line === '/editor') {
      // Suspend the presenter, edit the draft in $VISUAL/$EDITOR, resume.
      // The presenter re-draws from the transcript on start, so the screen
      // loss during the editor session is recovered. Every path restores
      // the presenter so raw mode can never be left behind.
      void (async () => {
        if (presenter === undefined || !presenter.isStarted) {
          notice.text = 'editor unavailable'
          return
        }
        try {
          const file = join(tmpdir(), `omd-draft-${randomUUID()}.md`)
          presenter.stop()
          try {
            writeFileSync(file, presenter.getInput())
          } catch {
            notice.text = 'draft write failed'
            return
          }
          const code = internals.runEditor(file)
          if (code === 0) {
            try {
              presenter.setInput(readFileSync(file, 'utf8').replace(/\n$/, ''))
              notice.text = 'editor updated'
            } catch {
              notice.text = 'editor output unreadable'
            }
          } else {
            notice.text = 'editor exited with an error'
          }
        } catch (error) {
          notice.text = `editor failed: ${error instanceof Error ? error.message : String(error)}`
        } finally {
          // Restore raw mode + alt screen on every path: a stranded
          // presenter leaves the user's shell unusable.
          if (presenter !== undefined && !presenter.isStarted) presenter.start()
        }
      })()
      return
    }
    if (line === '/sessions' || line.startsWith('/sessions ')) {
      // List persisted sessions and switch to the picked one: the drive loop
      // halts with the resume id and the outer loop rebuilds the agent.
      void (async () => {
        const persistence = ctx.sessionPersistence
        if (persistence === undefined || presenter === undefined) {
          notice.text = 'sessions unavailable'
          return
        }
        const listed = await persistence.list()
        if (listed.length === 0) {
          notice.text = 'no sessions yet'
          return
        }
        const options = listed.map(session => ({
          value: session.id,
          label: `${session.id}  ${new Date(session.createdAt).toLocaleString()}${session.cwd === undefined ? '' : `  ${session.cwd}`}`,
        }))
        const picked = await presenter.askQuestions([{ id: 'session', question: 'Resume session', options }])
        const answer = picked.answers[0]
        if (answer !== undefined && answer.selected.length === 1) {
          presenter.halt({ resumeId: answer.selected[0] })
        }
      })()
      return
    }
    if (parseCommand(line) !== undefined && commands !== undefined) {
      notice.text = ''
      void commands.execute(agent, line, commandAbort.signal).then(
        (execution) => {
          if (execution !== undefined) return
          if (interactive) notice.text = `unknown command: ${line}`
          else io.stdout.write(sanitizeText(`[command] unknown: ${line}`) + '\n')
        },
        () => {
          // The handler's failure already settled as a command/done error
          // card in the transcript; the rejection is contained here.
        },
      )
      return
    }
    notice.text = ''
    submitLine(agent, line)
  }

  let presenter: TuiPresenter | undefined
  // Git watcher disposer; declared before the presenter branch assigns it.
  let offGit = (): void => {}
  if (interactive) {
    // Query the terminal's scheme before raw mode owns stdin; the dark
    // theme is the fallback when the terminal reports nothing.
    const scheme = await detectTerminalScheme(process.stdin, io.stdout)
    // @-file and slash-command completion over the workspace directory.
    const descriptors = commands?.list(agent) ?? []
    const autocomplete = workspaceAutocomplete(
      [
        ...descriptors.map(descriptor => ({ name: descriptor.name, description: descriptor.description })),
        { name: 'model', description: 'switch provider/model' },
        { name: 'thinking', description: 'set reasoning effort level' },
        { name: 'sessions', description: 'list and resume a session' },
        { name: 'editor', description: 'edit the draft in $EDITOR' },
      ],
      config.workspace ?? process.cwd(),
    )
    presenter = new TuiPresenter(internals.createTerminal(), transcript, {
      onSubmit: dispatchLine,
      statusLine,
      transient,
    }, themeForScheme(scheme), autocomplete)
    presenter.setMetaData(metaData)
    offGit = watchGitStatus(workspace, (status) => {
      gitState = status
      presenter?.requestRender()
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

  // One active question provider: the presenter answers tool-asked questions
  // while it runs; the pipe path registers none, so `ask()` keeps its
  // documented NO_PROVIDER failure.
  const offQuestions = presenter === undefined
    ? undefined
    : ctx.userQuestions.registerProvider({
      ask: async (request) => {
        if (activePresenter === undefined || !activePresenter.isStarted) {
          throw new Error('tui: no presenter to answer user questions')
        }
        return activePresenter.askQuestions(request.questions)
      },
    })

  try {
    presenter?.start()
    const outcome = presenter !== undefined
      ? await drivePresenter(presenter, agent)
      : await driveInput(input as InputSource, agent, dispatchLine)

    // Stop the presenter before the graceful flush so the shell is usable
    // while persistence drains; the pipe path has no presenter.
    commandAbort.abort()
    offEvents()
    offApproval()
    offQuestions?.()
    presenter?.stop()
    offGit()
    stopSpinner()
    activePresenter = undefined

    if (outcome.kind === 'hard-exit') {
      io.hardExit(outcome.code)
      return { kind: 'exit', code: outcome.code }
    }
    await sessions.flush(agent.session)
    await handle.dispose()
    if (outcome.kind === 'switch') {
      return { kind: 'switch', resumeId: outcome.resumeId }
    }
    io.exit(outcome.code)
    return { kind: 'exit', code: outcome.code }
  } catch (error) {
    commandAbort.abort()
    offEvents()
    offApproval()
    offQuestions?.()
    presenter?.stop()
    offGit()
    stopSpinner()
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
  // Session switching loops the runner: /sessions halts the drive, the outer
  // loop resumes the picked session, and the presenter restarts fresh.
  const runLoop = async (): Promise<void> => {
    let resumeId = config.resume !== undefined ? SessionId(config.resume) : undefined
    for (;;) {
      const result = await runOnce(ctx, config, io, input, resumeId)
      if (result.kind === 'switch') {
        resumeId = result.resumeId
        continue
      }
      return
    }
  }
  void runLoop().catch((error: unknown) => {
    // Report before the crash restore: the restore path hard-exits.
    io.stderr.write(`omd: ${error instanceof Error ? error.message : String(error)}\n`)
    crash()
    io.exit(1)
  })
}
