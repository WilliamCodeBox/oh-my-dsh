/**
 * pi-tui transcript view: a {@link Component} rendering the folded
 * {@link Transcript} items into sanitized display lines for the presenter's
 * scroll viewport.
 *
 * Two render paths share this class:
 * - Without a semantic theme the view emits plain identity lines from
 *   {@link formatItem} — snapshot fixtures and non-TTY surfaces compare
 *   uncolored text.
 * - With a {@link SemanticTheme} the view renders real components: user
 *   messages on a full-width background box, assistant messages through the
 *   Markdown component (width-aware, streamed via setText), and tool calls
 *   as state-colored cards (pending/success/error backgrounds).
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import { Box, Markdown, Text, type Component } from '@earendil-works/pi-tui'
import type { Transcript, TranscriptItem, ToolItem } from './transcript.ts'
import { capped, formatItem, sanitizedLines } from './format.ts'
import { sanitizeText } from './sanitize.ts'
import type { SemanticTheme } from './theme.ts'

/** Per-item-kind line stylers; each maps one sanitized display line. */
export interface TranscriptTheme {
  user: (text: string) => string
  assistant: (text: string) => string
  tool: (text: string) => string
  turn: (text: string) => string
  command: (text: string) => string
}

/** Plain styling: snapshots and pipe surfaces compare uncolored lines. */
export const identityTheme: TranscriptTheme = {
  user: text => text,
  assistant: text => text,
  tool: text => text,
  turn: text => text,
  command: text => text,
}

/** One cached component plus the fingerprint it was built for. */
interface CachedRender {
  readonly fingerprint: string
  readonly render: (width: number) => string[]
}

/**
 * Content fingerprint of an item: the fields the themed renderers read at
 * build time. Tool/turn/command items mutate in place when results arrive,
 * so reference identity is not a valid cache key.
 */
function fingerprintOf(item: TranscriptItem): string {
  switch (item.kind) {
    case 'user':
      return `user:${item.text}`
    case 'assistant':
      // Streaming text updates via setText on the cached component; the
      // fingerprint stays constant so the cache survives chunk deltas.
      return 'assistant'
    case 'tool':
      return `tool:${item.name}:${item.args}:${item.result?.error?.name ?? ''}:${item.result?.text ?? ''}`
    case 'turn':
      return `turn:${item.end?.reason.kind ?? 'open'}`
    case 'command':
      return `command:${item.name}:${item.result?.kind ?? 'open'}:${item.result?.text ?? ''}`
  }
}

/** Build the Markdown component for one message item's sanitized text. */
function markdownFor(text: string, theme: SemanticTheme): Markdown {
  return new Markdown(sanitizeText(text), 0, 0, theme.markdown)
}

/** One tool card: state-colored background, title + settled outcome. */
function toolCardFor(item: ToolItem, theme: SemanticTheme): Component {
  const bgFn = item.result === undefined
    ? (text: string) => theme.bg('toolPendingBg', text)
    : item.result.error !== undefined
      ? (text: string) => theme.bg('toolErrorBg', text)
      : (text: string) => theme.bg('toolSuccessBg', text)
  const card = new Box(1, 1, bgFn)
  const args = item.args.trim()
  const title = `tool ${item.name}${args === '' ? '' : ` ${capped(args, 300)}`}`
  card.addChild(new Text(sanitizeText(title), 1, 0, bgFn))
  if (item.result !== undefined) {
    const outcome = item.result.error === undefined
      ? '  ok'
      : `  error ${item.result.error.name}`
    card.addChild(new Text(sanitizeText(outcome), 1, 0, bgFn))
  }
  return card
}

/**
 * Background function that re-applies the fill after every inline SGR reset:
 * Markdown's per-token `\x1b[0m` would otherwise drop the card background
 * for the rest of the line.
 */
function persistentBg(bg: (text: string) => string): (text: string) => string {
  const fill = bg('')
  return text => bg(text.replace(/\x1b\[0m/g, `\x1b[0m${fill}`))
}

/** Render the folded transcript items as sanitized display lines. */
export class TranscriptView implements Component {
  private readonly semantic: SemanticTheme | undefined
  private readonly cache = new Map<TranscriptItem, CachedRender>()

  constructor(
    private readonly transcript: Transcript,
    semantic?: SemanticTheme,
  ) {
    this.semantic = semantic
  }

  /** No cached rendering state; the presenter re-renders on fold changes. */
  invalidate(): void {}

  render(width: number): string[] {
    if (this.semantic === undefined) {
      const lines: string[] = []
      for (const item of this.transcript.state.items) {
        lines.push(...sanitizedLines(item))
      }
      return lines
    }
    const lines: string[] = []
    const theme = this.semantic
    for (const item of this.transcript.state.items) {
      const fingerprint = fingerprintOf(item)
      let cached = this.cache.get(item)
      if (cached === undefined || cached.fingerprint !== fingerprint) {
        cached = { fingerprint, render: this.build(item, theme) }
        this.cache.set(item, cached)
      }
      lines.push(...cached.render(width))
    }
    return lines
  }

  /** Build (or rebuild) the renderer for one item. */
  private build(item: TranscriptItem, theme: SemanticTheme): (width: number) => string[] {
    switch (item.kind) {
      case 'user': {
        const card = new Box(1, 1, persistentBg(text => theme.bg('userBg', text)))
        const md = markdownFor(item.text, theme)
        card.addChild(md)
        return (width) => card.render(width)
      }
      case 'assistant': {
        const md = markdownFor(item.text, theme)
        let lastText = item.text
        return (width) => {
          if (item.text !== lastText) {
            md.setText(sanitizeText(item.text))
            lastText = item.text
          }
          return md.render(width)
        }
      }
      case 'tool': {
        const card = toolCardFor(item, theme)
        return (width) => card.render(width)
      }
      case 'turn': {
        const lines = formatItem(item).map(line => theme.fg('dim', sanitizeText(line)))
        return () => lines
      }
      case 'command': {
        const lines: string[] = []
        for (const line of formatItem(item)) {
          lines.push(theme.fg('command', sanitizeText(line)))
        }
        return () => lines
      }
    }
  }
}

/** Render a dynamic status row, re-read before every render. */
export class StatusRow implements Component {
  constructor(private readonly read: (width: number) => string) {}

  invalidate(): void {}

  render(width: number): string[] {
    const text = this.read(width)
    return text === '' ? [] : [text]
  }
}
