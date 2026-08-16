#!/usr/bin/env tsx
/**
 * Release a new rc: bump every workspace version (packages/ AND apps/ — the
 * launcher's version source), refresh the install.sh pin comment, run the
 * full-repo typecheck (the host face CI compiles; the package-local face
 * misses test-file errors), commit, tag `omd-v<version>`, and push.
 *
 * Usage: pnpm exec tsx scripts/release-rc.ts [<version>]
 *
 * Without a version, the next rc is computed from the current apps/cli
 * version. The script stops before committing unless the workspace is
 * clean (uncommitted files would otherwise ride the release commit).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.cwd()

function run(cmd: string): string {
  return execFileSync(cmd, { cwd: repo, shell: true, encoding: 'utf8' }).trim()
}

function nextRc(current: string): string {
  const match = /^0\.1\.0-rc\.(\d+)$/.exec(current)
  if (match === null) throw new Error(`cannot compute next rc from "${current}"`)
  return `0.1.0-rc.${Number(match[1]) + 1}`
}

const cliVersion = JSON.parse(readFileSync(join(repo, 'apps/cli/package.json'), 'utf8')).version
const version = process.argv[2] ?? nextRc(cliVersion)
console.log(`release: ${cliVersion} -> ${version}`)

// 1. Clean workspace: anything uncommitted would ride the bump commit.
const dirty = run('git status --porcelain').split('\n').filter(line => line !== '')
if (dirty.length > 0) {
  console.error(`release: workspace not clean:\n${dirty.join('\n')}`)
  process.exit(1)
}

// 2. Bump every package.json under packages/ and apps/.
const manifests = globSync('{packages,apps}/**/package.json', { cwd: repo })
  .filter(path => !path.includes('/node_modules/') && !path.includes('/lib/'))
let bumped = 0
for (const path of manifests) {
  const file = join(repo, path)
  const text = readFileSync(file, 'utf8')
  const next = text.replace(`"version": "${cliVersion}"`, `"version": "${version}"`)
  if (next !== text) {
    writeFileSync(file, next)
    bumped += 1
  }
}
console.log(`bumped ${bumped} manifests (incl. apps/cli — 'omd --version' source)`)

// 3. install.sh pin comment.
const installer = join(repo, 'install.sh')
const installText = readFileSync(installer, 'utf8')
writeFileSync(installer, installText.replace(
  /sh -s -- 0\.1\.0-rc\.\d+/,
  `sh -s -- ${version}`,
))

// 4. Full-repo typecheck — the exact compile CI's Build library artifacts
//    runs. The package-local face (`tsc -p <pkg>/tsconfig.json`) misses
//    test-file errors that tsconfig.host.json surfaces.
console.log('typecheck (host face)...')
run('pnpm exec tsc -b tsconfig.host.json')

// 5. Commit, tag, push.
run('git add -A')
run(`git commit -q -m "chore(release): bump all workspaces to ${version}"`)
run(`git push origin main`)
run(`git tag omd-v${version}`)
run(`git push origin omd-v${version}`)
console.log(`tag omd-v${version} pushed — watch the Omd Distribution run:`)
console.log('  gh run list --workflow omd-dist.yml --limit 1')
console.log('verify assets after success:')
console.log('  gh release view omd-v' + version + " --json assets -q '.assets[] | \"\\(.name) \\(.size)\"'")
console.log('install locally:')
console.log(`  GH_PROXY=https://gh-proxy.com/ sh install.sh ${version}`)
