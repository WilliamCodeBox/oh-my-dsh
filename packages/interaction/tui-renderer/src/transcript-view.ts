/**
 * pi-tui transcript view: a {@link Component} rendering the folded
 * {@link Transcript} items into sanitized display lines for the presenter's
 * scroll viewport.
 *
 * @module @deepseek-ai/dsh-tui-renderer
 */

import type { Component } from '@earendil-works/pi-tui'
import type { Transcript } from './transcript.ts'
import { sanitizedLines } from './format.ts'

/** Render the folded transcript items as sanitized display lines. */
export class TranscriptView implements Component {
  constructor(private readonly transcript: Transcript) {}

  /** No cached rendering state; the presenter re-renders on fold changes. */
  invalidate(): void {}

  render(_width: number): string[] {
    const lines: string[] = []
    for (const item of this.transcript.state.items) {
      lines.push(...sanitizedLines(item))
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
