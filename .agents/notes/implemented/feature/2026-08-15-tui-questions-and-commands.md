# TUI user-questions and slash commands (M2b)

## Problem

The remaining interaction seams were silent: `ask_user_question` threw
`NO_PROVIDER` because no provider was registered, and a `/`-prefixed line was
submitted to the model like any other text instead of running through the
command runtime.

## Changes

- `packages/interaction/tui-renderer/src/presenter.ts` — the modal mechanism
  generalizes from approval to questions: `askQuestions` renders each
  question as its own overlay — a SelectList for option questions, a
  multi-select loop that re-shows the remaining options until Escape, and a
  free-text `Input` modal for option-less questions; Escape answers none.
  `promptSelect`/`promptText` share a `mountOverlay` slot; `approvalPending`
  becomes `interactionPending` so the runner's Ctrl+C listener yields for
  every modal kind (the SelectList/Input cancel binding is Escape *and*
  Ctrl+C).
- `packages/interaction/tui-renderer/src/transcript.ts` — new `command` item:
  `command/run` opens a card, the paired `command/done` (matched by
  `commandId` from the end) merges its `success`/`error` result. Commands are
  turn-external log-only appends, so the card never opens a turn bracket.
  `format.ts` renders `command /name args` + `  -> <text>` (error prefixed).
- `packages/bundle/tui/src/index.ts` — `dispatchLine` routes a submitted
  line: a parseable slash command runs through `ctx.commands.execute` (never
  the model); an unknown command reports in the presenter status row or as a
  `[command] unknown:` pipe line, and a handler failure stays contained (its
  `command/done` error card already rendered). The presenter registers the
  single user-questions provider while running; the pipe path registers none,
  keeping the documented `NO_PROVIDER` failure. The runner injects
  `userQuestions` and `commands` (both mounted by base). `traceLine` gains
  the command event summaries.
- Deps: renderer + bundle add `@deepseek-ai/dsh-commands` and
  `@deepseek-ai/dsh-user-questions` (peer+dev); renderer tsconfig gains both
  project references; the `command/run`/`command/done` session shapes ride
  the CommandRuntime merge.

## Why this design

- Questions reuse the approval modal verbatim: one interaction slot, one
  cancel convention, one Ctrl+C coordination rule.
- A slash command is a human UI gesture: it must never reach the model. The
  command runtime's own lifecycle events are the transcript's durable record
  — the renderer folds them like any other event, so the card survives
  resume replay without bundle-side state.
- The pipe path keeps its fail-closed posture: no presenter, no question
  provider; unknown commands surface as a trace line instead of vanishing.

## Verification

- +9 tests (bundle: known/unknown command dispatch, question modal answer,
  pipe NO_PROVIDER; renderer: command fold pairing, single/multi/text
  question flows). 109/109 unit tests, tsc 0, oxlint 0; PTY smoke passes in
  src and built-lib modes; full snapshot gate 14/14.

## Follow-up

- M3b snapshot fixtures cover interaction journeys (approval + question +
  command transcripts) replaying through the assembled application.
