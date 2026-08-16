/**
 * Behavioral tests for the regex syntax highlighter: keyword/string/comment
 * tokenization per language, JSON keys, plain fallback, and empty lines.
 */

import { describe, expect, it } from 'vitest'
import { highlightCode } from '../src/highlight.ts'
import { darkTheme } from '../src/theme.ts'

const fg = darkTheme.fg

describe('highlightCode', () => {
  it('highlights keywords, strings, and comments in TypeScript', () => {
    const lines = highlightCode('const x = "hi" // note', 'ts', fg)
    expect(lines[0]).toContain(darkTheme.fg('syntaxKeyword', 'const'))
    expect(lines[0]).toContain(darkTheme.fg('syntaxString', '"hi"'))
    expect(lines[0]).toContain(darkTheme.fg('syntaxComment', '// note'))
    expect(lines[0]).not.toContain('// note"')
  })

  it('highlights function calls and numbers', () => {
    const lines = highlightCode('run(42)', 'ts', fg)
    expect(lines[0]).toContain(darkTheme.fg('syntaxFunction', 'run'))
    expect(lines[0]).toContain(darkTheme.fg('syntaxNumber', '42'))
  })

  it('highlights JSON keys distinctly', () => {
    const lines = highlightCode('{"path": "a"}', 'json', fg)
    expect(lines[0]).toContain(darkTheme.fg('syntaxType', '"path"'))
    expect(lines[0]).toContain(darkTheme.fg('syntaxString', '"a"'))
  })

  it('leaves plain text uncolored without a language', () => {
    const lines = highlightCode('just some text', 'text', fg)
    expect(lines[0]).toBe('just some text')
  })

  it('preserves empty lines', () => {
    const lines = highlightCode('a\n\nb', 'ts', fg)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('')
  })

  it('does not color keywords inside strings', () => {
    const lines = highlightCode('const s = "const"', 'ts', fg)
    const first = lines[0].indexOf(darkTheme.fg('syntaxKeyword', 'const'))
    const second = lines[0].indexOf(darkTheme.fg('syntaxKeyword', 'const'), first + 1)
    // Only the identifier const is a keyword; the string content is not.
    expect(second).toBe(-1)
  })
})
