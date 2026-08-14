/** Interactive runner: event tracing, follow-up submission, steering, Ctrl+C machine, resume, permission, exit mapping. */

import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { CallId, createAssistantMessage, createToolResultMessage, MessageId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { apply, Config, internals, StdinInputSource } from '../src/index.ts'
import type { InputSource, TuiKey } from '../src/index.ts'

const originalInternals = { ...internals }
afterEach(() => { Object.assign(internals, originalInternals) })

/** Scripted key source: drains its queue, then EOF. */
class ScriptedInput implements InputSource {
  private queue: TuiKey[]
  constructor(keys: readonly TuiKey[]) { this.queue = [...keys] }
  async next(): Promise<TuiKey | undefined> {
    return this.queue.shift()
  }
}

/** What one run observed about the agent and the process. */
interface Recorded {
  followup: UserMessage[]
  steer: UserMessage[]
  cancel: Array<{ cause: unknown; options: unknown }>
  resume: ResumeAgentOptions[]
  createdOptions: Array<{ sessionId: string; agentOptions: unknown }>
  rawMode: boolean[]
  hardExits: number[]
  permissions: Array<{ session: Session; name: string }>
}

/** The assembled result of one driven run. */
interface RunResult {
  code: number
  out: string
  err: string
  order: string[]
}

interface Script {
  /** Fixed status for the live agent (defaults to `idle`). */
  status?: 'idle' | 'running'
  afterFollowup?(ctx: Context, session: Session, message: UserMessage): void
}

/**
 * Mount the real registries around a scripted Agent factory and drive one
 * `apply()` with a scripted key source.
 */
async function bench(keys: readonly TuiKey[], config: Record<string, unknown>, script: Script = {}): Promise<{
  ctx: Context
  recorded: Recorded
  run(): Promise<RunResult>
}> {
  const ctx = new Context()
  const recorded: Recorded = {
    followup: [], steer: [], cancel: [], resume: [], createdOptions: [], rawMode: [], hardExits: [], permissions: [],
  }
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })

  async function createAgentImpl(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
    const session = ctx.sessions.create(options.sessionId, { meta: options.meta ?? {} })
    recorded.createdOptions.push({ sessionId: options.sessionId, agentOptions: options.agentOptions })
    const agentCtx = ownerCtx.extend({ agent: {} })
    const agent = {
      id: session.id,
      options: options.agentOptions ?? {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      ctx: agentCtx,
      status: script.status ?? 'idle',
      cancel: (cause: unknown, cancelOptions?: unknown) => { recorded.cancel.push({ cause, options: cancelOptions }) },
      send: () => {},
      followup: (message: UserMessage) => {
        recorded.followup.push(message)
        script.afterFollowup?.(ctx, session, message)
      },
      steer: (message: UserMessage) => { recorded.steer.push(message) },
      inject: () => {},
      whenIdle: () => Promise.resolve(),
      runMaintenance: () => Promise.reject(new Error('not used')),
    } as unknown as Agent
    await options.setup?.(agentCtx)
    ctx.agents.register(agent)
    return { agent, dispose: () => Promise.resolve() }
  }

  ctx.agents.setFactory({
    createAgent: createAgentImpl,
    async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
      recorded.resume.push(options)
      return await createAgentImpl(ownerCtx, {
        sessionId: options.resumeSessionId,
        agentOptions: options.agentOptions,
        setup: options.setup,
      } as CreateAgentOptions)
    },
  })

  return {
    ctx,
    recorded,
    run: async () => {
      let out = ''
      let err = ''
      const order: string[] = []
      ctx.on('session/flush', () => { order.push('flush') })
      internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
      internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
      internals.device = { isTTY: true, setRawMode: (raw) => { recorded.rawMode.push(raw) } }
      internals.createInput = () => new ScriptedInput(keys)
      let resolveExited: (code: number) => void = () => {}
      const exited = new Promise<number>((resolve) => { resolveExited = resolve })
      ctx.provide('appExit', (code: number) => { order.push('exit'); resolveExited(code) })
      internals.hardExit = (code) => { recorded.hardExits.push(code); resolveExited(code) }
      apply(ctx, new Config(config))
      const code = await exited
      return { code, out, err, order }
    },
  }
}

/** Append one completed turn with a user message and an assistant text reply. */
function appendTurn(session: Session, message: UserMessage, text: string): void {
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'test-provider', model: 'test-model' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

describe('tui runner', () => {
  it('submits a line as a follow-up turn, traces events, and quits cleanly on Ctrl+C', async () => {
    const test = await bench(
      [
        { kind: 'char', char: 'h' },
        { kind: 'char', char: 'i' },
        { kind: 'submit' },
        { kind: 'ctrl-c' },
      ],
      {},
      { afterFollowup: (_ctx, session, message) => { appendTurn(session, message, 'hello back') } },
    )
    const result = await test.run()
    expect(result.code).toBe(0)
    expect(test.recorded.followup).toHaveLength(1)
    expect(result.out).toContain('[user] hi')
    expect(result.out).toContain('[assistant] hello back')
    expect(result.out).toContain('[turn/end] 1 completed')
    expect(test.recorded.rawMode).toEqual([true, false])
    expect(result.order).toEqual(['flush', 'exit'])
    await test.ctx.fiber.dispose()
  })

  it('honors --model by splitting provider/model into the agent options', async () => {
    const test = await bench(
      [
        { kind: 'char', char: 'x' },
        { kind: 'submit' },
        { kind: 'ctrl-c' },
      ],
      { model: 'deepseek-official/deepseek-v4-pro' },
      { afterFollowup: (_ctx, session, message) => { appendTurn(session, message, 'ok') } },
    )
    await test.run()
    expect(test.recorded.createdOptions[0]!.agentOptions).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
    })
    await test.ctx.fiber.dispose()
  })

  it('steers while a turn runs and cancels on Ctrl+C with inbox preserved', async () => {
    const test = await bench(
      [
        { kind: 'char', char: 'x' },
        { kind: 'submit' },
        { kind: 'ctrl-c' },
        { kind: 'ctrl-c' },
      ],
      {},
      { status: 'running' },
    )
    const result = await test.run()
    expect(test.recorded.steer).toHaveLength(1)
    expect(test.recorded.cancel).toHaveLength(1)
    expect(test.recorded.cancel[0]).toEqual({ cause: { kind: 'user' }, options: { keepInbox: true } })
    // The second press inside the window force-exits; the run never flushed.
    expect(result.code).toBe(130)
    expect(test.recorded.hardExits).toEqual([130])
    expect(result.order).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('clears the input line on Ctrl+C while typing, then quits on a fresh press', async () => {
    const test = await bench(
      [
        { kind: 'char', char: 'a' },
        { kind: 'ctrl-c' },
        { kind: 'char', char: 'b' },
        { kind: 'backspace' },
        { kind: 'submit' },
        { kind: 'ctrl-c' },
      ],
      {},
      { afterFollowup: (_ctx, session, message) => { appendTurn(session, message, 'ok') } },
    )
    const result = await test.run()
    // The first Ctrl+C cleared 'a'; 'b' then backspace emptied the line; the
    // empty submit submitted nothing; the final Ctrl+C quit with no turn.
    expect(result.code).toBe(0)
    expect(test.recorded.followup).toHaveLength(0)
    await test.ctx.fiber.dispose()
  })

  it('quits on EOF without any input', async () => {
    const test = await bench([], {})
    expect((await test.run()).code).toBe(0)
    await test.ctx.fiber.dispose()
  })

  it('resumes a persisted session when --resume is given', async () => {
    const test = await bench(
      [{ kind: 'ctrl-c' }],
      { resume: 'session-persisted' },
      { status: 'idle' },
    )
    await test.run()
    expect(test.recorded.resume).toHaveLength(1)
    expect(test.recorded.resume[0]!.resumeSessionId).toBe('session-persisted')
    await test.ctx.fiber.dispose()
  })

  it('traces every event family with its compact summary', async () => {
    const test = await bench(
      [
        { kind: 'char', char: 'x' },
        { kind: 'submit' },
        { kind: 'ctrl-c' },
      ],
      {},
      {
        afterFollowup: (_ctx, session, message) => {
          session.append('turn/start', { turn: 2 })
          session.append('step/start', { turn: 2, step: 1 })
          // A user message with no text content renders as `[user]`.
          session.append('user/message', {
            role: 'user', source: { kind: 'user' }, id: MessageId('no-text'), content: [{ type: 'text' } as never],
          }, { surfaceOp: 'append' })
          // Whitespace-only, reasoning, and visible chunks: only the visible
          // text-delta produces a line.
          session.append('assistant/chunk', { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: '  ' } })
          session.append('assistant/chunk', { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: 'visible' } })
          session.append('assistant/chunk', { turn: 2, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'think' } })
          // An empty assistant message renders as `[assistant]`.
          session.append('assistant/message', {
            turn: 2, step: 1,
            message: createAssistantMessage({ content: [], source: { provider: 'p', model: 'm' } }),
          }, { surfaceOp: 'append' })
          session.append('tool/call', { turn: 2, step: 1, callId: CallId('c1'), name: 'bash', arguments: '{}' })
          session.append('tool/result', {
            turn: 2, step: 1,
            message: createToolResultMessage({ callId: CallId('c1'), content: [{ type: 'text', text: '' }], isError: true }),
            error: { name: 'TestError', code: 'TEST' },
          }, { surfaceOp: 'append' })
          // A successful result renders `ok`.
          session.append('tool/call', { turn: 2, step: 1, callId: CallId('c2'), name: 'read', arguments: '{"path":"a"}' })
          session.append('tool/result', {
            turn: 2, step: 1,
            message: createToolResultMessage({ callId: CallId('c2'), content: [{ type: 'text', text: 'ok' }], isError: false }),
          }, { surfaceOp: 'append' })
          session.append('step/end', { turn: 2, step: 1 })
          session.append('turn/end', { turn: 2, reason: { kind: 'error', error: { code: 'SERVER', message: 'down' } } })
          session.append('todo/write', { todos: [] })
          // An unknown durable type falls through to the bare-name line.
          session.append('session/end-seed', {})
          session.append('user/message', message, { surfaceOp: 'append' })
        },
      },
    )
    const result = await test.run()
    console.log('TRACE OUT2=', JSON.stringify(result.out), 'code=', result.code, 'err=', JSON.stringify(result.err))
    expect(result.out).toContain('[user]')
    expect(result.out).toContain('[assistant] visible')
    expect(result.out).toContain('[assistant]')
    expect(result.out).toContain('[tool] bash {}')
    expect(result.out).toContain('[tool/result] error TestError')
    expect(result.out).toContain('[tool/result] ok')
    expect(result.out).toContain('[turn/end] 2 error')
    expect(result.out).toContain('[todo] 0 items')
    expect(result.out).toContain('[session/end-seed]')
    await test.ctx.fiber.dispose()
  })

  it('sanitizes control bytes in traced output', async () => {
    const test = await bench(
      [
        { kind: 'char', char: 'x' },
        { kind: 'submit' },
        { kind: 'ctrl-c' },
      ],
      {},
      {
        afterFollowup: (_ctx, session, message) => {
          session.append('turn/start', { turn: 1 })
          session.append('step/start', { turn: 1, step: 1 })
          session.append('user/message', message, { surfaceOp: 'append' })
          session.append('tool/call', {
            turn: 1, step: 1, callId: CallId('call-1'), name: 'bash', arguments: '"\u001b]52;c;evil\u0007"',
          })
          session.append('step/end', { turn: 1, step: 1 })
          session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        },
      },
    )
    const result = await test.run()
    expect(result.out).toContain('[tool] bash')
    expect(result.out).toContain('\\x1b')
    await test.ctx.fiber.dispose()
  })

  it('filters other sessions out of the trace (subagent isolation)', async () => {
    const test = await bench(
      [
        { kind: 'char', char: 'x' },
        { kind: 'submit' },
        { kind: 'ctrl-c' },
      ],
      {},
      {
        afterFollowup: (ctx, session, message) => {
          // A sibling session (e.g. a subagent) emits its own events; the
          // root listener must drop them before they reach the transcript.
          const other = ctx.sessions.create()
          other.append('turn/start', { turn: 1 })
          other.append('user/message', {
            role: 'user', content: [{ type: 'text', text: 'subagent noise' }], source: { kind: 'user' }, id: MessageId('s1'),
          }, { surfaceOp: 'append' })
          appendTurn(session, message, 'main ok')
        },
      },
    )
    const result = await test.run()
    expect(result.out).toContain('[assistant] main ok')
    expect(result.out).not.toContain('subagent noise')
    await test.ctx.fiber.dispose()
  })

  it('restores the terminal and force-exits on an uncaughtException', async () => {
    const ctx = new Context()
    const emitter = new EventEmitter()
    const hardExits: number[] = []
    const rawMode: boolean[] = []
    internals.stdout = { write: () => true }
    internals.stderr = { write: () => true }
    internals.device = { isTTY: true, setRawMode: (raw) => { rawMode.push(raw) } }
    internals.hardExit = (code) => { hardExits.push(code) }
    internals.crashEmitter = emitter
    internals.createInput = () => new ScriptedInput([])
    ctx.provide('appExit', () => {})
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', {
      create: async () => {
        const session = { id: 'session-x' } as Session
        const agent = { session, status: 'idle', ctx: new Context(), cancel: () => {}, followup: () => {}, steer: () => {} } as unknown as Agent
        return { agent, dispose: () => Promise.resolve() }
      },
      resume: () => Promise.reject(new Error('not used')),
    } as never)
    apply(ctx, new Config({}))
    emitter.emit('uncaughtException', new Error('boom'))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(hardExits).toEqual([1])
    expect(rawMode).toEqual([true, false])
    await ctx.fiber.dispose()
  })

  it('applies the permission preset at session creation', async () => {
    const ctx = new Context()
    const permissions: Array<{ session: Session; name: string }> = []
    ctx.provide('permissionPresets', { set: (session: Session, name: string) => { permissions.push({ session, name }) } } as never)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', {
      create: async () => {
        const session = { id: 'session-x' } as Session
        const agent = { session, status: 'idle', ctx: new Context(), cancel: () => {}, followup: () => {}, steer: () => {} } as unknown as Agent
        return { agent, dispose: () => Promise.resolve() }
      },
      resume: () => Promise.reject(new Error('not used')),
    } as never)
    let err = ''
    let resolved: (code: number) => void = () => {}
    const exited = new Promise<number>((resolve) => { resolved = resolve })
    ctx.provide('appExit', resolved)
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    internals.device = { isTTY: true, setRawMode: () => {} }
    internals.hardExit = () => {}
    internals.createInput = () => new ScriptedInput([{ kind: 'ctrl-c' }])
    apply(ctx, new Config({ permission: 'danger-full-access' }))
    expect(await exited).toBe(0)
    expect(permissions).toHaveLength(1)
    expect(permissions[0]!.name).toBe('danger-full-access')
    expect(err).toBe('')
    await ctx.fiber.dispose()
  })

  it('fails loud when --permission is given without the permission service', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    internals.device = { isTTY: true, setRawMode: () => {} }
    internals.hardExit = () => {}
    internals.createInput = () => new ScriptedInput([])
    let resolved: (code: number) => void = () => {}
    const exited = new Promise<number>((resolve) => { resolved = resolve })
    ctx.provide('appExit', resolved)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', {
      create: async () => {
        const session = { id: 'session-x' } as Session
        const agent = { session, status: 'idle', ctx: new Context(), cancel: () => {}, followup: () => {}, steer: () => {} } as unknown as Agent
        return { agent, dispose: () => Promise.resolve() }
      },
      resume: () => Promise.reject(new Error('not used')),
    } as never)
    apply(ctx, new Config({ permission: 'danger-full-access' }))
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: tui-runner: --permission needs the dsh-permission-presets service\n')
    await ctx.fiber.dispose()
  })

  it('reports a direct Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    internals.device = { isTTY: true, setRawMode: () => {} }
    internals.hardExit = () => {}
    internals.createInput = () => new ScriptedInput([])
    let resolved: (code: number) => void = () => {}
    const exited = new Promise<number>((resolve) => { resolved = resolve })
    ctx.provide('appExit', resolved)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', { create: () => Promise.reject(new Error('factory exploded')), resume: () => Promise.reject(new Error('not used')) } as never)
    apply(ctx, new Config({}))
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('stringifies a non-Error Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    internals.device = { isTTY: true, setRawMode: () => {} }
    internals.hardExit = () => {}
    internals.createInput = () => new ScriptedInput([])
    let resolved: (code: number) => void = () => {}
    const exited = new Promise<number>((resolve) => { resolved = resolve })
    ctx.provide('appExit', resolved)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    const rejected = {
      then(_resolve: (value: never) => void, reject: (reason: unknown) => void): void {
        reject('factory exploded')
      },
    }
    ctx.provide('agents', { create: () => rejected, resume: () => Promise.reject(new Error('not used')) } as never)
    apply(ctx, new Config({}))
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('abandons the run when core services are missing', async () => {
    const ctx = new Context()
    internals.stdout = { write: () => true }
    internals.stderr = { write: () => true }
    internals.device = { isTTY: true, setRawMode: () => {} }
    internals.hardExit = () => {}
    internals.createInput = () => new ScriptedInput([])
    let resolved: (code: number) => void = () => {}
    const exited = new Promise<number>((resolve) => { resolved = resolve })
    ctx.provide('appExit', resolved)
    apply(ctx, new Config({}))
    // No agents/agentDefaultModel/sessions: run() returns without exiting.
    const settled = await Promise.race([exited, new Promise<'pending'>((resolve) => { setTimeout(() => { resolve('pending') }, 20) })])
    expect(settled).toBe('pending')
    await ctx.fiber.dispose()
  })

  it('fails loud without the launcher-provided exit request', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, new Config({})) }).toThrow('must provide ctx.appExit')
  })

  it('validates config: every field is optional', () => {
    expect(new Config({})).toEqual({})
    expect(new Config({ resume: 'a', workspace: '/w', model: 'p/m', permission: 'read-only' })).toEqual({
      resume: 'a', workspace: '/w', model: 'p/m', permission: 'read-only',
    })
    expect(() => new Config({ model: 42 } as never)).toThrow()
  })
})

describe('StdinInputSource', () => {
  function fakeStream(): NodeJS.ReadStream & EventEmitter {
    return new EventEmitter() as unknown as NodeJS.ReadStream
  }

  it('decodes bytes into keys and buffers them for next()', async () => {
    const stream = fakeStream()
    const source = new StdinInputSource(stream)
    stream.emit('data', Buffer.from('hi\x03'))
    expect(await source.next()).toEqual({ kind: 'char', char: 'h' })
    expect(await source.next()).toEqual({ kind: 'char', char: 'i' })
    expect(await source.next()).toEqual({ kind: 'ctrl-c' })
    source.dispose()
  })

  it('routes Enter, backspace, ESC, and unprintable bytes correctly', async () => {
    const stream = fakeStream()
    const source = new StdinInputSource(stream)
    stream.emit('data', Buffer.from('\r\x7f\x1b[A\x00'))
    expect(await source.next()).toEqual({ kind: 'submit' })
    expect(await source.next()).toEqual({ kind: 'backspace' })
    // ESC begins a dropped key sequence; the following `[A` bytes are ordinary
    // printable characters, and \x00 is not printable.
    expect(await source.next()).toEqual({ kind: 'char', char: '[' })
    expect(await source.next()).toEqual({ kind: 'char', char: 'A' })
    stream.emit('end')
    expect(await source.next()).toBeUndefined()
    source.dispose()
  })

  it('resolves pending next() waiters when data arrives', async () => {
    const stream = fakeStream()
    const source = new StdinInputSource(stream)
    const pending = source.next()
    stream.emit('data', Buffer.from('z'))
    expect(await pending).toEqual({ kind: 'char', char: 'z' })
    source.dispose()
  })

  it('survives multi-byte UTF-8 split across chunks', async () => {
    const stream = fakeStream()
    const source = new StdinInputSource(stream)
    const bytes = Buffer.from('你')
    stream.emit('data', bytes.subarray(0, 1))
    stream.emit('data', bytes.subarray(1))
    expect(await source.next()).toEqual({ kind: 'char', char: '你' })
    source.dispose()
  })

  it('resolves undefined at EOF and drains pending waiters', async () => {
    const stream = fakeStream()
    const source = new StdinInputSource(stream)
    const pending = source.next()
    stream.emit('end')
    expect(await pending).toBeUndefined()
    expect(await source.next()).toBeUndefined()
    source.dispose()
  })

  it('detaches its listeners on dispose', () => {
    const stream = fakeStream()
    const source = new StdinInputSource(stream)
    source.dispose()
    expect(stream.listenerCount('data')).toBe(0)
    expect(stream.listenerCount('end')).toBe(0)
  })

  it('default createInput wraps process.stdin', () => {
    const input = originalInternals.createInput() as StdinInputSource
    expect(input).toBeInstanceOf(StdinInputSource)
    input.dispose()
  })

  it('default hardExit forces the process to exit', () => {    const spy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exited') })
    try {
      expect(() => { originalInternals.hardExit(130) }).toThrow('exited')
    } finally {
      spy.mockRestore()
    }
  })

  it('default device toggles raw mode on process.stdin', () => {
    if (process.stdin.isTTY) {
      originalInternals.device.setRawMode(true)
      originalInternals.device.setRawMode(false)
    } else {
      // A non-TTY stdin rejects raw mode; the default closure still runs and
      // surfaces the stream's error instead of silently succeeding.
      expect(() => { originalInternals.device.setRawMode(true) }).toThrow()
    }
  })
})
