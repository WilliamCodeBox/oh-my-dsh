# Agent Note: TUI P1 — status bar, paging, and workspace completion

Status: implemented

English | [中文](2026-08-16-tui-p1-status-bar-completion.zh.md)

## Problem

P0 shipped the semantic theme and component rendering. P1 (approved plan:
status bar, scroll/overlay, multi-line input, quick syntax) narrowed to the
self-contained items: a context-window progress bar in the status row,
viewport paging, and editor completion (`@` file references + slash
commands). pi-tui 0.84.2 already provides differential rendering, so the
no-flicker item needed no work.

## Decision

`packages/interaction/tui-renderer/src/format.ts` — `contextBar(ratio, width)`
renders the `████░░░░░░ 45%` progress glyphs (pure characters; threshold
coloring lives in the presenter).

`packages/interaction/tui-renderer/src/presenter.ts` — the status row now
composes left runner text (dim) + context-window bar (dim under 70%, warning
70-90%, error above 90%) + muted provider/model, truncated to the viewport.
`pageTranscript(dir)` pages by the terminal height minus chrome rows;
`scrollTranscript` stays for line deltas. `workspaceAutocomplete(commands,
basePath)` builds the editor's completion provider.

`packages/interaction/tui-renderer/src/autocomplete.ts` — new:
`WorkspaceAutocomplete` implements slash-command completion (fuzzyFilter over
the command list) and `@`-file completion by recursive readdir (depth 2,
hidden entries skipped, directories complete with a trailing slash).
pi-tui's CombinedAutocompleteProvider delegates `@` completion to an external
`fd` binary, which an out-of-the-box install must not require — this
provider is the fd-free replacement with the same surface.

`packages/bundle/tui/src/index.ts` — PgUp/PgDn page the transcript instead of
scrolling a fixed 10 lines; the presenter receives the autocomplete provider
built from `commands.list(agent)` over the workspace directory.

## Alternatives considered

- **pi-tui's CombinedAutocompleteProvider with the external `fd` binary** —
  rejected: an out-of-the-box install must not require a system binary; the
  readdir-backed provider keeps the distribution dependency-free.
- **Fixed 10-line scroll for PgUp/PgDn** — rejected in favor of viewport
  paging by the terminal height, which matches user expectations for page
  keys.

## Consequences

- vitest tui-renderer + bundle: 140 tests pass (10 new); tsc clean on both
  packages; eslint clean on changed files.
- PTY run of the source TUI: `@p` opens a 30-item file suggestion list with
  relative display paths, Tab applies the first suggestion
  (`@THIRD_PARTY_NOTICES.md`), the list shows a `(1/30)` scroll indicator.
- P1's multi-line input and mouse support remain; pi-tui's Editor already
  supports multi-line text (backslash-prefixed newline), and the plan's
  mouse item stays deferred.
