# Agent Note: TUI injected-context folding (Web parity)

Status: implemented

English | [中文](2026-08-18-tui-injected-context-folding.zh.md)

## Problem

The first input of a fresh TUI session floods the transcript with the
session's injected-context messages: the `agent-instructions` baseline
(complete `AGENTS.md`, ~16 KB) and the skill catalog (~50 entries) render as
full-width user-background Markdown bubbles with no preview cap, no collapse,
and no key to fold them (`packages/interaction/tui-renderer/src/transcript-view.ts`
rendered every `user` item's full text). The Web surface renders the same
content as collapsed-by-default disclosure rows (`ContextInjectionRow.tsx`).
The content itself is model-necessary — workspace rules and skill discovery,
both already bounded (`maxBytes: 65536`, `catalogDescriptionMaxLength`) and
deliberately not summarized (see the workspace-context and skill-system
notes) — so the fix belongs to the display layer, not the injection.

## Decision

- `packages/interaction/tui-renderer/src/transcript-view.ts` —
  `TranscriptView` gains `contextExpanded` (default `false`). A user item
  whose `source` exists with `kind !== 'user'` renders one dim line
  `▸ context · <label> · ctrl+o expands` by default and the full card when
  expanded. The label mirrors the Web provenance labels: the loaded file
  paths for `agent-instructions`, `skill catalog` for `skill-catalog`,
  `skill <name>` for `skill-invocation`, otherwise the source kind. The
  flag is read per render, so the item cache follows toggles without
  invalidation. The identity (non-semantic) render path is unchanged —
  snapshot fixtures and pipe surfaces keep full text.
- `packages/interaction/tui-renderer/src/presenter.ts` — `TuiPresenter`
  keeps the `TranscriptView` reference and exposes
  `toggleContextExpanded()` (flips the flag, requests a render) plus a
  `contextExpanded` getter.
- `packages/bundle/tui/src/index.ts` — `drivePresenter` registers
  `Ctrl+O` (`\x0f`) in the keybinding registry; the `?` help overlay lists
  it automatically.
- `packages/bundle/tui/README.md` / `README.zh.md` — presenter-surface
  bullet documents the fold and the key.

## Alternatives considered

- **Per-row selection and Enter** — rejected: the main transcript has no
  row-selection model; a global toggle is the terminal-appropriate
  equivalent of the Web's per-row click, and the archived TUI design's
  `Ctrl+O` three-state fold was the established vocabulary.
- **A letter-key toggle** — rejected: printable keys must stay typeable in
  the input editor; `Ctrl+O` collides with nothing and is not a modal key.
- **Trim or summarize the injected content** — rejected: the
  workspace-context and skill-system notes explicitly rejected
  summarization, package tests pin the full content, and the content is
  model-facing; shrinking it would change the model's behavior.

## Consequences

- The first input shows one dim line per injected block instead of a
  full-screen dump. Model-visible content is byte-identical
  (model-visible ⟺ logged untouched); only the TTY presenter display
  changes.
- `Ctrl+O` appears in the `?` help overlay; the collapsed row itself hints
  the key, so discovery does not depend on help.
- Pipe and snapshot identity surfaces are unchanged; resumed sessions fold
  the same way (the fold keys off the durable `source`).
- Verification: `tsc -b tsconfig.host.json` clean; the touched spec files
  pass 99 tests (6 new: default collapse, expand toggle, source labels,
  direct-prompt unaffected, presenter toggle, Ctrl+O no-leak into the
  editor); `tui-pty.snapshot` assertions are marker-based and unaffected.
