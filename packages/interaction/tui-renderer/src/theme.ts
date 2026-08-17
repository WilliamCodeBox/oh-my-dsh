/**
 * Semantic color themes for the omd TUI. Each theme maps named roles
 * (text/muted/border/userBg/...) to 256-color palette
 * entries, and exposes fg()/bg() helpers that wrap text in the matching
 * ANSI SGR codes. The presenter and transcript view consume semantic tokens
 * only, so swapping dark/light (or a future user-defined theme) never
 * touches renderer code.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import type { EditorTheme, MarkdownTheme } from '@earendil-works/pi-tui'
import { highlightCode } from './highlight.ts'

/** Semantic color roles the TUI surface uses. */
export type ColorToken =
  | 'text'
  | 'muted'
  | 'dim'
  | 'border'
  | 'accent'
  | 'success'
  | 'error'
  | 'warning'
  | 'command'
  | 'toolTitle'
  | 'toolOutput'
  // Syntax highlighting roles (mapped from token scopes by the highlighter).
  | 'syntaxComment'
  | 'syntaxKeyword'
  | 'syntaxString'
  | 'syntaxNumber'
  | 'syntaxFunction'
  | 'syntaxType'
  | 'syntaxOperator'
  | 'syntaxPunctuation'
  // Diff roles for the tool-card diff viewer.
  | 'diffAdded'
  | 'diffRemoved'
  | 'diffContext'
  | 'diffHunk'

/** Background roles: message layering and tool-card state. */
export type BgToken = 'userBg'

/** One theme's palette: 256-color index per semantic role. */
export interface ThemePalette {
  readonly fg: Record<ColorToken, number>
  readonly bg: Record<BgToken, number>
}

/** 256-color SGR wrappers; both reset after the wrapped text. */
function fgWrap(color: number, text: string): string {
  return `\x1b[38;5;${color}m${text}\x1b[0m`
}
function bgWrap(color: number, text: string): string {
  return `\x1b[48;5;${color}m${text}\x1b[0m`
}

/**
 * A resolved semantic theme. Instances are immutable; construct via
 * {@link themeFor}.
 */
export interface SemanticTheme {
  readonly mode: 'dark' | 'light'
  /** Wrap text in the foreground color of a semantic role. */
  fg: (token: ColorToken, text: string) => string
  /** Wrap text in the background color of a semantic role. */
  bg: (token: BgToken, text: string) => string
  /** pi-tui Markdown component theme, derived from the palette. */
  readonly markdown: MarkdownTheme
  /** pi-tui editor border theme. */
  readonly editor: EditorTheme
}

/**
 * Dark palette: text roles tuned for dark terminals; state reads through the
 * foreground roles (success/error/warning/accent) that color the tool-card
 * bars and outcomes.
 */
const DARK_PALETTE: ThemePalette = {
  fg: {
    text: 252,
    muted: 245,
    dim: 240,
    border: 239,
    accent: 117,
    success: 114,
    error: 167,
    warning: 179,
    command: 177,
    toolTitle: 223,
    toolOutput: 249,
    syntaxComment: 243,
    syntaxKeyword: 177,
    syntaxString: 114,
    syntaxNumber: 179,
    syntaxFunction: 117,
    syntaxType: 81,
    syntaxOperator: 251,
    syntaxPunctuation: 244,
    diffAdded: 114,
    diffRemoved: 167,
    diffContext: 249,
    diffHunk: 179,
  },
  bg: {
    userBg: 237,
  },
}

/** Light palette: pastel roles mirroring the dark foregrounds. */
const LIGHT_PALETTE: ThemePalette = {
  fg: {
    text: 0,
    muted: 8,
    dim: 240,
    border: 250,
    accent: 27,
    success: 28,
    error: 124,
    warning: 94,
    command: 91,
    toolTitle: 94,
    toolOutput: 59,
    syntaxComment: 102,
    syntaxKeyword: 91,
    syntaxString: 28,
    syntaxNumber: 94,
    syntaxFunction: 27,
    syntaxType: 25,
    syntaxOperator: 59,
    syntaxPunctuation: 8,
    diffAdded: 28,
    diffRemoved: 124,
    diffContext: 59,
    diffHunk: 94,
  },
  bg: {
    userBg: 255,
  },
}

/** Build the Markdown component theme from a palette. */
function markdownThemeFor(palette: ThemePalette): MarkdownTheme {
  const fg = fgWrap
  const syntaxFg = (token: ColorToken, text: string): string => fg(palette.fg[token], text)
  return {
    heading: text => `\x1b[1m${fg(palette.fg.accent, text)}\x1b[0m`,
    link: text => `\x1b[4m${fg(palette.fg.accent, text)}\x1b[0m`,
    linkUrl: text => fg(palette.fg.dim, text),
    code: text => fg(palette.fg.toolTitle, text),
    codeBlock: text => fg(palette.fg.text, text),
    codeBlockBorder: text => fg(palette.fg.border, text),
    quote: text => `\x1b[3m${fg(palette.fg.muted, text)}\x1b[0m`,
    quoteBorder: text => fg(palette.fg.border, text),
    hr: text => fg(palette.fg.dim, text),
    listBullet: text => fg(palette.fg.accent, text),
    bold: text => `\x1b[1m${text}\x1b[0m`,
    italic: text => `\x1b[3m${text}\x1b[0m`,
    strikethrough: text => `\x1b[9m${text}\x1b[0m`,
    underline: text => `\x1b[4m${text}\x1b[0m`,
    highlightCode: (code, lang) => highlightCode(code, lang, syntaxFg),
  }
}

/** Build a resolved theme from a palette. */
function themeFor(mode: 'dark' | 'light', palette: ThemePalette): SemanticTheme {
  return {
    mode,
    fg: (token, text) => fgWrap(palette.fg[token], text),
    bg: (token, text) => bgWrap(palette.bg[token], text),
    markdown: markdownThemeFor(palette),
    editor: {
      borderColor: text => fgWrap(palette.fg.accent, text),
      selectList: {
        selectedPrefix: text => fgWrap(palette.fg.accent, text),
        selectedText: text => `\x1b[1m${text}\x1b[0m`,
        description: text => fgWrap(palette.fg.muted, text),
        scrollInfo: text => fgWrap(palette.fg.dim, text),
        noMatch: text => fgWrap(palette.fg.error, text),
      },
    },
  }
}

/** The built-in dark theme (default). */
export const darkTheme: SemanticTheme = themeFor('dark', DARK_PALETTE)

/** The built-in light theme. */
export const lightTheme: SemanticTheme = themeFor('light', LIGHT_PALETTE)

/**
 * Resolve a theme by terminal color-scheme name. `'light'` selects the
 * light theme; anything else (including the absent case) selects dark.
 * @param scheme - terminal-reported scheme, when the launcher queried one.
 */
export function themeForScheme(scheme: 'dark' | 'light' | undefined): SemanticTheme {
  return scheme === 'light' ? lightTheme : darkTheme
}
