/**
 * Terminal color-scheme detection: query the terminal's reported scheme
 * (DECRQM-style `?997` report) before the presenter enters raw mode, and
 * resolve a theme. Terminals without the report answer nothing — the caller
 * falls back to the dark theme within a short deadline.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import { parseTerminalColorSchemeReport } from '@earendil-works/pi-tui'

const SCHEME_QUERY = '\x1b[?997n'
const QUERY_TIMEOUT_MS = 300

/**
 * Query the terminal's light/dark scheme report. Returns `undefined` when
 * the terminal does not answer within {@link QUERY_TIMEOUT_MS} or when the
 * streams are not TTYs; the caller falls back to its default theme.
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
    const finish = (scheme: 'dark' | 'light' | undefined): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(scheme)
    }
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString()
      const report = parseTerminalColorSchemeReport(buffer)
      if (report !== undefined) {
        finish(report)
        return
      }
      // Keep buffering: the report may arrive split across chunks. The
      // timeout bounds the wait; a terminal that never answers loses the
      // query and the buffered bytes (it had no scheme to report).
    }
    const timer = setTimeout(() => finish(undefined), QUERY_TIMEOUT_MS)
    const cleanup = (): void => {
      clearTimeout(timer)
      stdin.off('data', onData)
    }
    stdin.on('data', onData)
    stdout.write(SCHEME_QUERY)
  })
}
