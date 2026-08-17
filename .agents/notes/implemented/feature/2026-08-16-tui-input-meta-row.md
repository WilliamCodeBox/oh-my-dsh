# Agent Note: TUI input meta row — model, thinking, cwd, git, context

Status: implemented

English | [中文](2026-08-16-tui-input-meta-row.zh.md)

## Problem

User requested the oh-my-pi input-area design: a line above the input
editor carrying the current LLM model, thinking level, working directory,
git status, and context window. Two research agents analyzed the reference
implementations (pi footer / oh-my-pi powerline segments / opencode prompt
meta row) and seven industry products (Claude Code, Codex CLI, opencode,
Gemini CLI, crush, goose, Cursor). User approved: full five-element row,
2s git polling.

## Decision

`packages/interaction/tui-renderer/src/meta-row.ts` — new: `MetaRow`
component + `renderMetaRow()` compose three segments — left
(model/thinking), center (cwd/git), right (context bar + window label).
Context thresholds color the bar (50/70/90 → dim/muted/warning/error,
oh-my-pi's finer grid). Truncation drops the left segment first so the
context bar never disappears; empty data renders nothing.

`packages/interaction/tui-renderer/src/presenter.ts` — the VStack gains the
meta row between the status row and the editor; `setMetaData(read)` wires
the runner's data source; `requestRender()` is guarded by the started flag
(setMetaData may run before start).

`packages/bundle/tui/src/git.ts` — new: `readGitStatus()` (branch +
porcelain staged/unstaged/untracked counts) and `watchGitStatus()` polling
every 2s, stopping when the workspace is not a repository.

`packages/bundle/tui/src/index.ts` — the meta data source reads the
selection ref (model/thinking), the display cwd (`~`-folded), the polled
git state, and transcript context usage. `/thinking <level>` mutates
`selectionRef.current.reasoningEffort` (displayed as `⟳ level`). The
status row drops the model and context bar (they moved to the meta row);
`formatStatus` keeps running facts only. /model, /thinking, /sessions join
slash completion.

## Alternatives considered

- **pi footer / oh-my-pi powerline segments / opencode prompt meta row** —
  reviewed as references; the three-segment row (model-left, cwd/git-center,
  context-right) was chosen for truncation semantics that never drop the
  context bar.
- **fs.watch for git worktree changes** — rejected in favor of 2s polling:
  `git status` is cheap on typical repos, and a watcher would need to
  distinguish porcelain changes HEAD moves miss.

## Consequences

- vitest tui-renderer + bundle: 160 tests pass (10 new since the review
  round); tsc clean on both packages; eslint clean.
- PTY run of the source TUI: the meta row shows
  `deepseek-official/deepseek-v4-flash  ~/work/oh-my-dsh  ⎇ main +1 *8 ?4`
  with real git worktree counts; `/thinking medium` adds `⟳ medium`; the
  context bar appears once a turn finalizes usage.
- The context bar needs finalized usage (transcript totals accumulate on
  assistant/message); streaming input-token display is future work, and the
  thinking-level border color (pi's dual channel) is deferred — the row
  already shows the level as text, and the border needs per-level palette
  mapping that depends on adapter-specific effort ids.
