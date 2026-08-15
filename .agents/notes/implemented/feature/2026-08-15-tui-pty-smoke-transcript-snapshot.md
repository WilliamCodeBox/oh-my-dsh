# TUI PTY smoke and transcript snapshot (M3a)

## Problem

The `dsh --profile tui` journey — boot, render, input, quit, terminal restore — had no assembled-surface acceptance. `process.stdin` input never reached the presenter, and the process exited 1 silently on Ctrl+C; both were real bugs, not test-infrastructure gaps, and only a real PTY could have caught them.

## Changes

- `packages/bundle/tui/src/index.ts` — two bugs fixed:
  - `apply()` unconditionally created `StdinInputSource`, which attaches `data` listeners to `process.stdin`. pi-tui's `ProcessTerminal.start()` calls `setEncoding('utf8')`, so the callback received strings and `TextDecoder.decode(string)` threw a `TypeError` inside the listener, which crashed the EventEmitter dispatch and ran the crash-restore hard-exit before any error text was printed. The input source is now created only for the non-TTY path (`internals.createInput()`); the presenter owns stdin in TTY mode.
  - the `apply()` catch wrote the error after `crash()` (synchronous hard exit), silently dropping it; the write now happens first.
- `packages/boot/app-boot/src/profile.ts` — registered the `tui` profile template (`base` + `tui`) so a fresh `DSH_HOME` auto-initializes the profile; the PTY smoke and real users boot without pre-install.
- `apps/cli/tests/tui-pty.snapshot.ts` — keyless PTY case in the snapshot gate: a POSIX python driver forks `dsh --profile tui` into a pty, waits for the editor border marker, types, submits a keyless follow-up turn, waits, sends Ctrl+C, and asserts exit 0, the rendered input, and the alternate-screen restore (`ESC[?1049l`). `describe.skipIf(win32)`; runs in src and built-lib modes.
- `examples/tui-agent/` — new example owning the transcript snapshot: a recorded `session.jsonl` (turn bracket, streamed chunks, tool call/result pairing, compaction replace, aborted turn) folds through `Transcript`/`TranscriptView` and compares against `terminal.expected.txt`. The compaction assertion pins the decision that a replace surface op never erases what the human saw. Deps declared in `examples/package.json`.

## Why this design

- PTY case lives in the snapshot gate, not the e2e whitelist: the snapshot gate is forced keyless replay in CI and needs no built-lib whitelist entry.
- The driver is marker-gated with a `delayMs` fallback: boot time differs hugely between src mode (~12 s tsx/typert warm-up) and built libs (~2 s), so wall-clock sleeps alone would flake; the editor border is the render-ready signal.
- The fixture is a committed session log, not a live recording: deterministic, reviewable, and independent of model output. The snapshot gate's `refresh` mode rewrites the expected file.

## Verification

- `pnpm vitest run --config vitest.snapshot.config.ts apps/cli/tests/tui-pty.snapshot.ts examples/tui-agent/tests/tui-transcript.snapshot.ts` passes in src mode and with `DSH_EXAMPLE_MODE=lib` (the CI snapshot-gate mode) after `pnpm run build:lib`.
- `pnpm run typecheck` clean; oxlint clean; `packages/bundle/tui` + `packages/interaction/tui-renderer` unit tests 84/84.
- Manual pre-fix probe reproduced the exact failure (no input delivery, exit 1, empty stderr); post-fix probe shows input rendered, turn submitted, Ctrl+C exits 0 with the terminal restored.

## Follow-up

- M3b interactive adapter (key bindings, prompt, completion) and M4 polish extend the same PTY case; the driver's `waitFor`/`delayMs` action list grows with each.
- Windows PTY support is out of scope (skipIf win32); revisit when the TUI surface is shipped for Windows.
