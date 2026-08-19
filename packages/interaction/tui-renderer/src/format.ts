/**
 * Display formatting for folded transcript items and the presenter status
 * row. Each item formats to one or more plain-text lines (no ANSI in this
 * layer; styling is a renderer concern), and every emitted line passes the
 * display sanitizer before it reaches the terminal.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import type { TranscriptItem, TranscriptState } from './transcript.ts'
import { sanitizeText } from './sanitize.ts'

/** Cap for one tool card's arguments line; longer payloads read from the result. */
const TOOL_ARGS_CAP = 300

/** Progress bar of `width` cells with a percentage label (pure characters). */
export function contextBar(ratio: number, width: number): string {
  const clamped = Math.min(1, Math.max(0, ratio))
  const filled = Math.round(clamped * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.round(clamped * 100)}%`
}

/**
 * Compact token count: `7828` → `7.8k`, `12500` → `12.5k`, `100000` →
 * `100k`, `1000000` → `1M`. Below 1000 the raw number stays.
 */
export function formatCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${millions === Math.round(millions) ? Math.round(millions) : millions.toFixed(1)}M`
  }
  if (value >= 1_000) {
    const thousands = value / 1_000
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1)}k`
  }
  return String(value)
}

/** Truncate one line to a cap with an explicit remainder note. */
export function capped(line: string, cap: number): string {
  return line.length <= cap ? line : `${line.slice(0, cap)} …(+${line.length - cap})`
}

/** Format one transcript item into display lines. */
export function formatItem(item: TranscriptItem): string[] {
  switch (item.kind) {
    case 'user':
      return item.text === '' ? ['>'] : [`> ${item.text}`]
    case 'assistant':
      return item.text === '' ? [] : item.text.split('\n')
    case 'tool': {
      const lines = [`tool ${item.name} ${capped(item.args, TOOL_ARGS_CAP)}`]
      if (item.result !== undefined) {
        lines.push(item.result.error === undefined ? '  -> ok' : `  -> error ${item.result.error.name}`)
      }
      return lines
    }
    case 'command': {
      const lines = [`command /${item.name}${item.args.trim() === '' ? '' : ` ${capped(item.args.trim(), TOOL_ARGS_CAP)}`}`]
      if (item.result !== undefined) {
        const text = item.result.text ?? (item.result.kind === 'success' ? 'ok' : 'error')
        lines.push(item.result.kind === 'success' ? `  -> ${capped(text, TOOL_ARGS_CAP)}` : `  -> error ${capped(text, TOOL_ARGS_CAP)}`)
      }
      return lines
    }
    case 'turn':
      return item.end === undefined
        ? [`-- turn ${item.turn} --`]
        : [`-- turn ${item.turn} ${item.end.reason.kind} --`]
    case 'subagent':
      return [`subagent ${item.provider} ${item.state}`]
  }
}

/** Format the presenter status row from folded state (running facts only;
 * the model and context bar live on the input meta row). */
export function formatStatus(state: TranscriptState): string {
  const parts: string[] = []
  if (state.usage.inputTokens > 0 || state.usage.outputTokens > 0) {
    parts.push(`tokens ${state.usage.inputTokens}+${state.usage.outputTokens}`)
  }
  if (state.todos.length > 0) {
    const active = state.todos.filter(todo => todo.status === 'in_progress').length
    parts.push(`todos ${active}/${state.todos.length}`)
  }
  if (state.compactions.length > 0) {
    parts.push(`compacted ${state.compactions.length}`)
  }
  // The most recent completed turn's duration, when one is closed.
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]
    if (item !== undefined && item.kind === 'turn' && item.end !== undefined) {
      parts.push(`${Math.round((item.end.time - item.time) / 1000)}s`)
      break
    }
  }
  return parts.length === 0 ? '' : parts.join(' | ')
}

/** Sanitized display lines for one transcript item. */
export function sanitizedLines(item: TranscriptItem): string[] {
  return formatItem(item).map(line => sanitizeText(line))
}
