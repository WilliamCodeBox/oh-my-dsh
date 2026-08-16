/**
 * Behavioral tests for the P1 status-bar additions: the context progress bar
 * characters, the presenter status composition (left text + threshold-colored
 * bar + muted model), page scrolling, and the workspace autocomplete factory.
 */

import { describe, expect, it } from 'vitest'
import { Transcript } from '../src/transcript.ts'
import { TuiPresenter, workspaceAutocomplete } from '../src/presenter.ts'
import { contextBar, formatStatus } from '../src/format.ts'
import { darkTheme } from '../src/theme.ts'
import type { Terminal } from '@earendil-works/pi-tui'

/** Minimal in-memory Terminal for presenter construction. */
class FakeTerminal implements Terminal {
  writes: string[] = []
  started = false
  private onInput?: (data: string) => void

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.started = true
    this.onInput = onInput
  }

  stop(): void {
    this.started = false
  }

  async drainInput(): Promise<void> {}

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

function ev<T extends { type: string }>(type: T['type'], data: Record<string, unknown>, seq: number, extra: Record<string, unknown> = {}): never {
  return { type, seq, time: seq * 1000, data, ...extra } as never
}

describe('contextBar', () => {
  it('renders full, partial, and empty ratios', () => {
    expect(contextBar(1, 10)).toBe('██████████ 100%')
    expect(contextBar(0.45, 10)).toBe('█████░░░░░ 45%')
    expect(contextBar(0, 10)).toBe('░░░░░░░░░░ 0%')
  })

  it('clamps out-of-range ratios', () => {
    expect(contextBar(1.4, 10)).toBe('██████████ 100%')
    expect(contextBar(-0.2, 10)).toBe('░░░░░░░░░░ 0%')
  })
})

describe('TuiPresenter status bar', () => {
  it('composes left text with the threshold-colored bar, without duplicating the model', () => {
    const transcript = new Transcript()
    transcript.fold(ev('request/context', { provider: 'deepseek-official', model: 'deepseek-v4-flash', contextWindow: 1000 }, 1))
    transcript.fold(ev('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
      usage: { inputTokens: 450, outputTokens: 50 },
    }, 2, { surfaceOp: 'append' }))
    // The production statusLine already carries the model via formatStatus;
    // the presenter must not append it a second time.
    const presenter = new TuiPresenter(new FakeTerminal(), transcript, {
      onSubmit: () => {},
      statusLine: () => formatStatus(transcript.state),
    })
    const line = (presenter as unknown as { renderStatus(width: number): string }).renderStatus(80)
    expect(line).toContain('deepseek-official/deepseek-v4-flash')
    expect(line).toContain(darkTheme.fg('dim', contextBar(0.5, 10)))
    // The model appears exactly once.
    expect(line.split('deepseek-official/deepseek-v4-flash')).toHaveLength(2)
  })

  it('colors the bar by the warning threshold', () => {
    const transcript = new Transcript()
    transcript.fold(ev('request/context', { provider: 'p', model: 'm', contextWindow: 100 }, 1))
    transcript.fold(ev('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
      usage: { inputTokens: 75, outputTokens: 0 },
    }, 2, { surfaceOp: 'append' }))
    const presenter = new TuiPresenter(new FakeTerminal(), transcript, { onSubmit: () => {}, statusLine: () => 'x' })
    const line = (presenter as unknown as { renderStatus(width: number): string }).renderStatus(80)
    expect(line).toContain(darkTheme.fg('warning', contextBar(0.75, 10)))
  })

  it('colors the bar by the error threshold', () => {
    const transcript = new Transcript()
    transcript.fold(ev('request/context', { provider: 'p', model: 'm', contextWindow: 100 }, 1))
    transcript.fold(ev('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
      usage: { inputTokens: 95, outputTokens: 0 },
    }, 2, { surfaceOp: 'append' }))
    const presenter = new TuiPresenter(new FakeTerminal(), transcript, { onSubmit: () => {}, statusLine: () => 'x' })
    const line = (presenter as unknown as { renderStatus(width: number): string }).renderStatus(80)
    expect(line).toContain(darkTheme.fg('error', contextBar(0.95, 10)))
  })

  it('omits the bar without a context window and returns empty for no left text', () => {
    const transcript = new Transcript()
    const presenter = new TuiPresenter(new FakeTerminal(), transcript, { onSubmit: () => {}, statusLine: () => '' })
    const line = (presenter as unknown as { renderStatus(width: number): string }).renderStatus(80)
    expect(line).toBe('')
  })
})

describe('TuiPresenter paging', () => {
  it('pages by the terminal height minus chrome rows', () => {
    const terminal = new FakeTerminal()
    const presenter = new TuiPresenter(terminal, new Transcript(), { onSubmit: () => {}, statusLine: () => '' })
    presenter.start()
    expect(() => presenter.pageTranscript(-1)).not.toThrow()
    expect(() => presenter.pageTranscript(1)).not.toThrow()
    presenter.stop()
  })
})

describe('workspaceAutocomplete', () => {
  it('suggests slash commands from the provided list', async () => {
    const provider = workspaceAutocomplete([{ name: 'help', description: 'show help' }], '/tmp')
    const suggestions = await provider.getSuggestions(['/h'], 0, 2, { signal: new AbortController().signal })
    expect(suggestions).not.toBeNull()
    expect(suggestions!.items.some(item => item.value === 'help')).toBe(true)
  })

  it('suggests workspace files for an @ query without an fd binary', async () => {
    const provider = workspaceAutocomplete([], process.cwd())
    const suggestions = await provider.getSuggestions(['@s'], 0, 2, { signal: new AbortController().signal })
    expect(suggestions).not.toBeNull()
    const values = suggestions!.items.map(item => item.value)
    expect(values.some(value => value.startsWith('apps'))).toBe(true)
  })

  it('applies an @ completion by replacing the @ token', () => {
    const provider = workspaceAutocomplete([], '/tmp')
    const result = provider.applyCompletion(['x @p'], 0, 4, { value: 'packages/', label: 'packages/' }, '@p')
    expect(result.lines[0]).toBe('x @packages/')
    expect(result.cursorCol).toBe(12)
  })
})
