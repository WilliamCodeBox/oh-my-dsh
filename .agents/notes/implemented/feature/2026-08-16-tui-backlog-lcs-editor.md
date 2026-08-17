# Agent Note: TUI backlog — LCS diff ordering and /editor integration

Status: implemented

English | [中文](2026-08-16-tui-backlog-lcs-editor.zh.md)

## Problem

Backlog items from the P2 note: real unified diff ordering (the tool-card
viewer previously dumped additions then removals) and $EDITOR integration
for long drafts. Both shipped.

## Decision

`packages/interaction/tui-renderer/src/transcript-view.ts` — line-level
longest-common-subsequence diff: O(n·m) DP over before/after lines,
backtracking interleaves context/add/remove in unified order. Empty
context/add lines are skipped for noise; removed empty lines still render.

`packages/bundle/tui/src/index.ts` — `/editor` suspends the presenter
(`presenter.stop()`), writes the current draft to a temp file, runs
`$VISUAL`/`$EDITOR`/`vi` over it (shell-enabled for `code -w` style
commands, stdio inherited), reads the result back into the editor, and
resumes the presenter (`presenter.start()` re-draws from the transcript).
Success/failure report through the status notice. `internals.runEditor`
is injectable for tests.

Tests: LCS ordering assertions (ctx → del → add → ctx sequence),
/editor suspend–replace–resume cycle over the fake terminal. 171 pass.

## Alternatives considered

- **pi-tui's preserveScreen for /editor** — rejected: the editor session is a
  full terminal handoff, not a TUI takeover; stop/start re-draws the
  transcript on resume, so no content is lost.
- **Myers diff for the tool-card viewer** — deferred: the O(n·m) LCS table is
  bounded because diffs are file-sized; a switch to Myers stays available if
  very large diffs appear.

## Consequences

- vitest tui-renderer + bundle: 171 tests pass (2 new); tsc and eslint clean.
- Tool-card diffs now read in unified order instead of additions-then-removals.
- /editor works with `$VISUAL`/`$EDITOR`/`vi` (shell-enabled for `code -w`),
  with every failure path restoring the presenter.
