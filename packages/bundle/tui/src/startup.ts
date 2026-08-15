/**
 * The terminal app's command-line provider: it parses `--resume`,
 * `--workspace`, `--model`, and `--permission`, then publishes
 * {@link TUI_STARTUP_SERVICE}. The runner is an ordinary consumer whose lazy
 * config waits for that service.
 * @module @deepseek-ai/dsh-tui/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the startup values can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the runner row. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the runner row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Persisted session id to resume instead of creating a fresh session. */
  resume?: string
  /** Workspace root for this session; the runner defaults to the invoking directory. */
  workspace?: string
  /** Provider/model pair in `provider/model` form. */
  model?: string
  /** Permission preset name (read-only | workspace-write | danger-full-access). */
  permission?: string
}

/**
 * This app's command line: the flags, their descriptions, and the help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('omd --profile tui')
    .description('Start an interactive terminal coding session.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <session-id>', 'resume a persisted session instead of creating a fresh one')
    .option('--workspace <path>', 'workspace root for this session (default: invoking directory)')
    .option('--model <provider/model>', 'model pair for this session')
    .option('--permission <preset>', 'permission preset: read-only | workspace-write | danger-full-access')
    .addHelpText('after', `
Examples:
  omd --profile tui
  omd --profile tui --resume <session-id>
  omd --profile tui --model deepseek-official/deepseek-v4-pro
`)
}

/**
 * Parse and provide the startup values as an ordinary Cordis service. A
 * `--model` without a slash is a usage error, so on rejection (and on
 * `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action((options: { resume?: string; workspace?: string; model?: string; permission?: string }) => {
    if (options.model !== undefined && !options.model.includes('/')) {
      program.error('error: --model must be in provider/model form, for example deepseek-official/deepseek-v4-pro')
    }
    ctx.provide(TUI_STARTUP_SERVICE, {
      ...(options.resume !== undefined ? { resume: options.resume } : {}),
      ...(options.workspace !== undefined ? { workspace: options.workspace } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.permission !== undefined ? { permission: options.permission } : {}),
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
