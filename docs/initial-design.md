# oh-my-dsh Initial Design

English | [中文](initial-design.zh.md)

This document distills the archived Agent Notes (`.agents/notes/archived/`) into the
initial design of oh-my-dsh (`omd`): what the product is, the decisions that shaped
it, and the roadmap that follows. It is the single entry point for the design
history; the archived notes remain the authoritative per-decision records.

## Product

oh-my-dsh is an out-of-the-box coding agent TUI, forked from DeepSeek Harness.
It is a plugin host powered by Cordis: the launcher, the TUI, and every capability
(shell, filesystem, subprocess, sandbox, skills, sessions, delegation, approval)
are independently versioned plugins composed per profile. Bare `omd` opens the
interactive TUI.

## Architecture principles

- **Everything is a plugin.** New behavior goes on documented extension points;
  changing the agent loop requires updating `docs/architecture.md`.
- **Capability seam.** A capability comprises Service Definition / Service
  Provider / Consumer roles. It is complete, never one role.
- **Model-visible ⟺ logged.** Anything that reaches a model request must be
  reconstructable from the session log; a new model-visible input requires a
  session event.
- **Fail loud.** Misconfiguration fails at load when self-contained, otherwise at
  the earliest resolvable point; never silently skip a missing referent.
- **Explicit > implicit at package boundaries.** Defaulting is an explicit
  `resolve(request): Spec` step, never a hidden `?? default` inside `run()`.
- **No hardcoded tunables.** Deployment-varying choices are validated `Config`
  fields changeable from cordis.yml.
- **Runtime invariants assert owned relationships.** Check authoritative event
  streams or mutable data, not service presence or fixed pure examples.

## Milestones

### Completed

- **M0** — TUI surface reintroduction: line-oriented renderer, raw-mode keyboard,
  terminal restore, sanitizer, PTY tests, replay smoke.
- **M1** — Renderer presenter and transcript model: agent/session/user message
  rendering, streaming updates.
- **M2** — Interaction adapters: user questions, approval flow, commands.
- **M3** — Smoothness and replay: keymap polish, graceful 130/SIGINT quit,
  snapshot-driven transcript replay.
- **Rename** — CLI executable renamed to `omd`; scope renamed to
  `@williamcodebox`; repository metadata corrected (npm release retired in favor
  of GitHub Releases distribution).

### Roadmap (proposed, pending implementation)

- **M4** — Containerized execution world (optional hardening; local Docker first).
- **M5** — Least-privilege matrix (same-world first; Landlock ABI v4 TCP).
- **M6** — Declarative template pipeline + git tools (git tools first).
- **M7** — Persistent goal loop + budgets.

## Key decisions

- **Distribution: bun runtime + pnpm deploy closure folder.** Single-file
  bundles were rejected on evidence (ESM snapshot resolution and dynamic require
  failures); bun's GLIBC 2.17 baseline satisfies CentOS 7+. Shipped as a tarball
  via GitHub Releases with a curl installer (`install.sh`, `GH_PROXY` mirror
  support).
- **Deploy closure is self-contained.** Workspace symlinks into the source
  checkout are replaced with real copies (`scripts/unlink-workspace.py`); dev
  toolchain must not leak into the tarball (pnpm deploy filter).
- **Sandbox: Landlock-based local sandbox** (native launcher source of record in
  `native/landlock-run`), Windows ACL rung for the win32 chain.
- **Persistence: JSONL session logs with durable write-through publication.**
- **LSP: keep and wire.** TypeScript/JavaScript ships via typescript-language-server
  in the tarball; native servers (clangd, rust-analyzer, gopls) are host-provided
  config-only.
- **External subagent providers: keep and extend.** Codex / Claude Code / ACP /
  DSH SDK today; pi, oh-my-pi, opencode as future first-class providers.
- **Web search: keep deepseek default, support common providers** (Tavily,
  Brave, Serper) as mountable alternatives.
- **Python SDK: removed.** The python/ tree (PyPI product line) was deleted along
  with its CI/release lanes and the demo/ACP/SDK plugin families.

## Repository hygiene (2026-08-16)

The fork was cleaned to a single initial commit: upstream history (12k commits,
38 authors) squashed, dependabot disabled, README rewritten, and the plugin tree
trimmed to the shipped product closure (dead cloud/demo/SDK families removed,
test-supporting packages retained).
