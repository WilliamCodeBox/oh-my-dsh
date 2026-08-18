# `@williamcodebox/omd-tui`

English | [中文](README.zh.md)

The dsh interactive terminal surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md): it supplies the coding persona, disables HMR, moves the model-facing tool plane behind agent presets (mirroring the Web surface), and inserts this package's `tui-startup` provider plus the `tui-runner` glue plugin. It mounts no Host, HTTP server, Web runtime, or browser plugin.

After the Loader settles, the runner reads the shared `ctx.agentDefaultModel` (or the `--model` pair), creates or resumes one persisted Agent through `ctx.agents`, and drives it interactively:

- **Agent presets**: every model-facing tool and prompt section comes from the agent's preset, mirroring the Web surface. A fresh session composes the deployment default (`standard` unless overridden); a resumed session composes what its log records (`resolveSessionPreset`), so history stays under the tool set that produced it; `/preset` switches a blank session to another roster entry. A rosterless deployment (a custom profile without the `agent-presets` row) keeps the base global tool layer, the same fallback the Web api-proxy uses. The one global tool every TUI session sees is `lsp` — the base keeps it for every profile, and the TUI bundle ships the language server that activates it.
- **Transcript**: a root `session/event` listener filtered to the owned session folds every durable event into `@williamcodebox/omd-tui-renderer`'s `Transcript` (subagent sessions never fold in). A resumed session starts from the stored seed events, which constructor seeds never re-emit. The fold model is the stable contract between the bundle and the presentation layer. The fold also projects every event into a trajectory-style record ledger: `/ledger` toggles the ledger view (one row per record with its kind, summary, and duration; Enter opens a per-record detail overlay with input/output/schema/timing tabs where the record carries them), and `/filter <kind>` narrows it to one of the seven record kinds — `system`, `user`, `context`, `compacted`, `message`, `tool`, `subtool` — while a bare `/filter` clears the filter. The ledger and its detail overlay are TTY-only: on the pipe path `/ledger` reports `ledger unavailable`.
- **Presenter surface (TTY)**: the pi-tui-backed `TuiPresenter` owns the full screen — alternate screen, raw mode, the input editor, and the scroll viewport over the folded transcript with a status row. Enter submits the input line as an ordinary follow-up turn while idle and as steering while a turn runs; Ctrl+C is handled by the raw-mode key machine (clear line → cancel turn → idle confirm → graceful quit with exit 130 → force-exit), never by the launcher's signal chain. While a turn runs, the status row's transient shows the elapsed seconds plus an escape hint, and flips to the warning color once the model has been silent for a minute so a stalled request reads as a stall, not idle.
- **Pipe surface (non-TTY)**: a non-TTY stdin is driven as a pipe; each durable event prints a compact `[type] summary` trace line. Every line passes the display sanitizer before it reaches the terminal, so prompt-injected control sequences render as visible hex escapes instead of executing. The keymap decodes ESC sequences (arrows, Home/End, PgUp/PgDn, Delete) into an editable line buffer with up/down history recall and Escape-to-clear; unknown sequences never leak control bytes into the line.
- **Terminal lifecycle**: the presenter restores the terminal synchronously on quit, on uncaught exceptions, and as the crash-restore handler's first action, so a failed run cannot strand the user's shell in a raw state.

The approval / user-questions / commands adapters and the strict-TTY contract land in later milestones without changing these rows.

## App command line

The `tui-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)), parses this app's flags, and provides `tuiStartup`; the runner row injects that service and reads its config from lazy `!!js` expressions. `omd --profile tui --help` prints this app's help and boots nothing.

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

The runner (`traceLine`, `StdinInputSource`, the Ctrl+C machine, and the crash handler) is folded into the package entry; the presentation layer moved to `@williamcodebox/omd-tui-renderer`.

## Model Experience

None, as the runner submits user input as ordinary user messages and adds no prompt prose or tool schema of its own; every model-facing tool and prompt section belongs to the composed base, tui, and agent-preset layers.

#### KV Cache effect

None; the runner adds nothing to the request prefix beyond the shared persona row.

## Known Limitations and Deferred Work

- **No strict TTY requirement yet** — a non-TTY stdin is driven as a pipe with the line tracer; the strict-TTY milestone makes the surface fail loud instead.
- **Idle Ctrl+C confirms before quitting** — with an empty input line and no running turn, the first Ctrl+C hints (`Ctrl+C again to quit`) and only the second press inside the window quits with exit 130; the launcher's SIGINT/SIGTERM chain remains a cooked-window and external-signal safety net and is not reachable from raw mode.
