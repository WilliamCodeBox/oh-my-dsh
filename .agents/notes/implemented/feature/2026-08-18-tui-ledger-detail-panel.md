# Agent Note: TUI trajectory ledger and detail panel

Status: implemented

English | [中文](2026-08-18-tui-ledger-detail-panel.zh.md)

## Problem

The TUI surface (`packages/bundle/tui`) had no trajectory-style record view: the transcript fold in `@williamcodebox/omd-tui-renderer` projected durable session events into display items only, so a user could scroll the conversation but not see a classified record of what happened (system/user/context/compacted/message/tool/subtool rows) or inspect any one record's payloads. The Web surface has trajectory semantics; the TUI had no equivalent. Phase 2 extracted the shared record/layout/timeline model into `@williamcodebox/omd-client-trajectory-model` (see the [trajectory shared model extraction](2026-08-18-trajectory-shared-model-extraction.md) note), but nothing consumed it yet — this change is the TUI's user-visible consumption of that model.

## Decision

The TUI now owns a trajectory-style ledger of every folded event plus a per-record detail overlay, built on the Phase 2 shared model with zero changes to it:

- **`transcript.ts` fold extension** — the fold maintains `state.ledger`, an array of `TrajectoryCellProps` rows appended per event and merged in place when a paired event settles them (tool result by call id, subtool result by sub call id, compaction summary/end by compaction id), so per-event cost stays O(1) with a stable array reference. All seven kinds are produced: `system` (request/header events), `user`/`context` (direct prompts vs. injected sources on `user/message`), `compacted` (full compaction lifecycle: start row, summary/end merge, failure row), `message` (assistant/message with token usage and TTFT from per-step first-token timing), `tool` and `subtool` (tool/code-dispatch calls and results, with `schemaDetail` filled from the request header's tool catalog when present).
- **`transcript-view.ts` `LedgerView`** — one row per ledger cell (record index, kind, capped summary, own duration) with a focused-row marker, a record/filter header, a key-hint line, and an empty state; the presenter owns focus/scroll and the Enter/Esc keys.
- **`presenter.ts` foreground key seam** — the presenter registers its key listener first (ahead of the runner's registry and any focused component), and the ledger/detail key handlers run through that seam while the overlay is up. An interaction modal (approval/question) mounted above the ledger yields to the modal's own focused control; the detail overlay is the one overlay that keeps the foreground (tab switching). `openLedger`/`showDetail` mount pi-tui overlays; the detail overlay stacks over the ledger and restores it on close.
- **`detail.ts` `detailBody`** — real tab content for the shared model's `detailTabsFor` branches, conditionalized: `input`/`output` tabs appear only when the cell actually carries the payload, while `schema`/`timing` always exist and degrade to a placeholder; `cappedLines` caps a tab body at 40 lines (`DETAIL_LINE_CAP`) with an explicit remainder marker instead of clipping mid-row.
- **`bundle/tui` commands** — `/ledger` toggles the ledger view (`ledger unavailable` on the pipe path, which has no presenter); `/filter <kind>` sets the kind filter with 7-kind validation (`/filter` alone clears it; unknown kinds get a status notice). Both appear in the workspace-autocomplete descriptors.
- **`bundle/tui/src/ledger.ts` `LedgerProjection`** — the runner-side kind filter over the fold's ledger: a lazy, memoized filtered array invalidated on every fold, so per-event cost stays O(1) and only an actual read pays the filter scan.
- **Wiring** — `tui-renderer` and `bundle/tui` gained workspace deps on `@williamcodebox/omd-client-trajectory-model` (plus `omd-tools`/`omd-compaction` type-only imports in `tui-renderer` for the tool/code-dispatch and compaction event shapes); both tsconfigs reference the shared package; `tsconfig.host.json` references the client-side package from the host aggregate with a comment explaining the cross-face reference; `pnpm-lock.yaml` regenerated.

## Boundaries

- The shared model package is untouched: this change only consumes it. Record semantics are asserted by the consuming packages' tests.
- The pipe (non-TTY) path has no presenter, so `/ledger` reports `ledger unavailable` and never submits a follow-up turn.
- `context` cells come from `user/message` events whose source is not the user (injected context), matching the Web trajectory's split — not from `request`/`context` events, which are not append-origin surface material.

## Alternatives considered

- **A separate transcript-item stream for the ledger** — rejected: the ledger is a projection of the same append-origin surface events; folding it alongside the display items keeps one source of truth, and the in-place merge keeps per-event cost O(1) without re-derivation.
- **Re-derive the filtered ledger on every fold** — rejected: `LedgerProjection` memoizes the filtered array and invalidates it per fold, so rendering never pays the filter scan until the underlying cells actually change.
- **Route ledger keys through the runner's existing registry** — rejected: while the ledger or its detail overlay is up, Esc/Enter/Tab/arrows must be intercepted ahead of the registry's quit machine and the input editor; a foreground seam registered first in the presenter gives deterministic precedence, with interaction modals yielding to their own focused controls.
- **Show every tab unconditionally, uncapped** — rejected: `input`/`output` appear only when the cell carries the payload (placeholder tabs otherwise), and `cappedLines` gives degraded terminals a readable non-scrolling body with an explicit remainder marker instead of mid-row clipping.

## Consequences

- A TUI session can now browse every event as a classified ledger record and open a per-record detail overlay (overview/rendered/raw/source/input/output/schema/timing tabs per `detailTabsFor`), with `/filter` narrowing the view to one kind — the user-visible payoff of the Phase 2 model extraction.
- Verification: 225 tests green — `tui-renderer` 147 (8 new transcript, 11 detail, 5 presenter, 5 ledger-view) and `bundle/tui` 78 (index 63, including 4 new runner tests for `/ledger`/`/filter`, a 10s `waitFor` timeout, and the `createUserMessage` import fix) — plus a new pty-snapshot case exercising `/ledger` and the detail overlay on a real PTY.
- Host `typecheck` is clean: the first independent review round found 8 host typecheck errors, all in test fixtures — vitest does not typecheck, so the tests were green throughout; the fixture fixes landed and the second review round confirmed the change mergeable. Two independent review rounds total; the shared model saw zero changes.
- The ledger fold adds no model-facing surface: the runner still submits ordinary user messages and no new prompt prose or tool schema.

## Deferred

None.
