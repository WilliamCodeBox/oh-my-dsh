/**
 * Display sanitizer for untrusted terminal text. The TUI renders model
 * output, tool results, and error text that may carry terminal control
 * sequences; this module renders C0/C1 controls other than tab, LF, and CR as
 * visible hex escapes so a prompt-injected sequence cannot move the cursor,
 * rewrite the title, or reach the clipboard. Plain text passes through
 * unchanged, so the hot path pays nothing when no control is present.
 * @module @deepseek-ai/dsh-tui-renderer
 */

/**
 * Whether any byte of `text` would be rewritten by {@link sanitizeText}.
 * @param text - candidate text.
 * @returns whether the text carries a control that must be escaped.
 */
export function needsSanitize(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true
    if (code === 0x7f) return true
    if (code >= 0x80 && code <= 0x9f) return true
  }
  return false
}

/**
 * Render untrusted text for display. C0 controls (except tab, LF, CR), DEL,
 * and C1 controls become visible `\xNN` hex escapes; everything else is
 * preserved verbatim.
 * @param text - untrusted text from a tool result, model output, or error.
 * @returns the display-safe text; the same reference when nothing needs escaping.
 */
export function sanitizeText(text: string): string {
  if (!needsSanitize(text)) return text
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += text.charAt(i)
      continue
    }
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      out += `\\x${code.toString(16).padStart(2, '0')}`
      continue
    }
    out += text.charAt(i)
  }
  return out
}
