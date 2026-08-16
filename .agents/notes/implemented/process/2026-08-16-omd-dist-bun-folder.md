# Agent Note: omd distribution as a bun runtime + deployed closure folder

Status: implemented

English | [中文](2026-08-16-omd-dist-bun-folder.zh.md)

## Problem

The omd CLI needs a distribution that runs on CentOS 7+ (glibc 2.17) with no
system dependencies beyond libc. Bundled single-file paths were investigated
and rejected on evidence: `pkg` cannot resolve ESM bare imports inside its
snapshot (it patches CJS `require` only, and the 240-package closure is
all-ESM), and `bun build --compile` / Bun.build cannot embed the cordis
plugin tree (plugins are resolved by package name from node_modules at
runtime, so the closure is not statically bundlable). Compiling a fully
static node from source was attempted (node 26 then 22) and failed on the
available musl toolchains (GCC 11.2 C++20 gaps, zig clang evex512 target
conflicts), which is moot: the bun runtime binary itself links only
GLIBC_2.17 symbols (`readelf --version-info`), exactly the CentOS 7 baseline.

## Decision

Ship omd as a **folder**: the bun runtime binary + the launcher's deployed
closure tree (pnpm deploy), plus a launcher script. This mirrors pi's
distribution shape (`dist/` folder with the compiled binary and assets).
The folder is packed into a single tarball for distribution.

- `scripts/assemble-omd-dist.ts` (`pnpm run build:dist`): pnpm deploy the
  launcher closure → trim to publish semantics (drop src/tests/docs/build
  metadata; keep symlink store layout) → copy the bun runtime + `omd`
  launcher script → smoke `--version` through the assembled tree → tar.gz.
- `.github/workflows/omd-dist.yml`: matrix build on ubuntu-24.04 (x64) and
  ubuntu-24.04-arm (arm64) with the bun runtime from setup-bun, artifact
  upload on `omd-v*` tags or manual dispatch.
- The tarball runs on CentOS 7+ (glibc 2.17) with no install-time compile.

## Rejected alternatives

- **Single-file bundle** (`pkg`, `bun --compile`): ESM snapshot resolution
  and dynamic plugin loading are both incompatible; verified by experiment.
- **Fully static node** (musl, `--fully-static`): viable in principle but the
  toolchain cost (musl GCC 11 too old for node 22/26 C++, musl.cc native is
  also GCC 11, zig clang has evex512 conflicts) outweighs the benefit once
  bun's GLIBC_2.17 baseline is known.
- **Self-extracting single file**: works, but the folder form (pi-style) is
  simpler to inspect and debug; not needed for the CentOS 7 requirement.
