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
 *   as structured cards with a state-colored leading bar plus the settled
 *   outcome and diffs. Items are separated by one blank line in both paths.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import { Box, Markdown, Text, type Component } from '@earendil-works/pi-tui'
import type { AssistantItem, Transcript, TranscriptItem, ToolItem } from './transcript.ts'
import { capped, formatItem, sanitizedLines } from './format.ts'
import { sanitizeText } from './sanitize.ts'
import type { ColorToken, SemanticTheme } from './theme.ts'
import type { JsonValue } from '@williamcodebox/omd-session'
import type { MessageSource } from '@williamcodebox/omd-llm'
import { formatElapsedSeconds, type TrajectoryCellProps } from '@williamcodebox/omd-client-trajectory-model'

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
      // meta carries the diff view; a result with empty text but diffs must
      // still invalidate the card. The full result text is not hashed (MB
      // scale); open/settled plus error identity suffice for re-render.
      return `tool:${item.name}:${item.args}:${item.result === undefined ? 'open' : 'settled'}:${item.result?.error?.name ?? ''}:${item.result?.meta === undefined ? '' : 'meta'}`
    case 'turn':
      return `turn:${item.end?.reason.kind ?? 'open'}`
    case 'command':
      return `command:${item.name}:${item.result?.kind ?? 'open'}`
    case 'subagent':
      return `subagent:${item.state}:${item.error ?? ''}`
  }
}

/** Build the Markdown component for one message item's sanitized text. */
function markdownFor(text: string, theme: SemanticTheme): Markdown {
  return new Markdown(sanitizeText(text), 0, 0, theme.markdown)
}

/** Cap for the dim reasoning preview above a finalized assistant message. */
const THINKING_LINE_CAP = 10

/**
 * Dim reasoning lines for one finalized assistant item: the joined
 * `reasoning` blocks capped to {@link THINKING_LINE_CAP} lines with an
 * explicit continuation note when truncated. Read per render so the cached
 * assistant component picks up thinking set at finalization.
 */
function thinkingLines(item: AssistantItem, theme: SemanticTheme): string[] {
  if (item.thinking === undefined) return []
  const lines = item.thinking.split('\n')
  const shown = lines.slice(0, THINKING_LINE_CAP)
  const hidden = lines.length - shown.length
  const out = shown.map(line => theme.fg('dim', sanitizeText(line)))
  if (hidden > 0) {
    out.push(theme.fg('dim', sanitizeText(`… ${hidden} more reasoning line${hidden === 1 ? '' : 's'}`)))
  }
  return out
}

/** Whether a user item is injected context rather than a direct user prompt. */
function isInjectedContext(source: MessageSource | undefined): source is Exclude<MessageSource, { kind: 'user' }> {
  return source !== undefined && source.kind !== 'user'
}

/**
 * Short display label for one injected-context source: the loaded file
 * paths for workspace instructions, the catalog name for skills, otherwise
 * the source kind. Mirrors the Web provenance labels. Source kinds are
 * merge-extensible, so kinds not visible in this package's compilation
 * compare through the string form.
 */
function contextLabel(source: MessageSource): string {
  const kind = String(source.kind)
  if (kind === 'agent-instructions') {
    const changes = (source as { changes?: ReadonlyArray<{ readonly path?: string }> }).changes
    const paths = changes?.map(change => change.path).filter((path): path is string => path !== undefined)
    return paths !== undefined && paths.length > 0 ? paths.join(', ') : 'workspace instructions'
  }
  if (kind === 'skill-catalog') return 'skill catalog'
  if (kind === 'skill-invocation') {
    const name = (source as { name?: string }).name
    return name === undefined ? 'skill' : `skill ${name}`
  }
  return source.kind
}

/** One file diff embedded in a tool result's `meta`. */
export interface DiffLike {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
}

/** Parse the tool-fs `{ diffs: FileDiff[] }` meta payload shape. */
function diffsFromMetaValue(meta: JsonValue | undefined): DiffLike[] | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs)) return undefined
  const valid: DiffLike[] = []
  for (const entry of diffs) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.path !== 'string' || typeof record.newText !== 'string') continue
    valid.push({
      path: record.path,
      oldText: typeof record.oldText === 'string' ? record.oldText : null,
      newText: record.newText,
    })
  }
  return valid.length === 0 ? undefined : valid
}

/** One unified-diff edit line. */
export type DiffEdit = { kind: 'ctx' | 'del' | 'add'; text: string }

/** LCS row cap: beyond this the full DP table would stall the render thread. */
const LCS_MAX_LINES = 1500

/**
 * Line-level longest-common-subsequence diff: interleaves context, removals,
 * and additions in unified order. O(n·m) table bounded by {@link LCS_MAX_LINES}
 * per side; larger diffs fall back to a linear add/remove dump so huge tool
 * results degrade to readable output instead of freezing the UI.
 */
export function lcsDiff(before: string[], after: string[]): DiffEdit[] {
  if (before.length > LCS_MAX_LINES || after.length > LCS_MAX_LINES) {
    const edits: DiffEdit[] = []
    const beforeSet = new Set(before)
    for (const line of after) {
      edits.push(beforeSet.has(line) ? { kind: 'ctx', text: line } : { kind: 'add', text: line })
    }
    const afterSet = new Set(after)
    for (const line of before) {
      if (!afterSet.has(line)) edits.push({ kind: 'del', text: line })
    }
    return edits
  }
  const n = before.length
  const m = after.length
  // DP table: dp[i][j] = LCS length of before[i..] and after[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = before[i] === after[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const edits: DiffEdit[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      edits.push({ kind: 'ctx', text: before[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      edits.push({ kind: 'del', text: before[i]! })
      i++
    } else {
      edits.push({ kind: 'add', text: after[j]! })
      j++
    }
  }
  while (i < n) edits.push({ kind: 'del', text: before[i++]! })
  while (j < m) edits.push({ kind: 'add', text: after[j++]! })
  return edits
}

/** Unified diff lines: hunk header, then interleaved context/add/remove. */
function diffCardLines(diff: DiffLike, theme: SemanticTheme): string[] {
  const lines = [theme.fg('diffHunk', `--- ${sanitizeText(diff.path)}`)]
  const before = diff.oldText?.split('\n') ?? []
  const after = diff.newText.split('\n')
  for (const edit of lcsDiff(before, after)) {
    if (edit.text.trim() === '' && edit.kind !== 'del') continue
    switch (edit.kind) {
      case 'ctx':
        lines.push(theme.fg('diffContext', `  ${sanitizeText(edit.text)}`))
        break
      case 'del':
        lines.push(theme.fg('diffRemoved', `- ${sanitizeText(edit.text)}`))
        break
      case 'add':
        lines.push(theme.fg('diffAdded', `+ ${sanitizeText(edit.text)}`))
        break
    }
  }
  return lines
}

/** State color per tool card state: the leading bar reads pending/success/error. */
const TOOL_STATE_TOKEN: Readonly<Record<'pending' | 'success' | 'error', ColorToken>> = {
  pending: 'accent',
  success: 'success',
  error: 'error',
}

/**
 * One tool card: a state-colored leading bar plus structured lines — title
 * with dimmed args, the settled outcome, and any embedded file diffs. The
 * bar (not a full-width background) keeps the card readable on any terminal
 * background while the state color still reads at a glance.
 */
function toolCardFor(item: ToolItem, theme: SemanticTheme): Component {
  const state = item.result === undefined
    ? 'pending'
    : item.result.error !== undefined ? 'error' : 'success'
  const bar = theme.fg(TOOL_STATE_TOKEN[state], '▌')
  const pipe = theme.fg('dim', '│')
  const card = new Box(0, 0)
  const args = item.args.trim()
  const title = `tool ${theme.fg('toolTitle', sanitizeText(item.name))}`
    + (args === '' ? '' : ` ${theme.fg('dim', sanitizeText(capped(args, 300)))}`)
  card.addChild(new Text(`${bar} ${title}`, 0, 0))
  if (item.result !== undefined) {
    const outcome = item.result.error === undefined
      ? `${pipe} ${theme.fg('success', '✓ ok')}`
      : `${pipe} ${theme.fg('error', `✗ error ${sanitizeText(item.result.error.name)}`)}`
    card.addChild(new Text(outcome, 0, 0))
    const diffs = diffsFromMetaValue(item.result.meta)
    if (diffs !== undefined) {
      const diffText: string[] = []
      for (const diff of diffs) diffText.push(...diffCardLines(diff, theme))
      if (diffText.length > 0) {
        card.addChild(new Text(diffText.map(line => `${pipe} ${line}`).join('\n'), 0, 0))
      }
    }
  }
  return card
}

/**
 * Background function that re-applies the fill after every inline SGR reset:
 * Markdown's per-token `\x1b[0m` would otherwise drop the card background
 * for the rest of the line. The fill strips its own trailing reset so the
 * re-applied background survives until the line's final reset.
 */
function persistentBg(bg: (text: string) => string): (text: string) => string {
  const fill = bg('').replace(/\x1b\[0m$/, '')
  return text => bg(text.replace(/\x1b\[0m/g, `\x1b[0m${fill}`))
}

/** Options controlling the transcript view's rendering. */
export interface TranscriptViewOptions {
  /**
   * Lines rendered instead of an empty body while the transcript has no
   * items (the welcome screen). Re-read before every render, so the
   * presenter's meta row and header can update the welcome live.
   */
  empty?: () => string[]
}

/** Render the folded transcript items as sanitized display lines. */
export class TranscriptView implements Component {
  private readonly semantic: SemanticTheme | undefined
  private readonly cache = new Map<TranscriptItem, CachedRender>()
  /**
   * Whether injected-context user rows (workspace instructions, skill
   * catalog) render in full. Rows default collapsed to one dim line,
   * matching the Web surface's collapsed-by-default disclosure rows; the
   * presenter's Ctrl+O toggle flips this.
   */
  contextExpanded = false

  constructor(
    private readonly transcript: Transcript,
    semantic?: SemanticTheme,
    private readonly options: TranscriptViewOptions = {},
  ) {
    this.semantic = semantic
  }

  /** No cached rendering state; the presenter re-renders on fold changes. */
  invalidate(): void {}

  render(width: number): string[] {
    // The welcome state owns an empty transcript: with nothing folded yet,
    // the empty callback's lines render instead of a blank viewport.
    if (this.transcript.state.items.length === 0) {
      const empty = this.options.empty
      if (empty !== undefined) return empty()
    }
    if (this.semantic === undefined) {
      const lines: string[] = []
      for (const item of this.transcript.state.items) {
        if (lines.length > 0) lines.push('')
        lines.push(...sanitizedLines(item))
      }
      return lines
    }
    const lines: string[] = []
    const theme = this.semantic
    for (const item of this.transcript.state.items) {
      if (lines.length > 0) lines.push('')
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
        const full = (width: number): string[] => card.render(width)
        if (!isInjectedContext(item.source)) return full
        // Injected context folds to one dim line until Ctrl+O expands it.
        // The flag is read per render, so the cached closure follows toggles.
        const collapsed = [theme.fg('dim', sanitizeText(`▸ context · ${contextLabel(item.source)} · ctrl+o expands`))]
        return (width) => this.contextExpanded ? full(width) : collapsed
      }
      case 'assistant': {
        const md = markdownFor(item.text, theme)
        let lastText = item.text
        let lastSetAt = 0
        // Streaming chunks can arrive faster than re-lexing the whole
        // message; throttle setText to ~80ms so the last block's highlight
        // cost stays bounded while the text lags at most one frame.
        return (width) => {
          if (item.text !== lastText) {
            const now = Date.now()
            if (now - lastSetAt >= 80) {
              md.setText(sanitizeText(item.text))
              lastText = item.text
              lastSetAt = now
            }
          }
          // Thinking arrives with finalization, so it is read per render
          // (not captured at build time) and always sits above the text.
          const thinking = thinkingLines(item, theme)
          if (thinking.length === 0) return md.render(width)
          return [...thinking, ...md.render(width)]
        }
      }
      case 'tool': {
        const card = toolCardFor(item, theme)
        return (width) => card.render(width)
      }
      case 'turn': {
        const end = item.end
        const bracket = formatItem(item)
        if (end !== undefined && end.reason.kind === 'error') {
          const lines = bracket.map(line => theme.fg('error', sanitizeText(line)))
          lines.push(theme.fg('error', sanitizeText(end.reason.error.message)))
          return () => lines
        }
        if (end !== undefined && end.reason.kind === 'max-tokens') {
          const lines = bracket.map(line => theme.fg('warning', sanitizeText(line)))
          return () => lines
        }
        const lines = bracket.map(line => theme.fg('dim', sanitizeText(line)))
        return () => lines
      }
      case 'subagent': {
        const token: ColorToken = item.state === 'running'
          ? 'dim'
          : item.state === 'done' ? 'success' : 'error'
        const line = item.state === 'running'
          ? `⟳ subagent ${item.provider}`
          : item.state === 'done'
            ? `✓ subagent ${item.provider}`
            : `✗ subagent ${item.provider}${item.error === undefined ? '' : ` ${item.error}`}`
        const lines = [theme.fg(token, sanitizeText(line))]
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

/** One ledger render snapshot, re-read before every render. */
export interface LedgerViewData {
  readonly cells: readonly TrajectoryCellProps[]
  /** Focused row index; the view clamps it defensively. */
  readonly focus: number
  /** Active kind filter label, when one is applied. */
  readonly filter?: string
}

/**
 * The `/ledger` view: one row per trajectory ledger cell (index, kind,
 * summary text, own duration) with a focused-row marker, a record/filter
 * header, and a key hint line. Rows render only for the given width; the
 * presenter owns the focus/scroll state and the Enter/Esc keys.
 */
export class LedgerView implements Component {
  constructor(
    private readonly read: () => LedgerViewData,
    private readonly theme: SemanticTheme,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const { cells, focus, filter } = this.read()
    const lines = [
      this.theme.fg('accent', `ledger · ${cells.length} record${cells.length === 1 ? '' : 's'}${filter === undefined ? '' : ` · filter ${filter}`}`),
      this.theme.fg('dim', '↑/↓ navigate · enter detail · esc close'),
    ]
    const selected = cells.length === 0 ? -1 : Math.min(Math.max(0, focus), cells.length - 1)
    for (let index = 0; index < cells.length; index++) {
      lines.push(this.row(cells[index]!, index === selected, width))
    }
    return lines
  }

  /** One ledger row: marker, #index, kind, capped summary, duration. */
  private row(cell: TrajectoryCellProps, selected: boolean, width: number): string {
    const marker = selected ? this.theme.fg('accent', '▸') : ' '
    const index = this.theme.fg('dim', `#${String(cell.index).padStart(4)}`)
    const kind = this.theme.fg('muted', cell.kind.padEnd(8))
    const duration = this.theme.fg('dim', formatElapsedSeconds(cell.timeSeconds))
    const textBudget = Math.max(8, width - 2 - 6 - 9 - 13)
    const text = sanitizeText(capped(cell.text === '' ? '(empty)' : cell.text, textBudget))
    return `${marker} ${index} ${kind} ${text} ${duration}`
  }
}
