/**
 * Git worktree status for the TUI meta row: branch + staged/unstaged/
 * untracked counts, refreshed by stat-polling `.git/HEAD` so the shell
 * never runs git on every render — only when HEAD's mtime moved (git
 * replaces HEAD atomically, which fs.watch misses).
 *
 * @module @williamcodebox/omd-tui-runner
 */

import { execFile } from 'node:child_process'

/** One git worktree status snapshot. */
export interface GitStatus {
  readonly branch: string
  /** Files with unstaged modifications. */
  readonly unstaged: number
  /** Files staged for commit. */
  readonly staged: number
  /** Untracked files. */
  readonly untracked: number
}

/** Run one git command against the workspace; rejects when not a repo. */
function git(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, timeout: 2000 }, (error, stdout) => {
      if (error !== null) reject(error)
      else resolve(stdout.toString())
    })
  })
}

/** Read branch + porcelain counts; resolves undefined outside a repo. */
export async function readGitStatus(cwd: string): Promise<GitStatus | undefined> {
  let branch: string
  try {
    branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim()
  } catch {
    return undefined
  }
  if (branch === '') return undefined
  let porcelain: string
  try {
    porcelain = await git(['status', '--porcelain'], cwd)
  } catch {
    return undefined
  }
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const line of porcelain.split('\n')) {
    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') {
      untracked += 1
    } else {
      if (x !== ' ' && x !== '') staged += 1
      if (y !== ' ' && y !== '') unstaged += 1
    }
  }
  return { branch, staged, unstaged, untracked }
}

/**
 * Watch git status: report immediately, then re-read every `intervalMs`.
 * Worktree edits (unstaged counts) do not touch `.git/HEAD`, so a pure
 * HEAD stat-poll would miss them; porcelain is cheap on typical repos and
 * the poll stops once the workspace is not a repository.
 * @param cwd - the workspace directory.
 * @param onChange - receives each snapshot; undefined when not a repository.
 * @param intervalMs - poll cadence.
 * @returns the disposer.
 */
export function watchGitStatus(
  cwd: string,
  onChange: (status: GitStatus | undefined) => void,
  intervalMs = 2000,
): () => void {
  let disposed = false
  let timer: NodeJS.Timeout | undefined
  const poll = (): void => {
    if (disposed) return
    void readGitStatus(cwd).then((status) => {
      if (disposed) return
      onChange(status)
      if (status !== undefined) {
        timer = setTimeout(poll, intervalMs)
      }
    })
  }
  // Immediate first read; keep polling only while inside a repository.
  poll()
  return () => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
