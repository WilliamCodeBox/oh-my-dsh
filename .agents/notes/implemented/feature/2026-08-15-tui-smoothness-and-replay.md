# TUI smoothness pass and assembled replay (M3b)

## Problem

The TUI was functionally complete but not smooth: no way to page back
through history, a status row without token or timing information, an
undifferentiated single-color transcript, tool cards that could flood the
screen with long argument payloads, no resize verification, and — the
biggest gap — no test ever exercised the assembled app's real model
round-trip (streaming chunks → transcript → render) without a key.

## Changes

- `packages/interaction/tui-renderer`:
  - `TuiPresenter` keeps the transcript `ScrollView` and exposes
    `scrollTranscript(lines)`; PgUp/PgDn (+Shift variants) page the history
    from the runner's key listener, and pi-tui's `scrollBy` semantics leave
    end-following only while paging back — new content resumes following once
    the viewport returns to the bottom.
  - `Transcript` accumulates token usage across finalized assistant messages
    (`state.usage`); `formatStatus` shows `tokens i+o` and the most recent
    completed turn's duration.
  - `TranscriptView` takes an optional `TranscriptTheme`; the default is
    identity (snapshot fixtures stay plain text), the presenter passes a
    16-color ANSI theme (user cyan, tool yellow, turn gray, command magenta).
  - `formatItem` caps tool/command argument and result lines at 300 chars
    with an explicit `…(+N)` remainder.
- `packages/bundle/tui` — EOF on the pipe path now awaits `agent.whenIdle()`
  before quitting, so `echo task | dsh --profile tui` runs the piped task to
  completion instead of aborting it at stream end.
- `apps/cli/tests/tui-pty.snapshot.ts` — the PTY driver gains a `resize`
  action (TIOCSWINSZ + SIGWINCH); the case resizes mid-session and still
  asserts a clean 130 quit and alternate-screen restore.
- `examples/tui-agent` — the interaction-journey snapshot
  (`tui-interaction.snapshot.ts`) pins the rendering of every adapter-produced
  item kind (approval-decided tool card, command card, aborted turn); the
  assembled replay case (`tui-replay.snapshot.ts`) boots `dsh --profile tui
  --patch replay.cordis.yml` — real DeepSeek adapter disabled, `dsh-llm-replay`
  serving the fixture under the profile's default provider/model — pipes a
  line through the full agent loop, and asserts the trace stream (chunks,
  finalized message, completed turn). The replay package resolves in lib mode
  via a `node_modules` symlink under the temp profile's ancestor chain (the
  built loader resolves patched-in packages from the profile directory).

## Why this design

- Paging through history is the difference between a scrollback and a
  one-screen echo; pi-tui's `scrollBy` already implements leave-follow /
  resume-follow, so the runner only routes the keys.
- Styling is opt-in so the deterministic snapshot surface (plain lines) never
  changes; the colored transcript is a presentation choice.
- The replay case is the only keyless proof that the assembled app's model
  round-trip works — streamed chunks land in the transcript, the turn closes,
  and the pipe path drains before exiting. The `--patch` overlay reuses the
  shipped profile mechanism instead of a test-only composition.

## Verification

- Unit tests 116/116 (bundle + renderer, +7 for paging, usage, caps, EOF
  drain); tsc 0; oxlint 0.
- PTY smoke passes in src and built-lib modes with the mid-session resize.
- Replay + interaction snapshots pass in src and lib modes; full snapshot
  gate 16/16 files, 119/119 tests.

## Follow-up

- M4 out-of-process frontend; theme/card polish (markdown, diff cards) can
  build on the `TranscriptTheme` seam.
