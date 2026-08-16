# Agent Note: Rename the CLI executable to omd

Status: implemented
Archived: 2026-08-16

English | [中文](2026-08-15-rename-cli-to-omd.zh.md)

## Problem

The official `@williamcodebox/dsh` CLI is installed globally on this machine
(and published on npm), so a local `dsh` executable would shadow or collide
with it. The oh-my-dsh fork's launcher needed its own command name.

## Changes

- `apps/cli/package.json` `bin` becomes `{ "omd": "lib/bin.js" }`; the root
  `pnpm dsh` script becomes `pnpm omd`.
- Command-name surfaces: `args.ts`'s commander `.name('omd')`, the
  `loadLayeredEnv('omd')` diagnostic prefix, the `NAME` constants in
  profile-boot/plugin/dump-config, the runner's `omd: <error>` stderr prefix,
  and `--help` output (`Usage: omd --profile <name>`).
- Every `dsh` command-usage reference across repo docs, examples, tests, and
  comments (230+ files, including the bilingual `docs/user` tutorials)
  becomes `omd`. Archived Agent Notes are frozen and untouched.
- Preserved technical identifiers: `@williamcodebox/omd-*` package names,
  `DSH_HOME`/`DSH_*` environment variables, the `dsh.bundle`/`dsh.profile`
  manifest keys, `~/.dsh` home, and `dsh-`-prefixed plugin/feature names
  (e.g. the `dsh-badge` skill) — those are protocol or package identities,
  not the command name.

## Verification

- `pnpm omd --profile tui --help` prints `Usage: omd --profile tui` and
  exits 0; the built bin carries the renamed prefixes.
- Unit suites 61/61 (bundle) plus renderer; tsc 0, oxlint 0; PTY smoke and
  assembled replay pass; full snapshot gate 16/16 files, 119/119 tests.
