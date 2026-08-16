/**
 * Editor autocomplete for the omd TUI: slash-command completion plus
 * `@`-file fuzzy completion over the workspace directory, backed by plain
 * readdir walking. pi-tui's CombinedAutocompleteProvider delegates `@`
 * completion to an external `fd` binary, which an out-of-the-box install
 * must not require — this provider implements the same surface with node:fs.
 *
 * Completion ordering scores entries (prefix match highest, fuzzy match
 * next, directories get a small boost) and truncates after sorting, so the
 * top matches are never pushed out by readdir order. The directory listing
 * caches by the workspace's mtime fingerprint and excludes `node_modules`
 * and `.git`, keeping per-keystroke cost bounded on monorepos.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import {
  fuzzyFilter,
  fuzzyMatch,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from '@earendil-works/pi-tui'

const DELIMITERS = new Set([' ', '\t', '='])
const EXCLUDED_DIRS = new Set(['node_modules', '.git'])
const MAX_DEPTH = 2
const MAX_RESULTS = 30

/** The `@`-prefixed token before the cursor, or null when not in one. */
function extractAtPrefix(text: string): string | null {
  let index = text.length - 1
  while (index >= 0 && !DELIMITERS.has(text[index]!)) index -= 1
  const tokenStart = index + 1
  return text[tokenStart] === '@' ? text.slice(tokenStart) : null
}

/** Expand a leading `~` in a path to the home directory. */
function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
}

/**
 * Recursively list entries under a directory, skipping hidden names,
 * `node_modules`, and `.git`. Returns relative paths (POSIX separators).
 */
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
      if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue
      const full = join(current, entry.name)
      const isDirectory = entry.isDirectory()
      const relative = full.slice(dir.length).split(sep).join('/').replace(/^\//, '')
      out.push({ path: relative, isDirectory })
      if (isDirectory) walk(full, depth + 1)
    }
  }
  walk(dir, 0)
  return out
}

/** Score one entry against the query; higher is better. */
function scoreEntry(name: string, isDirectory: boolean, query: string): number {
  let score = 0
  if (query === '') {
    score = 1
  } else if (name.startsWith(query)) {
    score = 80 - (name.length - query.length)
  } else {
    const match = fuzzyMatch(query, name)
    if (!match.matches) return 0
    // fuzzyMatch's score is a negative-quality metric (lower = better,
    // gap penalties add positive offsets). Map it to a 1..40 band so
    // prefix matches (80) always rank above fuzzy hits.
    score = 40 - Math.min(39, Math.max(0, match.score + 10))
  }
  return score + (isDirectory ? 5 : 0)
}

/**
 * Workspace-aware completion: `/` commands from the provided list, `@`
 * files under the base directory (relative display paths, directories
 * completed with a trailing slash). Tab (`force`) lists files without an
 * `@` prefix.
 */
export class WorkspaceAutocomplete implements AutocompleteProvider {
  private cache: { fingerprint: string; entries: { path: string; isDirectory: boolean }[] } | undefined

  constructor(
    private readonly commands: readonly { name: string; description?: string }[],
    private readonly basePath: string,
  ) {}

  /** Fingerprint the workspace's immediate children mtimes. */
  private fingerprint(): string {
    let stamp = ''
    try {
      for (const entry of readdirSync(this.basePath, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue
        try {
          const stat = statSync(join(this.basePath, entry.name))
          stamp += `${entry.name}:${stat.mtimeMs};`
        } catch {
          // Unreadable entries do not invalidate the cache.
        }
      }
    } catch {
      // An unreadable workspace yields no listing; the cache stays empty.
    }
    return stamp
  }

  private listing(signal: AbortSignal): { path: string; isDirectory: boolean }[] {
    const stamp = this.fingerprint()
    if (this.cache === undefined || this.cache.fingerprint !== stamp) {
      this.cache = { fingerprint: stamp, entries: walkEntries(this.basePath, signal) }
    }
    return this.cache.entries
  }

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
      const hashIndex = atPrefix.indexOf('#')
      if (hashIndex !== -1) {
        return this.lineRangeSuggestions(atPrefix.slice(1, hashIndex), atPrefix.slice(hashIndex + 1))
      }
      return this.fileSuggestions(atPrefix, options.signal)
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
    if (options.force === true) {
      // Tab with no @ token: list workspace files from the cursor position.
      return this.fileSuggestions('', options.signal)
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

  /**
   * Complete a `@file#L<start>` line-range reference: read the file, propose
   * a 10-line window starting at the typed line (or 1). The completion value
   * replaces only the `#…` part, keeping the file token intact.
   */
  private lineRangeSuggestions(fileRel: string, lineInput: string): AutocompleteSuggestions | null {
    const file = join(this.basePath, fileRel)
    let content: string
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      return null
    }
    const total = content.split('\n').length
    const match = /^L(\d+)/.exec(lineInput)
    const start = match === null ? 1 : Math.min(parseInt(match[1]!, 10), total)
    const end = Math.min(total, start + 9)
    const value = `#L${start}-L${end}`
    return {
      items: [{
        value,
        label: `L${start}-L${end} (${total} lines)`,
        description: `@${fileRel}${value}`,
      }],
      prefix: `#${lineInput}`,
    }
  }

  /** Resolve the search directory, prefix, and base-relative dir for an `@` query. */
  private resolveQuery(atPrefix: string): { searchDir: string; searchPrefix: string; relDir: string } | undefined {
    const rel = atPrefix.slice(1)
    if (rel.startsWith('~')) return undefined
    const absolute = rel.startsWith('/')
    const isRoot = rel === '' || rel === './' || rel === '../' || rel === '/'
    if (isRoot || rel.endsWith('/')) {
      return {
        searchDir: absolute ? rel : join(this.basePath, rel),
        searchPrefix: '',
        relDir: absolute ? '' : rel,
      }
    }
    const dir = dirname(rel)
    const file = basename(rel)
    return {
      searchDir: absolute ? expandHome(dir) : join(this.basePath, dir),
      searchPrefix: file,
      relDir: absolute ? '' : dir === '.' ? '' : dir,
    }
  }

  private fileSuggestions(atPrefix: string, signal: AbortSignal): AutocompleteSuggestions | null {
    const resolved = this.resolveQuery(atPrefix)
    if (resolved === undefined) return null
    // Absolute and ~ queries walk the target directory (no workspace cache);
    // workspace queries filter the cached base listing by the typed dir.
    const absolute = atPrefix.slice(1).startsWith('/')
    const entries = absolute
      ? walkEntries(resolved.searchDir, signal).map(entry => ({ ...entry, path: entry.path }))
      : this.listing(signal)
    const dirPrefix = absolute ? '' : resolved.relDir === '' ? '' : `${resolved.relDir}/`
    const scored = entries
      .map(entry => ({
        entry,
        score: entry.path.startsWith(dirPrefix)
          ? scoreEntry(basename(entry.path), entry.isDirectory, resolved.searchPrefix)
          : 0,
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
    if (scored.length === 0) return null
    const items: AutocompleteItem[] = scored.map(({ entry }) => {
      const isDirectory = entry.isDirectory
      const value = `${entry.path}${isDirectory ? '/' : ''}`
      return {
        value,
        label: `${basename(entry.path)}${isDirectory ? '/' : ''}`,
        description: `@${value}`,
      }
    })
    return { items, prefix: atPrefix }
  }
}
