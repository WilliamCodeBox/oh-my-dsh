/**
 * Out-of-process CLI subagent backend: drives a headless coding-agent CLI
 * (pi, oh-my-pi, opencode, …) in a spawned subprocess. Each child has its own
 * process, session, model, and tools, so it shares no Cordis context and
 * advertises no parent-enforced start capabilities; the ONE thing it reads off
 * `request.parent` is the session's workspace cwd. This plugin uses named
 * exports only; a default would hide its loader metadata (see
 * `docs/postmortem/0001-acp-default-export-drops-inject.md`).
 * @module @williamcodebox/omd-subagent-cli
 */

import type { Context } from '@williamcodebox/cordis'
import z from '@williamcodebox/schemastery'
import type { SubagentProvider, SubagentStartRequest } from '@williamcodebox/omd-subagent'
import {
  NO_START_CAPABILITIES,
  resolveChildCwd,
  validateConfiguredCwd,
} from '@williamcodebox/omd-subagent'
import { MAX_TIMER_DELAY_MS } from '@williamcodebox/omd-timeout'
import { type CliRunSpec, type PromptStrategy, startCliRun } from './run.ts'

export const name = 'subagent-cli'
export const inject = ['subagents', 'subprocess']

/** Config: how to spawn and drive the child CLI agent process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `cli`). */
  providerName: string
  /** The executable to spawn for each run (the child coding agent). */
  command: string
  /** Arguments passed to {@link command}, excluding the prompt itself. */
  args: string[]
  /**
   * How the task prompt is delivered: `positional-tail` appends it as one
   * trailing argument (e.g. `pi -p "<prompt>"`); `stdin` writes it to the
   * child's stdin (e.g. `opencode run` reading the message from stdin).
   */
  promptStrategy: PromptStrategy
  /**
   * Working directory override for the child process. Must be non-empty; a
   * relative path resolves against the harness launch directory at load, and
   * the result must be an existing directory. When omitted, each child
   * inherits its delegating parent session's cwd — and starting one from a
   * parent session that has no cwd fails.
   */
  cwd?: string
  /**
   * Extra environment variables for the child process — e.g. the child
   * agent's own `DEEPSEEK_API_KEY` or `ANTHROPIC_API_KEY`. Forwarded on top
   * of a credential-scrubbed copy of the parent env, so an explicit key here
   * reaches the child while ambient secrets do not leak implicitly.
   */
  env: Record<string, string>
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal. Must not exceed
   * `MAX_TIMER_DELAY_MS`.
   */
  disposeEofGraceMs?: number
  /** Termination-escalation grace (ms); must not exceed `MAX_TIMER_DELAY_MS`. */
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('cli'),
  command: z.string().required(),
  args: z.array(z.string()).default([]),
  promptStrategy: z.union(['positional-tail', 'stdin'] as const).default('positional-tail'),
  cwd: z.string(),
  env: z.dict(z.string()).default({}),
  disposeEofGraceMs: z.number().default(6_000),
  disposeGraceMs: z.number().default(3_000),
})

/** A dispose grace must fit the single Node timer that owns its teardown tier. */
function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`subagent-cli: ${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** The shape after schemastery applied the defaults (cwd has none). */
type ResolvedConfig = Required<Omit<Config, 'cwd'>> & Pick<Config, 'cwd'>

/** Register the CLI subagent provider with `ctx.subagents`. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveFinite('disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertPositiveFinite('disposeGraceMs', resolved.disposeGraceMs)
  const configuredCwd = validateConfiguredCwd('subagent-cli', resolved.cwd)
  const provider: SubagentProvider = {
    name: resolved.providerName,
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    async start(request: SubagentStartRequest) {
      const spec: CliRunSpec = {
        command: resolved.command,
        args: resolved.args,
        promptStrategy: resolved.promptStrategy,
        cwd: resolveChildCwd('subagent-cli', configuredCwd, request.parent.session.header.cwd),
        env: resolved.env,
        disposeEofGraceMs: resolved.disposeEofGraceMs,
        disposeGraceMs: resolved.disposeGraceMs,
      }
      return startCliRun(request, spec, (childSpec) => ctx.subprocess.spawn(childSpec))
    },
  }
  ctx.subagents.registerProvider(provider)
}
