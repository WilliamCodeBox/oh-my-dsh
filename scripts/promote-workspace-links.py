#!/usr/bin/env python3
"""Promote every workspace package to the deployed tree's top-level
node_modules/@williamcodebox.

The app-boot profile fallback heals links by BFS over the app manifest's
resolvable dependency graph: each link target must resolve from the tree root
through the ordinary node_modules walk. pnpm deploy hoists only the app's
direct dependencies to the top level, while bundle packages (omd-base and
friends) keep their own dependency sets inside the virtual store. Without this
promotion, `healProfilesModuleFallback` cannot see a bundle's dependencies and
skips them, so the assembled tree fails to boot ("Cannot find package
'@williamcodebox/omd-...'").

Usage: promote-workspace-links.py <node_modules-dir>
"""
import os
import sys
from pathlib import Path

root = Path(sys.argv[1])
scoped = root / "@williamcodebox"
scoped.mkdir(exist_ok=True)

promoted = 0
skipped = 0
for store_entry in (root / ".pnpm").iterdir():
    if not store_entry.name.startswith("@williamcodebox+omd-"):
        continue
    inner = store_entry / "node_modules" / "@williamcodebox"
    if not inner.is_dir():
        continue
    for pkg in inner.iterdir():
        target = scoped / pkg.name
        if target.exists() or target.is_symlink():
            continue
        # Relative symlink into the virtual store, self-contained within the
        # deployed tree (pnpm's own layout uses the same shape).
        rel = os.path.relpath(pkg, scoped)
        target.symlink_to(rel)
        promoted += 1

print(f"promote-workspace-links: {promoted} workspace links promoted, {skipped} skipped")
