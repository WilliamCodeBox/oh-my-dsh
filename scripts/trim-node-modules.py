#!/usr/bin/env python3
"""Trim a pnpm deploy tree to publish semantics: drop src/tests/docs/build
metadata, keep package.json + declared files + lib artifacts. Cycle-safe."""
import os, shutil, sys, json, fnmatch

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/omd-dist/node_modules"

DROP_DIRS = {"tests", "test", "testdata", "__tests__", "examples",
             ".github", "coverage", "dist-src", "benchmark", "bench"}
DROP_FILES = {"tsconfig.json", "tsconfig.build.json", "biome.json", "eslint.config.js",
              ".npmignore", ".gitignore", "CHANGELOG.md", "LICENSE.md"}
DROP_SUFFIX = {".map", ".tsbuildinfo", ".d.ts.bak"}

count_dirs = 0
count_files = 0

def should_drop_dir(name):
    return name in DROP_DIRS or name.startswith(".") and name not in (".bin",)

def walk(pkgdir):
    global count_dirs, count_files
    for entry in os.listdir(pkgdir):
        path = os.path.join(pkgdir, entry)
        if os.path.islink(path):
            continue  # keep symlinks (pnpm structure)
        if os.path.isdir(path):
            if should_drop_dir(entry):
                shutil.rmtree(path, ignore_errors=True)
                count_dirs += 1
            else:
                walk(path)
        else:
            if entry in DROP_FILES or any(entry.endswith(s) for s in DROP_SUFFIX):
                os.unlink(path)
                count_files += 1

for dirpath, dirnames, filenames in os.walk(ROOT, topdown=False):
    # skip .bin (needed for pkg scripts? not at runtime; keep)
    if os.path.basename(dirpath) == ".bin":
        continue
    for name in list(dirnames):
        p = os.path.join(dirpath, name)
        if os.path.islink(p):
            continue
        if name in DROP_DIRS:
            shutil.rmtree(p, ignore_errors=True)
            count_dirs += 1
    for name in filenames:
        p = os.path.join(dirpath, name)
        if os.path.islink(p):
            continue
        if name in DROP_FILES or any(name.endswith(s) for s in DROP_SUFFIX):
            try:
                os.unlink(p)
                count_files += 1
            except OSError:
                pass

print(f"trimmed: {count_dirs} dirs, {count_files} files")
