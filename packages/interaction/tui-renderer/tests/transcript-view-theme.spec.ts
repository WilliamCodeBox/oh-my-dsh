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

function foldInjectedContext(
  transcript: Transcript,
  text: string,
  seq: number,
  source: Record<string, unknown> = { kind: 'agent-instructions', form: 'instructions', changes: [{ action: 'set', scope: 'root', path: 'AGENTS.md' }] },
): void {
  transcript.fold(ev('user/message', {
    id: `u${seq}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source,
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

  it('collapses injected-context rows to one dim line by default', () => {
    const transcript = new Transcript()
    foldInjectedContext(transcript, '<system-reminder>\nlong workspace instructions\n</system-reminder>', 2)
    const lines = new TranscriptView(transcript, darkTheme).render(80)
    const joined = lines.join('\n')
    // One dim summary line with the source's file path; no body text.
    expect(joined).toContain('▸ context · AGENTS.md · ctrl+o expands')
    expect(joined).not.toContain('long workspace instructions')
    expect(joined).not.toContain('\x1b[48;5;237m')
    expect(joined).toContain('\x1b[38;5;240m') // dim token
  })

  it('expands injected-context rows when contextExpanded flips', () => {
    const transcript = new Transcript()
    foldInjectedContext(transcript, '<system-reminder>\nlong workspace instructions\n</system-reminder>', 2)
    const view = new TranscriptView(transcript, darkTheme)
    view.contextExpanded = true
    const joined = view.render(80).join('\n')
    expect(joined).toContain('long workspace instructions')
    expect(joined).toContain('\x1b[48;5;237m')
    expect(joined).not.toContain('ctrl+o expands')
  })

  it('labels the skill catalog and skill-invocation rows', () => {
    const transcript = new Transcript()
    foldInjectedContext(transcript, '<available_skills>\n- a\n</available_skills>', 2, { kind: 'skill-catalog', form: 'catalog' })
    foldInjectedContext(transcript, 'skill body', 3, { kind: 'skill-invocation', name: 'fs.read', form: 'instructions' })
    const joined = new TranscriptView(transcript, darkTheme).render(80).join('\n')
    expect(joined).toContain('▸ context · skill catalog · ctrl+o expands')
    expect(joined).toContain('▸ context · skill fs.read · ctrl+o expands')
    expect(joined).not.toContain('<available_skills>')
  })

  it('keeps direct user prompts full-width regardless of context collapse', () => {
    const transcript = new Transcript()
    foldUser(transcript, 'my prompt', 2)
    const view = new TranscriptView(transcript, darkTheme)
    expect(view.render(80).join('\n')).toContain('my prompt')
    view.contextExpanded = false
    expect(view.render(80).join('\n')).toContain('my prompt')
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
    expect(pending.join('\n')).toContain('\x1b[38;5;117m▌') // pending bar in accent
    expect(pending.join('\n')).toContain('fs.read')
    expect(pending.join('\n')).not.toContain('ok')

    const success = themedLines(t => foldTool(t, 2, 'fs.read', '{"path":"a"}', {}))
    expect(success.join('\n')).toContain('\x1b[38;5;114m▌') // success bar
    expect(success.join('\n')).toContain('✓ ok')

    const error = themedLines(t => foldTool(t, 2, 'fs.read', '{"path":"a"}', { error: { name: 'ENOENT', code: 'ENOENT' } }))
    expect(error.join('\n')).toContain('\x1b[38;5;167m▌') // error bar
    expect(error.join('\n')).toContain('✗ error ENOENT')
    expect(error.join('\n')).toContain('\x1b[38;5;167m')
  })

  it('dims turn brackets', () => {
    const lines = themedLines(t => t.fold(ev('turn/start', { turn: 1 }, 1)))
    expect(lines.join('\n')).toContain('\x1b[38;5;240m')
    expect(lines.join('\n')).toContain('-- turn 1 --')
  })

  it('separates consecutive items with one blank line', () => {
    const lines = themedLines((t) => {
      foldUser(t, 'first', 1)
      foldAssistant(t, 'second', 2)
      foldTool(t, 3, 'fs.read', '{}', {})
    })
    // Each item boundary is a blank line, not glued-together text.
    const assistantIndex = lines.findIndex(line => line.trim() === 'second')
    const toolIndex = lines.findIndex(line => line.includes('fs.read'))
    expect(assistantIndex).toBeGreaterThan(-1)
    expect(toolIndex).toBeGreaterThan(-1)
    expect(lines[assistantIndex - 1]!.trim()).toBe('')
    expect(lines[toolIndex - 1]!).toBe('')
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
    expect(pending).toContain('\x1b[38;5;117m▌') // pending bar in accent
    expect(pending).not.toContain('✓ ok')
    transcript.fold(ev('tool/result', {
      turn: 1,
      step: 1,
      message: {
        content: [{ type: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
      },
    }, 2, { surfaceOp: 'append' }))
    const settled = view.render(80).join('\n')
    expect(settled).toContain('\x1b[38;5;114m▌') // success bar
    expect(settled).toContain('✓ ok')
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

  it('degrades gracefully for oversized diffs (beyond the LCS cap)', () => {
    const transcript = new Transcript()
    transcript.fold(ev('tool/call', { callId: 'c1', turn: 1, step: 1, name: 'fs.write', arguments: '{}' }, 1, { surfaceOp: 'append' }))
    const oldText = Array.from({ length: 3000 }, (_, i) => `old${i}`).join('\n')
    const newText = Array.from({ length: 3000 }, (_, i) => `new${i}`).join('\n')
    transcript.fold(ev('tool/result', {
      turn: 1,
      step: 1,
      message: {
        content: [{ type: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
      },
      meta: { diffs: [{ path: 'big.ts', oldText, newText }] },
    }, 2, { surfaceOp: 'append' }))
    const view = new TranscriptView(transcript, darkTheme)
    // Must render without freezing: the linear fallback runs instantly.
    const joined = view.render(80).join('\n')
    expect(joined).toContain('+ new0')
    expect(joined).toContain('- old0')
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

describe('TranscriptView subagent activity', () => {
  it('renders a running subagent dimmed', () => {
    const transcript = new Transcript()
    transcript.subagentLifecycle({ kind: 'start', runId: 'r-1', provider: 'task', id: 'child-1', time: 1000 })
    const joined = new TranscriptView(transcript, darkTheme).render(80).join('\n')
    expect(joined).toContain('\x1b[38;5;240m') // dim token
    expect(joined).toContain('⟳ subagent task')
  })

  it('merges a start→done transition into a success line on re-render', () => {
    const transcript = new Transcript()
    transcript.subagentLifecycle({ kind: 'start', runId: 'r-1', provider: 'task', id: 'child-1', time: 1000 })
    const view = new TranscriptView(transcript, darkTheme)
    expect(view.render(80).join('\n')).toContain('⟳ subagent task')
    // The settled edge merges in place; the fingerprint flip must rebuild.
    transcript.subagentLifecycle({ kind: 'end', runId: 'r-1', provider: 'task', id: 'child-1', time: 5000 })
    const settled = view.render(80).join('\n')
    expect(settled).toContain('✓ subagent task')
    expect(settled).not.toContain('⟳ subagent task')
    expect(settled).toContain('\x1b[38;5;114m') // success token
  })

  it('renders a failed subagent in error color with the failure text', () => {
    const transcript = new Transcript()
    transcript.subagentLifecycle({ kind: 'start', runId: 'r-1', provider: 'task', id: 'child-1', time: 1000 })
    transcript.subagentLifecycle({ kind: 'end', runId: 'r-1', provider: 'task', id: 'child-1', time: 5000, error: 'model failure' })
    const joined = new TranscriptView(transcript, darkTheme).render(80).join('\n')
    expect(joined).toContain('✗ subagent task model failure')
    expect(joined).toContain('\x1b[38;5;167m') // error token
  })
})

describe('TranscriptView reasoning preview', () => {
  it('renders reasoning above the text, dimmed and capped with a continuation note', () => {
    const transcript = new Transcript()
    transcript.fold(ev('assistant/message', {
      turn: 1, step: 1,
      message: {
        id: 'a1', role: 'assistant',
        content: [
          { type: 'reasoning', text: Array.from({ length: 12 }, (_, i) => `think ${i + 1}`).join('\n') },
          { type: 'text', text: 'final answer' },
        ],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
    }, 2, { surfaceOp: 'append' }))
    const joined = new TranscriptView(transcript, darkTheme).render(80).join('\n')
    expect(joined).toContain('think 1')
    expect(joined).toContain('think 10')
    expect(joined).not.toContain('think 11')
    expect(joined).toContain('… 2 more reasoning lines')
    expect(joined).toContain('\x1b[38;5;240m') // dim token
    // Reasoning sits above the answer text.
    expect(joined.indexOf('think 1')).toBeLessThan(joined.indexOf('final answer'))
  })

  it('shows a short reasoning preview without a truncation note', () => {
    const transcript = new Transcript()
    transcript.fold(ev('assistant/message', {
      turn: 1, step: 1,
      message: {
        id: 'a1', role: 'assistant',
        content: [
          { type: 'reasoning', text: 'brief thought' },
          { type: 'text', text: 'answer' },
        ],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
    }, 2, { surfaceOp: 'append' }))
    const joined = new TranscriptView(transcript, darkTheme).render(80).join('\n')
    expect(joined).toContain('brief thought')
    expect(joined).not.toContain('more reasoning lines')
  })
})

describe('TranscriptView turn end states', () => {
  it('renders a failed turn bracket in error color with the error message', () => {
    const transcript = new Transcript()
    transcript.fold(ev('turn/start', { turn: 1 }, 1))
    transcript.fold(ev('turn/end', {
      turn: 1, reason: { kind: 'error', error: { message: 'provider exploded', code: 'RATE_LIMIT' } },
    }, 2))
    const joined = new TranscriptView(transcript, darkTheme).render(80).join('\n')
    expect(joined).toContain('-- turn 1 error --')
    expect(joined).toContain('provider exploded')
    expect(joined).toContain('\x1b[38;5;167m') // error token
  })

  it('renders a max-tokens turn bracket in warning color', () => {
    const transcript = new Transcript()
    transcript.fold(ev('turn/start', { turn: 1 }, 1))
    transcript.fold(ev('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }, 2))
    const joined = new TranscriptView(transcript, darkTheme).render(80).join('\n')
    expect(joined).toContain('-- turn 1 max-tokens --')
    expect(joined).toContain('\x1b[38;5;179m') // warning token
    expect(joined).not.toContain('\x1b[38;5;167m') // not error
  })

  it('keeps other turn reasons dim', () => {
    const transcript = new Transcript()
    transcript.fold(ev('turn/start', { turn: 1 }, 1))
    transcript.fold(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2))
    const joined = new TranscriptView(transcript, darkTheme).render(80).join('\n')
    expect(joined).toContain('-- turn 1 completed --')
    expect(joined).toContain('\x1b[38;5;240m') // dim token
  })
})
