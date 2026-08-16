# Agent Note: AgentOS-style roadmap for oh-my-dsh (M4-M7), revised

Status: proposed
Archived: 2026-08-16

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
per-session preset composition, approval/permission, hooks, credentials seam),
but the AgentOS effects are not assembled: the sandbox is one shared
environment rather than per-task environments, the permission model is
file-effect only (no network/process/credential dimensions), the workflow
engine has no declarative template or checkpoints, the goal loop is
session-local, and there is no structured git/GitHub/PR capability.

This note records the roadmap to assemble those effects. It is a proposal: no
code ships with it. A first revision was adversarially reviewed; the review
record is at the end of this note.

**Terminology** — "task" here means a unit of pipeline work with a defined
lifecycle: created by the pipeline driver, tracked in the todo list, executed
by an agent (or subagent), completed when its acceptance criteria pass. It is
deliberately distinct from session/agent/subagent/job/goal-round; where an
existing concept fits, it is named.

## Current state (evidence)

- `packages/e2b/` — E2B POC: one shared sandbox owned by a single lifecycle
  owner; `ctx.fs` + `ctx.subprocess` point into it; not per-task.
- `packages/sandbox/` — process sandbox seam: file-effect fencing for
  subprocesses sharing the host kernel; `SandboxMode` vocabulary is
  read-only / workspace-write / danger-full-access only. The seam contract
  states that containers/microVMs are NOT backends of this seam — they replace
  the service providers of whole capability seams as environment-coherent
  groups.
- `native/landlock-run/` — native launcher with Landlock file rules
  (MAX_ABI=5); ABI v4 added TCP port rules (`LANDLOCK_RULE_NET_PORT`) — the
  in-repo path for network egress restriction without containers.
- `packages/workflow/` — workflow seam + worker-thread engine +
  tool-workflow/tool-ralph; scripts written by the model; no checkpoints,
  no persistence, no resume; foreground-only, holder-owned runs.
- `packages/goal/` + `packages/todo/` — goal is event-sourced in the session
  log (resume retains objective/phase/rounds but never auto-arms); todo is a
  per-session whole-table list tool.
- `packages/preset/` — per-session agent composition; a subagent child joins
  the parent's standing composition (composeFrom), never a different one.
- `packages/session/` — durable session log (jsonl with default zstd framing),
  checkpoint policy: the resume substrate.
- `packages/credentials/` — credential seam consumed by LLM adapters
  (llm-deepseek, llm-pi-ai, web-search) resolving per operation; the blank is
  injecting credentials into subprocesses/containers.
- `packages/token-meter/` — per-session token folding (exists; not yet used
  for loop budgets).
- `packages/hooks/` — Claude Code/Codex hook bridges; not GitHub integration.

## Roadmap

### M4 — Containerized execution world (optional hardening)

Goal: a task runs in an isolated environment whose filesystem and processes
are not shared with other tasks; the environment is destroyed when the task
ends (including error and timeout), the next task rebuilds clean.

Change: a local container **execution-world composition** (owner + fs/
subprocess adapters, the E2B three-package pattern) — NOT a sandbox-seam
backend (the seam contract forbids that; containers replace whole capability
seams as environment-coherent groups). Docker is an **optional hardening
provider**; the sandbox-local bwrap→Landlock ladder stays the default and the
degradation path on hosts without Docker. Scope: template image (Node + git),
workspace mount, create/exec/destroy lifecycle, residue reconciliation.

Verify: sequential tasks are isolated (filesystem/processes invisible between
runs); the container is destroyed on abnormal exit with no residue in
`docker ps`. Parallel per-task container pools (pool cap, labels, workspace
sync/conflict policy) are explicitly out of scope and listed as a follow-up.

Risks to design in: docker.sock ≈ root (model escape via
`docker run -v /:/host` — daemon boundary, rootless/socket proxy); image
supply chain; CI Docker-in-Docker; hosts without Docker fall back to the
sandbox-local ladder.

Size: medium-large (reduced: no parallel pool, no sync).

### M5 — Minimum-permission matrix (same-world first, containers later)

Goal: the agent gets only explicitly granted file paths, network allow-list,
visible processes, and injected credentials — deny by default. Split into a
same-world matrix (works without containers) and a containerized matrix
(builds on M4).

Change:
- **Same-world matrix**: files (already covered by SandboxMode); network —
  extend the native launcher with `LANDLOCK_RULE_NET_PORT` (ABI v4 TCP rules)
  and a denial dialect in the existing probe/partial report mode; processes —
  pid visibility via the existing bwrap profile; credentials — inject into
  restricted subprocess env (first subprocess-facing consumer of the
  credentials seam).
- **Containerized matrix**: per-container network policy, PID namespace,
  secret mounts (M4 as the substrate).
- Compat with the existing session model: each dimension gets a knob event +
  fold like sandbox/mode; escalation ("strictly wider" retry after denial)
  is defined per dimension; defaults come from config (cordis.yml manifest),
  runtime overrides from session events.
- Credential injection safety: secrets via one-shot env/secret-file mounts
  (never docker-inspect-visible env), rotation behavior (resolve per
  operation; running processes do not see rotated values — document),
  plaintext `.credentials.yaml` at rest risk assessment.

Verify: access outside the allow-list is denied (network/files/processes);
credentials appear only in authorized environments.

Size: medium.

### M6 — Declarative template pipeline + git tools (requirements → PR)

Goal: a feature flows through a declarative template (YAML) with stages —
understand requirements, decompose tasks, implement, test, review, open PR —
with checkpoints (resumable) and human confirmation gates. **Git tools move
into this milestone** (they are required by the pipeline's own acceptance
path): structured git tools (branch/commit/push) and PR integration, both
consuming the credentials seam.

Change, in two slices:
- **M6a — template format + stage executor**: stages (goal, tool set,
  completion criteria, confirmation gate) defined in YAML; a stage executor
  drives subagents/tools directly (no model-written JS); stage roles reuse one
  standing preset with tool-set differences as prompt-level discipline — OR a
  new per-stage agent design (open decision: the subagent seam forces children
  to inherit the parent's preset, so per-stage tool sets are not expressible
  today; todo ownership across stages must be pinned — todo is per-session
  single-owner today).
- **M6b — checkpoints/resume + PR integration**: stage checkpoints persist
  into the session log (new event family + fold + invariant; only declarative
  stage boundaries are checkpointable — arbitrary model-written script state
  is not); resume across restarts; PR create/update/request-review tools with
  credential consumption (one-shot env + cleanup or helper, scope-limited
  token).

Verify: a requirements md drives the pipeline to a PR (or halts at a
confirmation gate); killing and restarting the process resumes from the last
checkpoint.

Size: large (two slices).

### M7 — Persistent goal loop with budgets and verification gates

Goal: the loop keeps running until every defined task is checked off and the
PR is created/updated — with hard budgets and independent verification.

Change (the goal domain is already event-sourced in the session log; the real
increments are):
- automatic arming after restart (activation is never persisted today; keep a
  human-authorization boundary — arming policy, not silent auto-resume);
- headless residency (headless is "one submitted task only" today — add a
  non-exiting mode); reuse the schedule/round-driver idle mechanisms instead
  of a new driver;
- retry strategy as an explicit decision record (goal-round-driver has no
  auto-retry today — flipping it is a deliberate decision, bounded);
- budgets: token budget (reuse token-meter) + wall-time/currency hard caps
  with defaults;
- completion standard: each task must produce verifiable evidence (test/build
  results) before it may be checked off; the test stage is an independent
  gate, not model self-attestation.

Verify: a requirements md lands as an auto-created PR within budget; the
process keeps looping while tasks remain and resumes after restart only under
the arming policy.

Size: large.

## Implementation order (revised after review)

The original M4→M5 hard dependency was wrong: most matrix dimensions are
expressible on the same-world backends. Revised order:

1. **git/GitHub tools + M6a** (template pipeline) — the first path to user
   value (requirements → PR), on the existing workflow/approval/preset/session
   seams.
2. **M6b** (checkpoints/resume + PR integration).
3. **M5 same-world matrix** (Landlock TCP, pid visibility, subprocess
   credential injection).
4. **M4 containerized execution world** (optional hardening; sandbox-local
   stays default) + **M5 containerized matrix**.
5. **M7** (arming policy, headless residency, budgets, verification gates).

Milestone numbers keep their original meaning (M4 containers, M5 permissions,
M6 pipeline, M7 loop); this section states the actual build order.

## Decisions

- Containerized execution world is an optional hardening provider; the
  sandbox-local ladder stays the default and the degradation path.
- Network restriction first on Landlock ABI v4 (extend the native launcher),
  not container network policy.
- Git/GitHub tools move into M6 (the pipeline's acceptance path needs them).
- Credential injection into subprocesses/containers is the first
  subprocess-facing consumer of the credentials seam (LLM adapters already
  consume it).
- Retry/arming policies in M7 are explicit decision records, not silent flips
  of the no-auto-retry design.
- Budgets (tokens, wall time, currency) and an independent verification gate
  are mandatory for the unattended loop.
- Control-plane UI (Kanban boards, triggers, automations) is out of scope for
  M4-M7; the existing TUI/CLI is the control plane.

## Review record

Adversarial review (2026-08-16, two reviewers) found and this revision adopts:
- M4 as a sandbox-seam backend contradicts the seam contract — redefined as an
  execution-world composition, optional hardening, parallel pool out of scope.
- "credentials seam has no consumer" was factually wrong (LLM adapters
  consume it) — corrected; injection blank is subprocess/container-facing.
- M6's acceptance depended on M7's git tools — git/PR tooling moved into M6.
- M6 stage→preset mapping is not expressible under the subagent inheritance
  rule — recorded as an open design decision with todo ownership pinned.
- M6 checkpoints only on declarative stage boundaries (model-written script
  state is not checkpointable).
- M7's goal persistence was mostly implemented — increments redefined;
  retry/arming need explicit decision records.
- Unattended loops need token/wall-time/currency budgets and an independent
  completion gate — added.
- Docker's daemon boundary, image supply chain, and hosts-without-Docker
  degradation were unaddressed — added as risks to design in.
- "task" was undefined — defined at the top.
