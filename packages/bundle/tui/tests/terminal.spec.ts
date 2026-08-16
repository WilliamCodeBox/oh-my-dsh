/** Terminal lifecycle: Ctrl+C machine and crash restore. */

import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { CtrlCController, installCrashRestore } from '../src/terminal.ts'

describe('CtrlCController', () => {
  const now = (): number => 1_000_000

  it('clears a non-empty input line on the first press', () => {
    expect(new CtrlCController(now).press(false, false)).toBe('clear-input')
  })

  it('does not arm the force-exit window from a clear-input press', () => {
    const controller = new CtrlCController(now)
    expect(controller.press(false, false)).toBe('clear-input')
    expect(controller.press(false, true)).toBe('quit')
  })

  it('cancels a running turn on the first press with an empty line', () => {
    expect(new CtrlCController(now).press(true, true)).toBe('cancel')
  })

  it('quits on the first press when idle with an empty line', () => {
    expect(new CtrlCController(now).press(false, true)).toBe('quit')
  })

  it('force-exits on a second press inside the window', () => {
    const controller = new CtrlCController(now)
    expect(controller.press(true, true)).toBe('cancel')
    expect(controller.press(true, true)).toBe('hard-exit')
  })

  it('treats a press outside the window as a fresh first press', () => {
    let t = 0
    const controller = new CtrlCController(() => t)
    expect(controller.press(true, true)).toBe('cancel')
    t = 2_001
    expect(controller.press(true, true)).toBe('cancel')
  })
})

describe('installCrashRestore', () => {
  const emitter = new EventEmitter()
  afterEach(() => { emitter.removeAllListeners('uncaughtException') })

  it('restores the terminal and reports the crash on uncaughtException', () => {
    const restored: string[] = []
    const crashed: number[] = []
    const dispose = installCrashRestore(
      () => { restored.push('restore') },
      (code) => { crashed.push(code) },
      emitter,
    )
    emitter.emit('uncaughtException', new Error('boom'))
    expect(restored).toEqual(['restore'])
    expect(crashed).toEqual([1])
    dispose()
    expect(emitter.listenerCount('uncaughtException')).toBe(0)
  })

  it('defaults the emitter to process', () => {
    const restore = (): void => {}
    const crash = (): void => {}
    const baseline = process.listenerCount('uncaughtException')
    const dispose = installCrashRestore(restore, crash)
    expect(process.listenerCount('uncaughtException')).toBe(baseline + 1)
    dispose()
    expect(process.listenerCount('uncaughtException')).toBe(baseline)
  })
})
