#!/usr/bin/env python3
"""Replace workspace symlinks (pointing into the repo) with real copies so
the deployed tree is self-contained — pnpm deploy links workspace packages
to the source checkout, which breaks when the tree ships elsewhere."""
import os, shutil, sys

root = sys.argv[1]  # node_modules dir
repo_root = os.path.realpath(sys.argv[2])  # repo root (symlink targets inside are workspace links)
copied = 0
skipped = 0

for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
    for name in dirnames + filenames:
        link = os.path.join(dirpath, name)
        if not os.path.islink(link):
            continue
        target = os.path.realpath(link)
        if target.startswith(repo_root + os.sep) or target == repo_root:
            os.unlink(link)
            if os.path.isdir(target):
                shutil.copytree(target, link, symlinks=False, ignore_dangling_symlinks=True)
            else:
                shutil.copy2(target, link)
            copied += 1
        else:
            skipped += 1

print(f"unlink-workspace: copied {copied} workspace packages, kept {skipped} other symlinks")
