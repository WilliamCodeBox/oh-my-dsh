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
  Editor,
  ProcessTerminal,
  ScrollView,
  TuiAltScreen,
  VStack,
  isViewportTUI,
  type Terminal,
  type ViewportTUI,
} from '@earendil-works/pi-tui'
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
 * {@link TuiPresenter.stop} restores the terminal synchronously.
 */
export class TuiPresenter {
  readonly tui: ViewportTUI
  /** The input editor — the pi-tui seam later interaction milestones mount on. */
  readonly editor: Editor

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
  }

  /** Restore the terminal; safe to call once. */
  stop(): void {
    this.tui.stop()
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
