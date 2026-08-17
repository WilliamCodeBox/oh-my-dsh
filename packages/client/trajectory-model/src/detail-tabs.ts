/** Details-panel tab projection for trajectory records. */

import type { TrajectoryCellProps } from './trajectory-record.ts'

/** Details-panel tab identifiers for one trajectory record. */
export type DetailTab =
  | 'system-prompt'
  | 'tools'
  | 'overview'
  | 'rendered'
  | 'raw'
  | 'source'
  | 'input'
  | 'output'
  | 'schema'
  | 'options'
  | 'usage'
  | 'timing'
  | 'diff'

/** One details-panel tab entry. */
export interface DetailTabItem {
  id: DetailTab
  label: string
}

const SYSTEM_PROMPT_TABS: readonly DetailTabItem[] = [
  { id: 'system-prompt', label: 'System Prompt' },
  { id: 'tools', label: 'Tools' },
]

const SYSTEM_UPDATE_TABS: readonly DetailTabItem[] = [
  { id: 'diff', label: 'Diff' },
  ...SYSTEM_PROMPT_TABS,
]

function isMarkdownCell(cell: TrajectoryCellProps): boolean {
  return cell.kind === 'user'
    || cell.kind === 'context'
    || cell.kind === 'message'
}

/**
 * Resolve the details-panel tabs available for one trajectory record.
 * @param cell - Projected trajectory record.
 * @returns Ordered tab entries for the record's details panel.
 */
export function detailTabsFor(cell: TrajectoryCellProps): readonly DetailTabItem[] {
  if (cell.kind === 'system') {
    return cell.previousPromptDetail === undefined
      ? SYSTEM_PROMPT_TABS
      : SYSTEM_UPDATE_TABS
  }
  if (cell.kind === 'compacted') {
    return [
      { id: 'overview', label: 'Summary' },
      { id: 'raw', label: 'Raw Output' },
    ]
  }
  if (isMarkdownCell(cell)) {
    return [
      { id: 'overview', label: 'Summary' },
      { id: 'rendered', label: 'Preview' },
      { id: 'raw', label: 'Raw' },
      ...(cell.messageSource === undefined
        ? []
        : [{ id: 'source', label: 'Source' } as const]),
    ]
  }
  return [
    { id: 'overview', label: 'Summary' },
    ...(cell.inputDetail ? [{ id: 'input', label: 'Payload' } as const] : []),
    ...(cell.outputDetail ? [{ id: 'output', label: 'Result' } as const] : []),
    { id: 'schema', label: 'Schema' },
    { id: 'timing', label: 'Timing' },
  ]
}
