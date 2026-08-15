/**
 * Folded terminal transcript model for the dsh TUI surface.
 *
 * The model consumes the durable `session/event` stream of one owned session
 * and projects it into display items for a terminal renderer: user messages,
 * streaming-then-finalized assistant messages, tool call/result cards, and
 * turn brackets. Log-only facts the renderer shows beside the transcript
 * (todo list, request header, provider route) stay on the folded state.
 *
 * Transcript source material is append-origin surface events only. The
 * session surface contract (`isAppendSurfaceEvent` in
 * `packages/core/session/src/surface.ts`) names append-origin events "that
 * transcript's durable source material" and keeps replacement copies
 * model-only, because a landed compaction replacement would erase
 * conversation the human already saw. A replacement therefore records a
 * {@link CompactionNote} on the state and leaves the folded items untouched.
 *
 * @module @deepseek-ai/dsh-tui-renderer
 */

import type { JsonValue, SessionEvent, SurfaceEvent, SurfaceOp, TodoItem, TurnEndReason } from '@deepseek-ai/dsh-session'
import { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { AssistantMessage, MessageSource, TokenUsage } from '@deepseek-ai/dsh-llm'
// The command/run + command/done event shapes ride the CommandRuntime merge.
import type {} from '@deepseek-ai/dsh-commands/types'

/** A replacement surface event narrowed by {@link isReplacementSurfaceEvent}. */
type ReplacementSurfaceEvent = SurfaceEvent & { surfaceOp: Extract<SurfaceOp, { op: 'replace' }> }

/** Text of all `text` blocks in one content list, in block order. */
export function textOf(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

/** One compaction replacement observed while folding. */
export interface CompactionNote {
  /** Seq of the event that replaced the prior surface range. */
  readonly seq: number
  /** Declared inclusive start seq of the replaced surface range. */
  readonly start: number
  /** Declared inclusive end seq of the replaced surface range. */
  readonly end: number
  /** Surface event seqs shadowed by the replacement, when the event cited them. */
  readonly shadowedSeqs: readonly number[]
}

/** Fields every folded transcript item carries. */
interface TranscriptItemBase {
  /** Seq of the event that created or finalized the item. */
  readonly seq: number
  /** Event timestamp in Unix epoch milliseconds. */
  readonly time: number
}

/** A human user message on the transcript. */
export interface UserItem extends TranscriptItemBase {
  readonly kind: 'user'
  /** Joined text blocks of the user message. */
  readonly text: string
  /** Producer source of the message, when the event carried one. */
  readonly source?: MessageSource
  /** Turn open when the message was folded, when one was. */
  readonly turn?: number
}

/** Mutable internal assistant item the fold updates while streaming. */
interface MutableAssistantItem {
  kind: 'assistant'
  seq: number
  time: number
  turn: number
  step: number
  text: string
  usage?: TokenUsage
  message?: AssistantMessage
  streaming: boolean
}

/** An assistant message: streamed from chunks, finalized by the assembled message. */
export interface AssistantItem extends TranscriptItemBase {
  readonly kind: 'assistant'
  readonly turn: number
  readonly step: number
  /** Visible text: chunk deltas while streaming, the assembled content at finalization. */
  readonly text: string
  /** Token accounting from the assembled message, when the adapter reported it. */
  readonly usage?: TokenUsage
  /** Assembled message, present once the stream finalized. */
  readonly message?: AssistantMessage
  /** True while chunks stream and no assembled message has finalized the item. */
  readonly streaming: boolean
}

/** A completed tool call's model-facing result, merged into its card. */
export interface ToolResult extends TranscriptItemBase {
  /** Model-facing result text. */
  readonly text: string
  /** Internal failure identity, when the call failed. */
  readonly error?: { readonly name: string; readonly code: string }
  /** Tool-private presentation payload (e.g. `dsh-tool-fs`'s contextual diff). */
  readonly meta?: JsonValue
}

/** One tool invocation card: the model's call, with its result when it arrived. */
export interface ToolItem extends TranscriptItemBase {
  readonly kind: 'tool'
  readonly turn: number
  readonly step: number
  /** Call id pairing the call with its `tool/result`. */
  readonly callId: string
  /** Tool name the model requested. */
  readonly name: string
  /** Raw model-produced arguments JSON, unparsed. */
  readonly args: string
  /** Paired result, when the `tool/result` event arrived. */
  readonly result?: ToolResult
}

/** A turn bracket: opened by `turn/start`, closed by `turn/end`. */
export interface TurnItem extends TranscriptItemBase {
  readonly kind: 'turn'
  readonly turn: number
  /** When and why the turn ended; absent while the turn is open. */
  readonly end?: { readonly time: number; readonly reason: TurnEndReason }
}

/** A settled slash-command outcome, merged into its lifecycle card. */
export interface CommandResult extends TranscriptItemBase {
  readonly kind: 'success' | 'error'
  /** Handler text; absent for a bare success. */
  readonly text?: string
}

/**
 * A slash-command card: opened by `command/run`, settled by the paired
 * `command/done`. Commands are turn-external log-only appends, so the card
 * never opens or closes a turn bracket.
 */
export interface CommandItem extends TranscriptItemBase {
  readonly kind: 'command'
  /** Pairing id carried by the lifecycle events. */
  readonly commandId: string
  /** Command name without the leading slash. */
  readonly name: string
  /** Raw input after the name; empty when none. */
  readonly args: string
  /** Settled outcome, when `command/done` was folded. */
  readonly result?: CommandResult
}

/** One item in the folded transcript surface. */
export type TranscriptItem = UserItem | AssistantItem | ToolItem | TurnItem | CommandItem

/** Readonly projection of the folded transcript and its side state. */
export interface TranscriptState {
  /** Folded transcript items in event order. Do not mutate; fold replaces items in place. */
  readonly items: readonly TranscriptItem[]
  /** Latest todo-list snapshot; last write wins on replay. */
  readonly todos: readonly TodoItem[]
  /** Latest request header (config, system prompt, tools), when one was logged. */
  readonly header?: SessionEvent<'request/header'>['data']['header']
  /** Latest provider route metadata, when one was logged. */
  readonly context?: SessionEvent<'request/context'>['data']
  /** Token totals across all finalized assistant messages. */
  readonly usage: TokenUsage
  /** Seq of the `session/end-seed` marker, when the log carries one; absent otherwise. */
  readonly seedEndSeq?: number
  /** Compaction replacements observed while folding, in event order. */
  readonly compactions: readonly CompactionNote[]
}

/**
 * Fold one session's durable events into a terminal transcript.
 *
 * Feed events in sequence order — stored seed events first on resume, live
 * events as they emit. Each {@link Transcript.fold} call applies one event and
 * notifies listeners. The transcript keeps append-origin surface material
 * verbatim; compaction replacements surface as {@link CompactionNote}s only.
 */
export class Transcript {
  private items: TranscriptItem[] = []
  private todos: TodoItem[] = []
  private header: TranscriptState['header']
  private context: TranscriptState['context']
  private seedEndSeq?: number
  private compactions: CompactionNote[] = []
  private currentTurn?: number
  private pending: MutableAssistantItem | undefined
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  private readonly listeners = new Set<() => void>()

  /** Subscribe to fold changes; returns the disposer. */
  on(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Current folded state. */
  get state(): TranscriptState {
    return {
      items: this.items,
      todos: this.todos,
      usage: this.totalUsage,
      compactions: this.compactions,
      ...(this.header !== undefined ? { header: this.header } : {}),
      ...(this.context !== undefined ? { context: this.context } : {}),
      ...(this.seedEndSeq !== undefined ? { seedEndSeq: this.seedEndSeq } : {}),
    }
  }

  /** Apply one session event to the transcript. */
  fold(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        this.currentTurn = event.data.turn
        this.items.push({ kind: 'turn', seq: event.seq, time: event.time, turn: event.data.turn })
        break
      case 'turn/end':
        this.closePending()
        this.closeTurn(event.data.turn, event.time, event.data.reason)
        break
      case 'user/message':
        if (isAppendSurfaceEvent(event)) {
          this.closePending()
          this.pushUserItem(event)
        } else if (isReplacementSurfaceEvent(event)) {
          this.recordCompaction(event)
        }
        // A surface-eligible event without a surfaceOp marker cannot come from
        // the session writer contract; it is appended defensively below.
        else {
          this.pushUserItem(event)
        }
        break
      case 'assistant/chunk': {
        const { turn, step, chunk } = event.data
        if (chunk.type !== 'text-delta') break
        if (this.pending === undefined || this.pending.turn !== turn || this.pending.step !== step) {
          this.closePending()
          this.pending = {
            kind: 'assistant',
            seq: event.seq,
            time: event.time,
            turn,
            step,
            text: chunk.text,
            streaming: true,
          }
          this.items.push(this.pending)
        } else {
          this.pending.text += chunk.text
        }
        break
      }
      case 'assistant/message': {
        const { turn, step, message, usage } = event.data
        if (usage !== undefined) this.accumulateUsage(usage)
        if (isAppendSurfaceEvent(event)) {
          if (this.pending !== undefined && this.pending.turn === turn && this.pending.step === step) {
            this.pending.text = textOf(message.content)
            if (usage !== undefined) this.pending.usage = usage
            this.pending.message = message
            this.pending.streaming = false
            this.pending = undefined
          } else {
            this.closePending()
            this.items.push({
              kind: 'assistant',
              seq: event.seq,
              time: event.time,
              turn,
              step,
              text: textOf(message.content),
              ...(usage !== undefined ? { usage } : {}),
              message,
              streaming: false,
            })
          }
        } else if (isReplacementSurfaceEvent(event)) {
          this.recordCompaction(event)
        }
        break
      }
      case 'tool/call': {
        const { turn, step, callId, name, arguments: args } = event.data
        this.closePending()
        this.items.push({ kind: 'tool', seq: event.seq, time: event.time, turn, step, callId, name, args })
        break
      }
      case 'tool/result': {
        const { turn, step, message, error, meta } = event.data
        if (isAppendSurfaceEvent(event)) {
          const result: ToolResult = {
            seq: event.seq,
            time: event.time,
            text: textOf(message.content[0].content),
            ...(error !== undefined ? { error } : {}),
            ...(meta !== undefined ? { meta } : {}),
          }
          const callId = message.content[0].toolCallId
          this.mergeToolResult(callId, turn, step, event.seq, event.time, result)
        } else if (isReplacementSurfaceEvent(event)) {
          this.recordCompaction(event)
        }
        break
      }
      case 'todo/write':
        this.todos = event.data.todos
        break
      case 'command/run':
        this.items.push({
          kind: 'command',
          seq: event.seq,
          time: event.time,
          commandId: event.data.commandId,
          name: event.data.name,
          args: event.data.args ?? '',
        })
        break
      case 'command/done': {
        const { commandId, kind, text } = event.data
        this.closePending()
        this.mergeCommandResult(commandId, event.seq, event.time, kind, text)
        break
      }
      case 'request/header':
        this.header = event.data.header
        break
      case 'request/context':
        this.context = event.data
        break
      case 'session/end-seed':
        this.seedEndSeq = event.seq
        break
      default:
        // Log-only or plugin-extended event types the transcript does not
        // surface. Merge-extensible union: no assertNever here.
        break
    }
    for (const listener of this.listeners) listener()
  }

  /** Close an open streaming assistant item, keeping its partial text. */
  private closePending(): void {
    if (this.pending === undefined) return
    this.pending.streaming = false
    this.pending = undefined
  }

  /** Accumulate one finalized message's token accounting into the total. */
  private accumulateUsage(usage: TokenUsage): void {
    this.totalUsage = {
      inputTokens: this.totalUsage.inputTokens + usage.inputTokens,
      outputTokens: this.totalUsage.outputTokens + usage.outputTokens,
    }
  }

  /** Append one append-origin user message item. */
  private pushUserItem(event: SessionEvent<'user/message'>): void {
    this.items.push({
      kind: 'user',
      seq: event.seq,
      time: event.time,
      text: textOf(event.data.content),
      source: event.data.source,
      ...(this.currentTurn !== undefined ? { turn: this.currentTurn } : {}),
    })
  }

  /** Close the open turn bracket for `turn` with the ending reason. */
  private closeTurn(turn: number, time: number, reason: TurnEndReason): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]
      if (item === undefined) continue
      if (item.kind === 'turn' && item.turn === turn && item.end === undefined) {
        ;(item as { end?: TurnItem['end'] }).end = { time, reason }
        return
      }
    }
  }

  /**
   * Merge a completed result into its open tool card, creating the card from
   * the result event when the pairing `tool/call` was not folded (defensive;
   * the call precedes its result in every real log).
   */
  private mergeToolResult(
    callId: string,
    turn: number,
    step: number,
    seq: number,
    time: number,
    result: ToolResult,
  ): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]
      if (item === undefined) continue
      if (item.kind === 'tool' && item.callId === callId && item.result === undefined) {
        ;(item as { result?: ToolResult }).result = result
        return
      }
    }
    this.items.push({ kind: 'tool', seq, time, turn, step, callId, name: '', args: '', result })
  }

  /**
   * Merge a settled outcome into its open command card, creating the card
   * from the result event when the pairing `command/run` was not folded
   * (defensive; the run precedes its done in every real log).
   */
  private mergeCommandResult(
    commandId: string,
    seq: number,
    time: number,
    kind: 'success' | 'error',
    text: string | undefined,
  ): void {
    const result: CommandResult = { seq, time, kind, ...(text !== undefined ? { text } : {}) }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]
      if (item === undefined) continue
      if (item.kind === 'command' && item.commandId === commandId && item.result === undefined) {
        ;(item as { result?: CommandResult }).result = result
        return
      }
    }
    this.items.push({ kind: 'command', seq, time, commandId, name: '', args: '', result })
  }

  /** Record a compaction replacement; the folded transcript is untouched. */
  private recordCompaction(event: ReplacementSurfaceEvent): void {
    const { start, end } = event.surfaceOp
    this.compactions.push({
      seq: event.seq,
      start,
      end,
      shadowedSeqs: event.sourceEventSeqs ?? [],
    })
  }
}
