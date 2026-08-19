/**
 * Behavioral tests for the pi-tui presenter: terminal lifecycle, transcript
 * rendering into the alternate screen, editor submit wiring, input clearing,
 * and raw-key listener consumption. A fake Terminal substitutes the real
 * process streams so tests run without a TTY.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@earendil-works/pi-tui'
import { TuiAltScreen } from '@earendil-works/pi-tui'
import { Transcript } from '../src/transcript.ts'
import { TuiPresenter } from '../src/presenter.ts'
import { DialogBox } from '../src/overlay-box.ts'
import { TranscriptView } from '../src/transcript-view.ts'
import type { TrajectoryCellProps } from '@williamcodebox/omd-client-trajectory-model'

/** In-memory Terminal capturing writes, lifecycle calls, and the input callback. */
class FakeTerminal implements Terminal {
  writes: string[] = []
  started = false
  stopped = false
  private onInput?: (data: string) => void

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.onInput = onInput
    this.started = true
  }

  stop(): void {
    this.stopped = true
  }

  async drainInput(): Promise<void> {}

  /** Deliver raw key data as the terminal would. */
  send(data: string): void {
    this.onInput?.(data)
  }

  write(data: string): void {
    this.writes.push(data)
  }

  get columns(): number {
    return 80
  }

  get rows(): number {
    return 24
  }

  get kittyProtocolActive(): boolean {
    return false
  }

  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}
}

function transcriptWith(events: object[]): Transcript {
  const transcript = new Transcript()
  for (const event of events) {
    transcript.fold(event as never)
  }
  return transcript
}

function makePresenter(terminal: FakeTerminal, transcript: Transcript, onSubmit: (line: string) => void = () => {}): TuiPresenter {
  return new TuiPresenter(terminal, transcript, { onSubmit, statusLine: () => '' })
}

describe('TuiPresenter', () => {
  it('submits editor lines through onSubmit', () => {
    const submitted: string[] = []
    const presenter = makePresenter(new FakeTerminal(), new Transcript(), (line) => { submitted.push(line) })
    presenter.editor.setText('hello')
    presenter.editor.onSubmit?.('hello')
    presenter.editor.onSubmit?.('again')
    expect(submitted).toEqual(['hello', 'again'])
  })

  it('clears and reads the editor input', () => {
    const presenter = makePresenter(new FakeTerminal(), new Transcript())
    presenter.setInput('work in progress')
    expect(presenter.getInput()).toBe('work in progress')
    presenter.setInput('')
    expect(presenter.getInput()).toBe('')
  })

  it('renders folded transcript items', () => {
    const transcript = transcriptWith([
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'user/message', seq: 2, time: 2000, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }, surfaceOp: 'append' },
    ])
    const lines = new TranscriptView(transcript).render(80)
    expect(lines.join('\n')).toContain('-- turn 1 --')
    expect(lines.join('\n')).toContain('> hi')
  })

  it('starts the terminal and stops it on presenter stop', () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()
    expect(terminal.started).toBe(true)
    presenter.stop()
    expect(terminal.stopped).toBe(true)
  })

  it('reflects folds in the rendered transcript', () => {
    const transcript = new Transcript()
    const presenter = makePresenter(new FakeTerminal(), transcript)
    presenter.start()
    transcript.fold({ type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } } as never)
    const lines = new TranscriptView(transcript).render(80)
    expect(lines.join('\n')).toContain('-- turn 1 --')
  })

  it('toggles injected-context expansion on the transcript view', () => {
    const presenter = makePresenter(new FakeTerminal(), new Transcript())
    expect(presenter.contextExpanded).toBe(false)
    presenter.toggleContextExpanded()
    expect(presenter.contextExpanded).toBe(true)
    presenter.toggleContextExpanded()
    expect(presenter.contextExpanded).toBe(false)
    presenter.stop()
  })

  it('consumes a raw Ctrl+C key before other listeners', () => {
    const transcript = new Transcript()
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, transcript)
    let ctrlCSeen = 0
    presenter.onKey((data) => {
      if (data === '\x03') {
        ctrlCSeen += 1
        return true
      }
      return false
    })
    let laterSawCtrlC = false
    presenter.tui.addInputListener((data) => {
      if (data === '\x03') laterSawCtrlC = true
      return undefined
    })

    presenter.start()
    terminal.send('\x03')

    expect(ctrlCSeen).toBe(1)
    expect(laterSawCtrlC).toBe(false)
  })

  it('queues a second overlay behind a live modal and closes both in order', async () => {
    const tick = (): Promise<void> => {
      const { promise, resolve } = Promise.withResolvers<undefined>()
      setTimeout(resolve, 10)
      return promise
    }
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()
    const first = presenter.askApproval('fs.write', 'one')
    await tick()
    const second = presenter.askApproval('fs.read', 'two')
    await tick()
    // The second approval waited in the queue; the first closes first.
    terminal.send('\r')
    expect(await first).toBe('allowed-once')
    await tick()
    // After the first closes, the queued modal mounts and accepts Enter.
    terminal.send('\r')
    expect(await second).toBe('allowed-once')
    presenter.stop()
  })

  it('scrolls the transcript viewport without leaving end-following when at the bottom', () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()
    // With no content the viewport cannot move; the call must be a no-op.
    expect(() => { presenter.scrollTranscript(-10) }).not.toThrow()
    expect(() => { presenter.scrollTranscript(10) }).not.toThrow()
    presenter.stop()
  })

  it('asks an approval over an overlay modal: Enter allows, arrow+Enter rejects, Escape cancels', async () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()

    const allowed = presenter.askApproval('fs.write', 'write transcript.ts')
    // The modal mounts synchronously; a macrotask lets focus settle on the list.
    const { promise: mounted, resolve } = Promise.withResolvers<undefined>()
    setTimeout(resolve, 10)
    await mounted
    expect(presenter.interactionPending).toBe(true)
    terminal.send('\r')
    expect(await allowed).toBe('allowed-once')
    expect(presenter.interactionPending).toBe(false)

    const rejected = presenter.askApproval('fs.write')
    const { promise: mountedAgain, resolve: resolveAgain } = Promise.withResolvers<undefined>()
    setTimeout(resolveAgain, 10)
    await mountedAgain
    terminal.send('\x1b[B') // down to Reject
    terminal.send('\r')
    expect(await rejected).toBe('rejected')

    const cancelled = presenter.askApproval('fs.write')
    const { promise: mountedThird, resolve: resolveThird } = Promise.withResolvers<undefined>()
    setTimeout(resolveThird, 10)
    await mountedThird
    terminal.send('\x1b') // Escape cancels
    expect(await cancelled).toBe('cancelled')
    expect(presenter.interactionPending).toBe(false)
    presenter.stop()
  })

  it('asks option questions: single select returns one label, Escape answers none', async () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()

    const pending = presenter.askQuestions([{
      id: 'q1',
      question: 'Which mode?',
      options: [{ label: 'read-only' }, { label: 'full', description: 'full access' }],
    }])
    const { promise: mounted, resolve } = Promise.withResolvers<undefined>()
    setTimeout(resolve, 10)
    await mounted
    expect(presenter.interactionPending).toBe(true)
    terminal.send('\x1b[B') // down to 'full'
    terminal.send('\r')
    expect(await pending).toEqual({ answers: [{ id: 'q1', selected: ['full'] }] })

    const cancelled = presenter.askQuestions([{ id: 'q2', question: 'Confirm?', options: [{ label: 'yes' }] }])
    const { promise: mountedAgain, resolve: resolveAgain } = Promise.withResolvers<undefined>()
    setTimeout(resolveAgain, 10)
    await mountedAgain
    terminal.send('\x1b')
    expect(await cancelled).toEqual({ answers: [{ id: 'q2', selected: [] }] })
    presenter.stop()
  })

  it('asks multi-select questions by looping the remaining options until Escape', async () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()

    const pending = presenter.askQuestions([{
      id: 'q1',
      question: 'Pick tags',
      multiSelect: true,
      options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
    }])
    const settle = async (): Promise<void> => {
      const { promise, resolve } = Promise.withResolvers<undefined>()
      setTimeout(resolve, 10)
      await promise
    }
    await settle()
    terminal.send('\r') // a
    await settle()
    // b is now the default selection of the remaining [b, c] list.
    terminal.send('\r') // b
    await settle()
    terminal.send('\x1b') // done: c never picked
    expect(await pending).toEqual({ answers: [{ id: 'q1', selected: ['a', 'b'] }] })
    presenter.stop()
  })

  it('answers option-less questions with free text; Escape cancels to no answer', async () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()

    const pending = presenter.askQuestions([{ id: 'q1', question: 'Where is the repo?' }])
    const { promise: mounted, resolve } = Promise.withResolvers<undefined>()
    setTimeout(resolve, 10)
    await mounted
    terminal.send('h')
    terminal.send('e')
    terminal.send('r')
    terminal.send('e')
    terminal.send('\r')
    expect(await pending).toEqual({ answers: [{ id: 'q1', selected: [], custom: 'here' }] })

    const cancelled = presenter.askQuestions([{ id: 'q2', question: 'Type something' }])
    const { promise: mountedAgain, resolve: resolveAgain } = Promise.withResolvers<undefined>()
    setTimeout(resolveAgain, 10)
    await mountedAgain
    terminal.send('\x1b')
    expect(await cancelled).toEqual({ answers: [{ id: 'q2', selected: [] }] })
    presenter.stop()
  })
})

describe('TuiPresenter ledger', () => {
  /** Two ledger cells: a user row and an open tool row. */
  const cells = (): TrajectoryCellProps[] => [
    {
      index: 1, kind: 'user', text: 'hello', inputDetail: 'hello',
      messageSource: { kind: 'user' }, timeSeconds: 0, startedAt: 1000,
    },
    {
      index: 2, kind: 'tool', text: 'bash {}', callId: 'c1',
      inputDetail: '{}', timeSeconds: null, startedAt: 2000,
    },
  ]

  it('opens the ledger, navigates, opens a detail overlay, switches tabs, and closes', async () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()
    presenter.openLedger(cells, () => undefined)
    expect(presenter.ledgerOpen).toBe(true)
    await vi.waitFor(() => { expect(terminal.writes.join('')).toContain('ledger · 2 records') })

    // Focus moves to the tool row; Enter opens its detail overlay.
    terminal.send('\x1b[B')
    terminal.send('\r')
    await vi.waitFor(() => { expect(presenter.interactionPending).toBe(true) })
    await vi.waitFor(() => { expect(terminal.writes.join('')).toContain('Tool #2') })

    // Tool tabs: Summary/Payload/Schema/Timing; Tab advances to Payload.
    terminal.send('\t')
    await vi.waitFor(() => { expect(terminal.writes.join('')).toContain('▸Payload') })
    terminal.send('\x1b[C')
    await vi.waitFor(() => { expect(terminal.writes.join('')).toContain('▸Schema') })

    // Esc closes the detail and returns to the still-open ledger; Esc again
    // closes the ledger and restores the editor.
    terminal.send('\x1b')
    await vi.waitFor(() => { expect(presenter.interactionPending).toBe(false) })
    expect(presenter.ledgerOpen).toBe(true)
    terminal.send('\x1b')
    expect(presenter.ledgerOpen).toBe(false)
    presenter.stop()
  })

  it('renders the active kind filter in the ledger header', async () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()
    presenter.openLedger(cells, () => 'tool')
    await vi.waitFor(() => { expect(terminal.writes.join('')).toContain('ledger · 2 records · filter tool') })
    presenter.stop()
  })

  it('keeps ledger keys ahead of a later registry listener', async () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.setInput('draft')
    // The runner registers its registry listener after construction (like
    // drivePresenter); its Esc would clear the input, so the ledger's own
    // Esc must consume first.
    presenter.onKey((data) => {
      if (data === '\x1b') {
        presenter.setInput('')
        return true
      }
      return false
    })
    presenter.start()
    presenter.openLedger(cells, () => undefined)
    terminal.send('\x1b')
    expect(presenter.ledgerOpen).toBe(false)
    expect(presenter.getInput()).toBe('draft')
    presenter.stop()
  })

  it('yields ledger keys to an interaction modal mounted above it', async () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()
    presenter.openLedger(cells, () => undefined)
    const approval = presenter.askApproval('fs.write')
    const { promise: mounted, resolve } = Promise.withResolvers<undefined>()
    setTimeout(resolve, 10)
    await mounted
    // Arrow keys move the SelectList (not the ledger focus): down + Enter
    // picks Reject, proving the modal owns the keys while it is up.
    terminal.send('\x1b[B')
    terminal.send('\r')
    expect(await approval).toBe('rejected')
    expect(presenter.ledgerOpen).toBe(true)
    presenter.stop()
  })

  it('toggles the ledger closed and ignores Enter with no rows', async () => {
    const terminal = new FakeTerminal()
    const presenter = makePresenter(terminal, new Transcript())
    presenter.start()
    presenter.openLedger(() => [], () => undefined)
    expect(presenter.ledgerOpen).toBe(true)
    terminal.send('\r')
    expect(presenter.interactionPending).toBe(false)
    // A second open call toggles it closed, like /ledger.
    presenter.openLedger(() => [], () => undefined)
    expect(presenter.ledgerOpen).toBe(false)
    presenter.stop()
  })

  it('mounts interaction overlays bottom-anchored with the dialog chrome', () => {
    const showOverlay = vi.spyOn(TuiAltScreen.prototype, 'showOverlay')
    const presenter = makePresenter(new FakeTerminal(), new Transcript())
    presenter.showHelp([{ key: 'j/k', description: 'scroll' }])
    expect(showOverlay).toHaveBeenCalledWith(
      expect.any(DialogBox),
      { anchor: 'bottom-center', margin: 1, maxHeight: '70%' },
    )
    showOverlay.mockRestore()
  })
})
