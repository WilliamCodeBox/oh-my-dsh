# TUI approval adapter (M2a)

## Problem

Every tool call needing approval failed closed to `'unavailable'`: the TUI
had no answerer for the `approval/request` waterfall, so permission-sensitive
work could never run interactively.

## Changes

- `packages/interaction/tui-renderer/src/presenter.ts` — overlay modal on the
  presenter seam: `askApproval(toolName, reason)` mounts a pi-tui overlay
  card (title + reason + `SelectList` of Allow/Reject) via `showOverlay`,
  steals focus to the list, and resolves with the chosen outcome. Escape or
  Ctrl+C cancels (`'cancelled'`); the modal restores editor focus and hides
  itself on decision. `approvalPending` and `isStarted` getters expose the
  modal state to the runner.
- `packages/bundle/tui/src/index.ts` — the answerer: `ctx.on('approval/request',
  ...)` routes every approval on the composed surface to the active
  presenter's modal; without a presenter (pipe path) the listener calls
  `next()`, so the waterfall falls through to its fail-closed `'unavailable'`.
  The runner's Ctrl+C listener yields to the modal while `approvalPending`:
  the SelectList's own cancel binding (Escape/Ctrl+C) resolves the prompt
  instead of the quit machine.
- Deps: `@deepseek-ai/dsh-user-approval` added as peer+dev to the renderer
  and bundle (its `./types` subpath is wire-safe); the renderer tsconfig
  gains the user-approval project reference.

## Why this design

- pi-tui's `showOverlay`/`hideOverlay` manages focus, stacking, and restore —
  no layout-root swapping, and the pre-existing `EDITOR_THEME.selectList`
  styling is reused as the modal's list theme.
- The TUI answers every agent's approval (subagents included): the user is in
  front of this terminal, and the audit pair still lands on the requesting
  session's log.
- The pipe path keeps the documented fail-closed contract — no silent
  auto-approval anywhere.

## Verification

- +5 tests: the bundle drives Allow (Enter), Reject (down+Enter), Cancel
  (Ctrl+C then quit-130 on the next press) over the fake terminal, and the
  pipe path returns `'unavailable'`; the renderer tests the modal lifecycle
  directly (allow/reject/cancel, `approvalPending` transitions).
- 100/100 unit tests across bundle + renderer; `tsc -b` 0 errors; oxlint 0.

## Follow-up

- M2b: `ask_user_question` pickers mount on the same modal mechanism; the
  slash-command menu dispatches `/`-prefixed lines through the command
  runtime with a `command` transcript item.
