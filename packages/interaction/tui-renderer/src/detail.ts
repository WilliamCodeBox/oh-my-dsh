/**
 * Detail-overlay tab content for one trajectory ledger cell. The tab set
 * comes from the shared model's {@link detailTabsFor}; this module turns one
 * (cell, tab) pair into the plain-text body the terminal overlay renders.
 * Degraded terminals get capped, non-scrolling bodies — content beyond the
 * cap is summarized with a remainder marker instead of being clipped mid-row.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import type { DetailTab, TrajectoryCellKind, TrajectoryCellProps, TrajectoryPromptSnapshot } from '@williamcodebox/omd-client-trajectory-model'
import { formatDurationMillis, formatElapsedSeconds } from '@williamcodebox/omd-client-trajectory-model'
import { lcsDiff } from './transcript-view.ts'

/** Cap for one detail tab's content lines; longer content shows a marker. */
export const DETAIL_LINE_CAP = 40

/** Display label for one trajectory kind (detail title; ledger rows use the raw kind). */
export const KIND_LABEL: Record<TrajectoryCellKind, string> = {
  system: 'System',
  user: 'User',
  context: 'Context',
  compacted: 'Compacted',
  message: 'Message',
  tool: 'Tool',
  subtool: 'Subtool',
}

/** Split text into at most `cap` lines, appending an explicit remainder marker. */
export function cappedLines(text: string, cap: number = DETAIL_LINE_CAP): string[] {
  const lines = text.split('\n')
  if (lines.length <= cap) return lines
  return [...lines.slice(0, cap), `… (+${lines.length - cap} more lines)`]
}

/** Tabs the terminal detail overlay renders: {@link detailTabsFor}'s output, minus the Web-only tabs. */
export type RenderedDetailTab = Exclude<DetailTab, 'options' | 'usage'>

/** One detail tab's body for one cell. */
export function detailBody(cell: TrajectoryCellProps, tab: RenderedDetailTab): string {
  switch (tab) {
    case 'overview': {
      const lines = [cell.text]
      if (cell.result !== undefined) lines.push(cell.result)
      return lines.join('\n')
    }
    case 'rendered':
      return cell.previewMarkdown ?? 'No preview available'
    case 'raw':
      return cell.outputDetail ?? 'No output recorded'
    case 'source':
      return cell.messageSource === undefined
        ? 'No source recorded'
        : JSON.stringify(cell.messageSource, null, 2)
    case 'input':
      return cell.inputDetail ?? 'No payload captured'
    case 'output':
      return cell.outputDetail ?? 'No output captured'
    case 'schema':
      return cell.schemaDetail ?? 'Schema unavailable'
    case 'timing':
      return timingBody(cell)
    case 'system-prompt':
      return cell.promptDetail?.system ?? 'No system prompt recorded'
    case 'tools':
      return toolsBody(cell.promptDetail)
    case 'diff':
      return diffBody(cell)
  }
}

/** Started/total/TTFT/generation lines for one cell's timing tab. */
function timingBody(cell: TrajectoryCellProps): string {
  const lines = [
    `Started: ${startedAtText(cell.startedAt)}`,
    `Duration: ${formatElapsedSeconds(cell.timeSeconds)}`,
  ]
  const metrics = cell.assistantMetrics
  if (metrics !== undefined) {
    const ttft = metrics.stepStartTime !== null && metrics.firstTokenTime !== null
      ? formatDurationMillis(Math.max(0, metrics.firstTokenTime - metrics.stepStartTime))
      : '—'
    const generation = metrics.firstTokenTime !== null && metrics.completedTime !== null
      ? formatDurationMillis(Math.max(0, metrics.completedTime - metrics.firstTokenTime))
      : '—'
    lines.push(`TTFT: ${ttft}`)
    lines.push(`Generation: ${generation}`)
  }
  return lines.join('\n')
}

/** Epoch-ms start as a deterministic ISO label, or the em dash when unknown. */
function startedAtText(startedAt: number | null | undefined): string {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return '—'
  return new Date(startedAt).toISOString()
}

/** One schema line per tool in the recorded catalog, parameters JSON indented. */
function toolsBody(prompt: TrajectoryPromptSnapshot | undefined): string {
  const tools = prompt?.tools ?? []
  if (tools.length === 0) return 'No tools recorded'
  return tools.map(tool => {
    const parameters = tool.parameters !== undefined && Object.keys(tool.parameters).length > 0
      ? `\n${JSON.stringify(tool.parameters, null, 2)}`
      : ''
    return `${tool.name}${tool.description === '' ? '' : ` — ${tool.description}`}${parameters}`
  }).join('\n\n')
}

/** System-prompt line diff plus tool-catalog name changes for an update cell. */
function diffBody(cell: TrajectoryCellProps): string {
  const previous = cell.previousPromptDetail
  if (previous === undefined || cell.promptDetail === undefined) return 'No previous prompt recorded'
  const lines = ['--- previous', '+++ current']
  for (const edit of lcsDiff(previous.system.split('\n'), cell.promptDetail.system.split('\n'))) {
    if (edit.text.trim() === '' && edit.kind !== 'del') continue
    switch (edit.kind) {
      case 'ctx':
        lines.push(`  ${edit.text}`)
        break
      case 'del':
        lines.push(`- ${edit.text}`)
        break
      case 'add':
        lines.push(`+ ${edit.text}`)
        break
    }
  }
  const previousTools = new Set(previous.tools.map(tool => tool.name))
  for (const tool of cell.promptDetail.tools) {
    if (!previousTools.has(tool.name)) lines.push(`+ tool ${tool.name}`)
  }
  const currentTools = new Set(cell.promptDetail.tools.map(tool => tool.name))
  for (const tool of previous.tools) {
    if (!currentTools.has(tool.name)) lines.push(`- tool ${tool.name}`)
  }
  return lines.join('\n')
}
