/**
 * Behavioral tests for transcript display formatting: item → lines mapping,
 * status row composition, and sanitizer application on emitted lines.
 */

import { describe, expect, it } from 'vitest'
import { formatCount, formatItem, formatStatus, sanitizedLines } from '../src/format.ts'
import type { AssistantItem, SubagentItem, ToolItem, TranscriptState, TurnItem, UserItem } from '../src/transcript.ts'

const user = (text: string): UserItem => ({ kind: 'user', seq: 1, time: 1000, text, source: { kind: 'user' }, turn: 1 })
const assistant = (text: string, streaming = false): AssistantItem => ({
  kind: 'assistant', seq: 2, time: 2000, turn: 1, step: 0, text, streaming,
})
const tool = (result?: ToolItem['result']): ToolItem => ({
  kind: 'tool', seq: 3, time: 3000, turn: 1, step: 0, callId: 'c1', name: 'bash', args: '{"cmd":"ls"}',
  ...(result !== undefined ? { result } : {}),
})
const turn = (turn: number, end?: TurnItem['end']): TurnItem => ({
  kind: 'turn', seq: 0, time: 0, turn, ...(end !== undefined ? { end } : {}),
})

describe('formatItem', () => {
  it('prefixes user text', () => {
    expect(formatItem(user('hello'))).toEqual(['> hello'])
  })

  it('renders an empty user line', () => {
    expect(formatItem(user(''))).toEqual(['>'])
  })

  it('splits assistant text into lines', () => {
    expect(formatItem(assistant('line1\nline2'))).toEqual(['line1', 'line2'])
  })

  it('omits an empty assistant item', () => {
    expect(formatItem(assistant(''))).toEqual([])
  })

  it('renders a tool card with its result line', () => {
    expect(formatItem(tool({ seq: 4, time: 4000, text: 'done' }))).toEqual([
      'tool bash {"cmd":"ls"}',
      '  -> ok',
    ])
  })

  it('renders a failed tool result', () => {
    expect(formatItem(tool({ seq: 4, time: 4000, text: '', error: { name: 'EACCES', code: 'EACCES' } }))).toEqual([
      'tool bash {"cmd":"ls"}',
      '  -> error EACCES',
    ])
  })

  it('renders a pending tool card without a result line', () => {
    expect(formatItem(tool())).toEqual(['tool bash {"cmd":"ls"}'])
  })

  it('renders turn brackets with the ending reason', () => {
    expect(formatItem(turn(2))).toEqual(['-- turn 2 --'])
    expect(formatItem(turn(2, { time: 5000, reason: { kind: 'completed' } }))).toEqual(['-- turn 2 completed --'])
  })

  it('renders subagent activity lines with provider and state', () => {
    const subagent = (state: SubagentItem['state'], error?: string): SubagentItem => ({
      kind: 'subagent', seq: 0, time: 1000, runId: 'r-1', provider: 'task', id: 'child-1', state,
      ...(error !== undefined ? { error } : {}),
    })
    expect(formatItem(subagent('running'))).toEqual(['subagent task running'])
    expect(formatItem(subagent('done'))).toEqual(['subagent task done'])
    // The identity path carries no failure text; that is a themed concern.
    expect(formatItem(subagent('failed', 'boom'))).toEqual(['subagent task failed'])
  })
})

describe('sanitizedLines', () => {
  it('escapes control sequences in user text', () => {
    expect(sanitizedLines(user('a\x1b[2Jb'))).toEqual(['> a\\x1b[2Jb'])
  })

  it('passes plain text through unchanged', () => {
    expect(sanitizedLines(assistant('plain text'))).toEqual(['plain text'])
  })
})

describe('formatStatus', () => {
  const base: TranscriptState = { items: [], todos: [], usage: { inputTokens: 0, outputTokens: 0 }, compactions: [], ledger: [] }

  it('is empty without side state', () => {
    expect(formatStatus(base)).toBe('')
  })

  it('omits the provider route (it moved to the input meta row)', () => {
    expect(formatStatus({ ...base, context: { provider: 'deepseek', model: 'deepseek-chat' } })).toBe('')
  })

  it('shows active and total todos', () => {
    const todos = [
      { content: 'a', status: 'in_progress' as const },
      { content: 'b', status: 'pending' as const },
      { content: 'c', status: 'completed' as const },
    ]
    expect(formatStatus({ ...base, todos })).toBe('todos 1/3')
  })

  it('joins parts with separators', () => {
    expect(formatStatus({
      ...base,
      todos: [{ content: 'a', status: 'in_progress' as const }],
      compactions: [{ seq: 9, start: 0, end: 1, shadowedSeqs: [1, 2] }],
    })).toBe('todos 1/1 | compacted 1')
  })

  it('shows accumulated token totals', () => {
    expect(formatStatus({
      ...base,
      usage: { inputTokens: 1234, outputTokens: 56 },
    })).toBe('tokens 1234+56')
  })

  it('shows the most recent completed turn duration', () => {
    const turnItem = {
      kind: 'turn' as const,
      seq: 1,
      time: 1000,
      turn: 1,
      end: { time: 12_000, reason: { kind: 'completed' as const } },
    }
    expect(formatStatus({ ...base, items: [turnItem] })).toBe('11s')
  })
})

describe('formatCount', () => {
  it('keeps small counts verbatim', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
  })

  it('abbreviates thousands with one decimal below 100k', () => {
    expect(formatCount(1_000)).toBe('1.0k')
    expect(formatCount(7_828)).toBe('7.8k')
    expect(formatCount(12_500)).toBe('12.5k')
    expect(formatCount(99_999)).toBe('100.0k')
  })

  it('drops the decimal at 100k and above', () => {
    expect(formatCount(100_000)).toBe('100k')
    expect(formatCount(999_999)).toBe('1000k')
  })

  it('abbreviates millions, whole values without a decimal', () => {
    expect(formatCount(1_000_000)).toBe('1M')
    expect(formatCount(1_250_000)).toBe('1.3M')
    expect(formatCount(10_000_000)).toBe('10M')
  })
})

describe('formatItem caps', () => {
  it('truncates over-long tool arguments with a remainder note', () => {
    const longArgs = JSON.stringify({ path: '/x'.repeat(500) })
    const lines = formatItem({
      kind: 'tool', seq: 1, time: 1000, turn: 1, step: 1, callId: 'c-1',
      name: 'read', args: longArgs,
    })
    expect(lines[0]).toContain('…(+')
    expect(lines[0]).not.toContain(longArgs)
  })

  it('truncates command args and results the same way', () => {
    const lines = formatItem({
      kind: 'command', seq: 1, time: 1000, commandId: 'c-1',
      name: 'permission', args: ' x'.repeat(400),
      result: { seq: 2, time: 2000, kind: 'error', text: 'e'.repeat(500) },
    })
    expect(lines[0]).toContain('…(+')
    expect(lines[1]).toContain('error')
    expect(lines[1]).toContain('…(+')
  })
})
