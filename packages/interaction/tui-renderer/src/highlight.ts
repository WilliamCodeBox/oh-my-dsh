/**
 * Lightweight regex-based syntax highlighter feeding pi-tui's Markdown
 * `highlightCode` hook. Token scopes map to the theme's `syntax*` roles;
 * no parser dependency, fast enough for per-frame re-highlighting of the
 * last code block while streaming. Languages beyond the keyword sets fall
 * back to the generic tokenizer.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import type { ColorToken } from './theme.ts'

/** Keyword sets per language family. */
const KEYWORDS: Record<string, readonly string[]> = {
  ts: ['if', 'else', 'for', 'while', 'return', 'function', 'const', 'let', 'var', 'import', 'export', 'class', 'async', 'await', 'try', 'catch', 'new', 'type', 'interface', 'enum', 'extends', 'implements', 'from', 'in', 'of', 'typeof', 'instanceof', 'switch', 'case', 'break', 'continue', 'throw', 'yield', 'static', 'readonly', 'public', 'private', 'protected', 'get', 'set', 'delete', 'void', 'null', 'undefined', 'true', 'false', 'this', 'super', 'default', 'declare', 'abstract', 'namespace', 'module', 'as', 'satisfies', 'keyof', 'never', 'unknown', 'any', 'string', 'number', 'boolean', 'bigint', 'symbol', 'object', 'readonly', 'await', 'using', 'async'],
  js: ['if', 'else', 'for', 'while', 'return', 'function', 'const', 'let', 'var', 'import', 'export', 'class', 'async', 'await', 'try', 'catch', 'new', 'typeof', 'instanceof', 'switch', 'case', 'break', 'continue', 'throw', 'yield', 'delete', 'void', 'null', 'undefined', 'true', 'false', 'this', 'super', 'default', 'of', 'in'],
  json: [],
  py: ['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import', 'from', 'as', 'try', 'except', 'finally', 'with', 'lambda', 'yield', 'global', 'nonlocal', 'pass', 'break', 'continue', 'raise', 'assert', 'True', 'False', 'None', 'self', 'async', 'await', 'match', 'case'],
  sh: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'export', 'local', 'return', 'exit', 'source', 'echo', 'cd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'grep', 'sed', 'awk', 'true', 'false'],
  go: ['func', 'package', 'import', 'var', 'const', 'type', 'struct', 'interface', 'if', 'else', 'for', 'range', 'return', 'go', 'defer', 'chan', 'map', 'switch', 'case', 'break', 'continue', 'select', 'fallthrough', 'true', 'false', 'nil', 'this'],
  rs: ['fn', 'let', 'mut', 'pub', 'use', 'mod', 'impl', 'trait', 'struct', 'enum', 'match', 'if', 'else', 'for', 'while', 'loop', 'return', 'async', 'await', 'move', 'ref', 'type', 'dyn', 'where', 'self', 'Self', 'true', 'false', 'None', 'Some', 'Ok', 'Err'],
  md: [],
  plaintext: [],
  text: [],
}

/** Token classes the generic scanner recognizes, in priority order. */
const TOKEN_PATTERNS: ReadonlyArray<{ token: ColorToken; pattern: RegExp }> = [
  { token: 'syntaxComment', pattern: /\/\/[^\n]*|\/\*[\s\S]*?\*\// },
  { token: 'syntaxString', pattern: /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/ },
  { token: 'syntaxNumber', pattern: /\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
  { token: 'syntaxType', pattern: /\b[A-Z][A-Za-z0-9_]*\b/ },
  { token: 'syntaxFunction', pattern: /\b[a-z_][A-Za-z0-9_]*(?=\s*\()/ },
  { token: 'syntaxKeyword', pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/ },
  { token: 'syntaxOperator', pattern: /=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|<<|>>|[+\-*/%<>=!&|^~?]/ },
  { token: 'syntaxPunctuation', pattern: /[(){}[\].,:;]/ },
]

/** Normalize a language tag to a known key. */
function languageKey(lang: string | undefined): string {
  if (lang === undefined) return 'text'
  const key = lang.trim().toLowerCase()
  if (key === '') return 'text'
  return KEYWORDS[key] !== undefined ? key : 'text'
}

/** Escape regex specials in a keyword. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build one combined keyword alternation per language. */
const keywordRegexCache = new Map<string, RegExp>()
function keywordRegex(lang: string): RegExp {
  let cached = keywordRegexCache.get(lang)
  if (cached === undefined) {
    const keywords = KEYWORDS[lang] ?? []
    cached = new RegExp(`\\b(${keywords.map(escapeRegex).join('|')})\\b`)
    keywordRegexCache.set(lang, cached)
  }
  return cached
}

/** Tokenize one line into [text, role] segments (role undefined = plain). */
function tokenizeLine(line: string, lang: string): Array<{ text: string; token?: ColorToken }> {
  const segments: Array<{ text: string; token?: ColorToken }> = []
  let rest = line
  const keywordPattern = lang === 'text' || lang === 'json' || lang === 'md' ? undefined : keywordRegex(lang)
  while (rest.length > 0) {
    // Keyword check first: identifiers that are keywords beat the generic
    // identifier pattern below.
    if (keywordPattern !== undefined) {
      const match = keywordPattern.exec(rest)
      if (match !== null && match.index === 0) {
        segments.push({ text: match[0], token: 'syntaxKeyword' })
        rest = rest.slice(match[0].length)
        continue
      }
    }
    // JSON keys: a string directly before a colon reads as a key.
    if (lang === 'json') {
      const keyMatch = /^"(?:[^"\\]|\\.)*"(?=\s*:)/.exec(rest)
      if (keyMatch !== null) {
        segments.push({ text: keyMatch[0], token: 'syntaxType' })
        rest = rest.slice(keyMatch[0].length)
        continue
      }
    }
    let matched: { text: string; token: ColorToken } | undefined
    for (const { token, pattern } of TOKEN_PATTERNS) {
      const match = pattern.exec(rest)
      if (match !== null && match.index === 0 && match[0].length > 0) {
        matched = { text: match[0], token }
        break
      }
    }
    if (matched === undefined) {
      // Plain char run until the next token boundary.
      const next = findNextTokenStart(rest, lang)
      segments.push({ text: rest.slice(0, next) })
      rest = rest.slice(next)
      continue
    }
    segments.push(matched)
    rest = rest.slice(matched.text.length)
  }
  return segments
}

/** Index of the next tokenizable position in a plain run. */
function findNextTokenStart(text: string, lang: string): number {
  const pattern = lang === 'text' || lang === 'json' || lang === 'md' ? undefined : keywordRegex(lang)
  let earliest = text.length
  const consider = (match: RegExpExecArray | null): void => {
    if (match !== null && match.index < earliest && match[0].length > 0) earliest = match.index
  }
  if (pattern !== undefined) consider(pattern.exec(text))
  for (const { pattern: p } of TOKEN_PATTERNS) consider(p.exec(text))
  return earliest
}

/**
 * Highlight source code into ANSI-styled lines for the Markdown hook.
 * @param code - the code block content.
 * @param lang - the fence language tag.
 * @param fg - the theme's fg wrapper (token, text) => styled text.
 * @returns one styled line per source line.
 */
export function highlightCode(
  code: string,
  lang: string | undefined,
  fg: (token: ColorToken, text: string) => string,
): string[] {
  const key = languageKey(lang)
  if (key === 'text') return code.split('\n')
  return code.split('\n').map(line => {
    if (line.trim() === '') return line
    const segments = tokenizeLine(line, key)
    return segments.map(segment => {
      if (segment.token === undefined) return segment.text
      return fg(segment.token, segment.text)
    }).join('')
  })
}
