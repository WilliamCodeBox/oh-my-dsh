/**
 * The pi-tui-backed terminal presenter: alternate-screen TUI whose layout is
 * a scrollable {@link TranscriptView}, a dynamic status row, and the input
 * editor. The presenter owns the terminal lifecycle (raw mode, alternate
 * screen, restore on stop) through pi-tui's {@link Terminal}; the runner
 * drives it: submit lines via the editor, feed session events through the
 * {@link Transcript}, and handle raw keys through the TUI input listener.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import {
  Box,
  Editor,
  Input,
  ProcessTerminal,
  ScrollView,
  SelectList,
  Text,
  TuiAltScreen,
  VStack,
  isViewportTUI,
  truncateToWidth,
  visibleWidth,
  type AutocompleteProvider,
    type OverlayHandle,
  type SelectItem,
  type Terminal,
  type ViewportTUI,
} from '@earendil-works/pi-tui'
import type { ApprovalOutcome } from '@williamcodebox/omd-user-approval/types'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
} from '@williamcodebox/omd-user-questions/types'
import type { Component } from '@earendil-works/pi-tui'
import type { Transcript } from './transcript.ts'
import { sanitizeText } from './sanitize.ts'
import { StatusRow, TranscriptView } from './transcript-view.ts'
import { MetaRow, type MetaRowData } from './meta-row.ts'
import { WorkspaceAutocomplete } from './autocomplete.ts'
import { darkTheme, type SemanticTheme } from './theme.ts'

/** The production terminal: real process stdin/stdout streams. */
export function processTerminal(): Terminal {
  return new ProcessTerminal()
}

/**
 * Build the editor's completion provider: slash commands plus `@`-file
 * fuzzy completion over a base directory. No external `fd` binary required.
 * @param commands - available slash commands (name + optional description).
 * @param basePath - the workspace directory file completion searches.
 */
export function workspaceAutocomplete(
  commands: readonly { name: string; description?: string }[],
  basePath: string,
): AutocompleteProvider {
  return new WorkspaceAutocomplete(commands, basePath)
}

/** Presenter callbacks the runner supplies. */
export interface PresenterOptions {
  /** Called with each editor-submitted input line. */
  onSubmit: (line: string) => void
  /** Status row text, re-read before each render. */
  statusLine: () => string
  /** Transient right-side status (spinner, retry, esc hint); re-read per render. */
  transient?: () => string
}

/**
 * Full-screen terminal presenter over a folded {@link Transcript}.
 * {@link TuiPresenter.start} enters raw mode and the alternate screen;
 * {@link TuiPresenter.stop} restores the terminal synchronously. Interaction
 * prompts (approvals, user questions) mount as overlay modals that steal
 * focus to a {@link SelectList} or {@link Input}; while one is pending, the
 * runner's Ctrl+C listener must let the modal's cancel binding
 * (Escape/Ctrl+C) resolve it instead of driving the quit machine.
 */
export class TuiPresenter {
  readonly tui: ViewportTUI
  /** The input editor — the pi-tui seam later interaction milestones mount on. */
  readonly editor: Editor
  /** The transcript scroll viewport, for runner-driven history paging. */
  readonly transcriptScroll: ScrollView
  private started = false
  /** The live interaction overlay, when one is asking. */
  private overlay: { handle: OverlayHandle } | undefined
  /** Overlays waiting behind the live one (approvals/questions during a modal). */
  private overlayQueue: Array<{ component: Component; focus?: Component; close: (() => void) | undefined }> = []
  /** External halt sink: the runner resolves its drive loop here. */
  private haltHandler: ((outcome: unknown) => void) | undefined
  /** The input-context row (model/thinking | cwd/git | context bar). */
  private readonly metaRow: MetaRow
  /** Input-context data source; the runner replaces the getter per drive. */
  private metaData: () => MetaRowData = () => ({})

  constructor(
    terminal: Terminal,
    transcript: Transcript,
    private readonly options: PresenterOptions,
    private readonly theme: SemanticTheme = darkTheme,
    autocomplete?: AutocompleteProvider,
  ) {
    this.tui = new TuiAltScreen(terminal)
    if (!isViewportTUI(this.tui)) {
      throw new Error('tui-renderer: the presenter requires a viewport TUI')
    }
    const view = new TranscriptView(transcript, this.theme)
    const status = new StatusRow(width => this.renderStatus(width))
    this.metaRow = new MetaRow(() => this.metaData(), this.theme)
    this.editor = new Editor(this.tui, this.theme.editor)
    if (autocomplete !== undefined) this.editor.setAutocompleteProvider(autocomplete)
    this.editor.onSubmit = (line) => {
      options.onSubmit(line)
      this.editor.addToHistory(line)
    }
    this.transcriptScroll = new ScrollView(view, { follow: 'end', primary: true, overscroll: 'chain' })

    this.tui.setLayoutRoot(new VStack([
      {
        component: this.transcriptScroll,
        basis: 0,
        grow: 1,
        minSize: 1,
      },
      {
        component: status,
        basis: 'auto',
        shrink: 1,
        minSize: 1,
      },
      {
        component: this.metaRow,
        basis: 'auto',
        shrink: 1,
        minSize: 1,
      },
      {
        component: this.editor,
        basis: 'auto',
        shrink: 1,
        minSize: 1,
      },
    ]))
    transcript.on(() => { this.tui.requestRender() })
  }

  /** Enter raw mode and draw the alternate screen. */
  start(): void {
    this.tui.start()
    this.tui.setFocus(this.editor)
    this.started = true
  }

  /** Restore the terminal; safe to call once. */
  stop(): void {
    this.tui.stop()
    this.started = false
  }

  /** True while the presenter owns the terminal. */
  get isStarted(): boolean {
    return this.started
  }

  /** True while an interaction overlay modal is asking. */
  get interactionPending(): boolean {
    return this.overlay !== undefined
  }

  /**
   * Register the runner's halt sink. The runner resolves its input loop
   * here when a command (e.g. session switch) wants to end the current
   * drive without a Ctrl+C quit.
   * @param handler - receives the halt payload the command produced.
   */
  setHaltHandler(handler: (outcome: unknown) => void): void {
    this.haltHandler = handler
  }

  /** Request a halt of the current drive loop with an arbitrary payload. */
  halt(outcome: unknown): void {
    this.haltHandler?.(outcome)
  }

  /**
   * Present one approval request as an overlay modal and resolve with the
   * user's decision. Enter on the default (Allow) or arrow+Enter selection,
   * Escape/Ctrl+C cancels.
   * @param toolName - the tool whose call is being decided.
   * @param reason - the asker's explanation, when provided.
   * @returns the closed approval outcome.
   */
  async askApproval(toolName: string, reason?: string): Promise<ApprovalOutcome> {
    const picked = await this.promptSelect(
      `Approve tool call: ${toolName}`,
      reason,
      [
        { value: 'allowed-once', label: `Allow ${toolName}` },
        { value: 'rejected', label: 'Reject' },
      ],
    )
    return picked === undefined ? 'cancelled' : picked as ApprovalOutcome
  }

  /**
   * Present one user-questions request: each question renders as its own
   * modal — a SelectList for option questions (multi-select loops over the
   * remaining options until Escape), a free-text Input for option-less
   * questions. Escape answers nothing for that question.
   * @param questions - the questions to ask, in order.
   * @returns the answers in question order.
   */
  async askQuestions(questions: AskUserQuestionItem[]): Promise<AskUserQuestionAnswer> {
    const answers: AskUserQuestionAnswerItem[] = []
    for (const item of questions) answers.push(await this.askOne(item))
    return { answers }
  }

  /** Ask one question by its shape: options list or free text. */
  private async askOne(item: AskUserQuestionItem): Promise<AskUserQuestionAnswerItem> {
    const options = item.options ?? []
    if (options.length === 0) {
      const value = await this.promptText(item.question, item.detail)
      return value === undefined
        ? { id: item.id, selected: [] }
        : { id: item.id, selected: [], custom: value }
    }
    const select = options.map(option => ({
      value: option.label,
      label: option.label,
      ...(option.description !== undefined ? { description: option.description } : {}),
    }))
    if (item.multiSelect !== true) {
      const picked = await this.promptSelect(item.question, item.detail, select)
      return { id: item.id, selected: picked === undefined ? [] : [picked] }
    }
    const selected: string[] = []
    const remaining = [...options]
    while (remaining.length > 0) {
      const picked = await this.promptSelect(
        selected.length === 0 ? item.question : `${item.question} (${selected.length} selected)`,
        item.detail,
        remaining.map(option => ({
          value: option.label,
          label: option.label,
          ...(option.description !== undefined ? { description: option.description } : {}),
        })),
      )
      if (picked === undefined) break
      selected.push(picked)
      const index = remaining.findIndex(option => option.label === picked)
      if (index !== -1) remaining.splice(index, 1)
    }
    return { id: item.id, selected }
  }

  /**
   * Mount one interaction overlay as the single interaction slot and return
   * its close callback. While one modal is live, further overlays queue;
   * when the current one closes the queue advances and the queued modal's
   * focus target receives focus (pi-tui's overlay stack would otherwise
   * show both and strand the lower one's promise). The returned close is a
   * proxy: before the queued modal mounts it cancels the queue entry;
   * after mounting it closes the real modal.
   */
  private mountOverlay(component: Component, focus?: Component): () => void {
    if (this.overlay !== undefined) {
      const pending: { component: Component; focus?: Component; close: (() => void) | undefined } = {
        component,
        ...(focus !== undefined ? { focus } : {}),
        close: undefined,
      }
      this.overlayQueue.push(pending)
      return () => {
        pending.close?.()
        const index = this.overlayQueue.indexOf(pending)
        if (index !== -1) this.overlayQueue.splice(index, 1)
      }
    }
    const handle = this.tui.showOverlay(component)
    this.overlay = { handle }
    if (focus !== undefined) this.tui.setFocus(focus)
    let closed = false
    const close = (): void => {
      if (closed) return
      closed = true
      this.overlay = undefined
      handle.hide()
      this.tui.setFocus(this.editor)
      const next = this.overlayQueue.shift()
      if (next !== undefined) {
        next.close = this.mountOverlay(next.component, next.focus)
      } else {
        this.tui.requestRender()
      }
    }
    return close
  }

  /**
   * Show one SelectList modal and resolve with the chosen value, or
   * `undefined` when the user cancels.
   */
  private promptSelect(
    title: string,
    detail: string | undefined,
    items: SelectItem[],
  ): Promise<string | undefined> {
    const { promise, resolve } = Promise.withResolvers<string | undefined>()
    const card = new Box(1, 1)
    card.addChild(new Text(sanitizeText(title), 0, 0))
    if (detail !== undefined && detail !== '') card.addChild(new Text(sanitizeText(detail), 0, 0))
    card.addChild(new Text('', 0, 0))
    const list = new SelectList(items, 5, this.theme.editor.selectList)
    card.addChild(list)
    const close = this.mountOverlay(card, list)
    list.onSelect = (item) => { close(); resolve(item.value) }
    list.onCancel = () => { close(); resolve(undefined) }
    this.tui.requestRender()
    return promise
  }

  /**
   * Show one free-text modal and resolve with the entered value, or
   * `undefined` when the user cancels. Enter submits, Escape/Ctrl+C cancels.
   */
  private promptText(title: string, detail: string | undefined): Promise<string | undefined> {
    const { promise, resolve } = Promise.withResolvers<string | undefined>()
    const input = new Input()
    const card = new Box(1, 1)
    card.addChild(new Text(sanitizeText(title), 0, 0))
    if (detail !== undefined && detail !== '') card.addChild(new Text(sanitizeText(detail), 0, 0))
    card.addChild(input)
    const close = this.mountOverlay(card, input)
    input.onSubmit = (value) => { close(); resolve(value) }
    input.onEscape = () => { close(); resolve(undefined) }
    this.tui.requestRender()
    return promise
  }

  /** Replace the editor content (e.g. clear input on Ctrl+C). */
  setInput(text: string): void {
    this.editor.setText(text)
  }

  /**
   * Show a read-only keybinding help overlay. Escape or Enter closes it and
   * restores editor focus.
   * @param entries - the keybindings to list.
   */
  showHelp(entries: readonly { key: string; description: string }[]): void {
    if (this.overlay !== undefined) return
    const card = new Box(1, 1)
    card.addChild(new Text(this.theme.fg('accent', 'Keys'), 0, 0))
    for (const entry of entries) {
      card.addChild(new Text(`  ${entry.key.padEnd(20)} ${entry.description}`, 0, 0))
    }
    card.addChild(new Text('', 0, 0))
    card.addChild(new Text(this.theme.fg('dim', 'esc / enter to close'), 0, 0))
    const close = this.mountOverlay(card)
    const offKey = this.onKey((data) => {
      if (data === '\x1b' || data === '\r' || data === '\n') {
        offKey()
        close()
        return true
      }
      return false
    })
  }

  /**
   * Scroll the transcript viewport; positive scrolls toward the end. A
   * manual scroll leaves end-following until the viewport returns to the
   * bottom, so history stays readable while new content streams.
   * @param lines - signed line delta (negative scrolls back in history).
   */
  scrollTranscript(lines: number): void {
    this.transcriptScroll.scrollBy(lines)
    this.tui.requestRender()
  }

  /**
   * Page the transcript viewport by one visible page; positive pages
   * toward the end.
   * @param dir - 1 pages forward (toward the end), -1 pages back.
   */
  pageTranscript(dir: 1 | -1): void {
    const rows = this.tui.terminal.rows
    this.transcriptScroll.scrollBy(dir * Math.max(1, rows - 4))
    this.tui.requestRender()
  }

  /** Replace the input-context data source (model/thinking/cwd/git/context). */
  setMetaData(read: () => MetaRowData): void {
    this.metaData = read
    if (this.started) this.tui.requestRender()
  }

  /** Ask the TUI to redraw (e.g. after the git watcher updated the meta row). */
  requestRender(): void {
    if (this.started) this.tui.requestRender()
  }

  /** Reflect the terminal's task-progress indicator (OSC 9). */
  setProgress(active: boolean): void {
    if (this.started) this.tui.terminal.setProgress(active)
  }

  /**
   * Assemble the status row: the runner's left text (dim, running facts
   * from formatStatus) plus a transient right segment (spinner/retry/esc
   * hints). The transient renders even when the left text is empty (first
   * turn before any usage lands); truncation drops the left first.
   */
  private renderStatus(width: number): string {
    const left = this.options.statusLine()
    const transient = this.options.transient?.() ?? ''
    const transientText = transient === '' ? '' : ` ${this.theme.fg('accent', transient)}`
    if (left === '') return transientText
    const transientWidth = transient === '' ? 0 : 1 + visibleWidth(transient)
    const budget = Math.max(1, width - transientWidth)
    return truncateToWidth(this.theme.fg('dim', left), budget) + transientText
  }

  /** Current editor text, for the Ctrl+C empty-input decision. */
  getInput(): string {
    return this.editor.getText()
  }

  /** Subscribe to raw key data before components consume it; returns the disposer. */
  onKey(listener: (data: string) => boolean): () => void {
    return this.tui.addInputListener((data) => {
      if (listener(data)) return { consume: true }
      return undefined
    })
  }
}
