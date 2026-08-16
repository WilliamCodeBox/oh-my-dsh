/**
 * Behavioral tests for the semantic theme system: SGR generation per token,
 * markdown/editor sub-themes, and scheme resolution with the dark fallback.
 */

import { describe, expect, it } from 'vitest'
import { darkTheme, lightTheme, themeForScheme } from '../src/theme.ts'

describe('darkTheme', () => {
  it('wraps text in the 256-color SGR of each foreground token', () => {
    expect(darkTheme.fg('accent', 'x')).toBe('\x1b[38;5;117mx\x1b[0m')
    expect(darkTheme.fg('muted', 'x')).toBe('\x1b[38;5;245mx\x1b[0m')
    expect(darkTheme.fg('error', 'x')).toBe('\x1b[38;5;167mx\x1b[0m')
  })

  it('wraps text in the background SGR of each background token', () => {
    expect(darkTheme.bg('userBg', 'x')).toBe('\x1b[48;5;237mx\x1b[0m')
    expect(darkTheme.bg('toolPendingBg', 'x')).toBe('\x1b[48;5;236mx\x1b[0m')
    expect(darkTheme.bg('toolErrorBg', 'x')).toBe('\x1b[48;5;234mx\x1b[0m')
  })

  it('builds markdown styles from the palette', () => {
    expect(darkTheme.markdown.heading('t')).toBe('\x1b[1m\x1b[38;5;117mt\x1b[0m\x1b[0m')
    expect(darkTheme.markdown.bold('t')).toBe('\x1b[1mt\x1b[0m')
    expect(darkTheme.markdown.italic('t')).toBe('\x1b[3mt\x1b[0m')
    expect(darkTheme.markdown.codeBlockBorder('t')).toBe('\x1b[38;5;239mt\x1b[0m')
  })

  it('styles the editor border with the accent color', () => {
    expect(darkTheme.editor.borderColor('t')).toBe('\x1b[38;5;117mt\x1b[0m')
    expect(darkTheme.editor.selectList.selectedPrefix('t')).toBe('\x1b[38;5;117mt\x1b[0m')
  })
})

describe('lightTheme', () => {
  it('differs from the dark palette on key roles', () => {
    expect(lightTheme.fg('text', 'x')).not.toBe(darkTheme.fg('text', 'x'))
    expect(lightTheme.bg('userBg', 'x')).not.toBe(darkTheme.bg('userBg', 'x'))
    expect(lightTheme.bg('toolSuccessBg', 'x')).toBe('\x1b[48;5;194mx\x1b[0m')
  })
})

describe('themeForScheme', () => {
  it('selects the light theme for a light scheme report', () => {
    expect(themeForScheme('light')).toBe(lightTheme)
  })

  it('falls back to the dark theme otherwise', () => {
    expect(themeForScheme('dark')).toBe(darkTheme)
    expect(themeForScheme(undefined)).toBe(darkTheme)
  })
})
