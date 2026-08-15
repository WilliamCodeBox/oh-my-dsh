# Agent Note: TUI surface reintroduction (M0 skeleton)

Status: implemented

## Problem

The terminal front door deleted by [remove-tui-package](../../implemented/simplification/2026-08-04-remove-tui-package.md) left dsh with Web as the only interactive human surface. Its reintroduction conditions — a named product or deployment, an explicit package boundary, a concrete interaction provider, and assembled lifecycle and transcript acceptance — were recorded but unaddressed. This note records the phased reintroduction of `omd --profile tui` and how each condition is met or named as a milestone's exit criterion.

## Decision

`@deepseek-ai/dsh-tui` returns as an installable profile bundle at `packages/bundle/tui` (patch + `tui-startup` cmdline provider + `tui-runner` glue plugin), booted as `omd --profile tui`. The M0 surface is line-oriented event tracing over `dsh-base` — no Host, HTTP, Web runtime, or browser rows.

Reintroduction conditions, in order:

1. **Named product/deployment — met.** `omd --profile tui` is the product entrypoint; the package README and this note define the deployment and its M0 contract.
2. **Explicit package boundary — met.** The glue bundle sits at `packages/bundle/tui`. The presentation layer stays out of the bundle; the renderer milestone picks its package home (the `ui/` group was dissolved by the [regrouping RFC](../../../docs/AGENTS.md) and is not resurrected by this change).
3. **Concrete interaction provider — named, deferred.** The approval / user-questions / commands adapters are the interaction milestone's deliverable. Until then approvals fall through to the fail-closed `unavailable` outcome and questions to `NO_PROVIDER`; nothing degrades silently.
4. **Assembled lifecycle and transcript acceptance — named, deferred.** The testing milestone adds the runnable-example keyless snapshot and PTY case the human-visible surface policy requires; the M0 package tests cover the runner seams.

The M0 runner creates or resumes one Agent through `ctx.agents`, traces durable `session/event` facts filtered to the owned session (subagent sessions never reach the transcript), submits user input as follow-up turns while idle and steering while a turn runs, and owns the terminal lifecycle:

- **Input**: Enter submits the line; backspace edits; Ctrl+C goes through the raw-mode key machine (clear input → cancel turn with `keepInbox: true` → quit → force-exit), never the launcher's signal chain, because raw mode turns Ctrl+C into byte `0x03`.
- **Terminal restore**: raw mode is entered on boot and restored synchronously on quit, on uncaught exceptions, and as the crash-restore handler's first action, so a failed run cannot strand the user's shell.
- **Sanitizer**: every traced line passes `sanitizeText` before it reaches the terminal, so prompt-injected C0/C1 controls render as visible hex escapes instead of executing.
- **Command line**: `--resume <session-id>` (via `ctx.agents.resume`), `--workspace <path>`, `--model <provider/model>` (split into agent options), and `--permission <preset>` (via `ctx.permissionPresets.set`), parsed by the ordinary `tui-startup` provider through `dsh-cmdline`.

## Alternatives considered

### Why not reintroduce the old full-screen TUI directly?

The deleted package's renderer, adapters, and snapshots were built for the removed product entrypoint and would need the same rework the milestones perform anyway. Restarting from the current host and interaction requirements — per the removal note's own guidance — keeps the bundle thin and the presentation decision open.

### Why not build the out-of-process frontend first?

The SDK JSON-RPC channel's server→client requests are a dead capability, so approval, questions, and commands have no wire round-trip today. The repository's working out-of-process interaction channel is the ApiProxy four-quadrant contract; a second frontend reusing it is a later milestone, not the M0 spine.

### Why not resurrect the `ui/` group for the presentation layer?

The regrouping RFC dissolved `ui/` (tui joined the `interaction/` direction, app-boot joined `boot/`, scaffold replaced `sdk/`). A new group for the pure renderer is an open decision the renderer milestone makes with the spike evidence; M0 has no presentation layer to place.

## Consequences

- `omd --profile tui` is runnable again: installs through `dsh plugin --profile tui add <spec>`, prints its own `--help`, boots the base tree, and restores the terminal on every exit path (quit, EOF, crash).
- Approval and question tools remain fail-closed until the interaction milestone — an explicit, documented gap, not silent degradation.
- The Ctrl+C semantics are the skeleton; the refined "cancel then graceful 130 quit" policy and full keymap land with the interaction milestone.
- The launcher's SIGINT/SIGTERM chain remains a cooked-window and external-signal safety net only; raw mode owns user Ctrl+C.
- The renderer milestone replaces the tracer with the two-layer renderer and moves presentation out of the bundle; until then the surface is line-oriented with no scrollback.
