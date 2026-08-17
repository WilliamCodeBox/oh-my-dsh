/**
 * The input-context row: one line directly above the input editor showing
 * the current model + thinking level (left), workspace + git status
 * (center), and the context-window bar (right). The status row above it
 * carries running state (tokens, todos, transient hints); this row carries
 * the durable input context. Truncation drops from the left segments first
 * so the context bar never disappears.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { contextBar, formatCount } from './format.ts'
import { sanitizeText } from './sanitize.ts'
import type { SemanticTheme } from './theme.ts'

/** Git worktree state for the meta row. */
export interface MetaGit {
  readonly branch: string
  /** Files with unstaged modifications. */
  readonly unstaged: number
  /** Files staged for commit. */
  readonly staged: number
  /** Untracked files. */
  readonly untracked: number
}

/** Input-context data, re-read before every render. */
export interface MetaRowData {
  /** Current provider/model selection. */
  model?: { provider: string; model: string }
  /** Current reasoning-effort label, when the adapter exposes one. */
  thinking?: string
  /** Current agent preset id, when the deployment composes one. */
  preset?: string
  /** Workspace directory display path. */
  cwd?: string
  /** Git worktree state, when inside a repository. */
  git?: MetaGit
  /** Context usage for the progress bar. */
  context?: { ratio: number; window?: number; used: number }
}

/** Context threshold colors (percent); more conservative of the two wins. */
const CONTEXT_PERCENT_THRESHOLDS: ReadonlyArray<{ at: number; token: ColorTokenForBar }> = [
  { at: 0.9, token: 'error' },
  { at: 0.7, token: 'warning' },
  { at: 0.5, token: 'muted' },
]

type ColorTokenForBar = 'error' | 'warning' | 'muted' | 'dim'

/** Threshold color for a context ratio. */
export function contextTokenFor(ratio: number): ColorTokenForBar {
  for (const threshold of CONTEXT_PERCENT_THRESHOLDS) {
    if (ratio >= threshold.at) return threshold.token
  }
  return 'dim'
}

/** Render one meta row from the current data. */
export function renderMetaRow(data: MetaRowData, theme: SemanticTheme, width: number): string {
  const leftParts: string[] = []
  if (data.model !== undefined) {
    leftParts.push(theme.fg('muted', `${data.model.provider}/${data.model.model}`))
  }
  if (data.thinking !== undefined) {
    leftParts.push(theme.fg('accent', `⟳ ${data.thinking}`))
  }
  if (data.preset !== undefined) {
    leftParts.push(theme.fg('command', `◈ ${data.preset}`))
  }

  const centerParts: string[] = []
  if (data.cwd !== undefined) {
    centerParts.push(theme.fg('dim', sanitizeText(data.cwd)))
  }
  if (data.git !== undefined) {
    const git = data.git
    const markers: string[] = []
    if (git.staged > 0) markers.push(theme.fg('success', `+${git.staged}`))
    if (git.unstaged > 0) markers.push(theme.fg('warning', `*${git.unstaged}`))
    if (git.untracked > 0) markers.push(theme.fg('muted', `?${git.untracked}`))
    centerParts.push(theme.fg('accent', `⎇ ${git.branch}`) + (markers.length === 0 ? '' : ` ${markers.join(' ')}`))
  }

  const right = data.context === undefined
    ? ''
    : theme.fg(contextTokenFor(data.context.ratio), contextBar(data.context.ratio, 10))
      + (data.context.window === undefined ? '' : theme.fg('dim', ` ${formatCount(data.context.used)}/${formatCount(data.context.window)}`))

  const left = leftParts.join('  ')
  const center = centerParts.join('  ')
  const rightWidth = right === '' ? 0 : visibleWidth(right)
  const budget = Math.max(1, width - rightWidth - (right === '' ? 0 : 1))
  // Center is the middle priority: keep it whole until the left must shrink.
  const centerWidth = center === '' ? 0 : visibleWidth(center)
  const leftBudget = Math.max(1, budget - centerWidth - (center === '' ? 0 : 2))
  const leftText = truncateToWidth(left, leftBudget)
  const centerText = center === '' ? '' : `  ${center}`
  const rightText = right === '' ? '' : `  ${right}`
  return truncateToWidth(leftText + centerText + rightText, width)
}

/** Component wrapper for the meta row. */
export class MetaRow implements Component {
  constructor(
    private readonly read: () => MetaRowData,
    private readonly theme: SemanticTheme,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const text = renderMetaRow(this.read(), this.theme, width)
    return text === '' ? [] : [text]
  }
}
