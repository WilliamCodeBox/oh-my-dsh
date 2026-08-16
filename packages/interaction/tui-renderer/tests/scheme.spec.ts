/**
 * Behavioral tests for terminal scheme detection: the DSR query sequence,
 * report parsing (dark/light), the OSC 11 fallback, leftover-byte re-queue,
 * and the non-TTY short circuit.
 */

import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { detectTerminalScheme } from '../src/scheme.ts'

/** Fake stdin: an EventEmitter with TTY markers and a push() recorder. */
class FakeStdin extends EventEmitter {
  isTTY = true
  pushed: string[] = []
  push(chunk: string): void {
    this.pushed.push(chunk)
  }
}

class FakeStdout {
  isTTY = true
  writes: string[] = []
  write(chunk: string): unknown {
    this.writes.push(chunk)
    return true
  }
}

describe('detectTerminalScheme', () => {
  it('queries the DSR color-scheme report (CSI ? 996 n)', async () => {
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const pending = detectTerminalScheme(stdin as never, stdout)
    expect(stdout.writes.join('')).toContain('\x1b[?996n')
    stdin.emit('data', '\x1b[?997;2n')
    await expect(pending).resolves.toBe('light')
  })

  it('parses the dark report', async () => {
    const stdin = new FakeStdin()
    const pending = detectTerminalScheme(stdin as never, new FakeStdout())
    stdin.emit('data', 'junk\x1b[?997;1nmore')
    await expect(pending).resolves.toBe('dark')
  })

  it('re-queues bytes that arrive alongside the report', async () => {
    const stdin = new FakeStdin()
    const pending = detectTerminalScheme(stdin as never, new FakeStdout())
    stdin.emit('data', '\x1b[?997;1nuser input')
    await expect(pending).resolves.toBe('dark')
    // Leftover input is pushed back onto the stream (after a microtask).
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(stdin.pushed.join('')).toBe('user input')
  })

  it('falls back to the OSC 11 background report', async () => {
    const stdin = new FakeStdin()
    const pending = detectTerminalScheme(stdin as never, new FakeStdout())
    stdin.emit('data', '\x1b]11;rgb:eeee/eeee/eeee\x1b\\')
    await expect(pending).resolves.toBe('light')
  })

  it('resolves undefined on the timeout when nothing answers', async () => {
    const stdin = new FakeStdin()
    const pending = detectTerminalScheme(stdin as never, new FakeStdout())
    await expect(pending).resolves.toBeUndefined()
  })

  it('short-circuits without TTY streams', async () => {
    const stdin = new FakeStdin()
    stdin.isTTY = false
    const stdout = new FakeStdout()
    stdout.isTTY = false
    await expect(detectTerminalScheme(stdin as never, stdout)).resolves.toBeUndefined()
    expect(stdout.writes).toHaveLength(0)
  })
})
