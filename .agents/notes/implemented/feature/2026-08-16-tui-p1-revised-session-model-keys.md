# Agent Note: TUI P1 revised — model switching, transient status, keybinding registry, session switching

Status: implemented

English | [中文](2026-08-16-tui-p1-revised-session-model-keys.zh.md)

## Problem

The adversarial plan review (opencode source + industry practice) flagged
five P1 gaps in the TUI roadmap: session management, help/which-key, /model
switching, running-state visibility, and a keybinding registry. This note
covers their implementation. OSC 133/7 prompt markers are deferred: inside
the alternate screen they would interleave with pi-tui's own rendering, and
pi-tui's semantic jump bindings need framework support first.

## Decision

`packages/interaction/tui-renderer/src/keybindings.ts` — new:
`KeybindingRegistry` with last-wins dispatch, opt-out handlers, a display
name per binding, and help listing.

`packages/interaction/tui-renderer/src/presenter.ts` — `showHelp(entries)`
renders a read-only overlay (esc/enter closes); `setHaltHandler`/`halt`
let a command end the drive loop with an arbitrary payload; the status row
gains a transient right segment (spinner/retry/esc hints) that truncation
never drops (left segments shrink first).

`packages/bundle/tui/src/index.ts` —
- /model <provider>/<model> mutates the now-mutable ModelSelectionRef (the
  assembly listener reads ref.current per prompt); /model alone reports the
  current selection; listed in slash completion.
- The transient status callback shows a spinner + 'esc to interrupt' while
  a turn runs.
- drivePresenter registers PgUp/PgDn (and Shift variants), ?, Ctrl+C through
  the registry; ? opens the help overlay from the same bindings.
- /sessions lists persisted sessions via ctx.sessionPersistence.list() and
  picks one through the questions modal; the drive halts with the resume id
  and the outer loop rebuilds the agent (runOnce + switch loop in apply).
- Fail-soft without a persistence service: 'sessions unavailable' notice.

## Alternatives considered

- **OSC 133/7 prompt markers now** — rejected: inside the alternate screen
  they interleave with pi-tui's own rendering, and the semantic jump
  bindings need framework support first.
- **Slash commands executing inline in dispatchLine** — rejected for the
  commands runtime: the runtime gives settled command cards and the drive
  halt seam (`setHaltHandler`) that session switching needs.

## Consequences

- vitest tui-renderer + bundle: 157 tests pass (9 new since the review);
  tsc clean on both packages; eslint clean.
- PTY run of the source TUI: ? opens the keybinding help overlay; /model
  reports the current selection; /sessions opens a 16-entry session picker
  with id/createdAt/cwd and scroll indicator.
- The keybinding registry is the foundation for which-key/command-palette:
  bindings are data, help derives from the same source the dispatcher uses.
  Session switch rebuilds the agent inside the process (presenter stop →
  resume → fresh presenter); the pipe path keeps single-run semantics.
