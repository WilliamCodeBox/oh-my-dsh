/**
 * Editor autocomplete for the omd TUI: slash-command completion plus
 * `@`-file fuzzy completion over the workspace directory, backed by plain
 * readdir walking. pi-tui's CombinedAutocompleteProvider delegates `@`
 * completion to an external `fd` binary, which an out-of-the-box install
 * must not require — this provider implements the same surface with node:fs.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import { readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  fuzzyFilter,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from '@earendil-works/pi-tui'

const DELIMITERS = new Set([' ', '\t', '"', "'", '='])
const MAX_DEPTH = 2
const MAX_RESULTS = 30

/** The `@`-prefixed token before the cursor, or null when not in one. */
function extractAtPrefix(text: string): string | null {
  let index = text.length - 1
  while (index >= 0 && !DELIMITERS.has(text[index]!)) index -= 1
  const tokenStart = index + 1
  return text[tokenStart] === '@' ? text.slice(tokenStart) : null
}

/** Recursively list entries under a directory, skipping hidden names. */
function walkEntries(dir: string, signal: AbortSignal): { path: string; isDirectory: boolean }[] {
  const out: { path: string; isDirectory: boolean }[] = []
  const walk = (current: string, depth: number): void => {
    if (depth > MAX_DEPTH || signal.aborted) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (signal.aborted) return
      if (entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      const isDirectory = entry.isDirectory()
      out.push({ path: full, isDirectory })
      if (isDirectory) walk(full, depth + 1)
    }
  }
  walk(dir, 0)
  return out
}

/**
 * Workspace-aware completion: `/` commands from the provided list, `@`
 * files under the base directory (relative display paths, directories
 * completed with a trailing slash).
 */
export class WorkspaceAutocomplete implements AutocompleteProvider {
  constructor(
    private readonly commands: readonly { name: string; description?: string }[],
    private readonly basePath: string,
  ) {}

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const current = lines[cursorLine] ?? ''
    const before = current.slice(0, cursorCol)
    const atPrefix = extractAtPrefix(before)
    if (atPrefix !== null) {
      return this.fileSuggestions(atPrefix.slice(1), options.signal)
    }
    if (before.startsWith('/') && !before.includes(' ')) {
      const prefix = before.slice(1)
      const items = this.commands.map(command => ({
        value: command.name,
        label: command.name,
        ...(command.description !== undefined ? { description: command.description } : {}),
      }))
      const filtered = fuzzyFilter(items, prefix, item => item.value)
      if (filtered.length === 0) return null
      return { items: filtered, prefix: before }
    }
    return null
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    const current = lines[cursorLine] ?? ''
    const before = current.slice(0, cursorCol)
    const after = current.slice(cursorCol)
    const start = before.length - prefix.length
    const value = prefix.startsWith('@') && !item.value.startsWith('@')
      ? `@${item.value}`
      : item.value
    const next = before.slice(0, start) + value + after
    const nextLines = [...lines]
    nextLines[cursorLine] = next
    return { lines: nextLines, cursorLine, cursorCol: start + value.length }
  }

  /** Resolve the search directory and prefix for a relative `@` query. */
  private resolveQuery(rel: string): { searchDir: string; searchPrefix: string } | undefined {
    if (rel.startsWith('~')) return undefined
    const absolute = rel.startsWith('/')
    const isRoot = rel === '' || rel === './' || rel === '../' || rel === '/'
    if (isRoot || rel.endsWith('/')) {
      return {
        searchDir: absolute ? rel : join(this.basePath, rel),
        searchPrefix: '',
      }
    }
    const dir = dirname(rel)
    const file = basename(rel)
    return {
      searchDir: absolute ? dir : join(this.basePath, dir),
      searchPrefix: file,
    }
  }

  private fileSuggestions(rel: string, signal: AbortSignal): AutocompleteSuggestions | null {
    const resolved = this.resolveQuery(rel)
    if (resolved === undefined) return null
    const entries = walkEntries(resolved.searchDir, signal)
    const filtered = entries
      .filter(entry => {
        const name = basename(entry.path)
        if (resolved.searchPrefix === '') return true
        return name.startsWith(resolved.searchPrefix) || fuzzyFilter([entry], resolved.searchPrefix, e => basename(e.path)).length > 0
      })
      .slice(0, MAX_RESULTS)
    if (filtered.length === 0) return null
    const items: AutocompleteItem[] = filtered.map(entry => {
      const display = entry.path.slice(resolved.searchDir.length).replace(/\\/g, '/').replace(/^\//, '')
      const isDirectory = entry.isDirectory
      return {
        value: `${display}${isDirectory ? '/' : ''}`,
        label: `${basename(entry.path)}${isDirectory ? '/' : ''}`,
        description: `@${display}${isDirectory ? '/' : ''}`,
      }
    })
    return { items, prefix: rel === '' ? '@' : `@${rel}` }
  }
}
