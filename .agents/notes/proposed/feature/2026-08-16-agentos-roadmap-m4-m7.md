# Agent Note: AgentOS-style roadmap for oh-my-dsh (M4-M7)

Status: proposed

English | [中文](2026-08-16-agentos-roadmap-m4-m7.zh.md)

## Problem

Danny Postma's "AgentOS" (built on the Claude Agent SDK; talk
_How I Built My Own AgentOS on Claude's Agent SDK_, 2026-08-14) is a personal
agent control plane, not an open-source product: each agent session runs in a
fresh ephemeral container, is granted the minimum permissions for its task
(deny by default, explicit allow-lists for files, network, secrets, and
processes), a declarative template pipeline drives a feature from a
requirements document to a reviewed PR, and the goal loop keeps running until
every defined task is checked off. The publicly available architecture detail
is a community reconstruction (Ian Nuttall's blueprint gist), not the author's
source.

oh-my-dsh already has most of the execution seams (fs/shell/subprocess/sandbox/
E2B, session persistence, goal/todo, subagent delegation, workflow engine,
per-session preset composition, approval/permission, hooks, credentials seam
with no consumer yet), but the AgentOS effects are not assembled: the sandbox
is one shared environment rather than per-task containers, the permission
model is file-effect only (no network/process/credential dimensions), the
workflow engine has no declarative template or checkpoints, the goal loop is
session-local, and there is no structured git/GitHub/PR capability.

This note records the roadmap (milestones M4-M7) to assemble those effects.
It is a proposal: no code ships with it.

## Current state (evidence)

- `packages/e2b/` — E2B POC: one shared sandbox owned by a single lifecycle
  owner; `ctx.fs` + `ctx.subprocess` point into it; not per-task.
- `packages/sandbox/` — process sandbox seam: file-effect fencing for
  subprocesses sharing the host kernel; `SandboxMode` vocabulary is
  read-only / workspace-write / danger-full-access only.
- `packages/workflow/` — workflow seam + worker-thread engine +
  tool-workflow/tool-ralph; scripts written by the model; no checkpoints,
  no persistence, no resume.
- `packages/goal/` + `packages/todo/` — session-local goal with round budget;
  todo is a plain list tool.
- `packages/preset/` — per-session agent composition from a cordis.yml preset.
- `packages/session/` — durable session log (jsonl/sqlite), checkpoint policy:
  the resume substrate.
- `packages/credentials/` — credential seam with local provider; no consumer.
- `packages/hooks/` — Claude Code/Codex hook bridges; not GitHub integration.

## Roadmap

### M4 — Per-task isolated execution environment

Goal: each task runs in its own ephemeral container; environments are mutually
invisible; containers are destroyed when the task ends (including on error and
timeout), next task rebuilds clean.

Change: new local container provider (Docker) implementing the sandbox
seam — create from a template image / exec / destroy lifecycle; base image with
Node + git toolchain; workspace mount; point `ctx.fs`/`ctx.shell`/
`ctx.subprocess` at the container (E2B-style adapter swap, provider replaced).

Verify: two tasks run in parallel with mutually invisible filesystems and
processes; container destroyed on abnormal exit; no residue in `docker ps`.

Size: medium-large.

### M5 — Minimum-permission model (deny by default)

Goal: agent gets only explicitly granted file paths, network allow-list,
visible processes, and injected credentials — a four-dimension permission
matrix, deny by default.

Change: extend the sandbox seam with the matrix (files/network/process/
credentials); network egress restriction via container network policy; PID
namespace isolation; credential injection through the existing `credentials`
seam as its first consumer (e.g. GitHub token injected into authorized
containers only); permission manifest in cordis.yml.

Verify: access outside the allow-list is denied (network, files, processes);
credentials appear only in authorized containers.

Size: medium.

### M6 — Declarative template pipeline (requirements → PR)

Goal: a feature flows through a declarative template (YAML) with stages —
understand requirements, decompose tasks, implement, test, review, open PR —
with checkpoints (resumable) and human confirmation gates.

Change: pipeline template format (stages: goal, tool set, completion criteria,
confirmation gate); workflow engine gains stage checkpoint persistence (into
the session log) and resume across restarts; stage-to-agent-role mapping via
the preset mechanism (plan/implement/review agents); requirements document as
input decomposed into the todo list; human gates through the existing
approval seam.

Verify: a requirements md drives the pipeline to a PR (or halts at a
confirmation gate); killing and restarting the process resumes from the last
checkpoint.

Size: large.

### M7 — Persistent goal loop + automatic PR

Goal: the goal loop keeps running across restarts until every defined task is
checked off, then creates/updates the PR automatically.

Change: persist goal state in the session log and resume the loop; idle-driven
continuation in headless/background mode with retry and round caps; structured
git tools (branch/commit/push) instead of bare shell git; GitHub integration
consuming the credentials seam (PR create/update/request-review).

Verify: a requirements md lands as an auto-created PR; the process keeps
looping while tasks remain and resumes after restart.

Size: large.

## Dependencies and order

- M4 → M5 (M5 builds on the container); M6 → M7 (M7 builds on the pipeline
  plus git/GitHub tooling).
- M6 does not depend on M4/M5 — the two groups can proceed in parallel.
- Numbering continues the TUI milestones M0-M3 (all shipped).

## Decisions

- Local container provider (Docker) for M4 — no cloud sandbox (E2B remains an
  alternative provider behind the seam).
- Permission matrix denies by default; every dimension is explicit.
- Credential injection is the first consumer of the existing credentials seam.
- Control-plane UI (Kanban boards, triggers, automations) is out of scope for
  M4-M7; the existing TUI/CLI is the control plane.
