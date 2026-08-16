#!/usr/bin/env python3
"""Remove the workspace root's devDependencies from a deployed tree.

The omd closure deploys the app (apps/cli) with `pnpm deploy` without
`--prod`: the prod flag silently drops workspace bundle plugins (the root
package declares no `dependencies`, so pnpm's prod closure from it is empty
and the base bundle's plugins go missing). Without the flag the root
devDependencies (typescript, vitest, tsdown toolchain, ...) leak into the
deployed tree. The root declares no `dependencies`, so nothing else is
reachable from it; removing exactly its devDependencies keys — the top-level
symlink plus the virtual-store entries — leaves the workspace prod closure
intact. A shared name (same name+version in a prod closure) is not removed:
the .pnpm entry is deleted only when no other package in the tree links to it.

Usage: drop-dev-deps.py <node_modules-dir> <repo-root>
"""
import json
import os
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1])
repo_root = Path(sys.argv[2])

root_manifest = json.loads((repo_root / "package.json").read_text())
dev_deps = root_manifest.get("devDependencies", {})

removed = 0
for name in dev_deps:
    top = root / name
    if top.is_symlink() or top.exists():
        try:
            top.unlink()
            removed += 1
        except OSError:
            pass
    # Remove matching virtual-store entries only when nothing else links them:
    # a package the runtime closure needs could share the name+version.
    for store_entry in (root / ".pnpm").iterdir():
        if not store_entry.name.startswith(name + "@"):
            continue
        linked = False
        for p in (root / ".pnpm").rglob("node_modules"):
            link = p / name
            if link.is_symlink() and store_entry.name in os.readlink(link):
                linked = True
                break
        if not linked:
            shutil.rmtree(store_entry, ignore_errors=True)
            removed += 1

print(f"drop-dev-deps: removed {removed} root devDependencies entries")
