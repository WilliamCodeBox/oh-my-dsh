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
import { LedgerView, StatusRow, TranscriptView } from './transcript-view.ts'
import { cappedLines, detailBody, KIND_LABEL, type RenderedDetailTab } from './detail.ts'
import { MetaRow, type MetaRowData } from './meta-row.ts'
import { DialogBox } from './overlay-box.ts'
import { WorkspaceAutocomplete } from './autocomplete.ts'
import { darkTheme, type SemanticTheme } from './theme.ts'
import { detailTabsFor, formatElapsedSeconds, type DetailTabItem, type TrajectoryCellProps } from '@williamcodebox/omd-client-trajectory-model'

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
  /** The status row, kept so the ledger layout can rebuild around it. */
  private readonly statusRow: StatusRow
  /** The layout root; rebuilt when the ledger view swaps in. */
  private readonly layoutRoot: VStack
  /**
   * Foreground key dispatch: the ledger/detail key handlers live here and run
   * before the runner's registry listener (registered later via {@link onKey})
   * and before any focused component. This is the key-precedence contract:
   * while the ledger or its detail overlay is up, Esc/Enter/Tab/arrows are
   * consumed here — they never fall through to the registry's Esc (clear
   * input / interrupt a running turn) or to the editor's submit.
   */
  private foreground: ((data: string) => boolean) | undefined
  /** True while the detail overlay belongs to this presenter (vs an interaction modal). */
  private detailOverlayActive = false
  /** Ledger view state; the ledger rows render from these getters. */
  private ledgerOpenState = false
  private ledgerFocus = 0
  private ledgerCells: () => readonly TrajectoryCellProps[] = () => []
  private ledgerFilter: () => string | undefined = () => undefined
  private ledgerScrollRef: ScrollView | undefined
  private offLedgerForeground: (() => void) | undefined
  /** Active detail tab index within the current cell's tab list. */
  private detailTabIndex = 0
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
    this.statusRow = status
    this.metaRow = new MetaRow(() => this.metaData(), this.theme)
    this.editor = new Editor(this.tui, this.theme.editor)
    if (autocomplete !== undefined) this.editor.setAutocompleteProvider(autocomplete)
    this.editor.onSubmit = (line) => {
      options.onSubmit(line)
      this.editor.addToHistory(line)
    }
    this.transcriptScroll = new ScrollView(view, { follow: 'end', primary: true, overscroll: 'chain' })

    this.layoutRoot = new VStack([
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
    ])
    this.tui.setLayoutRoot(this.layoutRoot)
    // Registered first, so the foreground dispatch runs ahead of every later
    // onKey listener (the runner's registry) and of focused components. The
    // listener lives as long as the presenter, like the runner's registry.
    this.onKey((data) => {
      if (this.foreground === undefined) return false
      // An interaction modal (approval/question) mounted above the ledger owns
      // its keys through the focused SelectList/Input; the ledger handler
      // yields to it. The detail overlay is the one overlay that needs the
      // foreground (tab switching), so it stays active.
      if (this.overlay !== undefined && !this.detailOverlayActive) return false
      return this.foreground(data)
    })
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
    // Bottom-anchored, opaque dialogs: interaction modals rise from the
    // bottom edge like the Web surface's ask panel, capped at 70% of the
    // terminal so a long option list cannot swallow the screen.
    const handle = this.tui.showOverlay(component, {
      anchor: 'bottom-center',
      margin: 1,
      maxHeight: '70%',
    })
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
   * Install one foreground key handler and return its disposer. The handler
   * runs ahead of the runner's registry and the focused component (see the
   * constructor's `offForeground` seam); the disposer restores the handler
   * that was active before, so the detail overlay stacks over the ledger.
   */
  private pushForeground(handler: (data: string) => boolean): () => void {
    const previous = this.foreground
    this.foreground = handler
    return () => { this.foreground = previous }
  }

  /** Rebuild the layout root with the given primary scroll viewport. */
  private rebuildLayout(scroll: ScrollView): void {
    this.tui.setLayoutRoot(new VStack([
      { component: scroll, basis: 0, grow: 1, minSize: 1 },
      { component: this.statusRow, basis: 'auto', shrink: 1, minSize: 1 },
      { component: this.metaRow, basis: 'auto', shrink: 1, minSize: 1 },
      { component: this.editor, basis: 'auto', shrink: 1, minSize: 1 },
    ]))
  }

  /** True while the ledger view replaces the transcript viewport. */
  get ledgerOpen(): boolean {
    return this.ledgerOpenState
  }

  /**
   * Open the ledger view over the transcript (or close it when already open).
   * While the ledger is open, ↑/↓ move the focus, Enter opens the focused
   * cell's detail overlay, and Esc returns to the transcript and editor.
   * @param cells - the (filtered) ledger cells, re-read before every render.
   * @param filter - the active kind filter label, when one is applied.
   */
  openLedger(cells: () => readonly TrajectoryCellProps[], filter: () => string | undefined): void {
    if (this.ledgerOpenState) {
      this.closeLedger()
      return
    }
    this.ledgerCells = cells
    this.ledgerFilter = filter
    this.ledgerFocus = 0
    this.detailTabIndex = 0
    const view = new LedgerView(() => {
      const filter = this.ledgerFilter()
      return {
        cells: this.ledgerCells(),
        focus: this.ledgerFocus,
        ...(filter === undefined ? {} : { filter }),
      }
    }, this.theme)
    this.ledgerScrollRef = new ScrollView(view)
    this.rebuildLayout(this.ledgerScrollRef)
    this.ledgerOpenState = true
    // The ledger owns the keys; the editor must not see typing or submit.
    this.tui.setFocus(null)
    this.offLedgerForeground = this.pushForeground((data) => {
      switch (data) {
        case '\x1b[A':
          this.moveLedgerFocus(-1)
          break
        case '\x1b[B':
          this.moveLedgerFocus(1)
          break
        case '\r':
        case '\n':
          this.openLedgerDetail()
          break
        case '\x1b':
          this.closeLedger()
          break
        default:
          return false
      }
      return true
    })
    this.tui.requestRender()
  }

  /** Close the ledger and restore the transcript viewport and editor focus. */
  closeLedger(): void {
    if (!this.ledgerOpenState) return
    this.offLedgerForeground?.()
    this.offLedgerForeground = undefined
    this.ledgerScrollRef = undefined
    this.ledgerOpenState = false
    this.rebuildLayout(this.transcriptScroll)
    this.tui.setFocus(this.editor)
    this.tui.requestRender()
  }

  /** Move the ledger focus by a signed delta, keeping it in bounds and visible. */
  private moveLedgerFocus(delta: number): void {
    const count = this.ledgerCells().length
    if (count === 0) return
    this.ledgerFocus = Math.min(count - 1, Math.max(0, this.ledgerFocus + delta))
    this.ledgerScrollRef?.scrollTo(this.ledgerFocus)
    this.tui.requestRender()
  }

  /** Open the focused cell's detail overlay, when a row is focused. */
  private openLedgerDetail(): void {
    const cell = this.ledgerCells()[this.ledgerFocus]
    if (cell === undefined) return
    this.showDetail(cell)
  }

  /**
   * Show one ledger cell's detail overlay: a title, a horizontal tab row
   * (from the shared model's {@link detailTabsFor}), and the active tab's
   * capped body. ←/→ (or Tab/Shift+Tab) switch tabs; Esc or Enter closes.
   * The overlay's keys run through the foreground seam, ahead of the
   * registry's Esc/Ctrl+C handling and of the editor, so closing and tabbing
   * never leak into the quit machine or the draft.
   */
  showDetail(cell: TrajectoryCellProps): void {
    if (this.overlay !== undefined) return
    const tabs = detailTabsFor(cell)
    this.detailTabIndex = 0
    const tabRow = new Text('', 0, 0)
    const body = new Text('', 0, 0)
    const dialog = new DialogBox(
      this.theme,
      () => `${KIND_LABEL[cell.kind]} #${cell.index} · ${formatElapsedSeconds(cell.timeSeconds)}`,
      [tabRow, new Text('', 0, 0), body],
      () => '←/→ switch tab · esc close',
    )
    const close = this.mountOverlay(dialog)
    const render = (): void => {
      tabRow.setText(this.tabLine(tabs))
      const tabId = tabs[Math.min(this.detailTabIndex, Math.max(0, tabs.length - 1))]?.id
      // detailTabsFor never emits the Web-only 'options'/'usage' tabs; the
      // 'overview' fallback is always in its output.
      body.setText(cappedLines(detailBody(cell, (tabId ?? 'overview') as RenderedDetailTab)).join('\n'))
    }
    render()
    this.detailOverlayActive = true
    const offForeground = this.pushForeground((data) => {
      if (data === '\x1b' || data === '\r' || data === '\n') {
        offForeground()
        close()
        this.detailOverlayActive = false
        // mountOverlay restores editor focus; the ledger wants to keep the
        // key ownership until it closes too.
        if (this.ledgerOpenState) this.tui.setFocus(null)
        return true
      }
      if (data === '\x1b[C' || data === '\t') {
        this.detailTabIndex = (this.detailTabIndex + 1) % tabs.length
        render()
        this.tui.requestRender()
        return true
      }
      if (data === '\x1b[D' || data === '\x1b[Z') {
        this.detailTabIndex = (this.detailTabIndex - 1 + tabs.length) % tabs.length
        render()
        this.tui.requestRender()
        return true
      }
      return false
    })
  }

  /** One horizontal tab row; the active tab is marked and accented. */
  private tabLine(tabs: readonly DetailTabItem[]): string {
    return tabs.map((tab, index) => index === this.detailTabIndex
      ? this.theme.fg('accent', `▸${tab.label}`)
      : this.theme.fg('dim', tab.label)).join('  ')
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
    const list = new SelectList(items, 5, this.theme.editor.selectList)
    const dialog = new DialogBox(
      this.theme,
      () => title,
      [
        ...(detail !== undefined && detail !== '' ? [new Text(sanitizeText(detail), 0, 0)] : []),
        list,
      ],
      () => '↑/↓ choose · enter confirm · esc cancel',
    )
    const close = this.mountOverlay(dialog, list)
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
    const dialog = new DialogBox(
      this.theme,
      () => title,
      [
        ...(detail !== undefined && detail !== '' ? [new Text(sanitizeText(detail), 0, 0)] : []),
        input,
      ],
      () => 'enter submit · esc cancel',
    )
    const close = this.mountOverlay(dialog, input)
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
    const dialog = new DialogBox(
      this.theme,
      () => 'Keys',
      entries.map(entry => new Text(`  ${entry.key.padEnd(20)} ${entry.description}`, 0, 0)),
      () => 'esc / enter to close',
    )
    const close = this.mountOverlay(dialog)
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
