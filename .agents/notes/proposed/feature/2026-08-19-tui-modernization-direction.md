# Agent Note: TUI modernization direction — gap survey and borrowing list

Status: proposed

English | [中文](2026-08-19-tui-modernization-direction.zh.md)

## Problem

A TUI gap survey (2026-08-19, main-agent orchestration: three read-only scouts
over the local oh-my-dsh, oh-my-pi pi-tui, and opencode TUI sources, plus web
research on Claude Code and Codex CLI) found the oh-my-dsh TUI's rendering
layer — folded event-stream cards, semantic dark/light themes, tool cards with
unified-order diffs, the O(1) trajectory ledger with detail tabs — is the
deepest of the four. The real gaps are on the feature surface (multi-view,
scrollback, notifications, configurability) and discoverability (help /
command palette), and a large set of pi-tui capabilities already vendored into
`tui-renderer` is not wired up.

## Proposal

Adopt the borrowing list below as the forward direction, tiered by cost.
Items already shipped (multiline input, `/todos` overlay, welcome/empty state,
`/workspace`, `/editor`, subagent rows, reasoning/error rows, LCS diff order,
ledger detail panel, injected-context folding, status-bar mode display) are
excluded and not re-planned.

### Tier A — low cost, pi-tui capabilities already available (1–3 days)

| # | Item | Source | Gap today |
|---|---|---|---|
| A1 | Desktop notifications (OSC 99 / D-Bus on task completion) | pi-tui `desktop-notify.ts` | None; long tasks have no completion signal |
| A2 | which-key help panel (grouped keybinds, scrolling, dock/overlay) | opencode `which-key.tsx` | `keybindings.ts` help is a static list |
| A3 | SGR mouse (wheel scroll, click/hover hit zones) | pi-tui `mouse.ts` | Keyboard-only; long messages need paging keys |
| A4 | ESC-cancellable Loader (returns AbortSignal) | pi-tui `cancellable-loader.ts` | Spinner not cancellable; only Ctrl+C cancels the whole chain |
| A5 | Markdown enhancements: OSC8 links, mermaid→ASCII, inline images | pi-tui `markdown.ts` | Not all wired into the transcript renderer |
| A6 | Native scrollback streaming (long output without page caps) | pi-tui scrollback commit | Detail bodies are line-capped; paging only |
| A7 | Session cost display (tokens + cost) | Claude Code `/cost` | Status row shows tokens, no cost |

### Tier B — new development, borrowing opencode / Claude Code (≈1 week)

| # | Item | Source | Gap today |
|---|---|---|---|
| B1 | Multi-session TabBar | pi-tui `tab-bar.ts`, opencode multi-session | `/sessions` cycles; no side-by-side tabs |
| B2 | Standalone `/diff` viewer (file tree, split/unified, hunk jump, per-turn diff) | opencode `diff-viewer.tsx`, Claude Code `/diff` | Tool cards diff; no cross-turn diff view |
| B3 | Permission decision memory (edit-diff preview + always/reject tiers) | opencode `permission.tsx` | Approval modal exists; no preview, no remembered decisions |
| B4 | Theme customization (JSON token overrides + preset library, daltonized variants) | Claude Code theme JSON, opencode 35 themes | Only dark/light, not overridable |
| B5 | Command palette (searchable `/` command discovery) | opencode keymap, Codex Cmd+Shift+P | Commands memorized; no discovery panel |
| B6 | Home session picker (welcome block exists; add session select) | opencode `home.tsx`, Codex resume | Welcome block exists; no session list to pick |
| B7 | Session fork/export | opencode fork/export, Codex resume/archive | Only `--resume`; no fork/export |

### Tier C — architecture-level, needs product positioning first

| # | Item | Source | Note |
|---|---|---|---|
| C1 | Programmable status line (custom widgets / shell commands, Powerline style) | Claude Code `/statusline` | Status row is hardcoded fields; configurable line is a product-level feature |
| C2 | Embedded terminal view (run command → watch live output, not just the tool card) | Codex Cmd+J, pi-tui `ProcessTerminal` | Shell becomes process-visible; ties into e2b/shell packages |
| C3 | Checkpoint / rewind (Esc multi-level: rewind to any turn) | Claude Code | Needs session snapshot machinery; touches the session package; higher risk |
| C4 | Feature plugin slots (todo/diff/help become registered extensions) | opencode pluginRuntime | Architecture refactor; long-term extensibility payoff |

## Alternatives considered

- **Full rewrite on a declarative framework (opencode-style, Solid.js)** —
  rejected: the vendored pi-tui diff-renderer plus semantic themes already
  covers the rendering baseline; a rewrite would trade mature terminal
  engineering for framework novelty.
- **Jump straight to Tier C** — rejected: without a product positioning call
  (is oh-my-dsh TUI a published agent surface or an internal harness?), the
  architecture investment is speculative; Tier A delivers daily-visible gains
  at near-zero cost.
- **Borrow Claude Code statusline/rewind verbatim** — deferred to C1/C3: both
  require config-format and session-format decisions, which are C-level scope.

## Acceptance criteria

- Tier A: all seven items ship with unit tests; each maps to an observable
  surface (notification fires, help panel opens grouped and scrolls, wheel
  scrolls, ESC cancels a long tool call, OSC8 links activate, long output
  streams into scrollback, cost appears in the status row).
- Tier B: each item ships behind its own note; B1/B2/B4 are the first three.
- Tier C: each item opens with its own proposed note before implementation;
  C3 explicitly needs a session-format impact assessment.
- Every shipped tier keeps model-visible ⟺ logged untouched (display-only
  changes, as in the surface-parity batch).

## Risks

- **pi-tui version drift** — oh-my-pi is pinned at 17.3.1; wiring more of its
  surface (mouse, notifications, scrollback) couples us to its behavior.
  Mitigate: capability probe + graceful fallback (pi-tui already does both).
- **Mouse enablement misfires** — clicking/hover must be opt-in or
  conservative; wheel-scroll-only is the safe first step.
- **Notification noise** — needs a config switch; default off or completion-
  only.
- **Tier B touches session semantics** (B1 multi-session, B7 fork) — reuse the
  existing session model; do not invent a parallel session store.
- **Discovery panel scope creep** — which-key (A2) and command palette (B5)
  must stay read-only surfaces over existing registries, not new command
  systems.
