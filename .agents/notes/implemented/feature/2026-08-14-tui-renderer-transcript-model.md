# Agent Note: TUI renderer transcript model (M1a fold-model slice)

Status: implemented

## Problem

The renderer milestone of [the TUI reintroduction](2026-08-14-tui-surface-reintroduction-m0.md) needs a presentation foundation, and the bundle's line tracer is the only surface today. The two-layer renderer requires a durable transcript model that folds the session event stream into display items — one that survives streaming, tool pairing, turn boundaries, and compaction — before any viewport or pi-tui surface can be built on top.

## Decision

New package `packages/interaction/tui-renderer` (`@deepseek-ai/dsh-tui-renderer`) hosts the fold model; the interaction/ group is its confirmed home (the dissolved `ui/` group is not resurrected). `Transcript` folds one session's `session/event` stream in sequence order into display items:

- **user** messages with producer source and the open turn;
- **assistant** messages that stream `text-delta` chunks and finalize on the assembled message (carrying `usage` and the assembled message);
- **tool** call/result cards merged by call id (the pairing id lives in `tool/result`'s message block, not the event data), with failure identity and presentation `meta`;
- **turn** brackets opened by `turn/start` and closed by `turn/end` with the ending reason.

Side state rides the projection: todo snapshot, request header, provider route context, the end-seed marker, and observed compaction replacements. The bundle's line tracer is replaced by a pi-tui presenter over this model in the next slice; the fold model is the stable contract between them.

**Transcript material is append-origin surface events only.** The session surface contract (`isAppendSurfaceEvent` in `packages/core/session/src/surface.ts`) names append-origin events the transcript's durable source material and keeps replacement copies model-only: a landed compaction replacement would erase conversation the human already saw. A replacement therefore records a `CompactionNote` and leaves the folded items untouched. This corrects the naive assumption that the model-visible surface (which shadows replaced ranges) is the transcript source.

## Alternatives considered

### Why not reuse `foldSurface` from dsh-session?

`foldSurface` projects the *model-visible* surface: replacements erase shadowed nodes. That is exactly the wrong projection for a human transcript, and its output (surface node seqs) does not carry the display items — tool cards, turn brackets, streaming state — a renderer needs. The fold model is a display projection, not a reconstruction.

### Why not keep the model in the bundle?

The M0 note's boundary is explicit: presentation stays out of `packages/bundle/tui`. The model is the presentation layer's foundation and lives with it in `interaction/`.

### Why not accumulate reasoning deltas?

Chunk accumulation keeps `text-delta` only; the assembled `assistant/message` is retained for renderers that need full block structure. Reasoning rendering is a renderer-milestone design decision, not a model concern.

## Consequences

- `packages/interaction/tui-renderer` ships `Transcript`, `textOf`, item/state types, and the invariant companion; 16 behavioral tests cover streaming, tool pairing, turn brackets, compaction notes, and side state. Typecheck, workspace constraints, and the Model Experience doc gate pass.
- The bundle's `traceLine`/`StdinInputSource`/`TerminalSession` machinery stays in place until the presenter slice; the M0 surface contract is unchanged by this note.
- Resume replay is not yet wired: stored seed events are not re-emitted through `session/event` (constructor seeds do not emit), so the runner must read storage and fold seed events before live events. The presenter slice owns this.
- The renderer package home decision in the M0 note is now recorded: `interaction/`.
