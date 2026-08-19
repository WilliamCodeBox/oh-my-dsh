/**
 * Box-drawing chrome for interaction overlays (ask dialog, detail panel):
 * a titled top border, section divider, bottom border, and content rows.
 * The chrome wraps child components so dialog text never blends into the
 * transcript beneath it; every rendered line carries the modal background.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import type { Component } from '@earendil-works/pi-tui'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { SemanticTheme } from './theme.ts'

/** Box-drawing characters for the overlay chrome. */
const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
}

/** Pad or truncate a (possibly ANSI-styled) string to exactly `width` columns. */
function fit(text: string, width: number): string {
  const visible = visibleWidth(text)
  return visible <= width ? text + ' '.repeat(width - visible) : truncateToWidth(text, width, '…')
}

function paint(theme: SemanticTheme, text: string): string {
  return theme.fg('border', text)
}

/** Top border with an accent-colored title inset into the rule. */
export function topBorder(theme: SemanticTheme, width: number, title = ''): string {
  const inner = Math.max(0, width - 2)
  if (title === '') return paint(theme, BOX.topLeft + BOX.horizontal.repeat(inner) + BOX.topRight)
  const shown = truncateToWidth(` ${title} `, Math.max(0, inner - 2))
  const fill = Math.max(0, inner - 1 - visibleWidth(shown))
  return (
    paint(theme, BOX.topLeft + BOX.horizontal) +
    theme.fg('accent', shown) +
    paint(theme, BOX.horizontal.repeat(fill) + BOX.topRight)
  )
}

/** A horizontal rule with left/right tees, splitting overlay sections. */
export function divider(theme: SemanticTheme, width: number): string {
  return paint(theme, BOX.teeRight + BOX.horizontal.repeat(Math.max(0, width - 2)) + BOX.teeLeft)
}

export function bottomBorder(theme: SemanticTheme, width: number): string {
  return paint(theme, BOX.bottomLeft + BOX.horizontal.repeat(Math.max(0, width - 2)) + BOX.bottomRight)
}

/** Wrap pre-styled content in vertical borders with single-column insets. */
export function row(theme: SemanticTheme, content: string, width: number): string {
  return `${paint(theme, BOX.vertical)} ${fit(content, Math.max(0, width - 4))} ${paint(theme, BOX.vertical)}`
}

/**
 * A bordered, opaque dialog container for interaction overlays: a titled top
 * border, the child components' rendered lines as content rows, an optional
 * footer hint above the bottom border, and the modal background across every
 * line. Rendered at the overlay's width, so the dialog reads as one solid
 * panel over the transcript.
 */
export class DialogBox implements Component {
  constructor(
    private readonly theme: SemanticTheme,
    private readonly readTitle: () => string,
    private readonly children: Component[],
    private readonly readFooter?: () => string,
  ) {}

  invalidate(): void {
    for (const child of this.children) child.invalidate()
  }

  render(width: number): string[] {
    const childWidth = Math.max(1, width - 4)
    const lines: string[] = []
    for (const child of this.children) {
      for (const line of child.render(childWidth)) lines.push(line)
    }
    const body = lines.length === 0 ? [''] : lines
    const out = [topBorder(this.theme, width, this.readTitle())]
    for (const line of body) out.push(row(this.theme, line, width))
    if (this.readFooter !== undefined) {
      out.push(divider(this.theme, width))
      out.push(row(this.theme, this.readFooter(), width))
    }
    out.push(bottomBorder(this.theme, width))
    return out.map(line => this.theme.bg('modalBg', line))
  }
}
