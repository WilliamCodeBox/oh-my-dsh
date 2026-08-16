/**
 * Behavioral tests for the git status watcher against the real repository:
 * porcelain parsing and repeated polling under the short cadence.
 */

import { describe, expect, it } from 'vitest'
import { readGitStatus, watchGitStatus } from '../src/git.ts'

describe('readGitStatus', () => {
  it('parses branch and porcelain counts from a real repository', async () => {
    const status = await readGitStatus(process.cwd())
    expect(status).toBeDefined()
    expect(status!.branch.length).toBeGreaterThan(0)
    expect(status!.staged).toBeGreaterThanOrEqual(0)
    expect(status!.unstaged).toBeGreaterThanOrEqual(0)
    expect(status!.untracked).toBeGreaterThanOrEqual(0)
  }, 10000)
})

describe('watchGitStatus', () => {
  it('reports repeatedly while inside a repository', async () => {
    const seen: string[] = []
    const disposer = watchGitStatus(process.cwd(), (status) => {
      if (status !== undefined) seen.push(status.branch)
    }, 100)
    await new Promise(resolve => setTimeout(resolve, 350))
    disposer()
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen.every(branch => branch === seen[0])).toBe(true)
  }, 10000)
})
