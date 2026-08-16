# Agent Note: TUI keymap and graceful 130 quit (M1b)

Status: implemented
Archived: 2026-08-16

English | [中文](2026-08-15-tui-keymap-graceful-130-quit.zh.md)

## Problem

The pipe (non-TTY) surface had no keyboard protocol: ESC sequences were
dropped byte-by-byte, so arrows/Home/End/PgUp/PgDn/Delete could not edit the
input line, and Ctrl+C quit with exit code 0 — not the SIGINT convention code
a user interrupt should report.

## Changes

- `packages/bundle/tui/src/keymap.ts` — new streaming ESC-sequence decoder.
  Holds an ESC across chunks until the next byte decides bare-Escape vs a
  CSI/SS3 sequence, and a CSI sequence until its final byte arrives; maps
  arrows, Home/End (CSI letter, `1~`/`4~`/`7~`/`8~`), PgUp/PgDn (`5~`/`6~`),
  Delete (`3~`), SS3 application-cursor finals, and modifier parameters to
  the base key; unknown well-formed sequences are consumed silently, matching
  the M0 contract that escape bytes never enter the input line; a trailing
  ESC flushes as Escape at EOF.
- `packages/bundle/tui/src/index.ts` — `TuiKey` grows delete/escape/left/
  right/up/down/home/end/page-up/page-down; `StdinInputSource` decodes
  through the keymap; `driveInput` becomes a cursor-editing line buffer with
  Escape-to-clear and up/down history recall (newest-first ring with draft
  restore). Ctrl+C quit now exits **130** on both the pipe and presenter
  paths — graceful (presenter stop, flush, terminal restore), never the
  crash-restore hard exit; EOF quit stays 0.
- `packages/bundle/tui/src/terminal.ts` — the Ctrl+C machine docstring now
  states the landed policy instead of deferring it.
- `packages/bundle/tui/README.md`/`README.zh.md` — pipe-surface and gap
  bullets updated; pairing hashes re-recorded.
- Tests: +11 (keymap sequence families, cross-chunk buffering, EOF flush,
  cursor editing, history recall); the obsolete ESC-drop and quit-0
  assertions changed with the behavior. The PTY smoke's expected exit is 130.

## Why this design

- pi-tui's Editor already consumes arrows/PgUp/PgDn on the presenter path
  (its own cursor and paging keybindings), so the keymap decodes only where
  no editor exists — the pipe line-tracer surface.
- 130 is what a shell reports for a SIGINT-killed process; a TUI quit is the
  same user interrupt delivered gracefully, so the exit code matches the
  convention while the shutdown path stays clean.
- History is a bounded ring: up recalls newest-first, down returns to the
  pre-recall draft; submitting pushes and resets.

## Verification

- `packages/bundle/tui` tests 52/52 (was 41); `tsc -b` 0 errors; oxlint 0.
- PTY smoke passes in src mode and `DSH_EXAMPLE_MODE=lib` with the 130 exit
  and terminal restore asserted; full snapshot gate 14/14 files, 117/117
  tests (the previously flaky ACP goal cases also passed).

## Follow-up

- M2 interaction adapters mount on the presenter seam; slash-commands will
  reuse the keymap vocabulary for `/`-prefixed lines on the pipe path.
