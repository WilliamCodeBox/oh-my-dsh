/** Display sanitizer: control bytes become visible hex escapes, plain text passes through. */

import { describe, expect, it } from 'vitest'
import { needsSanitize, sanitizeText } from '../src/sanitize.ts'

describe('sanitizeText', () => {
  it('returns the same reference for plain text', () => {
    const text = 'plain text with tabs\tand newlines\n'
    expect(sanitizeText(text)).toBe(text)
    expect(needsSanitize(text)).toBe(false)
  })

  it('escapes ESC and other C0 controls as visible hex', () => {
    expect(sanitizeText('a\x1b[2Jb')).toBe('a\\x1b[2Jb')
    expect(sanitizeText('\x07bell')).toBe('\\x07bell')
    expect(needsSanitize('\x1b')).toBe(true)
  })

  it('escapes DEL and C1 controls', () => {
    expect(sanitizeText('a\x7fb')).toBe('a\\x7fb')
    expect(sanitizeText('a\x9bc')).toBe('a\\x9bc')
  })

  it('preserves tab, LF, and CR verbatim', () => {
    expect(sanitizeText('a\tb\nc\rd')).toBe('a\tb\nc\rd')
  })

  it('escapes a full OSC clipboard sequence so it cannot reach the terminal', () => {
    const osc52 = '\x1b]52;c;aGVsbG8=\x07'
    expect(sanitizeText(osc52)).toBe('\\x1b]52;c;aGVsbG8=\\x07')
  })

  it('keeps non-ASCII text verbatim while escaping controls beside it', () => {
    expect(sanitizeText('\x1b你好')).toBe('\\x1b你好')
  })

  it('preserves tab and CR inside an otherwise-escaped string', () => {
    expect(sanitizeText('\x1b\t\r')).toBe('\\x1b\t\r')
  })
})
