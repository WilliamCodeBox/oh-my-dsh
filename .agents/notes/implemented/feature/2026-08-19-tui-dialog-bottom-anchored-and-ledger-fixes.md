# Agent Note: Bottom-anchored TUI dialogs and ledger fixes

Status: implemented

English | [中文](2026-08-19-tui-dialog-bottom-anchored-and-ledger-fixes.zh.md)

## Problem

Three defects surfaced when a user typed `ledger` in the TUI:

1. **Interaction dialogs render mid-screen over the transcript with no
   background.** `TuiPresenter` mounted every modal (`ask_user_question`
   options, approvals, text prompts, the help card, the ledger detail
   panel) through `showOverlay` with no options, so pi-tui anchored the
   component at the terminal center, and the card was a bare `Box(1, 1)`
   with no `bgFn` — dialog text composited directly onto the transcript
   text beneath it, unreadable.
2. **`ask_user_question` options carried no authoring guidance.** The
   model generated option labels and descriptions from implementation
   vocabulary (`packages/bundle/tui/src/ledger.ts`, the
   `tui-renderer ledger view`), which a user cannot act on; the tool
   description never constrained option authoring.
3. **The ledger fold dropped a `tool/code-dispatch` settle whose pairing
   start was not folded**, silently losing a subtool result — asymmetric
   with `mergeToolLedgerCell`, which defensively creates the cell.

## Decision

- `packages/interaction/tui-renderer/src/overlay-box.ts` (new) —
  box-drawing chrome ported from the oh-my-pi overlay: `topBorder`
  (accent title inset), `divider`, `bottomBorder`, `row`, and a
  `DialogBox` component that wraps child components, renders their lines
  as bordered content rows, appends an optional footer hint, and paints
  the `modalBg` background across every line so the panel reads as one
  opaque block.
- `packages/interaction/tui-renderer/src/theme.ts` — `BgToken` gains
  `modalBg` (dark 235, light 255) beside `userBg`.
- `packages/interaction/tui-renderer/src/presenter.ts` —
  `mountOverlay` calls `showOverlay(component, { anchor:
  'bottom-center', margin: 1, maxHeight: '70%' })`; all four dialog
  builders (`askApproval` via `promptSelect`, `promptSelect`,
  `promptText`, `showHelp`) and `showDetail` build a `DialogBox`
  instead of a bare `Box`. Every interaction modal now rises from the
  bottom edge, capped at 70% of the terminal, with a border, a footer
  hint, and an opaque background.
- `packages/interaction/tool-ask-user/src/index.ts` — the
  `ask_user_question` description now requires plain user language in
  options (no repo paths, module names, or implementation vocabulary)
  and outcome-based option splitting (view/modify/explain, not code
  ownership). The `label` schema description repeats the plain-language
  constraint.
- `packages/interaction/tui-renderer/src/transcript.ts` — the
  `tool/code-dispatch` fold defensively creates the subtool cell when
  the pairing start was not folded, mirroring `mergeToolLedgerCell`.
- `packages/interaction/tui-renderer/src/detail.ts` — `detailBody`
  takes `RenderedDetailTab = Exclude<DetailTab, 'options' | 'usage'>`
  (the Web-only tabs `detailTabsFor` never emits); the unreachable
  `options`/`usage` cases are deleted and the caller narrows once with a
  comment.

## Alternatives considered

- **Full-screen dim scrim behind the dialog** — rejected: pi-tui 0.84.2
  overlays have no scrim option; building one needs terminal-size
  awareness and an extra component. The opaque card background already
  separates the dialog from the transcript.
- **Mounting dialogs into the layout (oh-my-pi's editor-container
  mechanism)** — rejected: pi-tui 0.84.2 already supports
  `anchor: 'bottom-center'` plus `margin`/`maxHeight`, so the visual
  outcome (bottom panel, stable sizing) is reachable with one
  `showOverlay` options object instead of a presenter layout rework.
- **Deleting `options`/`usage` from the shared `DetailTab` union** —
  rejected: the Web trajectory table builds its own tab list from those
  ids; the union is the shared contract. The terminal side narrows
  instead.
- **Keeping the dead `detailBody` cases** — rejected: they were
  unreachable and the narrowing makes that a type-level fact.

## Consequences

- All interaction modals (ask, approval, prompt, help, detail) now
  render as bottom-anchored bordered panels with an opaque background;
  the ledger detail overlay shares the chrome. Esc/Enter/tab behavior is
  unchanged — only presentation moved.
- The `ask_user_question` tool description is model-visible; prompts
  generated after this change should stop leaking repo paths into
  options. No pinned snapshot referenced the old text.
- A stray `tool/code-dispatch` now records a subtool row instead of
  vanishing; `transcript.spec.ts` updated to assert the defensive cell.
- Verification: host typecheck clean; tui-renderer + tui packages pass
  237 tests (7 new: chrome rows, truncation, DialogBox structure/background/
  placeholder/no-footer, bottom-anchor overlay options); the keyless
  `tui-pty.snapshot` ledger journey (open, detail, tab-switch, close)
  still passes. The oxlint tree has pre-existing errors in untouched
  files (`detail.ts:102`, `transcript.ts:592-685`, tests) — none in the
  new or edited lines.
