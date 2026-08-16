/**
 * Terminal color-scheme detection: query the terminal's reported scheme
 * (DSR `CSI ? 996 n`; terminals answer `CSI ? 997;1n` dark / `;2n` light)
 * plus an OSC 11 background-color fallback for terminals without the DSR
 * report, before the presenter enters raw mode. Unanswered queries resolve
 * to `undefined` within a short deadline and the caller falls back to the
 * dark theme.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import { parseOsc11BackgroundColor, parseTerminalColorSchemeReport } from '@earendil-works/pi-tui'

const SCHEME_QUERY = '\x1b[?996n'
const OSC11_QUERY = '\x1b]11;?\x1b\\'
const QUERY_TIMEOUT_MS = 250

/** Report the luminance of an RGB color; >0.5 counts as a light scheme. */
function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/**
 * Query the terminal's light/dark scheme report. Returns `undefined` when
 * the terminal does not answer within {@link QUERY_TIMEOUT_MS} or when the
 * streams are not TTYs; the caller falls back to its default theme.
 * Bytes read during the query that are not part of a scheme report are
 * pushed back onto the stdin stream so canonical-mode input is not lost.
 * @param stdin - the raw byte stream to watch for the report (the real
 *   process stdin; only read before raw mode owns it).
 * @param stdout - the stream to write the query to.
 */
export function detectTerminalScheme(
  stdin: NodeJS.ReadStream,
  stdout: { write(chunk: string): unknown; isTTY?: boolean },
): Promise<'dark' | 'light' | undefined> {
  if (!stdin.isTTY || !stdout.isTTY) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    let buffer = ''
    let settled = false
    const finish = (scheme: 'dark' | 'light' | undefined, leftover: string): void => {
      if (settled) return
      settled = true
      stdin.off('data', onData)
      clearTimeout(timer)
      if (leftover !== '') {
        // Re-queue user input that arrived inside the query window.
        queueMicrotask(() => { stdin.push(leftover) })
      }
      resolve(scheme)
    }
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString()
      // DSR report: `CSI ? 997;1 n` / `;2 n`, possibly merged with input.
      const reportStart = buffer.indexOf('\x1b[?997;')
      if (reportStart !== -1) {
        const reportEnd = buffer.indexOf('n', reportStart)
        if (reportEnd !== -1) {
          const scheme = parseTerminalColorSchemeReport(buffer.slice(reportStart, reportEnd + 1))
          const leftover = buffer.slice(reportEnd + 1)
          if (scheme !== undefined) {
            finish(scheme, leftover)
            return
          }
        }
      }
      // OSC 11 fallback: `ESC ] 11 ; rgb:RRRR/GGGG/BBBB ESC \`.
      const oscStart = buffer.indexOf('\x1b]11;')
      if (oscStart !== -1) {
        const oscEnd = buffer.indexOf('\x1b\\', oscStart)
        if (oscEnd !== -1) {
          const color = parseOsc11BackgroundColor(buffer.slice(oscStart, oscEnd + 2))
          const leftover = buffer.slice(oscEnd + 2)
          if (color !== undefined) {
            finish(luminance(color) > 0.5 ? 'light' : 'dark', leftover)
            return
          }
        }
      }
      // Neither report complete: keep buffering until the timeout bounds it.
    }
    const timer = setTimeout(() => finish(undefined, buffer), QUERY_TIMEOUT_MS)
    stdin.on('data', onData)
    stdout.write(SCHEME_QUERY + OSC11_QUERY)
  })
}
