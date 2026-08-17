# Agent Note: TUI P2 — syntax highlighting, tool diff cards, session cost

Status: implemented

English | [中文](2026-08-16-tui-p2-highlight-diff-cost.zh.md)

## Problem

P2 of the adversarial plan: theme token expansion (syntax/diff roles),
syntax highlighting via pi-tui's Markdown `highlightCode` hook, a minimal
diff viewer on tool cards, and config-driven session cost. Mouse/IME stay
built-in pi-tui capabilities (verification items). `#` line-range
completion and $EDITOR integration remain pending.

## Decision

`packages/interaction/tui-renderer/src/theme.ts` — `ColorToken` gains 9
syntax roles and 4 diff roles; both palettes map them (dark: keyword 177,
string 114, function 117, comment 243, added 114, removed 167, hunk 179).

`packages/interaction/tui-renderer/src/highlight.ts` — new: regex
tokenizer (keywords per language family ts/js/py/sh/go/rs, strings,
comments, numbers, functions, types, operators, punctuation; JSON keys;
plain fallback) feeding the Markdown `highlightCode` hook. Fast enough for
per-frame re-highlighting of the last block while streaming; empty lines
and plain text pass through uncolored.

`packages/interaction/tui-renderer/src/transcript-view.ts` — tool cards
render embedded diffs from the tool-fs `{ diffs }` meta payload:
line-level add/remove/context with diff roles, hunk header with the path.
The renderer parses the meta shape itself (no tool-fs dependency).

`packages/bundle/tui/src/index.ts` — `Config` gains optional
`costPerInputToken`/`costPerOutputToken`; when configured, the status row
appends the session cost (`$0.001234` style, computed from transcript
usage). Without prices the cost stays hidden.

## Alternatives considered

- **Full-featured diff viewer with LCS ordering now** — deferred: the card
  renders line-level hunks (additions then removals); unified ordering with
  context landed in the next backlog item.
- **Hardcoded provider per-token prices** — rejected: session cost is
  deployment-configured; the provider adapter could advertise per-token
  pricing later.

## Consequences

- vitest tui-renderer + bundle: 168 tests pass (8 new); tsc clean on both
  packages; eslint clean.
- PTY run: the meta row renders model/cwd/git as before; syntax roles
  appear in the raw stream once a code block renders (unit tests assert
  the exact token colors).
- `@file#L10-L20` line-range completion and $EDITOR integration remain on
  the P2 backlog.
