/**
 * The pi-tui-backed terminal presenter: alternate-screen TUI whose layout is
 * a scrollable {@link TranscriptView}, a dynamic status row, and the input
 * editor. The presenter owns the terminal lifecycle (raw mode, alternate
 * screen, restore on stop) through pi-tui's {@link Terminal}; the runner
 * drives it: submit lines via the editor, feed session events through the
 * {@link Transcript}, and handle raw keys through the TUI input listener.
 *
 * @module @deepseek-ai/dsh-tui-renderer
 */

import {
  Box,
  Editor,
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
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type { Transcript } from './transcript.ts'
import { StatusRow, TranscriptView } from './transcript-view.ts'

/** The production terminal: real process stdin/stdout streams. */
export function processTerminal(): Terminal {
  return new ProcessTerminal()
}

/** Editor theme with identity styling; colors land with the theme milestone. */
const EDITOR_THEME = {
  borderColor: (text: string) => text,
  selectList: {
    selectedPrefix: (text: string) => text,
    selectedText: (text: string) => text,
    description: (text: string) => text,
    scrollInfo: (text: string) => text,
    noMatch: (text: string) => text,
  },
} as const

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
 * {@link TuiPresenter.stop} restores the terminal synchronously. Approval
 * prompts mount as an overlay modal that steals focus to a {@link SelectList};
 * while one is pending, the runner's Ctrl+C listener must let the modal's
 * cancel binding (Escape/Ctrl+C) resolve it instead of driving the quit
 * machine.
 */
export class TuiPresenter {
  readonly tui: ViewportTUI
  /** The input editor — the pi-tui seam later interaction milestones mount on. */
  readonly editor: Editor
  private started = false
  /** The live approval modal, when one is asking. */
  private approvalModal:
    | { handle: OverlayHandle; resolve: (outcome: ApprovalOutcome) => void }
    | undefined

  constructor(terminal: Terminal, transcript: Transcript, options: PresenterOptions) {
    this.tui = new TuiAltScreen(terminal)
    if (!isViewportTUI(this.tui)) {
      throw new Error('tui-renderer: the presenter requires a viewport TUI')
    }
    const view = new TranscriptView(transcript)
    const status = new StatusRow(options.statusLine)
    this.editor = new Editor(this.tui, EDITOR_THEME)
    this.editor.onSubmit = (line) => {
      options.onSubmit(line)
      this.editor.addToHistory(line)
    }

    this.tui.setLayoutRoot(new VStack([
      {
        component: new ScrollView(view, { follow: 'end', primary: true, overscroll: 'chain' }),
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

  /** True while an approval modal is asking. */
  get approvalPending(): boolean {
    return this.approvalModal !== undefined
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
    const items: SelectItem[] = [
      { value: 'allowed-once', label: `Allow ${toolName}` },
      { value: 'rejected', label: 'Reject' },
    ]
    const card = new Box(1, 1)
    card.addChild(new Text(`Approve tool call: ${toolName}`, 0, 0))
    if (reason !== undefined && reason !== '') card.addChild(new Text(reason, 0, 0))
    card.addChild(new Text('', 0, 0))
    const list = new SelectList(items, 5, EDITOR_THEME.selectList)
    card.addChild(list)

    return await new Promise<ApprovalOutcome>((resolve) => {
      const handle = this.tui.showOverlay(card)
      const finish = (outcome: ApprovalOutcome): void => {
        if (this.approvalModal === undefined) return
        this.approvalModal = undefined
        handle.hide()
        this.tui.setFocus(this.editor)
        this.tui.requestRender()
        resolve(outcome)
      }
      this.approvalModal = { handle, resolve: finish }
      list.onSelect = (item) => { finish(item.value as ApprovalOutcome) }
      list.onCancel = () => { finish('cancelled') }
      this.tui.setFocus(list)
      this.tui.requestRender()
    })
  }

  /** Replace the editor content (e.g. clear input on Ctrl+C). */
  setInput(text: string): void {
    this.editor.setText(text)
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
