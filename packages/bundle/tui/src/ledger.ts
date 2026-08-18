/**
 * Ledger projection for the TUI runner: a kind-filtered view over the
 * transcript's trajectory ledger. The transcript fold maintains the cells
 * incrementally (O(1) per event); this projection only adds the `/filter`
 * slice — a lazy, memoized filter invalidated on every fold, so rendering
 * never re-derives the full list until the underlying cells actually change.
 *
 * @module @williamcodebox/omd-tui
 */

import type { Transcript } from '@williamcodebox/omd-tui-renderer'
import type { TrajectoryCellKind, TrajectoryCellProps } from '@williamcodebox/omd-client-trajectory-model'

/** The seven ledger record kinds, in canonical order (also the /filter vocabulary). */
export const LEDGER_KINDS: readonly TrajectoryCellKind[] = [
  'system',
  'user',
  'context',
  'compacted',
  'message',
  'tool',
  'subtool',
]

/** Narrow a raw /filter argument to a ledger kind. */
export function isLedgerKind(value: string): value is TrajectoryCellKind {
  return (LEDGER_KINDS as readonly string[]).includes(value)
}

/** Kind-filtered projection over one transcript's ledger cells. */
export class LedgerProjection {
  private filterKind: TrajectoryCellKind | undefined
  private filtered: readonly TrajectoryCellProps[] | undefined

  constructor(private readonly transcript: Transcript) {
    // Invalidate the filtered memo on every fold; the next read re-derives.
    // Per-event cost stays O(1) — only an actual read pays the filter scan.
    transcript.on(() => { this.filtered = undefined })
  }

  /** The filtered (or unfiltered) ledger cells, memoized per fold. */
  get cells(): readonly TrajectoryCellProps[] {
    const ledger = this.transcript.state.ledger
    if (this.filterKind === undefined) return ledger
    if (this.filtered !== undefined) return this.filtered
    this.filtered = ledger.filter(cell => cell.kind === this.filterKind)
    return this.filtered
  }

  /** The active kind filter, when one is applied. */
  get filter(): TrajectoryCellKind | undefined {
    return this.filterKind
  }

  /** Set (or clear, with `undefined`) the kind filter. */
  setFilter(kind: TrajectoryCellKind | undefined): void {
    this.filterKind = kind
    this.filtered = undefined
  }
}
