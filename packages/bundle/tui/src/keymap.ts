/**
 * Streaming ESC-sequence keymap for the pipe input surface. pi-tui owns key
 * decoding on the TTY presenter path; this decoder classifies raw bytes on
 * the non-TTY line-tracer path into the same {@link TuiKey} vocabulary the
 * runner drives, so arrows, Home/End, PgUp/PgDn, and Delete edit the input
 * line instead of leaking control bytes into it.
 *
 * Sequences are held across chunk boundaries: an ESC byte never commits as a
 * key until the following byte decides between a bare Escape and a CSI/SS3
 * sequence, and a CSI sequence never commits until its final byte arrives.
 * Unknown-but-well-formed sequences are consumed silently, matching the M0
 * contract that escape bytes never enter the input line.
 *
 * @module @williamcodebox/omd-tui/keymap
 */

import type { TuiKey } from './index.ts'

/** The final byte of a CSI/SS3 sequence: `0x40`–`0x7E` (`@`–`~`). */
function isSequenceFinal(char: string): boolean {
  const code = char.charCodeAt(0)
  return code >= 0x40 && code <= 0x7e
}

/** Map a completed sequence (without its leading ESC) to a key. */
function mapSequence(sequence: string): TuiKey | undefined {
  // SS3 single-char finals: `ESC O A` etc. (application cursor keys).
  const first = sequence[0]
  if (first === 'O') {
    const final = sequence[1]
    return final === undefined ? undefined : mapFinal(final)
  }
  if (first !== '[') return undefined
  // CSI: `[` + optional params (`;`-separated digits / intermediates) + final.
  let index = 1
  while (index < sequence.length && !isSequenceFinal(sequence[index] ?? '')) index++
  const final = sequence[index]
  if (final === undefined) return undefined
  const params = sequence.slice(1, index)
  // Tilde finals carry the key in the first parameter (`ESC[5~` = PgUp);
  // letter finals carry it in the final byte. Modifier parameters (`;5`)
  // map to the base key: the pipe line editor has no per-modifier actions.
  if (final === '~') {
    const tilde = params.split(';')[0]
    switch (tilde) {
      case '1': case '7': return { kind: 'home' }
      case '3': return { kind: 'delete' }
      case '4': case '8': return { kind: 'end' }
      case '5': return { kind: 'page-up' }
      case '6': return { kind: 'page-down' }
      default: return undefined
    }
  }
  return mapFinal(final)
}

/** Map the CSI final byte to a navigation key. */
function mapFinal(final: string): TuiKey | undefined {
  switch (final) {
    case 'A': return { kind: 'up' }
    case 'B': return { kind: 'down' }
    case 'C': return { kind: 'right' }
    case 'D': return { kind: 'left' }
    case 'H': return { kind: 'home' }
    case 'F': return { kind: 'end' }
    default: return undefined
  }
}

/**
 * Stateful byte-classifier: feed decoded text chunks, receive keys. The
 * decoder holds an ESC until its sequence resolves or the next byte proves
 * it bare, so chunk boundaries never split a key.
 */
export class Keymap {
  /** Decoded characters awaiting classification, ESC first when buffering. */
  private pending: string[] = []

  /**
   * Classify one decoded chunk into keys; incomplete sequences stay buffered.
   * @param text - one chunk of decoded stdin text.
   * @returns the keys the chunk completed, in arrival order.
   */
  push(text: string): TuiKey[] {
    // Code points, not UTF-16 units: multi-byte characters are single keys
    // and ESC sequences are pure ASCII, so grapheme decomposition is not
    // needed here.
    this.pending.push(...Array.from(text))
    return this.drain()
  }

  /**
   * Classify any buffered remainder at EOF: a trailing bare ESC becomes the
   * Escape key; nothing else can be pending.
   * @returns the keys the remainder completed.
   */
  flush(): TuiKey[] {
    return this.drain(true)
  }

  private drain(forceBareEscape = false): TuiKey[] {
    const out: TuiKey[] = []
    while (this.pending.length > 0) {
      const first = this.pending[0]
      if (first === undefined) break // loop guard: length > 0
      if (first !== '\x1b') {
        this.pending.shift()
        const key = mapPlain(first)
        if (key !== undefined) out.push(key)
        continue
      }
      if (this.pending.length === 1) {
        // A lone ESC may start a sequence in the next chunk; only a forced
        // flush (EOF) commits it as the Escape key.
        if (forceBareEscape) {
          this.pending.shift()
          out.push({ kind: 'escape' })
        }
        break
      }
      const second = this.pending[1]
      if (second === undefined) break // unreachable: length >= 2
      if (second === '[' || second === 'O') {
        const finalIndex = this.pending.findIndex((char, i) => i >= 2 && isSequenceFinal(char))
        if (finalIndex === -1) break
        const sequence = this.pending.slice(0, finalIndex + 1).join('').slice(1)
        this.pending.splice(0, finalIndex + 1)
        const key = mapSequence(sequence)
        if (key !== undefined) out.push(key)
      } else {
        this.pending.shift()
        out.push({ kind: 'escape' })
      }
    }
    return out
  }
}

/** Map one plain character to a key, or drop it when unprintable. */
function mapPlain(char: string): TuiKey | undefined {
  const code = char.charCodeAt(0)
  if (code === 0x03) return { kind: 'ctrl-c' }
  if (code === 0x0d || code === 0x0a) return { kind: 'submit' }
  if (code === 0x7f || code === 0x08) return { kind: 'backspace' }
  if (code >= 0x20) return { kind: 'char', char }
  return undefined
}
