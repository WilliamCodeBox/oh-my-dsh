/**
 * Behavioral tests for the Transcript fold model: append-origin surface
 * events build the transcript, streaming assistant text finalizes on the
 * assembled message, tool cards merge their results, turn brackets close,
 * compaction replacements surface as notes without erasing the transcript,
 * and log-only state rides the folded projection.
 */

import { describe, expect, it } from 'vitest'
import { Transcript, textOf } from '../src/transcript.ts'
import type { AssistantItem, ToolItem, TurnItem, UserItem } from '../src/transcript.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { CallId, MessageId } from '@deepseek-ai/dsh-llm'
import { CommandId } from '@deepseek-ai/dsh-commands'

/** Build one event; surface events pass `surfaceOp: 'append'` explicitly. */
function ev<T extends SessionEvent['type']>(
  type: T,
  data: Extract<SessionEvent, { type: T }>['data'],
  seq: number,
  extra: Record<string, unknown> = {},
): SessionEvent {
  return { type, seq, time: seq * 1000, data, ...extra } as SessionEvent
}

const userText = (text: string) => ({
  id: MessageId('u1'),
  role: 'user' as const,
  content: [{ type: 'text' as const, text }],
  source: { kind: 'user' as const },
})

const assistantText = (text: string) => ({
  id: MessageId('a1'),
  role: 'assistant' as const,
  content: [{ type: 'text' as const, text }],
  source: { kind: 'model' as const, provider: 'deepseek', model: 'deepseek-chat' },
})

const chunk = (turn: number, step: number, text: string, seq: number) =>
  ev('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text } }, seq)

describe('textOf', () => {
  it('joins text blocks in order', () => {
    expect(textOf([{ type: 'text', text: 'a' }, { type: 'tool', text: 'ignored' }, { type: 'text', text: 'b' }])).toBe('ab')
  })

  it('returns empty string for no text blocks', () => {
    expect(textOf([])).toBe('')
  })
})

describe('Transcript', () => {
  it('folds a user message with its source and open turn', () => {
    const transcript = new Transcript()
    transcript.fold(ev('turn/start', { turn: 1 }, 1))
    transcript.fold(ev('user/message', userText('hello'), 2, { surfaceOp: 'append' }))

    const items = transcript.state.items
    expect(items).toHaveLength(2)
    const user = items[1] as UserItem
    expect(user.kind).toBe('user')
    expect(user.text).toBe('hello')
    expect(user.source).toEqual({ kind: 'user' })
    expect(user.turn).toBe(1)
  })

  it('streams assistant chunks and finalizes on the assembled message', () => {
    const transcript = new Transcript()
    transcript.fold(ev('turn/start', { turn: 1 }, 1))
    transcript.fold(ev('user/message', userText('hi'), 2, { surfaceOp: 'append' }))
    transcript.fold(chunk(1, 0, 'Hel', 3))
    transcript.fold(chunk(1, 0, 'lo', 4))

    const streaming = transcript.state.items.at(-1) as AssistantItem
    expect(streaming.kind).toBe('assistant')
    expect(streaming.streaming).toBe(true)
    expect(streaming.text).toBe('Hello')

    transcript.fold(ev('assistant/message', { turn: 1, step: 0, message: assistantText('Hello!'), usage: { inputTokens: 10, outputTokens: 5 } }, 5, { surfaceOp: 'append' }))

    const finalized = transcript.state.items.at(-1) as AssistantItem
    expect(finalized.streaming).toBe(false)
    expect(finalized.text).toBe('Hello!')
    expect(finalized.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(finalized.message).toBeDefined()
  })

  it('keeps partial text of an aborted stream', () => {
    const transcript = new Transcript()
    transcript.fold(ev('turn/start', { turn: 1 }, 1))
    transcript.fold(chunk(1, 0, 'partial', 2))
    transcript.fold(ev('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }, 3))

    const item = transcript.state.items.at(-1) as AssistantItem
    expect(item.kind).toBe('assistant')
    expect(item.streaming).toBe(false)
    expect(item.text).toBe('partial')
  })

  it('starts a new assistant item when chunks move to a new step', () => {
    const transcript = new Transcript()
    transcript.fold(chunk(1, 0, 'first', 1))
    transcript.fold(ev('assistant/message', { turn: 1, step: 0, message: assistantText('first') }, 2, { surfaceOp: 'append' }))
    transcript.fold(chunk(1, 1, 'second', 3))

    const items = transcript.state.items
    expect(items).toHaveLength(2)
    expect((items[0] as AssistantItem).streaming).toBe(false)
    expect((items[1] as AssistantItem).streaming).toBe(true)
    expect((items[1] as AssistantItem).text).toBe('second')
  })

  it('merges a tool result into its call card', () => {
    const transcript = new Transcript()
    transcript.fold(ev('tool/call', { turn: 1, step: 0, callId: CallId('call-1'), name: 'bash', arguments: '{"cmd":"ls"}' }, 1))
    transcript.fold(ev('tool/result', {
      turn: 1,
      step: 0,
      message: {
        id: MessageId('r1'),
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'done' }] }],
        source: { kind: 'tool', callId: CallId('call-1') },
      },
    }, 2, { surfaceOp: 'append' }))

    const items = transcript.state.items
    expect(items).toHaveLength(1)
    const tool = items[0] as ToolItem
    expect(tool.kind).toBe('tool')
    expect(tool.callId).toBe('call-1')
    expect(tool.name).toBe('bash')
    expect(tool.args).toBe('{"cmd":"ls"}')
    expect(tool.result?.text).toBe('done')
    expect(tool.result?.error).toBeUndefined()
  })

  it('records a failed tool result error', () => {
    const transcript = new Transcript()
    transcript.fold(ev('tool/call', { turn: 1, step: 0, callId: CallId('call-1'), name: 'bash', arguments: '{}' }, 1))
    transcript.fold(ev('tool/result', {
      turn: 1,
      step: 0,
      message: {
        id: MessageId('r1'),
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: '' }] }],
        source: { kind: 'tool', callId: CallId('call-1') },
      },
      error: { name: 'EACCES', code: 'EACCES' },
    }, 2, { surfaceOp: 'append' }))

    const tool = transcript.state.items[0] as ToolItem
    expect(tool.result?.error).toEqual({ name: 'EACCES', code: 'EACCES' })
  })

  it('creates a tool card from a result when the call was not folded', () => {
    const transcript = new Transcript()
    transcript.fold(ev('tool/result', {
      turn: 1,
      step: 0,
      message: {
        id: MessageId('r1'),
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: CallId('orphan'), content: [{ type: 'text', text: 'ok' }] }],
        source: { kind: 'tool', callId: CallId('orphan') },
      },
    }, 1, { surfaceOp: 'append' }))

    const tool = transcript.state.items[0] as ToolItem
    expect(tool.kind).toBe('tool')
    expect(tool.callId).toBe('orphan')
    expect(tool.name).toBe('')
    expect(tool.result?.text).toBe('ok')
  })

  it('closes turn brackets with their ending reason', () => {
    const transcript = new Transcript()
    transcript.fold(ev('turn/start', { turn: 2 }, 1))
    transcript.fold(ev('turn/end', { turn: 2, reason: { kind: 'completed' } }, 2))

    const turn = transcript.state.items[0] as TurnItem
    expect(turn.kind).toBe('turn')
    expect(turn.turn).toBe(2)
    expect(turn.end).toEqual({ time: 2000, reason: { kind: 'completed' } })
  })

  it('keeps an open turn bracket when the turn never ends', () => {
    const transcript = new Transcript()
    transcript.fold(ev('turn/start', { turn: 3 }, 1))
    const turn = transcript.state.items[0] as TurnItem
    expect(turn.end).toBeUndefined()
  })

  it('tracks the todo list snapshot', () => {
    const transcript = new Transcript()
    transcript.fold(ev('todo/write', { todos: [{ content: 'task', status: 'in_progress' }] }, 1))
    expect(transcript.state.todos).toEqual([{ content: 'task', status: 'in_progress' }])
  })

  it('records compaction replacements without erasing the transcript', () => {
    const transcript = new Transcript()
    transcript.fold(ev('user/message', userText('first'), 1, { surfaceOp: 'append' }))
    transcript.fold(ev('assistant/message', { turn: 1, step: 0, message: assistantText('reply') }, 2, { surfaceOp: 'append' }))
    transcript.fold(ev('user/message', userText('summary'), 3, { surfaceOp: { op: 'replace', start: 0, end: 1 }, sourceEventSeqs: [1, 2] }))

    const state = transcript.state
    // Append-origin material stays — the human already saw it.
    expect(state.items).toHaveLength(2)
    expect((state.items[0] as UserItem).text).toBe('first')
    expect(state.compactions).toEqual([{ seq: 3, start: 0, end: 1, shadowedSeqs: [1, 2] }])
  })

  it('folds request header, route context, and the end-seed marker', () => {
    const transcript = new Transcript()
    const header = { config: { provider: 'deepseek', model: 'deepseek-chat' } } as never
    transcript.fold(ev('request/header', { header, reason: 'initial' }, 1))
    transcript.fold(ev('request/context', { provider: 'deepseek', model: 'deepseek-chat' }, 2))
    transcript.fold(ev('session/end-seed', {}, 3))

    const state = transcript.state
    expect(state.header).toBe(header)
    expect(state.context).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(state.seedEndSeq).toBe(3)
  })

  it('skips unknown and non-transcript event types', () => {
    const transcript = new Transcript()
    transcript.fold(ev('step/start', { turn: 1, step: 0 }, 1))
    transcript.fold({ type: 'plugin/novel-event', seq: 2, time: 2000, data: {}, ignorable: true } as unknown as SessionEvent)
    expect(transcript.state.items).toHaveLength(0)
  })

  it('folds a slash command lifecycle into one card with its settled result', () => {
    const transcript = new Transcript()
    transcript.fold(ev('command/run', {
      commandId: CommandId('c-1'), name: 'permission', args: ' read-only', source: { kind: 'user' },
    }, 1))
    transcript.fold(ev('command/done', {
      commandId: CommandId('c-1'), kind: 'success', text: 'preset read-only', sourceEventSeq: 1,
    }, 2))
    const item = transcript.state.items[0]
    expect(item).toMatchObject({
      kind: 'command',
      commandId: 'c-1',
      name: 'permission',
      args: ' read-only',
      result: { kind: 'success', text: 'preset read-only' },
    })
  })

  it('pairs command/done to its open card by id across interleaved commands', () => {
    const transcript = new Transcript()
    transcript.fold(ev('command/run', {
      commandId: CommandId('c-1'), name: 'one', source: { kind: 'user' },
    }, 1))
    transcript.fold(ev('command/run', {
      commandId: CommandId('c-2'), name: 'two', source: { kind: 'user' },
    }, 2))
    transcript.fold(ev('command/done', { commandId: CommandId('c-1'), kind: 'error', text: 'boom' }, 3))
    transcript.fold(ev('command/done', { commandId: CommandId('c-2'), kind: 'success' }, 4))
    const [first, second] = transcript.state.items
    expect(first).toMatchObject({ kind: 'command', name: 'one', result: { kind: 'error', text: 'boom' } })
    // A bare success carries no text field.
    expect(second).toMatchObject({ kind: 'command', name: 'two', result: { kind: 'success' } })
    expect('text' in (second as { result?: { text?: string } }).result!).toBe(false)
  })

  it('notifies listeners after each fold', () => {
    const transcript = new Transcript()
    let calls = 0
    const off = transcript.on(() => { calls++ })
    transcript.fold(ev('turn/start', { turn: 1 }, 1))
    transcript.fold(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2))
    expect(calls).toBe(2)
    off()
    transcript.fold(ev('turn/start', { turn: 2 }, 3))
    expect(calls).toBe(2)
  })
})
