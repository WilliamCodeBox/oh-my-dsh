# Agent Note: TUI surface parity batch (welcome, todos, multiline, subagent, error rows)

Status: implemented

English | [中文](2026-08-18-tui-surface-parity-batch.zh.md)

## Problem

A TUI-vs-Web surface audit (scout, code-confirmed) ranked six genuine
feature-parity gaps by user impact. The first — injected context rendering
as an indistinguishable, unbounded full-text bubble — was fixed separately
(see the injected-context folding note). The remaining five were: welcome
and empty state plus workspace switching; subagent activity invisible in
the main surface; the full todo list reduced to a status-row count;
single-line input; and turn error / max-token / reasoning details flattened
into the turn bracket or the `/ledger` tabs.

## Decision

All five shipped in the TUI surfaces, display-only (model-facing content is
byte-identical; model-visible ⟺ logged untouched):

- **Welcome / empty state** — `TranscriptView` gains an optional
  `empty()` renderer shown when the folded transcript has no items;
  `TuiPresenter` wires it to a welcome block (model from the folded
  request header when present, workspace, preset, hints) and suppresses
  the meta row while it is active so the model name never renders twice.
- **Todo list** — `TuiPresenter.openTodos()` renders a status-glyph
  overlay (✓/◐/○) over a scrollable body, re-read before every render so
  live `todo/write` snapshots update it; `/todos` opens it.
- **Workspace switching** — `/workspace <path>` switches the runner's
  workspace override (meta-row display, `@`-file completion root, git
  watcher) and reports the boundary honestly: the fs tool root stays the
  session header cwd fixed at creation, documented in the notice and the
  bundle README.
- **Multiline input** — pi-tui's built-in `tui.input.newLine` binding
  (`shift+enter` / `ctrl+j`) inserts newlines natively; the runner leaves
  those keys to the editor, Enter still submits the whole draft, and the
  editor layout grows (minSize 3). The pipe keymap is unchanged: a raw
  `\x0a` still submits so `echo task | omd` works.
- **Subagent activity** — the runner subscribes to the parent-scoped
  `subagent/start` / `subagent/end` cordis events on the driven agent's
  scoped ctx and forwards them as `Transcript.subagentLifecycle` edges;
  the fold appends a `subagent` item (running) and merges the settled
  state in place (done / failed + stop reason). Edges are not session
  events, so they never replay from storage on resume.
- **Error / reasoning rows** — `AssistantItem` captures `reasoning`
  content blocks; the themed renderer shows them dimmed above the reply,
  capped at 10 lines with a continuation note. Turn brackets color by
  outcome: `error` turns render in the error color plus the structured
  error message line, `max-tokens` in the warning color.

## Alternatives considered

- **Per-row selection for expansion** — rejected (folding note): no row
  selection model in the main transcript; global affordances match the
  terminal.
- **Custom multiline editor component** — rejected: pi-tui's Editor
  already inserts and renders newlines via `tui.input.newLine`; a
  hand-rolled editor would duplicate owned code (dependencies-over-
  hand-rolling).
- **Mutating the session header cwd for `/workspace`** — rejected: the
  header is a durable creation-time record the fs tool resolves per
  request; rewriting it mid-session is not a supported operation. The
  runner-level override plus an explicit boundary notice is the honest
  scope.
- **Subagent rows driven by session events** — rejected: subagent
  sessions fold nowhere in the main surface by design; the scoped
  lifecycle events are the sanctioned observation channel and carry the
  run identity.

## Consequences

- The main TUI transcript now distinguishes injected context, subagent
  activity, reasoning, and failing turns at a glance; `/todos`,
  `/workspace`, and multiline drafts work without Web-side behavior
  changes.
- Subagent lifecycle rows are run-local: a resumed session does not
  replay past subagent activity (edges never persist), matching the
  append-origin transcript policy.
- `/workspace` intentionally does not move the fs tool root; the notice
  and README state that boundary instead of silently claiming it.
- Verification (independent verification agent, three rounds): `tsc -b
  tsconfig.host.json` clean; tui-renderer + bundle/tui unit suites 265
  tests pass (incl. the welcome meta-row suppression regression); the
  keyless `tui profile` PTY snapshot gate passes; `git diff --name-only`
  scoped to tui-renderer, bundle/tui, and pnpm-lock.yaml.
