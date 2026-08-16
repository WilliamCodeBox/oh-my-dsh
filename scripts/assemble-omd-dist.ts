#!/usr/bin/env tsx
/**
 * Assemble the omd distribution folder (bun runtime + deployed closure tree)
 * and pack it into a single tarball for CentOS 7+ (glibc 2.17) targets.
 *
 * The launcher is a cordis plugin host: plugins are resolved by package name
 * from node_modules at runtime, so the closure must ship as a real tree
 * (pnpm deploy) rather than a bundled single file. The bun runtime binary
 * links only GLIBC_2.17 symbols (verified by `readelf`), which is exactly the
 * CentOS 7 baseline, so the folder runs there with no system dependencies.
 *
 * Steps: pnpm deploy the launcher closure → trim to publish semantics →
 * copy the bun runtime + launcher script → tar.gz. Run:
 *
 *   pnpm run build:dist [-- --bun /path/to/bun --out /tmp/omd-dist.tar.gz]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, copyFileSync, chmodSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const bunPath = flag('bun') ?? process.env.OMD_BUN ?? join(process.env.HOME ?? '/tmp', '.bun', 'bin', 'bun')
const outPath = resolve(flag('out') ?? '/tmp/omd-dist.tar.gz')
const keepDir = flag('keep-dir')

function run(cmd: string, cwd: string): void {
  const r = spawnSync(cmd, { cwd, shell: true, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`assemble-omd-dist: failed: ${cmd}`)
    process.exit(r.status ?? 1)
  }
}

if (!existsSync(bunPath)) {
  console.error(`assemble-omd-dist: bun runtime not found at ${bunPath} (pass --bun)`)
  process.exit(1)
}

const work = keepDir ?? join(tmpdir(), `omd-dist-${process.pid}`)
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

try {
  // 1. deploy the launcher closure (real dependency tree, workspace protocols
  //    resolved). No `--prod`: pnpm's prod closure starts from the root
  //    package's `dependencies`, which is empty here, so the flag silently
  //    drops every workspace plugin the base bundle depends on (observed: 28
  //    runtime plugins missing). The root devDependencies leak in instead;
  //    step 2 removes exactly that set.
  run(`pnpm deploy --legacy --filter @williamcodebox/oh-my-dsh ${work}`, repoRoot)

  // 2. drop the root devDependencies from the deployed tree. The root package
  //    declares no `dependencies`, so nothing else is reachable from it;
  //    removing exactly its devDependencies keys (top-level symlink plus the
  //    .pnpm store entries) leaves the workspace prod closure intact.
  const dropDevDeps = join(import.meta.dirname, 'drop-dev-deps.py')
  if (existsSync(dropDevDeps)) {
    run(`python3 ${dropDevDeps} ${join(work, 'node_modules')} ${repoRoot}`, repoRoot)
  }

  // 2. replace workspace symlinks with real copies (self-contained tree)
  const unlink = join(import.meta.dirname, 'unlink-workspace.py')
  if (existsSync(unlink)) {
    run(`python3 ${unlink} ${join(work, 'node_modules')} ${repoRoot}`, repoRoot)
  }

  // 2b. promote every workspace package to the top-level scope. pnpm deploy
  //     hoists only the app's direct dependencies there; the app-boot profile
  //     fallback resolves bundle dependencies from the tree root, so without
  //     promotion the assembled tree cannot load any bundle plugin beyond the
  //     direct set (observed: omd-base's deps missing at boot).
  const promote = join(import.meta.dirname, 'promote-workspace-links.py')
  if (existsSync(promote)) {
    run(`python3 ${promote} ${join(work, 'node_modules')}`, repoRoot)
  }

  // 3. trim to publish semantics: drop src/tests/docs/build metadata
  const trim = join(import.meta.dirname, 'trim-node-modules.py')
  if (existsSync(trim)) {
    run(`python3 ${trim} ${join(work, 'node_modules')}`, repoRoot)
  }

  // 3. runtime + launcher script
  copyFileSync(bunPath, join(work, 'bun'))
  chmodSync(join(work, 'bun'), 0o755)
  writeFileSync(
    join(work, 'omd'),
    `#!/bin/sh\nDIR="$(cd "$(dirname "$0")" && pwd)"\nexport OMD_NO_HMR=1\nexec "$DIR/bun" --expose-internals "$DIR/lib/bin.js" "$@"\n`,
  )
  chmodSync(join(work, 'omd'), 0o755)

  // 5. smoke: boot the headless profile through the assembled tree (home
  //    OUTSIDE the tree). The tree is healthy when the plugin tree loads and
  //    the run reaches the model step — with no API key that is the expected
  //    MISSING_CREDENTIAL failure. A missing plugin fails earlier with
  //    "plugin tree failed to load"; that is what this smoke rejects.
  const smokeHome = join(tmpdir(), `omd-smoke-${process.pid}`)
  const smokeOut = join(tmpdir(), `omd-smoke-${process.pid}.log`)
  const smoke = spawnSync(
    `DSH_HOME=${smokeHome} ${join(work, 'omd')} --profile headless "smoke" < /dev/null > ${smokeOut} 2>&1`,
    { cwd: work, shell: true },
  )
  const smokeLog = existsSync(smokeOut) ? readFileSync(smokeOut, 'utf8') : ''
  const loaded = smokeLog.includes('MISSING_CREDENTIAL') || (smoke.status === 0 && !smokeLog.includes('plugin tree failed to load'))
  if (!loaded) {
    console.error(`assemble-omd-dist: smoke failed — plugin tree did not load:\n${smokeLog.slice(0, 4000)}`)
    process.exit(1)
  }
  console.log('assemble-omd-dist: smoke ok (headless tree loaded)')

  // 6. pack (tolerate mtime churn from the smoke run; GNU tar)
  run(`tar czf ${outPath} --warning=no-file-changed -C ${work} .`, work)
  console.log(`assemble-omd-dist: ${outPath}`)
} finally {
  if (!keepDir) rmSync(work, { recursive: true, force: true })
}
