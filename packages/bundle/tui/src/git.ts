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

/** Read branch + porcelain counts; resolves undefined only when the
 * workspace is *not* a repository (git is present and HEAD resolves but
 * the branch is unborn, or git is absent). Transient failures (timeout,
 * IO, lock) reject so the watcher can retry instead of dying. */
export async function readGitStatus(cwd: string): Promise<GitStatus | undefined> {
  let branch: string
  try {
    branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim()
  } catch {
    // git missing or outside a repository: treat as permanently no-repo.
    return undefined
  }
  if (branch === '') return undefined
  let porcelain: string
  try {
    porcelain = await git(['status', '--porcelain'], cwd)
  } catch {
    // The repo exists but the status read failed transiently; let the
    // watcher retry rather than treating it as no-repo.
    throw new Error(`git status failed in ${cwd}`)
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
 * HEAD stat-poll would miss them; porcelain is cheap on typical repos.
 * Outside a repository the watcher stops; transient read failures retry
 * with a short backoff instead of dying.
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
  const schedule = (delay: number): void => {
    if (disposed) return
    timer = setTimeout(poll, delay)
  }
  const poll = (): void => {
    if (disposed) return
    void readGitStatus(cwd).then(
      (status) => {
        if (disposed) return
        onChange(status)
        if (status !== undefined) schedule(intervalMs)
      },
      () => {
        // Transient failure (repo exists, status read failed): retry soon
        // and keep the last snapshot visible.
        if (disposed) return
        schedule(Math.max(500, intervalMs / 4))
      },
    )
  }
  // Immediate first read; keep polling only while inside a repository.
  poll()
  return () => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
