/**
 * Behavioral tests for the keybinding registry and the presenter help
 * overlay: dispatch order, handler consumption, and help listing.
 */

import { describe, expect, it } from 'vitest'
import { KeybindingRegistry } from '../src/keybindings.ts'
import { TuiPresenter } from '../src/presenter.ts'
import { Transcript } from '../src/transcript.ts'
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

describe('KeybindingRegistry', () => {
  it('dispatches to the last registered binding for a key', () => {
    const registry = new KeybindingRegistry()
    const order: string[] = []
    registry.register({ key: 'a', description: 'first', handler: () => { order.push('first') } })
    registry.register({ key: 'a', description: 'second', handler: () => { order.push('second') } })
    expect(registry.dispatch('a')).toBe(true)
    expect(order).toEqual(['second'])
  })

  it('returns false when no binding matches', () => {
    const registry = new KeybindingRegistry()
    expect(registry.dispatch('x')).toBe(false)
  })

  it('lets a handler opt out by returning false', () => {
    const registry = new KeybindingRegistry()
    let second = 0
    registry.register({ key: 'k', description: 'opt-out', handler: () => false })
    registry.register({ key: 'k', description: 'fallback', handler: () => { second += 1 } })
    expect(registry.dispatch('k')).toBe(true)
    expect(second).toBe(1)
  })

  it('contains a throwing handler and still consumes the key', () => {
    const registry = new KeybindingRegistry()
    registry.register({ key: 'x', description: 'boom', handler: () => { throw new Error('boom') } })
    expect(() => registry.dispatch('x')).not.toThrow()
    expect(registry.dispatch('x')).toBe(true)
  })

  it('lists bindings in registration order for help', () => {
    const registry = new KeybindingRegistry()
    registry.register({ key: 'a', description: 'one', handler: () => {} })
    registry.register({ key: 'b', description: 'two', handler: () => {} })
    expect(registry.list().map(binding => binding.description)).toEqual(['one', 'two'])
  })
})

describe('TuiPresenter status transient', () => {
  it('renders the transient segment right-aligned and truncated-left', () => {
    const presenter = new TuiPresenter(new FakeTerminal(), new Transcript(), {
      onSubmit: () => {},
      statusLine: () => 'model | tokens 1+1',
      transient: () => '⠋ running',
    })
    const line = (presenter as unknown as { renderStatus(width: number): string }).renderStatus(40)
    expect(line).toContain('⠋ running')
    expect(line).toContain(darkTheme.fg('accent', '⠋ running'))
  })

  it('shows no transient when the callback returns empty', () => {
    const presenter = new TuiPresenter(new FakeTerminal(), new Transcript(), {
      onSubmit: () => {},
      statusLine: () => 'x',
      transient: () => '',
    })
    const line = (presenter as unknown as { renderStatus(width: number): string }).renderStatus(40)
    expect(line).toBe(darkTheme.fg('dim', 'x'))
  })

  it('keeps the transient right segment when left text is short', () => {
    const presenter = new TuiPresenter(new FakeTerminal(), new Transcript(), {
      onSubmit: () => {},
      statusLine: () => 'x',
      transient: () => 'running',
    })
    const line = (presenter as unknown as { renderStatus(width: number): string }).renderStatus(60)
    expect(line).toContain('running')
    expect(line).toContain(darkTheme.fg('dim', 'x'))
  })
})

describe('TuiPresenter help overlay', () => {
  it('opens on request and closes on Escape', () => {
    const terminal = new FakeTerminal()
    const presenter = new TuiPresenter(terminal, new Transcript(), { onSubmit: () => {}, statusLine: () => '' })
    presenter.start()
    presenter.showHelp([{ key: '?', description: 'help' }])
    expect(presenter.interactionPending).toBe(true)
    terminal.send('\x1b')
    // The escape listener closes the overlay asynchronously (offKey runs
    // before close resolves the mount); allow a microtask.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(presenter.interactionPending).toBe(false)
        resolve()
      }, 10)
    })
  })
})
