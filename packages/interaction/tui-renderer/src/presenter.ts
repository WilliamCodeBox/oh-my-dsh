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
import { StatusRow, TranscriptView } from './transcript-view.ts'
import { darkTheme, type SemanticTheme } from './theme.ts'

/** The production terminal: real process stdin/stdout streams. */
export function processTerminal(): Terminal {
  return new ProcessTerminal()
}

/** Presenter callbacks the runner supplies. */
export interface PresenterOptions {
  /** Called with each editor-submitted input line. */
  onSubmit: (line: string) => void
  /** Status row text, re-read before each render. */
  statusLine: () => string
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

  constructor(
    terminal: Terminal,
    transcript: Transcript,
    options: PresenterOptions,
    private readonly theme: SemanticTheme = darkTheme,
  ) {
    this.tui = new TuiAltScreen(terminal)
    if (!isViewportTUI(this.tui)) {
      throw new Error('tui-renderer: the presenter requires a viewport TUI')
    }
    const view = new TranscriptView(transcript, this.theme)
    const status = new StatusRow(options.statusLine, text => this.theme.fg('dim', text))
    this.editor = new Editor(this.tui, this.theme.editor)
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
   * its close callback. Closing restores editor focus, hides the overlay,
   * and clears the slot; the caller resolves its pending promise.
   */
  private mountOverlay(component: Component): () => void {
    const handle = this.tui.showOverlay(component)
    this.overlay = { handle }
    return () => {
      if (this.overlay === undefined) return
      this.overlay = undefined
      handle.hide()
      this.tui.setFocus(this.editor)
      this.tui.requestRender()
    }
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
    card.addChild(new Text(title, 0, 0))
    if (detail !== undefined && detail !== '') card.addChild(new Text(detail, 0, 0))
    card.addChild(new Text('', 0, 0))
    const list = new SelectList(items, 5, this.theme.editor.selectList)
    card.addChild(list)
    const close = this.mountOverlay(card)
    list.onSelect = (item) => { close(); resolve(item.value) }
    list.onCancel = () => { close(); resolve(undefined) }
    this.tui.setFocus(list)
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
    card.addChild(new Text(title, 0, 0))
    if (detail !== undefined && detail !== '') card.addChild(new Text(detail, 0, 0))
    card.addChild(input)
    const close = this.mountOverlay(card)
    input.onSubmit = (value) => { close(); resolve(value) }
    input.onEscape = () => { close(); resolve(undefined) }
    this.tui.setFocus(input)
    this.tui.requestRender()
    return promise
  }

  /** Replace the editor content (e.g. clear input on Ctrl+C). */
  setInput(text: string): void {
    this.editor.setText(text)
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
