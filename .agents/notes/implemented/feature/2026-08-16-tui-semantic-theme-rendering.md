# TUI semantic theme and component rendering

## Context

The `omd --profile tui` surface rendered as a line tracer: 4 ANSI foreground
colors, no Markdown, no width awareness, and an identity default theme kept
snapshot fixtures plain. Users found it plain. Three parallel research
agents analyzed the current renderer, the pi/oh-my-pi reference TUIs, and
industry coding-agent TUIs (Claude Code, Codex CLI, opencode, Gemini CLI).
The agreed plan (user-approved, P0): semantic color tokens with dark/light
palettes derived from the terminal when it reports one; message background
layering; Markdown rendering; tool-call cards with state backgrounds;
width-aware CJK-safe rendering. Snapshot policy: keep the identity default
path for fixtures, assert behavior structurally on the themed path.

## Change

`packages/interaction/tui-renderer/src/theme.ts` — new: `SemanticTheme`
(fg/bg wrappers over 256-color SGR), `darkTheme`/`lightTheme`, and
`themeForScheme`. Palettes use low-saturation state backgrounds
(toolPendingBg 236 / toolSuccessBg 235 / toolErrorBg 52 in dark).

`packages/interaction/tui-renderer/src/scheme.ts` — new: `detectTerminalScheme`
queries `\x1b[?997n` before raw mode owns stdin and resolves dark/light from
the report; 300 ms timeout falls back to dark. The bundle launcher awaits it
before constructing the presenter.

`packages/interaction/tui-renderer/src/transcript-view.ts` — two render
paths. Without a theme: identity lines (fixtures unchanged). With a theme:
user messages render on a full-width background box (`Box` + `bg userBg`),
assistant messages through the pi-tui `Markdown` component (streamed via
`setText` without rebuilding), tool calls as state-colored cards
(pending/success/error backgrounds), turn brackets dimmed, slash commands in
the command color. Sanitization runs before Markdown parsing.

`packages/interaction/tui-renderer/src/presenter.ts` — accepts an optional
`SemanticTheme` (default dark), wires `theme.editor` and the SelectList theme,
dims the status row.

`packages/bundle/tui/src/index.ts` — queries the terminal scheme and passes
`themeForScheme(...)` to the presenter.

Tests: `tests/theme.spec.ts` (SGR generation per token, markdown/editor
sub-themes, scheme resolution) and `tests/transcript-view-theme.spec.ts`
(background layering, Markdown bold/code, streaming setText, tool-card
states, CJK width fit, control-char sanitization).

## Verification

- `vitest` tui-renderer + bundle: 130 tests pass (14 new).
- `tsc` for both packages clean; eslint clean on changed files.
- PTY run of the source TUI: rendered a real turn; raw byte stream contains
  `\x1b[48;5;237m` (user background), other 256-color fg/bg, and the editor
  accent border. The `?997` scheme query reaches the terminal (pyte lacks the
  report handler; the terminal answers).

## Notes

- Markdown/card rendering lives on the themed path only; the identity path
  keeps the snapshot and pipe surfaces byte-stable.
- P1 (status-bar progress bars, slash commands, mouse) and P2 (syntax
  highlighting, IME, OSC 133) remain from the approved plan.
- The `theme!` non-null assertion is avoided by narrowing after the
  identity-early-return; keep that shape.
