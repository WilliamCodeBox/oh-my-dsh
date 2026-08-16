# TUI adversarial review fixes (back-to-back)

## Context

Three independent reviewers ran back-to-back adversarial reviews over the
full TUI surface (correctness/lifecycle, robustness/security,
performance/UX). Findings were cross-compared: issues found by multiple
agents independently (lcsDiff bounds, git polling, /editor error paths)
were treated as highest confidence. All P1 findings fixed; P2 backlog
recorded in the note.

## Fixes (13)

1. lcsDiff O(n·m) unbounded → line cap (1500/side) with a linear
   add/remove fallback for oversized diffs (two reviewers independently).
2. git polling died on any transient failure → readGitStatus now
   distinguishes no-repo (stop) from transient status failure (throw);
   the watcher retries with backoff and keeps the last snapshot (three
   reviewers).
3. /editor async IIFE could strand raw mode on write failure →
   try/catch + finally restores the presenter on every path (two
   reviewers).
4. Modal overlays stacked under concurrent mounts (approvals during
   /sessions) → mountOverlay queues, advances on close with focus
   restoration (correctness reviewer).
5. Tool-card fingerprint missed result.meta → empty-text diffs never
   rendered; fingerprint now hashes open/settled + error + meta presence,
   and no longer concatenates MB-scale result text (correctness + perf).
6. Keybinding handler throws escaped to uncaughtException (hard exit,
   lost flush) → dispatch contains handlers (correctness).
7. Empty Enter submitted empty user messages on the presenter path →
   dispatchLine guards (correctness).
8. lineRangeSuggestions read any path synchronously (frozen main thread
   on FIFO/GB files) → statSync size cap (1 MB) + regular-file check
   (robustness).
9. ANSI injection through filesystem-controlled strings → meta-row cwd,
   autocomplete labels/descriptions, and overlay titles pass sanitizeText
   (robustness).
10. persistentBg fill carried a trailing reset that undid its own fix →
    fill strips the reset so re-applied backgrounds survive (robustness).
11. '?' was consumed unconditionally → typing '?' was impossible; the
    handler falls through when no modal is open (perf/UX).
12. Streaming setText re-lexed the whole message per chunk (O(n²)) →
    setText throttled to ~80ms (perf/UX).
13. Spinner had no timer (frozen frame) and vanished when the left status
    was empty on the first turn → transient renders independently, and a
    ~100ms interval drives re-render while running (perf/UX).

Also: /model requires the provider/model separator (fail loud);
overlay title/detail sanitization; tool-fingerprint no longer hashes full
result text.

Tests: overlay queue (two approvals in sequence), keybinding throw
containment, empty-submit guard, /model validation, oversized-diff
degradation, git watcher repeated polling. 178 pass.

## Verification

- vitest tui-renderer + bundle: 178 tests pass (7 new).
- tsc clean on both packages; eslint clean.

## Notes

- P2 findings deferred: symlink directory handling, deeper fingerprint
  staleness, git porcelain cost on huge repos, context-bar semantics
  (session-cumulative usage vs per-request window — clamped bar is the
  documented behavior), $EDITOR shell-quoting.
