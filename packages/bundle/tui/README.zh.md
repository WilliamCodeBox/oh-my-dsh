# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

The dsh interactive terminal surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md): it supplies the coding persona, disables HMR, and inserts this package's `tui-startup` provider plus the `tui-runner` glue plugin. It mounts no Host, HTTP server, Web runtime, or browser plugin.

After the Loader settles, the runner reads the shared `ctx.agentDefaultModel` (or the `--model` pair), creates or resumes one persisted Agent through `ctx.agents`, and drives it interactively:

- **Event tracing**: a root `session/event` listener filtered to the owned session prints a compact `[type] summary` line per durable event (user messages, assistant chunks, tool calls and results, turn and step boundaries). Subagent sessions never trace into the transcript, and every traced line passes through the display sanitizer before it reaches the terminal, so prompt-injected control sequences render as visible hex escapes instead of executing.
- **Input**: Enter submits the input line as an ordinary follow-up turn while idle and as steering while a turn runs; backspace edits; Ctrl+C is handled by the raw-mode key machine (clear line → cancel turn → quit → force-exit), never by the launcher's signal chain.
- **Terminal lifecycle**: raw mode is entered on boot and restored synchronously on quit, on uncaught exceptions, and as the crash-restore handler's first action, so a failed run cannot strand the user's shell in a raw state.

The current surface is the M0 skeleton: line-oriented event tracing with no full-screen renderer. The approval / user-questions / commands adapters, the scroll viewport, the two-layer renderer, and the strict-TTY contract land in later milestones without changing these rows.

## App command line

The `tui-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)), parses this app's flags, and provides `tuiStartup`; the runner row injects that service and reads its config from lazy `!!js` expressions. `dsh --profile tui --help` prints this app's help and boots nothing.

| Flag | Meaning |
|---|---|
| `--resume <session-id>` | Resume a persisted session instead of creating a fresh one (`ctx.agents.resume`). |
| `--workspace <path>` | Session workspace root; defaults to the invoking directory. |
| `--model <provider/model>` | Provider/model pair for this session; defaults to `ctx.agentDefaultModel`'s current selection. The slash is required. |
| `--permission <preset>` | Permission preset applied at session creation (`ctx.permissionPresets.set`); requires the `dsh-permission-presets` service. |

## Public modules

| Export | Role |
|---|---|
| `./startup` | The `tui-startup` command-line provider. |
| `./invariant` | Package-owned invariant companion (no runtime invariant yet; the runner's contract is process-level). |

The terminal lifecycle (`TerminalSession`, `CtrlCController`, `installCrashRestore`) and the display sanitizer are internal modules folded into the package entry; they become public surface when the renderer milestone splits the presentation layer.

## Model Experience

None, as the runner submits user input as ordinary user messages and adds no prompt prose or tool schema of its own; the persona row and the tool rows belong to the base and tui bundle layers.

#### KV Cache effect

None; the runner adds nothing to the request prefix beyond the shared persona row.

## Known Limitations and Deferred Work

- **Line-oriented M0 only** — there is no full-screen renderer, alternate-screen scrollback, or scroll viewport; a resumed session replays as a stream of trace lines. The renderer milestone replaces the tracer.
- **No interaction adapters yet** — approval prompts, `ask_user_question` pickers, and the slash-command menu arrive with the interaction-adapter milestone; until then, approvals fall through to the fail-closed `unavailable` outcome and questions to `NO_PROVIDER`.
- **No strict TTY requirement yet** — a non-TTY stdin skips raw mode and is driven as a pipe; the full-screen milestone makes the surface fail loud instead.
- **Ctrl+C semantics are the skeleton** — the refined "cancel then graceful 130 quit" policy lands with the keymap milestone; the launcher's SIGINT/SIGTERM chain remains a cooked-window and external-signal safety net and is not reachable from raw mode.
- **Escape sequences are dropped, not decoded** — `StdinInputSource` ignores ESC-prefixed key sequences until the keymap milestone.
