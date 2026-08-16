/**
 * Behavioral tests for the semantic (themed) transcript render path: user
 * messages on a background box, assistant Markdown rendering with streamed
 * updates, tool cards with state backgrounds, turn dimming, and width-aware
 * output that survives CJK text without tearing ANSI sequences.
 */

import { describe, expect, it } from 'vitest'
import { Transcript } from '../src/transcript.ts'
import { TranscriptView } from '../src/transcript-view.ts'
import { darkTheme } from '../src/theme.ts'
import { visibleWidth } from '@earendil-works/pi-tui'

/** Build one event; surface events pass `surfaceOp: 'append'` explicitly. */
function ev<T extends { type: string }>(
  type: T['type'],
  data: Record<string, unknown>,
  seq: number,
  extra: Record<string, unknown> = {},
): never {
  return { type, seq, time: seq * 1000, data, ...extra } as never
}

function foldUser(transcript: Transcript, text: string, seq: number): void {
  transcript.fold(ev('user/message', {
    id: `u${seq}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }, seq, { surfaceOp: 'append' }))
}

function foldAssistant(transcript: Transcript, text: string, seq: number): void {
  transcript.fold(ev('assistant/message', {
    turn: 1,
    step: seq,
    message: {
      id: `a${seq}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
    },
  }, seq, { surfaceOp: 'append' }))
}

function foldTool(
  transcript: Transcript, seq: number, name: string, args: string,
  result?: { error?: { name: string; code: string } },
): void {
  transcript.fold(ev('tool/call', { callId: `c${seq}`, turn: 1, step: seq, name, arguments: args }, seq, { surfaceOp: 'append' }))
  if (result !== undefined) {
    transcript.fold(ev('tool/result', {
      turn: 1,
      step: seq,
      message: {
        content: [{
          type: 'tool',
          toolCallId: `c${seq}`,
          content: result.error === undefined
            ? [{ type: 'text', text: 'ok' }]
            : [{ type: 'text', text: `error: ${result.error.name}` }],
        }],
      },
      ...(result.error !== undefined ? { error: result.error } : {}),
    }, seq + 100, { surfaceOp: 'append' }))
  }
}

function themedLines(events: (t: Transcript) => void, width = 80): string[] {
  const transcript = new Transcript()
  events(transcript)
  return new TranscriptView(transcript, darkTheme).render(width)
}

describe('TranscriptView themed path', () => {
  it('renders a user message on the user background box', () => {
    const lines = themedLines(t => foldUser(t, 'hello', 2))
    expect(lines.join('\n')).toContain('\x1b[48;5;237m')
    expect(lines.join('\n')).toContain('hello')
  })

  it('renders assistant Markdown bold and code', () => {
    const lines = themedLines(t => foldAssistant(t, '**done** and `code`', 2))
    const joined = lines.join('\n')
    expect(joined).toContain('\x1b[1m')
    expect(joined).toContain('done')
    expect(joined).toContain('code')
  })

  it('updates a streaming assistant item via setText', () => {
    const transcript = new Transcript()
    transcript.fold(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'part one' } }, 1))
    const view = new TranscriptView(transcript, darkTheme)
    const first = view.render(80).join('\n')
    expect(first).toContain('part one')
    // The assembled message finalizes the same mutable item; the view must
    // re-render the new text without rebuilding the item cache.
    transcript.fold(ev('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'final text' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
    }, 2, { surfaceOp: 'append' }))
    const second = view.render(80).join('\n')
    expect(second).toContain('final text')
    expect(second).not.toContain('part one')
  })

  it('colors tool cards by state: pending, success, error', () => {
    const pending = themedLines(t => foldTool(t, 2, 'fs.read', '{"path":"a"}'))
    expect(pending.join('\n')).toContain('\x1b[48;5;236m')
    expect(pending.join('\n')).toContain('fs.read')

    const success = themedLines(t => foldTool(t, 2, 'fs.read', '{"path":"a"}', {}))
    expect(success.join('\n')).toContain('\x1b[48;5;235m')
    expect(success.join('\n')).toContain('ok')

    const error = themedLines(t => foldTool(t, 2, 'fs.read', '{"path":"a"}', { error: { name: 'ENOENT', code: 'ENOENT' } }))
    expect(error.join('\n')).toContain('\x1b[48;5;52m')
    expect(error.join('\n')).toContain('ENOENT')
  })

  it('dims turn brackets', () => {
    const lines = themedLines(t => t.fold(ev('turn/start', { turn: 1 }, 1)))
    expect(lines.join('\n')).toContain('\x1b[38;5;240m')
    expect(lines.join('\n')).toContain('-- turn 1 --')
  })

  it('keeps rendered lines within the viewport width, including CJK', () => {
    const longCjk = '中文测试'.repeat(30)
    const lines = themedLines(t => foldUser(t, longCjk, 2), 40)
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40)
    }
    expect(lines.length).toBeGreaterThan(1)
  })

  it('updates a tool card when its result arrives after the first render', () => {
    const transcript = new Transcript()
    transcript.fold(ev('tool/call', { callId: 'c1', turn: 1, step: 1, name: 'fs.read', arguments: '{"path":"a"}' }, 1, { surfaceOp: 'append' }))
    const view = new TranscriptView(transcript, darkTheme)
    const pending = view.render(80).join('\n')
    expect(pending).toContain('\x1b[48;5;236m') // toolPendingBg
    transcript.fold(ev('tool/result', {
      turn: 1,
      step: 1,
      message: {
        content: [{ type: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
      },
    }, 2, { surfaceOp: 'append' }))
    const settled = view.render(80).join('\n')
    expect(settled).toContain('\x1b[48;5;235m') // toolSuccessBg
    expect(settled).toContain('ok')
  })

  it('renders tool diffs with add/remove/hunk colors', () => {
    const transcript = new Transcript()
    transcript.fold(ev('tool/call', { callId: 'c1', turn: 1, step: 1, name: 'fs.write', arguments: '{}' }, 1, { surfaceOp: 'append' }))
    transcript.fold(ev('tool/result', {
      turn: 1,
      step: 1,
      message: {
        content: [{ type: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
      },
      meta: { diffs: [{ path: 'a.ts', oldText: 'old line', newText: 'new line\nkeep' }] },
    }, 2, { surfaceOp: 'append' }))
    const view = new TranscriptView(transcript, darkTheme)
    const joined = view.render(80).join('\n')
    expect(joined).toContain(darkTheme.fg('diffHunk', '--- a.ts'))
    expect(joined).toContain(darkTheme.fg('diffAdded', '+ new line'))
    expect(joined).toContain(darkTheme.fg('diffRemoved', '- old line'))
    expect(joined).toContain(darkTheme.fg('diffAdded', '+ keep'))
  })

  it('interleaves diff edits in unified order', () => {
    const transcript = new Transcript()
    transcript.fold(ev('tool/call', { callId: 'c1', turn: 1, step: 1, name: 'fs.write', arguments: '{}' }, 1, { surfaceOp: 'append' }))
    transcript.fold(ev('tool/result', {
      turn: 1,
      step: 1,
      message: {
        content: [{ type: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
      },
      meta: { diffs: [{ path: 'a.ts', oldText: 'a\nb\nc', newText: 'a\nx\nc' }] },
    }, 2, { surfaceOp: 'append' }))
    const joined = new TranscriptView(transcript, darkTheme).render(80).join('\n')
    const ctxA = joined.indexOf(darkTheme.fg('diffContext', '  a'))
    const delB = joined.indexOf(darkTheme.fg('diffRemoved', '- b'))
    const addX = joined.indexOf(darkTheme.fg('diffAdded', '+ x'))
    const ctxC = joined.indexOf(darkTheme.fg('diffContext', '  c'))
    expect(ctxA).toBeGreaterThan(-1)
    expect(delB).toBeGreaterThan(-1)
    expect(addX).toBeGreaterThan(-1)
    expect(ctxC).toBeGreaterThan(-1)
    // Unified order: a, -b, +x, c.
    expect(ctxA).toBeLessThan(delB)
    expect(delB).toBeLessThan(addX)
    expect(addX).toBeLessThan(ctxC)
  })

  it('keeps the user background across inline markdown resets', () => {
    const lines = themedLines(t => foldUser(t, '**bold** and `code`', 2))
    const joined = lines.join('\n')
    // Every inline reset re-applies the user background.
    expect(joined).toContain('\x1b[0m\x1b[48;5;237m')
    expect(joined).toContain('\x1b[1mbold')
  })

  it('sanitizes control characters before Markdown rendering', () => {
    const lines = themedLines(t => foldAssistant(t, 'line\x1b[31mred\x07', 2))
    const joined = lines.join('\n')
    expect(joined).toContain('\\x1b')
    expect(joined).not.toContain('\x1b[31mred')
  })
})
