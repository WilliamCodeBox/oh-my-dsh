/**
 * Behavioral tests for the Transcript fold model: append-origin surface
 * events build the transcript, streaming assistant text finalizes on the
 * assembled message, tool cards merge their results, turn brackets close,
 * compaction replacements surface as notes without erasing the transcript,
 * and log-only state rides the folded projection.
 */

import { describe, expect, it } from 'vitest'
import { Transcript, textOf } from '../src/transcript.ts'
import type { AssistantItem, SubagentItem, ToolItem, TurnItem, UserItem } from '../src/transcript.ts'
import type { SessionEvent } from '@williamcodebox/omd-session'
import { CallId, MessageId } from '@williamcodebox/omd-llm'
import { CommandId } from '@williamcodebox/omd-commands'
import { CompactionId } from '@williamcodebox/omd-compaction'

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

  it('accumulates token usage across finalized assistant messages', () => {
    const transcript = new Transcript()
    transcript.fold(ev('assistant/message', {
      turn: 1, step: 0, message: assistantText('one'), usage: { inputTokens: 10, outputTokens: 5 },
    }, 1, { surfaceOp: 'append' }))
    transcript.fold(ev('assistant/message', {
      turn: 1, step: 1, message: assistantText('two'), usage: { inputTokens: 100, outputTokens: 50 },
    }, 2, { surfaceOp: 'append' }))
    expect(transcript.state.usage).toEqual({ inputTokens: 110, outputTokens: 55 })
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

describe('Transcript subagent lifecycle', () => {
  const start = (runId = 'r-1', time = 1000) => ({
    kind: 'start' as const, runId, provider: 'task', id: `child-${runId}`, time,
  })
  const end = (runId = 'r-1', time = 5000, error?: string) => ({
    kind: 'end' as const, runId, provider: 'task', id: `child-${runId}`, time,
    ...(error !== undefined ? { error } : {}),
  })

  it('appends a running item on start', () => {
    const transcript = new Transcript()
    transcript.subagentLifecycle(start())
    const item = transcript.state.items[0] as SubagentItem
    expect(item).toMatchObject({
      kind: 'subagent', runId: 'r-1', provider: 'task', id: 'child-r-1', state: 'running',
    })
    // Edges are not session events, so they fold with seq 0.
    expect(item.seq).toBe(0)
    expect(item.error).toBeUndefined()
  })

  it('merges a done edge into the open card in place', () => {
    const transcript = new Transcript()
    transcript.subagentLifecycle(start())
    const running = transcript.state.items[0]
    transcript.subagentLifecycle(end())
    const items = transcript.state.items
    expect(items).toHaveLength(1)
    // Same item reference: the end edge merged, it did not append.
    expect(items[0]).toBe(running)
    expect((items[0] as SubagentItem).state).toBe('done')
    expect((items[0] as SubagentItem).error).toBeUndefined()
  })

  it('merges a failed edge with the failure text in place', () => {
    const transcript = new Transcript()
    transcript.subagentLifecycle(start())
    transcript.subagentLifecycle(end('r-1', 5000, 'model failure'))
    const item = transcript.state.items[0] as SubagentItem
    expect(item.state).toBe('failed')
    expect(item.error).toBe('model failure')
  })

  it('appends a settled item when the end edge has no matching start', () => {
    const transcript = new Transcript()
    transcript.subagentLifecycle(end('orphan', 5000, 'boom'))
    const item = transcript.state.items[0] as SubagentItem
    expect(item.state).toBe('failed')
    expect(item.error).toBe('boom')
    expect(item.runId).toBe('orphan')
  })

  it('pairs ends to starts by run id across interleaved runs', () => {
    const transcript = new Transcript()
    transcript.subagentLifecycle(start('a', 1000))
    transcript.subagentLifecycle(start('b', 2000))
    transcript.subagentLifecycle(end('a', 3000, 'first failed'))
    transcript.subagentLifecycle(end('b', 4000))
    const [first, second] = transcript.state.items as [SubagentItem, SubagentItem]
    expect(first.state).toBe('failed')
    expect(first.error).toBe('first failed')
    expect(second.state).toBe('done')
  })

  it('notifies listeners on lifecycle edges', () => {
    const transcript = new Transcript()
    let calls = 0
    const off = transcript.on(() => { calls++ })
    transcript.subagentLifecycle(start())
    transcript.subagentLifecycle(end())
    expect(calls).toBe(2)
    off()
    transcript.subagentLifecycle(start('x'))
    expect(calls).toBe(2)
  })
})

describe('Transcript reasoning capture', () => {
  it('captures reasoning blocks as thinking on the finalized assistant item', () => {
    const transcript = new Transcript()
    transcript.fold(chunk(1, 0, 'streamed', 1))
    transcript.fold(ev('assistant/message', {
      turn: 1, step: 0,
      message: {
        id: MessageId('a1'), role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think one' },
          { type: 'text', text: 'final answer' },
        ],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    }, 2, { surfaceOp: 'append' }))

    const item = transcript.state.items[0] as AssistantItem
    expect(item.thinking).toBe('think one')
    expect(item.text).toBe('final answer')
  })

  it('joins reasoning blocks and leaves thinking absent without them', () => {
    const withReasoning = new Transcript()
    withReasoning.fold(ev('assistant/message', {
      turn: 1, step: 0,
      message: {
        id: MessageId('a1'), role: 'assistant',
        content: [
          { type: 'reasoning', text: 'line 1' },
          { type: 'reasoning', text: 'line 2' },
          { type: 'text', text: 'answer' },
        ],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    }, 1, { surfaceOp: 'append' }))
    expect((withReasoning.state.items[0] as AssistantItem).thinking).toBe('line 1\nline 2')

    const plain = new Transcript()
    plain.fold(ev('assistant/message', {
      turn: 1, step: 0,
      message: {
        id: MessageId('a2'), role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    }, 1, { surfaceOp: 'append' }))
    expect((plain.state.items[0] as AssistantItem).thinking).toBeUndefined()
  })
})

describe('Transcript ledger', () => {
  it('projects user and message cells with step timing and usage', () => {
    const transcript = new Transcript()
    transcript.fold(ev('turn/start', { turn: 1 }, 1))
    transcript.fold(ev('step/start', { turn: 1, step: 1 }, 2))
    transcript.fold(ev('user/message', userText('hello'), 3, { surfaceOp: 'append' }))
    transcript.fold(chunk(1, 1, 'Hel', 4))
    transcript.fold(ev('assistant/message', {
      turn: 1, step: 1, message: assistantText('Hello!'),
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2 },
    }, 5, { surfaceOp: 'append' }))

    const [user, message] = transcript.state.ledger
    expect(user).toMatchObject({
      index: 1, kind: 'user', text: 'hello', inputDetail: 'hello',
      previewMarkdown: 'hello', opensTurn: true, timeSeconds: 0, startedAt: 3000,
    })
    expect(message).toMatchObject({
      index: 2, kind: 'message', text: 'Hello!', outputDetail: 'Hello!',
      previewMarkdown: 'Hello!', input: 10, output: 5, think: 2,
      timeSeconds: 3, startedAt: 2000,
    })
    expect(message?.assistantMetrics).toEqual({
      timingRecorded: true, stepStartTime: 2000, firstTokenTime: 4000,
      completedTime: 5000, usageProvided: true, outputTokens: 5,
    })
  })

  it('records reasoning-only messages and empty messages as activity summaries', () => {
    const transcript = new Transcript()
    transcript.fold(ev('assistant/message', {
      turn: 1, step: 0,
      message: {
        id: MessageId('a1'), role: 'assistant',
        content: [{ type: 'reasoning', text: 'think line 1\nthink line 2' }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    }, 1, { surfaceOp: 'append' }))
    transcript.fold(ev('assistant/message', {
      turn: 1, step: 1,
      message: {
        id: MessageId('a2'), role: 'assistant',
        content: [{ type: 'tool-call', id: CallId('c1'), name: 'bash', arguments: '{}' }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    }, 2, { surfaceOp: 'append' }))

    const [thinking, toolOnly] = transcript.state.ledger
    expect(thinking?.text).toBe('think line 1')
    expect(thinking?.thinkingDetail).toBe('think line 1\nthink line 2')
    expect(toolOnly?.text).toBe('Tool call only')
    expect(toolOnly?.outputDetail).toBeUndefined()
  })

  it('classifies injected-context user messages as context rows', () => {
    const transcript = new Transcript()
    transcript.fold(ev('user/message', {
      id: MessageId('u1'), role: 'user',
      content: [{ type: 'text', text: 'file changed' }],
      source: { kind: 'plugin', plugin: 'fs', form: 'notice', summary: 'file changed' },
    }, 1, { surfaceOp: 'append' }))

    const [cell] = transcript.state.ledger
    expect(cell?.kind).toBe('context')
    expect(cell?.opensTurn).toBeUndefined()
    expect(cell?.messageSource).toEqual({ kind: 'plugin', plugin: 'fs', form: 'notice', summary: 'file changed' })
  })

  it('tracks a tool call/result pair: duration, output, error, and schema', () => {
    const transcript = new Transcript()
    transcript.fold(ev('request/header', {
      header: {
        config: { provider: 'p', model: 'm' },
        system: 'sys',
        tools: [{ name: 'bash', description: 'run commands', parameters: { type: 'object' } }],
      },
      reason: 'initial',
    }, 1))
    transcript.fold(ev('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{"cmd":"ls"}' }, 2))
    transcript.fold(ev('tool/result', {
      turn: 1, step: 1,
      message: {
        id: MessageId('r1'), role: 'user',
        content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'file list' }] }],
        source: { kind: 'tool', callId: CallId('c1') },
      },
    }, 5, { surfaceOp: 'append' }))

    const [, tool] = transcript.state.ledger
    expect(tool).toMatchObject({
      kind: 'tool', callId: 'c1', text: 'bash {"cmd":"ls"}',
      inputDetail: '{"cmd":"ls"}', outputDetail: 'file list',
      result: 'file list', isError: false, timeSeconds: 3, startedAt: 2000,
      schemaDetail: JSON.stringify({ name: 'bash', description: 'run commands', parameters: { type: 'object' } }, null, 2),
    })
  })

  it('marks a failed tool result and creates a cell from an orphan result', () => {
    const transcript = new Transcript()
    transcript.fold(ev('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{}' }, 1))
    transcript.fold(ev('tool/result', {
      turn: 1, step: 1,
      message: {
        id: MessageId('r1'), role: 'user',
        content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: '' }] }],
        source: { kind: 'tool', callId: CallId('c1') },
      },
      error: { name: 'EACCES', code: 'EACCES' },
    }, 2, { surfaceOp: 'append' }))
    transcript.fold(ev('tool/result', {
      turn: 2, step: 1,
      message: {
        id: MessageId('r2'), role: 'user',
        content: [{ type: 'tool-result', toolCallId: CallId('orphan'), content: [{ type: 'text', text: 'orphan output' }] }],
        source: { kind: 'tool', callId: CallId('orphan') },
      },
    }, 3, { surfaceOp: 'append' }))

    const [failed, orphan] = transcript.state.ledger
    expect(failed).toMatchObject({
      kind: 'tool', outputDetail: 'EACCES: EACCES', isError: true,
      result: 'EACCES', timeSeconds: 1,
    })
    expect(orphan).toMatchObject({
      kind: 'tool', callId: 'orphan', text: 'orphan output', outputDetail: 'orphan output',
      timeSeconds: null,
    })
  })

  it('projects subtool records from the code-dispatch pair', () => {
    const transcript = new Transcript()
    transcript.fold(ev('tool/code-dispatch-start', {
      rootCallId: CallId('root'), parentCallId: CallId('root'),
      subCallId: CallId('root:code:1'), name: 'read_file', arguments: { path: 'a' },
    }, 1))
    transcript.fold(ev('tool/code-dispatch', {
      rootCallId: CallId('root'), parentCallId: CallId('root'),
      subCallId: CallId('root:code:1'), name: 'read_file', arguments: { path: 'a' },
      isError: false, content: [{ type: 'text', text: 'contents' }],
    }, 3))

    const [subtool] = transcript.state.ledger
    expect(subtool).toMatchObject({
      kind: 'subtool', callId: 'root:code:1',
      text: 'read_file {"path":"a"}', inputDetail: '{"path":"a"}',
      outputDetail: 'contents', result: 'contents', isError: false,
      timeSeconds: 2, startedAt: 1000,
    })
  })

  it('marks a failed subtool result and records a stray settle without a start defensively', () => {
    const transcript = new Transcript()
    transcript.fold(ev('tool/code-dispatch-start', {
      rootCallId: CallId('root'), parentCallId: CallId('root'),
      subCallId: CallId('root:code:1'), name: 'bash', arguments: {},
    }, 1))
    transcript.fold(ev('tool/code-dispatch', {
      rootCallId: CallId('root'), parentCallId: CallId('root'),
      subCallId: CallId('root:code:1'), name: 'bash', arguments: {},
      isError: true, content: [{ type: 'text', text: 'boom' }],
    }, 2))
    transcript.fold(ev('tool/code-dispatch', {
      rootCallId: CallId('root'), parentCallId: CallId('root'),
      subCallId: CallId('stray'), name: 'bash', arguments: {},
      isError: false, content: [{ type: 'text', text: 'never started' }],
    }, 3))

    const [subtool, stray] = transcript.state.ledger
    expect(subtool).toMatchObject({ kind: 'subtool', result: 'error', isError: true, timeSeconds: 1 })
    expect(stray).toMatchObject({
      kind: 'subtool', callId: 'stray',
      text: 'never started', outputDetail: 'never started', result: 'never started',
      isError: false, timeSeconds: null, startedAt: 3000,
    })
    expect(transcript.state.ledger).toHaveLength(2)
  })

  it('tracks the compaction lifecycle with summary content and failure', () => {
    const transcript = new Transcript()
    transcript.fold(ev('compaction/start', { compactionId: CompactionId('c1'), turn: null }, 1))
    transcript.fold(ev('compaction/summary', {
      compactionId: CompactionId('c1'),
      summary: [{ type: 'text', text: 'summary line 1\nsummary line 2' }],
      shadowedRange: { start: 1, end: 2 }, shadowedSeqs: [1, 2], shadowedTokenCount: 100,
      provider: 'p', model: 'm',
    }, 2))
    transcript.fold(ev('compaction/end', { compactionId: CompactionId('c1'), turn: null }, 4))

    const [cell] = transcript.state.ledger
    expect(cell).toMatchObject({
      kind: 'compacted', text: 'summary line 1', outputDetail: 'summary line 1\nsummary line 2',
      timeSeconds: 3, startedAt: 1000,
    })

    const failing = new Transcript()
    failing.fold(ev('compaction/start', { compactionId: CompactionId('c2'), turn: null }, 1))
    failing.fold(ev('compaction/end', { compactionId: CompactionId('c2'), turn: null, error: 'cancelled' }, 2))
    const [failed] = failing.state.ledger
    expect(failed).toMatchObject({ kind: 'compacted', text: 'Compaction failed: cancelled', isError: true, timeSeconds: 1 })
  })

  it('marks an empty-summary compaction as context compacted', () => {
    const transcript = new Transcript()
    transcript.fold(ev('compaction/start', { compactionId: CompactionId('c1'), turn: null }, 1))
    transcript.fold(ev('compaction/summary', {
      compactionId: CompactionId('c1'),
      summary: [],
      shadowedRange: { start: 1, end: 1 }, shadowedSeqs: [1], shadowedTokenCount: 0,
      provider: 'p', model: 'm',
    }, 2))
    const [cell] = transcript.state.ledger
    expect(cell).toMatchObject({ kind: 'compacted', text: 'Context compacted' })
    expect(cell?.outputDetail).toBeUndefined()
  })

  it('projects system cells for initial and change headers, not resume or config-only changes', () => {
    const transcript = new Transcript()
    const header = (system: string, tools: { name: string }[]) => ({
      config: { provider: 'p', model: 'm' },
      system,
      tools: tools.map(tool => ({ name: tool.name, description: '', parameters: {} })),
    })
    transcript.fold(ev('request/header', { header: header('sys v1', [{ name: 'bash' }]), reason: 'initial' }, 1))
    transcript.fold(ev('request/header', { header: header('sys v2', [{ name: 'bash' }]), reason: 'change' }, 2))
    transcript.fold(ev('request/header', { header: header('sys v2', [{ name: 'bash' }]), reason: 'change' }, 3))
    transcript.fold(ev('request/header', { header: header('sys v2', [{ name: 'bash' }, { name: 'read' }]), reason: 'change' }, 4))
    transcript.fold(ev('request/header', { header: header('sys v2', [{ name: 'bash' }, { name: 'read' }]), reason: 'resume' }, 5))

    const cells = transcript.state.ledger
    expect(cells.map(cell => cell.text)).toEqual([
      'Initial System Prompt',
      'System Prompt Updated',
      'Tools Updated',
    ])
    expect(cells[0]?.promptDetail?.system).toBe('sys v1')
    expect(cells[1]?.promptDetail?.system).toBe('sys v2')
    expect(cells[1]?.previousPromptDetail?.system).toBe('sys v1')
    // A config-only change (no system/tools delta) and a resume produce no row.
    expect(cells).toHaveLength(3)
  })

  it('does not emit ledger rows for turns, commands, context, or end-seed events', () => {
    const transcript = new Transcript()
    transcript.fold(ev('turn/start', { turn: 1 }, 1))
    transcript.fold(ev('request/context', { provider: 'p', model: 'm' }, 2))
    transcript.fold(ev('command/run', { commandId: CommandId('c1'), name: 'ping', source: { kind: 'user' } }, 3))
    transcript.fold(ev('session/end-seed', {}, 4))
    expect(transcript.state.ledger).toHaveLength(0)
  })
})
