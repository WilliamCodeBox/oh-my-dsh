/**
 * @deepseek-ai/dsh-tui-renderer — folded terminal transcript model and
 * pi-tui-backed presentation layer for the `dsh --profile tui` surface. The
 * transcript projects one session's durable events into display items; the
 * presenter renders them on the alternate screen with a scroll viewport,
 * status row, and input editor. Interaction adapters (approval, questions,
 * commands) land in later milestones on top of the presenter seam.
 *
 * @module @deepseek-ai/dsh-tui-renderer
 */

export { Transcript, textOf } from './transcript.ts'
export type {
  AssistantItem, CompactionNote, ToolItem, ToolResult, TranscriptItem, TranscriptState,
  TurnItem, UserItem,
} from './transcript.ts'
export { formatItem, formatStatus } from './format.ts'
export { needsSanitize, sanitizeText } from './sanitize.ts'
export { StatusRow, TranscriptView } from './transcript-view.ts'
export { TuiPresenter, processTerminal } from './presenter.ts'
export type { PresenterOptions } from './presenter.ts'
