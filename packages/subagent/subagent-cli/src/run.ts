/**
 * Fresh-process CLI subagent client. Drives one headless coding-agent CLI
 * (pi `-p`, oh-my-pi `-p`, opencode `run`, …): feeds the task prompt as a
 * positional tail argument or on stdin, collects stdout, and maps the exit
 * code + final text to the seam result. No shared wire protocol exists across
 * these agents, so the provider is generic and the parser surface is small.
 * @module @williamcodebox/omd-subagent-cli/run
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock } from '@williamcodebox/omd-llm'
import { SessionId } from '@williamcodebox/omd-session'
import { AssistantOutputFold } from '@williamcodebox/omd-subagent'
import type { SubagentResult, SubagentRun, SubagentStartRequest, SubagentStopReason } from '@williamcodebox/omd-subagent'
import {
  settleRunResult,
  subprocessRunHandle,
} from '@williamcodebox/omd-subagent'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@williamcodebox/omd-subprocess'

/** How the task prompt reaches the child. */
export type PromptStrategy = 'positional-tail' | 'stdin'

/** Resolved spawn spec for a CLI child process (no defaults — see Config). */
export interface CliRunSpec {
  /** The executable to spawn (the child coding agent). */
  command: string
  /** Arguments passed to {@link command}, excluding the prompt itself. */
  args: string[]
  /**
   * How the task prompt is delivered: appended as one trailing argument
   * (`positional-tail`, e.g. `pi -p "<prompt>"`) or written to the child's
   * stdin (`stdin`, e.g. `opencode run` reading the message from stdin).
   */
  promptStrategy: PromptStrategy
  /**
   * Absolute working directory for the child process. The provider resolves
   * it before this spec exists: config override, else the delegating parent
   * session's workspace.
   */
  cwd: string
  /**
   * Extra environment variables to ADD for the child (e.g. the child agent's
   * own `DEEPSEEK_API_KEY`). Merged on top of the subprocess seam's scrubbed
   * parent env; a value here is forwarded even if its name matches the
   * credential-scrub pattern (an explicit opt-in for the child's own creds).
   */
  env: Record<string, string>
  /** EOF grace for child flush and nested-process teardown (ms). */
  disposeEofGraceMs: number
  /** Termination-escalation grace (ms). */
  disposeGraceMs: number
}

/**
 * Translate the harness prompt blocks into the single prompt string sent to
 * the child: every block must be non-empty text (a child CLI has no channel
 * for non-text content). Throws on an empty prompt or any non-text block.
 * @param prompt - the harness prompt blocks.
 * @returns the joined prompt text.
 */
export function textTask(prompt: ContentBlock[]): string {
  if (prompt.length === 0) throw new Error('subagent-cli: refusing an empty task prompt')
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-cli: the CLI child accepts text prompts only')
    }
    if (block.text.length === 0) throw new Error('subagent-cli: refusing an empty task prompt')
    texts.push(block.text)
  }
  return texts.join('\n\n')
}

/**
 * Map the child's exit code + collected stdout to a seam stop reason.
 * A clean exit with no usable answer is an error (never `completed`), because
 * some CLIs exit 0 even when the run produced nothing.
 * @param exitCode - the child's exit code (`null` when a signal killed it).
 * @param stdout - the collected stdout text.
 * @returns `completed` only for exit 0 with non-blank output; `error` otherwise.
 */
export function cliStopReason(exitCode: number | null, stdout: string): SubagentStopReason {
  return exitCode === 0 && stdout.trim().length > 0 ? 'completed' : 'error'
}

/**
 * Cooperative teardown ladder for an out-of-process CLI child, over the seam's
 * public verbs; resolves only at whole-tree quiescence: stdin EOF (the child's
 * window to flush and reap its own descendants), then the terminate()
 * escalation (SIGTERM → spec grace → SIGKILL) and its whole-tree exit proof.
 * @param child - the spawned CLI child's handle.
 * @param eofGraceMs - tier-1 window after stdin EOF.
 */
export async function disposeCliChild(child: SubprocessHandle, eofGraceMs: number): Promise<void> {
  // A spawn failure has no process to tear down; observe the rejection so
  // disposal in a finally block cannot surface it as unhandled.
  if (child.pid <= 0) {
    await child.done.catch(() => {})
    return
  }
  child.stdin?.end()
  if (await treeExitsWithin(child, eofGraceMs)) return
  // terminate() owns the bounded SIGTERM→SIGKILL timer. Its unbounded wait is
  // the process owner's exit proof, not a second derived grace that can overflow.
  child.terminate()
  await child.waitForExit()
}

/** Resolve `waitForExit` within a bounded window (whole-tree exit proof). */
async function treeExitsWithin(child: SubprocessHandle, ms: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  timer.unref?.()
  try {
    return await child.waitForExit(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value: unknown): Error {
  /* v8 ignore next */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Start and publish one CLI child run. The child's stdout is collected into
 * the final text result; stderr stays on parent stderr ('inherit') for
 * diagnostics. Child failures resolve through the run result; startup
 * failures reject after process reap. Disposal cancels, kills, and reaps the
 * child.
 * @param request - the start request; its signal is the cancellation channel.
 * @param spec - the resolved spawn spec: command/args/cwd, prompt strategy,
 * env, dispose graces, and the optional error sink.
 * @returns the ready run handle for the child subprocess.
 */
export async function startCliRun(
  request: SubagentStartRequest,
  spec: CliRunSpec,
  spawn: (childSpec: SubprocessSpawnSpec) => SubprocessHandle,
): Promise<SubagentRun> {
  if (request.signal.aborted) throw new Error('subagent request was aborted before the CLI child started')
  // The lifecycle id is minted in the parent namespace so fresh processes
  // cannot collide with each other or with a local agent.
  const id = SessionId(randomUUID())

  const task = textTask(request.prompt)
  const argv = spec.promptStrategy === 'positional-tail'
    ? [spec.command, ...spec.args, task]
    : [spec.command, ...spec.args]

  // Keep diagnostics on parent stderr ('inherit'); only child stdout
  // contributes to the result. The seam's scrub drops ambient credentials and
  // DSH_* names while spec.env (the child's own key, its deployment facts)
  // merges after it.
  const child = spawn({
    argv,
    cwd: spec.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    graceMs: spec.disposeGraceMs,
    env: spec.env,
  })
  /* v8 ignore start -- 'pipe' dispositions expose both streams by the seam contract; defensive. */
  if (child.stdin === undefined || child.stdout === undefined) {
    throw new Error('subagent-cli: subprocess implementation dropped a piped protocol stream')
  }
  /* v8 ignore stop */

  const output: string[] = []
  child.stdout.on('data', (chunk: Buffer | string) => {
    output.push(chunk.toString())
  })

  // Spawn-level failure surfaces as `done` rejecting into the startup race; a
  // clean exit must never win it, so the success arm parks forever.
  const spawnFailed: Promise<never> = child.done.then(
    /* v8 ignore next -- the success arm's never-settling executor is intentionally empty. */
    () => new Promise<never>(() => {}),
    (err: unknown) => Promise.reject(toError(err)),
  )
  spawnFailed.catch(() => { /* observed by the startup race; never unhandled */ })

  // Startup rollback and the published handle share one process teardown.
  let processDisposal: Promise<void> | undefined
  const disposeProcess = (): Promise<void> => {
    processDisposal ??= disposeCliChild(child, spec.disposeEofGraceMs)
    return processDisposal
  }

  // Deliver the prompt on stdin for the stdin strategy; the positional-tail
  // strategy closes stdin immediately so the child never waits on it.
  child.stdin.end(spec.promptStrategy === 'stdin' ? task : undefined)

  // The settlement callback resolves the child's terminal state.
  const fold = new AssistantOutputFold()
  const waitForExit = child.done
  const attempt = async (): Promise<SubagentResult> => {
    const outcome = await waitForExit
    const text = output.join('').trim()
    if (outcome.exitCode !== 0) {
      throw new Error(`subagent-cli: ${spec.command} exited with code ${outcome.exitCode}`)
    }
    if (text.length === 0) {
      throw new Error(`subagent-cli: ${spec.command} completed without an answer`)
    }
    fold.pushText(text)
    const collected = fold.collect()
    if (collected === undefined) throw new Error(`subagent-cli: ${spec.command} completed without an answer`)
    return { output: collected, stopReason: 'completed' }
  }

  const requestCancel = (): void => {
    // No wire-level cancel exists for a bare CLI; process teardown is authoritative.
  }

  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  const collectOutput = (): ContentBlock[] => fold.collect() ?? []
  const cancelled = (): boolean => request.signal.aborted

  const result = settleRunResult({
    attempt,
    collectOutput,
    cancelled,
    signal: request.signal,
    onAbort,
  })

  return subprocessRunHandle({ id, result, signal: request.signal, onAbort, requestCancel, teardown: disposeProcess })
}
