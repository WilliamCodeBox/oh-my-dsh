/**
 * pi-tui transcript view: a {@link Component} rendering the folded
 * {@link Transcript} items into sanitized display lines for the presenter's
 * scroll viewport. Styling is opt-in: the default theme is identity, so
 * snapshot fixtures compare plain text; the presenter passes a color theme.
 *
 * @module @deepseek-ai/dsh-tui-renderer
 */

import type { Component } from '@earendil-works/pi-tui'
import type { Transcript } from './transcript.ts'
import { sanitizedLines } from './format.ts'

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

/** Render the folded transcript items as sanitized display lines. */
export class TranscriptView implements Component {
  constructor(
    private readonly transcript: Transcript,
    private readonly theme: TranscriptTheme = identityTheme,
  ) {}

  /** No cached rendering state; the presenter re-renders on fold changes. */
  invalidate(): void {}

  render(_width: number): string[] {
    const lines: string[] = []
    for (const item of this.transcript.state.items) {
      const style = this.theme[item.kind]
      for (const line of sanitizedLines(item)) lines.push(style(line))
    }
    return lines
  }
}

/** Render a dynamic status row, re-read before every render. */
export class StatusRow implements Component {
  constructor(private readonly read: () => string) {}

  invalidate(): void {}

  render(_width: number): string[] {
    const text = this.read()
    return text === '' ? [] : [text]
  }
}
