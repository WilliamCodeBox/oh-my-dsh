#!/usr/bin/env python3
"""Remove the workspace root's devDependencies closure from a deployed tree.

The omd closure deploys the app (apps/cli) with `pnpm deploy` without
`--prod`: the prod flag silently drops workspace bundle plugins (the root
package declares no `dependencies`, so pnpm's prod closure from it is empty
and the base bundle's plugins go missing). Without the flag the root
devDependencies (typescript, vitest, tsdown toolchain, ...) and their whole
transitive trees leak into the deployed tree.

This script computes two package-name sets over the virtual store:
- dev closure: the root devDependencies plus everything their manifests
  depend on (BFS through .pnpm entries);
- prod closure: everything the workspace packages depend on (BFS from every
  `@williamcodebox+omd-*` store entry's manifest dependencies).
Every .pnpm entry whose package name is in the dev closure but NOT in the
prod closure is deleted, along with any top-level symlink of that name.
Entries shared with the prod closure are kept. The assemble smoke (headless
profile boot) then proves the result still loads.

Usage: drop-dev-deps.py <node_modules-dir> <repo-root>
"""
import json
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1])
repo_root = Path(sys.argv[2])

root_manifest = json.loads((repo_root / "package.json").read_text())
dev_deps = root_manifest.get("devDependencies", {})

pnpm = root / ".pnpm"


def entry_names_for(package_name: str):
    """Yield .pnpm entry directory names for a package name. Store entry
    names encode a scope's `/` as `+` (`@williamcodebox+omd-x@file+...`)."""
    scoped = package_name.replace("/", "+")
    for entry in pnpm.iterdir():
        if entry.name.startswith(scoped + "@"):
            yield entry


def manifest_of(entry_name: str):
    """Read the manifest at a .pnpm entry's package root. Scope packages sit
    two directories under node_modules (`@scope/name/package.json`)."""
    pkg_dir = pnpm / entry_name / "node_modules"
    for manifest in pkg_dir.rglob("package.json"):
        return json.loads(manifest.read_text())
    return None


def dependency_names(entry_name: str):
    """Package names a store entry depends on."""
    manifest = manifest_of(entry_name)
    if manifest is None:
        return []
    return [*manifest.get("dependencies", {}), *manifest.get("peerDependencies", {})]


def package_name(entry_name: str) -> str:
    """Package name of a store entry (its manifest's `name`)."""
    manifest = manifest_of(entry_name)
    return manifest["name"] if manifest else None


def reachable_package_names(start_names: set[str]) -> set[str]:
    """BFS package names from start names, resolving each through the store."""
    seen = set()
    queue = list(start_names)
    while queue:
        name = queue.pop()
        if name in seen:
            continue
        seen.add(name)
        for entry in entry_names_for(name):
            for dep in dependency_names(entry.name):
                queue.append(dep)
    return seen


# Dev closure: the root devDependencies plus their transitive trees.
dev_closure = reachable_package_names(set(dev_deps.keys()))

# Prod closure: BFS from every workspace package's dependencies. The store
# entries carry full package names (@williamcodebox/omd-...), which is what
# dependency resolution keys on; the top-level scope links use bare names.
workspace_entries = [e for e in pnpm.iterdir() if e.name.startswith("@williamcodebox+omd-")]
prod_seed = set()
for entry in workspace_entries:
    prod_seed.update(dependency_names(entry.name))
prod_closure = reachable_package_names(prod_seed)

removable = dev_closure - prod_closure
removed = 0
for name in sorted(removable):
    top = root / name
    if top.is_symlink() or top.exists():
        try:
            top.unlink()
            removed += 1
        except OSError:
            pass
    for entry in entry_names_for(name):
        shutil.rmtree(entry, ignore_errors=True)
        removed += 1

print(f"drop-dev-deps: dev closure {len(dev_closure)}, prod closure {len(prod_closure)}, "
      f"removed {removed} entries")
