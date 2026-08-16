# Agent Note: TUI renderer presenter (M1a presenter slice)

Status: implemented
Archived: 2026-08-16

English | [中文](2026-08-14-tui-renderer-presenter.zh.md)

## Problem

The transcript fold model ([2026-08-14-tui-renderer-transcript-model](2026-08-14-tui-renderer-transcript-model.md)) is the renderer's data foundation, but the TTY surface was still the M0 line tracer. The two-layer renderer — a scrollable transcript, status row, and input editor over the alternate screen — needed the pi-tui presenter wired into the runner, with raw-mode and input ownership moved out of the bundle.

## Decision

`packages/interaction/tui-renderer` gains the presentation layer:

- **`TranscriptView`/`StatusRow`** — pi-tui `Component`s rendering folded items and the dynamic status row through the display sanitizer.
- **`TuiPresenter`** — a `TuiAltScreen` with a `setLayoutRoot` `VStack`: `ScrollView` (follow-end, primary) over the transcript, status row, and the pi-tui `Editor`. `start()`/`stop()` own raw mode and the alternate screen; `onSubmit` forwards editor lines; `onKey` lets the runner consume raw keys (Ctrl+C); `setInput`/`getInput` serve the Ctrl+C clear/empty-input decisions. `processTerminal()` is the production backend; the bundle injects an in-memory `Terminal` in tests.
- **`format`/`sanitize`** — item→line formatting and the display sanitizer, moved out of the bundle (the sanitizer is a presentation concern; the bundle's copy is deleted).

The bundle's `tui-runner` folds every owned-session event into `Transcript` and branches on `process.stdin.isTTY`:

- **TTY** — the presenter owns the surface; resume folds `agent.session.events` first (constructor seeds never re-emit through `session/event`); the crash handler stops the presenter.
- **non-TTY** — the M0 line tracer remains the pipe surface; `TerminalSession` is deleted because neither path uses it (the presenter owns raw mode on TTY; pipes never entered it).

## Alternatives considered

### Why not keep the line tracer as the TTY surface?

The renderer milestone's contract: presentation moves out of the bundle and the tracer is replaced on the human surface. Keeping it would have preserved the M0 tests but shipped no renderer.

### Why does the bundle branch on `isTTY` instead of failing loud?

The strict-TTY contract is the M1b milestone's decision ("refuse to boot or degrade explicitly"). The pipe path preserves M0 behavior (scripted stdin) until then; M1b removes or hardens it.

### Why delete `TerminalSession`?

With the presenter owning raw mode on TTY and pipes never entering it, `TerminalSession.enter()` was dead on both paths. The crash handler now stops the presenter instead, which restores raw mode and the alternate screen together.

## Consequences

- `omd --profile tui` on a TTY shows the two-layer surface: scrollable transcript (user/assistant/tool/turn items), status row (model route, todo counts, compaction count), and the input editor. Enter submits follow-up turns or steering; Ctrl+C runs the same three-state machine (clear → cancel → quit → force-exit) through the presenter's raw-key listener.
- The bundle's M0 pipe tests were re-based to the non-TTY path; new presenter tests drive the runner through an in-memory `Terminal` (editor submit, Ctrl+C cancel/force-exit, resume seed folding, crash restore). 84 tests pass across the bundle and renderer packages; typecheck, lint, build, workspace constraints, and the Model Experience doc gate pass.
- `@earendil-works/pi-tui@0.84.2` (ESM, Node ≥ 22.19, deps: marked + get-east-asian-width) is a runtime dependency of the renderer package; the old dsh patch (editor prompt prefixes) is not upstreamed and is not re-applied yet.
- Remaining in the milestone arc: keymap refinement (ESC sequences, Shift+Enter, graceful-130 Ctrl+C), interaction adapters (approval/questions/commands), theming/diff cards, and the PTY acceptance harness (M3a).
