# @williamcodebox/omd-tui-renderer

English | [中文](README.zh.md)

Folded terminal transcript model and pi-tui-backed presentation layer for the `omd --profile tui` surface. The transcript projects one session's durable `session/event` stream into display items; the presenter renders them on the alternate screen with a scroll viewport, status row, and input editor. Interaction adapters land in later milestones on top of the presenter seam.

## Transcript model

`Transcript` folds events in sequence order — stored seed events first on resume, live events as they emit — into display items:

- **user** messages, with their producer source and the turn open when folded;
- **assistant** messages that stream text from chunks and finalize on the assembled message (carrying its token usage and the assembled message itself);
- **tool** call/result cards merged by call id, with the model-facing result text, failure identity, and tool-private presentation `meta` (e.g. `dsh-tool-fs`'s contextual diff);
- **turn** brackets opened by `turn/start` and closed by `turn/end` with the ending reason.

Side state the renderer shows beside the transcript rides the folded projection: the latest todo-list snapshot, request header, provider route context, the `session/end-seed` marker, and observed compaction replacements.

Transcript material is **append-origin surface events only**. The session surface contract (`isAppendSurfaceEvent` in `packages/core/session/src/surface.ts`) names append-origin events the transcript's durable source material and keeps replacement copies model-only — a landed compaction replacement would erase conversation the human already saw. Replacements therefore surface as `CompactionNote` entries, so the renderer can indicate that context was compacted without erasing what the user already saw.

## Public modules

| Export | Role |
|---|---|
| `./transcript` | The `Transcript` fold model and the `textOf` block-text extractor. |
| `./presenter` | `TuiPresenter` — the pi-tui alternate-screen surface (scroll viewport, status row, meta row, editor) plus the `processTerminal()` production backend and `workspaceAutocomplete()`. |
| `./transcript-view` | `TranscriptView`/`StatusRow` — themed rendering of folded items (user background cards, assistant Markdown, state-colored tool cards with diffs, one blank line between items) and the dynamic status row. |
| `./meta-row` | `MetaRow`/`renderMetaRow` — the input-context row (model/thinking, cwd/git, context bar). |
| `./theme` | `darkTheme`/`lightTheme`/`themeForScheme` — semantic 256-color themes (foreground roles, user background, markdown and editor sub-themes). |
| `./scheme` | `detectTerminalScheme` — terminal color-scheme query for theme selection. |
| `./keybindings` | `KeybindingRegistry` — presenter raw-key dispatch used by the runner. |
| `./sanitize` | `sanitizeText`/`needsSanitize` display sanitizer for untrusted model and tool text. |
| `./format` | `formatItem`/`formatStatus` display formatting for folded items and the status row. |
| `./invariant` | Package-owned invariant companion (no runtime invariant; the fold is a projection, and the session layer owns event validation). |

## Model Experience

None, as the transcript model folds durable session events into display items and registers no prompt, tool schema, or model context of its own.

#### KV Cache effect

None; the model folds no request prefix.

## Known Limitations and Deferred Work

- **Interaction overlays are single-slot** — one approval or question modal at a time; further requests queue behind the live modal and mount on its close.
- **Visible text only** — chunk accumulation keeps `text-delta` content; reasoning deltas and tool-call content blocks are not accumulated separately (the assembled `assistant/message` is retained for renderers that need the full block structure).
- **No ordering validation** — the fold trusts the session layer's sequence order; out-of-order events are folded as received.
