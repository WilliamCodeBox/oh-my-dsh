/**
 * @deepseek-ai/dsh-tui-renderer — folded terminal transcript model and
 * presentation seam for the `dsh --profile tui` surface. The transcript
 * projects one session's durable events into display items; the presentation
 * layer (pi-tui-backed renderer and interaction adapters) lands in later
 * milestones on top of this model.
 *
 * @module @deepseek-ai/dsh-tui-renderer
 */

export { Transcript, textOf } from './transcript.ts'
export type {
  AssistantItem, CompactionNote, ToolItem, ToolResult, TranscriptItem, TranscriptState,
  TurnItem, UserItem,
} from './transcript.ts'
