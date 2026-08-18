/**
 * Behavioral tests for the ledger view: row layout (index, kind, summary,
 * duration), the focus marker with clamping, the record/filter header, and
 * the empty state.
 */

import { describe, expect, it } from 'vitest'
import { LedgerView } from '../src/transcript-view.ts'
import { darkTheme } from '../src/theme.ts'
import type { TrajectoryCellProps } from '@williamcodebox/omd-client-trajectory-model'

/** One minimal ledger cell with the display fields the view reads. */
function cell(index: number, kind: TrajectoryCellProps['kind'], text: string, timeSeconds: number | null = null): TrajectoryCellProps {
  return { index, kind, text, timeSeconds }
}

describe('LedgerView', () => {
  it('renders the header, hint, and one row per cell with index/kind/text/duration', () => {
    const view = new LedgerView(() => ({
      cells: [
        cell(1, 'user', 'hello'),
        cell(2, 'message', 'hi there', 1.25),
        cell(3, 'tool', 'bash {"cmd":"ls"}', 0.5),
      ],
      focus: 0,
    }), darkTheme)
    const lines = view.render(80).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''))
    expect(lines[0]).toBe('ledger · 3 records')
    expect(lines[1]).toContain('↑/↓ navigate')
    expect(lines[2]).toBe('▸ #   1 user     hello —')
    expect(lines[3]).toBe('  #   2 message  hi there 1,250 ms')
    expect(lines[4]).toBe('  #   3 tool     bash {"cmd":"ls"} 500 ms')
  })

  it('shows the active kind filter in the header', () => {
    const view = new LedgerView(() => ({
      cells: [cell(1, 'tool', 'bash')],
      focus: 0,
      filter: 'tool',
    }), darkTheme)
    const plain = view.render(80)[0]!.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toBe('ledger · 1 record · filter tool')
  })

  it('moves the focus marker and clamps an out-of-range focus', () => {
    const cells = [cell(1, 'user', 'a'), cell(2, 'message', 'b'), cell(3, 'tool', 'c')]
    const view = new LedgerView(() => ({ cells, focus: 2 }), darkTheme)
    const plain = view.render(80).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''))
    expect(plain[2]).toContain('  #')
    expect(plain[3]).toContain('  #')
    expect(plain[4]).toContain('▸ #')
    const clamped = new LedgerView(() => ({ cells, focus: 99 }), darkTheme)
    const clampedLines = clamped.render(80).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''))
    expect(clampedLines[4]).toContain('▸ #')
  })

  it('renders an empty ledger with no rows', () => {
    const view = new LedgerView(() => ({ cells: [], focus: 0 }), darkTheme)
    const lines = view.render(80).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''))
    expect(lines[0]).toBe('ledger · 0 records')
    expect(lines).toHaveLength(2)
  })

  it('caps long row text and marks an empty summary', () => {
    const view = new LedgerView(() => ({
      cells: [cell(1, 'context', 'x'.repeat(200)), cell(2, 'compacted', '')],
      focus: 0,
    }), darkTheme)
    const plain = view.render(40).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''))
    expect(plain[2]).toContain('…(+')
    expect(plain[3]).toContain('(empty)')
  })
})
