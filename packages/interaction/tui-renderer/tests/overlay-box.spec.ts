/**
 * Behavioral tests for the interaction-overlay chrome: the bordered dialog
 * rows and the DialogBox container that wraps child components in the modal
 * background. The chrome is pure string shaping, so tests assert the exact
 * box-drawing structure, truncation marker, and background escape sequence
 * without a terminal.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Component } from '@earendil-works/pi-tui'
import { visibleWidth } from '@earendil-works/pi-tui'
import { DialogBox, bottomBorder, divider, row, topBorder } from '../src/overlay-box.ts'
import { darkTheme } from '../src/theme.ts'

/** Modal background SGR for the dark theme (palette modalBg 235). */
const MODAL_BG = '\x1b[48;5;235m'

describe('overlay chrome', () => {
  it('builds a titled top border, divider, bottom border, and content rows', () => {
    const top = topBorder(darkTheme, 20, 'Ask')
    expect(top).toContain('┌─')
    expect(top).toContain('Ask')
    expect(top).toContain('┐')
    expect(divider(darkTheme, 20)).toContain('├')
    expect(divider(darkTheme, 20)).toContain('┤')
    expect(topBorder(darkTheme, 20)).toContain('┌─')
    expect(topBorder(darkTheme, 20)).not.toContain('Ask')
    expect(bottomBorder(darkTheme, 20)).toContain('└')
    expect(bottomBorder(darkTheme, 20)).toContain('┘')
    const contentRow = row(darkTheme, 'content', 20)
    expect(visibleWidth(contentRow)).toBe(20)
    expect(contentRow).toContain(' content')
    expect(contentRow).toContain('│\x1b[0m')
  })

  it('truncates an overlong content row with a remainder marker', () => {
    const line = row(darkTheme, 'x'.repeat(100), 20)
    expect(line).toContain('…')
    expect(line.length).toBeGreaterThanOrEqual(20)
  })
})

/** Static two-line child for DialogBox rendering tests. */
class TwoLineChild implements Component {
  render(): string[] {
    return ['line one', 'line two']
  }

  invalidate(): void {}
}

describe('DialogBox', () => {
  it('wraps child lines in the titled border with the modal background on every line', () => {
    const dialog = new DialogBox(darkTheme, () => 'Title', [new TwoLineChild()], () => 'footer hint')
    const lines = dialog.render(24)
    expect(lines[0]).toContain('┌─')
    expect(lines[0]).toContain('Title')
    expect(lines[1]).toContain('line one')
    expect(lines[2]).toContain('line two')
    expect(lines[3]).toContain('├')
    expect(lines[4]).toContain('footer hint')
    expect(lines[5]).toContain('└')
    expect(lines).toHaveLength(6)
    for (const line of lines) expect(line).toContain(MODAL_BG)
  })

  it('renders a body placeholder when no child emits lines', () => {
    const dialog = new DialogBox(darkTheme, () => 'Empty', [])
    const lines = dialog.render(20)
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('└')
  })

  it('omits the footer divider without a footer callback', () => {
    const dialog = new DialogBox(darkTheme, () => 'Bare', [new TwoLineChild()])
    const lines = dialog.render(20)
    expect(lines).toHaveLength(4)
    expect(lines.join('\n')).not.toContain('├')
  })

  it('invalidates child components', () => {
    const child = new TwoLineChild()
    const invalidate = vi.spyOn(child, 'invalidate')
    const dialog = new DialogBox(darkTheme, () => 'T', [child])
    dialog.invalidate()
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
})
