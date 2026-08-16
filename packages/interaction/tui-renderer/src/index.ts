/**
 * @williamcodebox/omd-tui-renderer — folded terminal transcript model and
 * pi-tui-backed presentation layer for the `omd --profile tui` surface. The
 * transcript projects one session's durable events into display items; the
 * presenter renders them on the alternate screen with a scroll viewport,
 * status row, and input editor. Approval prompts mount as an overlay modal on
 * the presenter seam; further interaction adapters (questions, commands)
 * build on the same modal mechanism.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

export { Transcript, textOf } from './transcript.ts'
export type {
  AssistantItem, CompactionNote, ToolItem, ToolResult, TranscriptItem, TranscriptState,
  TurnItem, UserItem,
} from './transcript.ts'
export { contextBar, formatItem, formatStatus } from './format.ts'
export { needsSanitize, sanitizeText } from './sanitize.ts'
export { StatusRow, TranscriptView } from './transcript-view.ts'
export { TuiPresenter, processTerminal, workspaceAutocomplete } from './presenter.ts'
export type { PresenterOptions } from './presenter.ts'
export { darkTheme, lightTheme, themeForScheme } from './theme.ts'
export type { BgToken, ColorToken, SemanticTheme, ThemePalette } from './theme.ts'
export { detectTerminalScheme } from './scheme.ts'
export { KeybindingRegistry } from './keybindings.ts'
export type { Keybinding } from './keybindings.ts'
