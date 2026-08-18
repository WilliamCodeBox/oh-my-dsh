/**
 * Behavioral tests for the detail-overlay tab content: per-tab bodies for
 * every trajectory kind, degraded texts for absent payloads, the line cap
 * with its remainder marker, and the kind display labels.
 */

import { describe, expect, it } from 'vitest'
import { cappedLines, detailBody, DETAIL_LINE_CAP, KIND_LABEL } from '../src/detail.ts'
import type { TrajectoryCellProps } from '@williamcodebox/omd-client-trajectory-model'

/** Minimal cell with the optional fields filled per test. */
function cell(partial: Partial<TrajectoryCellProps> = {}): TrajectoryCellProps {
  return {
    index: 1,
    kind: 'tool',
    text: 'bash',
    timeSeconds: null,
    ...partial,
  }
}

describe('cappedLines', () => {
  it('passes short text through unchanged', () => {
    expect(cappedLines('a\nb')).toEqual(['a', 'b'])
  })

  it('caps long text with an explicit remainder marker', () => {
    const lines = Array.from({ length: DETAIL_LINE_CAP + 3 }, (_, index) => `line ${index}`)
    const capped = cappedLines(lines.join('\n'))
    expect(capped).toHaveLength(DETAIL_LINE_CAP + 1)
    expect(capped.at(-1)).toBe('… (+3 more lines)')
  })
})

describe('KIND_LABEL', () => {
  it('maps every trajectory kind to a display label', () => {
    expect(KIND_LABEL).toEqual({
      system: 'System',
      user: 'User',
      context: 'Context',
      compacted: 'Compacted',
      message: 'Message',
      tool: 'Tool',
      subtool: 'Subtool',
    })
  })
})

describe('detailBody', () => {
  it('renders the tool tab set with payload, result, schema, and timing', () => {
    const tool = cell({
      kind: 'tool',
      text: 'bash {"cmd":"ls"}',
      result: 'file list',
      inputDetail: '{"cmd":"ls"}',
      outputDetail: 'file list',
      schemaDetail: '{"name":"bash"}',
      startedAt: 1_000,
      timeSeconds: 2,
    })
    expect(detailBody(tool, 'overview')).toBe('bash {"cmd":"ls"}\nfile list')
    expect(detailBody(tool, 'input')).toBe('{"cmd":"ls"}')
    expect(detailBody(tool, 'output')).toBe('file list')
    expect(detailBody(tool, 'schema')).toBe('{"name":"bash"}')
    expect(detailBody(tool, 'timing')).toContain('Duration: 2,000 ms')
    expect(detailBody(tool, 'timing')).toContain('Started: 1970-01-01T00:00:01.000Z')
  })

  it('degrades absent payloads and schemas with explicit notices', () => {
    const bare = cell()
    expect(detailBody(bare, 'input')).toBe('No payload captured')
    expect(detailBody(bare, 'output')).toBe('No output captured')
    expect(detailBody(bare, 'schema')).toBe('Schema unavailable')
    expect(detailBody(bare, 'timing')).toContain('Duration: —')
    expect(detailBody(bare, 'timing')).toContain('Started: —')
  })

  it('renders message cells: summary, preview, raw, and source', () => {
    const message = cell({
      kind: 'message',
      text: 'hello',
      previewMarkdown: 'hello **world**',
      outputDetail: 'hello **world**',
      messageSource: { kind: 'user' },
    })
    expect(detailBody(message, 'overview')).toBe('hello')
    expect(detailBody(message, 'rendered')).toBe('hello **world**')
    expect(detailBody(message, 'raw')).toBe('hello **world**')
    expect(detailBody(message, 'source')).toBe('{\n  "kind": "user"\n}')
  })

  it('renders a message timing tab with TTFT and generation from the metrics', () => {
    const message = cell({
      kind: 'message',
      text: 'hi',
      startedAt: 1_000,
      timeSeconds: 5,
      assistantMetrics: {
        timingRecorded: true,
        stepStartTime: 1_000,
        firstTokenTime: 1_500,
        completedTime: 6_000,
        usageProvided: true,
        outputTokens: 10,
      },
    })
    const timing = detailBody(message, 'timing')
    expect(timing).toContain('TTFT: 500 ms')
    expect(timing).toContain('Generation: 4,500 ms')
  })

  it('renders compacted cells with summary and raw output', () => {
    const compacted = cell({
      kind: 'compacted',
      text: 'summary line 1',
      outputDetail: 'summary line 1\nsummary line 2',
    })
    expect(detailBody(compacted, 'overview')).toBe('summary line 1')
    expect(detailBody(compacted, 'raw')).toBe('summary line 1\nsummary line 2')
  })

  it('renders system cells with prompt, tools, and the update diff', () => {
    const system = cell({
      kind: 'system',
      text: 'System Prompt Updated',
      promptDetail: {
        config: { provider: 'p', model: 'm' },
        system: 'line one\nline two\nline three',
        tools: [
          { name: 'bash', description: 'run', parameters: { type: 'object' } },
          { name: 'read', description: 'read files', parameters: {} },
        ],
      },
      previousPromptDetail: {
        config: { provider: 'p', model: 'm' },
        system: 'line one\nline three',
        tools: [{ name: 'bash', description: 'run', parameters: { type: 'object' } }],
      },
    })
    expect(detailBody(system, 'system-prompt')).toBe('line one\nline two\nline three')
    const tools = detailBody(system, 'tools')
    expect(tools).toContain('bash — run')
    expect(tools).toContain('"type": "object"')
    const diff = detailBody(system, 'diff')
    expect(diff).toContain('--- previous')
    expect(diff).toContain('+ line two')
    expect(diff).toContain('+ tool read')
  })

  it('degrades system cells without a recorded prompt', () => {
    const bare = cell({ kind: 'system', text: 'Initial System Prompt' })
    expect(detailBody(bare, 'system-prompt')).toBe('No system prompt recorded')
    expect(detailBody(bare, 'tools')).toBe('No tools recorded')
    expect(detailBody(bare, 'diff')).toBe('No previous prompt recorded')
  })

  it('renders degraded preview, raw, and source for missing content', () => {
    const bare = cell({ kind: 'user', text: '' })
    expect(detailBody(bare, 'rendered')).toBe('No preview available')
    expect(detailBody(bare, 'raw')).toBe('No output recorded')
    expect(detailBody(bare, 'source')).toBe('No source recorded')
  })
})
