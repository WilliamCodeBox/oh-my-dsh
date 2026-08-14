/**
 * Display formatting for folded transcript items and the presenter status
 * row. Each item formats to one or more plain-text lines (no ANSI in this
 * layer; styling is a renderer concern), and every emitted line passes the
 * display sanitizer before it reaches the terminal.
 *
 * @module @deepseek-ai/dsh-tui-renderer
 */

import type { TranscriptItem, TranscriptState } from './transcript.ts'
import { sanitizeText } from './sanitize.ts'

/** Format one transcript item into display lines. */
export function formatItem(item: TranscriptItem): string[] {
  switch (item.kind) {
    case 'user':
      return item.text === '' ? ['>'] : [`> ${item.text}`]
    case 'assistant':
      return item.text === '' ? [] : item.text.split('\n')
    case 'tool': {
      const lines = [`tool ${item.name} ${item.args}`]
      if (item.result !== undefined) {
        lines.push(item.result.error === undefined ? '  -> ok' : `  -> error ${item.result.error.name}`)
      }
      return lines
    }
    case 'turn':
      return item.end === undefined
        ? [`-- turn ${item.turn} --`]
        : [`-- turn ${item.turn} ${item.end.reason.kind} --`]
  }
}

/** Format the presenter status row from folded state. */
export function formatStatus(state: TranscriptState): string {
  const parts: string[] = []
  if (state.context !== undefined) {
    parts.push(`${state.context.provider}/${state.context.model}`)
  }
  if (state.todos.length > 0) {
    const active = state.todos.filter(todo => todo.status === 'in_progress').length
    parts.push(`todos ${active}/${state.todos.length}`)
  }
  if (state.compactions.length > 0) {
    parts.push(`compacted ${state.compactions.length}`)
  }
  return parts.length === 0 ? '' : parts.join(' | ')
}

/** Sanitized display lines for one transcript item. */
export function sanitizedLines(item: TranscriptItem): string[] {
  return formatItem(item).map(line => sanitizeText(line))
}
