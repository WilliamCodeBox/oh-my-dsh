# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

The dsh interactive terminal surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md): it supplies the coding persona, disables HMR, and inserts this package's `tui-startup` provider plus the `tui-runner` glue plugin. It mounts no Host, HTTP server, Web runtime, or browser plugin.

After the Loader settles, the runner reads the shared `ctx.agentDefaultModel` (or the `--model` pair), creates or resumes one persisted Agent through `ctx.agents`, and drives it interactively:

- **Transcript**: a root `session/event` listener filtered to the owned session folds every durable event into `@deepseek-ai/dsh-tui-renderer`'s `Transcript` (subagent sessions never fold in). A resumed session starts from the stored seed events, which constructor seeds never re-emit. The fold model is the stable contract between the bundle and the presentation layer.
- **Presenter surface (TTY)**: the pi-tui-backed `TuiPresenter` owns the full screen — alternate screen, raw mode, the input editor, and the scroll viewport over the folded transcript with a status row. Enter submits the input line as an ordinary follow-up turn while idle and as steering while a turn runs; Ctrl+C is handled by the raw-mode key machine (clear line → cancel turn → graceful quit with exit 130 → force-exit), never by the launcher's signal chain.
- **Pipe surface (non-TTY)**: a non-TTY stdin is driven as a pipe; each durable event prints a compact `[type] summary` trace line. Every line passes the display sanitizer before it reaches the terminal, so prompt-injected control sequences render as visible hex escapes instead of executing. The keymap decodes ESC sequences (arrows, Home/End, PgUp/PgDn, Delete) into an editable line buffer with up/down history recall and Escape-to-clear; unknown sequences never leak control bytes into the line.
- **Terminal lifecycle**: the presenter restores the terminal synchronously on quit, on uncaught exceptions, and as the crash-restore handler's first action, so a failed run cannot strand the user's shell in a raw state.

The approval / user-questions / commands adapters and the strict-TTY contract land in later milestones without changing these rows.

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

The runner (`traceLine`, `StdinInputSource`, the Ctrl+C machine, and the crash handler) is folded into the package entry; the presentation layer moved to `@deepseek-ai/dsh-tui-renderer`.

## Model Experience

None, as the runner submits user input as ordinary user messages and adds no prompt prose or tool schema of its own; the persona row and the tool rows belong to the base and tui bundle layers.

#### KV Cache effect

None; the runner adds nothing to the request prefix beyond the shared persona row.

## Known Limitations and Deferred Work

- **No interaction adapters yet** — approval prompts, `ask_user_question` pickers, and the slash-command menu arrive with the interaction-adapter milestone; until then, approvals fall through to the fail-closed `unavailable` outcome and questions to `NO_PROVIDER`.
- **No strict TTY requirement yet** — a non-TTY stdin is driven as a pipe with the line tracer; the strict-TTY milestone makes the surface fail loud instead.
- **Ctrl+C quits with exit 130** — the SIGINT convention code, delivered through the normal shutdown path (presenter stop, flush, terminal restore); the launcher's SIGINT/SIGTERM chain remains a cooked-window and external-signal safety net and is not reachable from raw mode.
- **Presenter text is plain** — the transcript renders as sanitized plain lines with no markdown, diff cards, or colors; the theme and card milestones land on the `TuiPresenter` seam.
