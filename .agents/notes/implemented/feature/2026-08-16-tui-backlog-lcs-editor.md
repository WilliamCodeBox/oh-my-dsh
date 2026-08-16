# TUI backlog: LCS diff ordering, /editor integration

## Context

Backlog items from the P2 note: real unified diff ordering (the tool-card
viewer previously dumped additions then removals) and $EDITOR integration
for long drafts. Both shipped.

## Change

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

## Verification

- vitest tui-renderer + bundle: 171 tests pass (2 new).
- tsc clean; eslint clean.

## Notes

- The LCS table is O(n·m) memory; diffs are file-sized so this is bounded.
  Very large diffs could switch to Myers later.
- /editor uses stop/start rather than pi-tui's preserveScreen (the editor
  session is a full terminal handoff, not a TUI takeover); the transcript
  re-draws on resume, so no content is lost.
