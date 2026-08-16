# Agent Note: distribution closure boots on the bundled bun runtime

Status: implemented

English | [中文](2026-08-16-dist-closure-bun-runtime.zh.md)

## Problem

The omd distribution tarball (`build:dist`) passed its `--version` smoke but
never booted a real profile: every run failed with `plugin tree failed to
load`. Three independent defects produced the failure:

1. **`pnpm deploy --prod` dropped bundle plugins.** The root package declares
   no `dependencies` (only 35 devDependencies), so pnpm's prod closure from
   it is empty and 28 runtime plugins the base bundle depends on
   (`omd-llm-deepseek`, `omd-subprocess-local`, `omd-sandbox-local`,
   `omd-lsp`, ...) never entered the deployed tree. The old smoke only ran
   `--version`, which never loads the plugin tree.
2. **The trim step deleted runtime code.** `trim-node-modules.py` dropped
   every `src/` and `build/` directory wholesale; `koffi` ships runtime code
   under `src/` and `@opentelemetry/sdk-logs` under `build/`, so their
   imports broke (`Cannot find module '.../src/koffi/index.js'`).
3. **The bundled bun runtime lacks Node internals.** `node:module`
   `stripTypeScriptTypes` (ESM-only, used by `omd-code-runtime-worker-thread`)
   and the Node internal ESM loader (required by `cordis-plugin-hmr`) do not
   exist on bun; static imports and the HMR constructor failed the whole tree
   at load.

## Decision

**Deploy without `--prod`, then remove exactly the root devDependencies and
promote every workspace package to the top-level scope.** The assemble script
now runs `pnpm deploy --legacy` (complete workspace prod closure), then
`drop-dev-deps.py` deletes the root's 35 devDependency entries (top-level
symlink plus virtual-store entries nothing else links), then
`promote-workspace-links.py` symlinks every workspace package into
`node_modules/@williamcodebox/` — the app-boot profile fallback resolves
bundle dependencies from the tree root through the ordinary node_modules
walk, and pnpm deploy hoists only the app's direct dependencies there.

**Trim only test/doc directories.** `trim-node-modules.py` now drops
`tests`/`test`/`testdata`/`__tests__`/`examples`/`.github`/`coverage`/
`dist-src`/`benchmark`/`bench`; `src/` and `build/` are kept because package
layouts are not standardized (koffi, @opentelemetry).

**Runtime guards for bun.** `omd-code-runtime-worker-thread` detects
`node:module.stripTypeScriptTypes` on the namespace and falls back to the
identity function (bun worker threads execute TypeScript natively, so the
strip is semantically redundant there). `vendor/hmr` degrades to an inactive
service (warning, no-op `registerConfig`) when the Node internal loader is
unavailable, instead of throwing; the base bundle disables the row when the
distribution launcher exports `OMD_NO_HMR=1`, and the launcher also passes
`--expose-internals` for Node parity.

**The smoke boots the headless profile.** `build:dist` now runs
`omd --profile headless "smoke"` and accepts the run only when the tree loads
(`MISSING_CREDENTIAL` without a key, or a clean run) — rejecting
`plugin tree failed to load` with the captured log.

## Alternatives considered

**Keep `--prod` and add the missing 28 packages back.** Rejected: the
missing set is the base bundle's transitive workspace closure, which the
deploy step would have to re-resolve by hand; dropping the flag and removing
the (empty-root) devDependencies is the same set with one mechanism.

**Patch `app-boot` to resolve from the virtual store.** Rejected: the
profile fallback's BFS over `node_modules` is the documented resolution
contract; changing it would affect source-tree and npm-installed layouts, not
just the assembled tree.

**Make HMR work on bun.** Rejected: bun does not implement the Node internal
ESM loader (`--expose-internals` parses but the internal modules do not
exist); there is no API surface to hook. Degrading to restart-applied config
edits is the correct product behavior for the distributed runtime.

## Consequences

- The assembled tree boots: `build:dist` smoke passes, and a pty-driven TUI
  run renders in ~2s, submits input, reaches the model step (status bar shows
  `deepseek-official/deepseek-v4-flash`), and surfaces the keyless error
  path.
- Tarball size grew from 82 MB (`--prod`, broken closure) to ~145 MB: the
  root devDependencies' transitive trees remain in the virtual store because
  their entries are still linked by each other. Size recovery is deferred;
  correctness first.
- `vendor/hmr` gains a documented local modification (bun degradation),
  logged in `vendor/README.md` item 13.
- The keyless model path is the only untested link; a real
  `DEEPSEEK_API_KEY` is required for an end-to-end model reply.
