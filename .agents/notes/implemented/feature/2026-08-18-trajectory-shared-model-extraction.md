# Agent Note: Trajectory shared model extraction

Status: implemented

English | [中文](2026-08-18-trajectory-shared-model-extraction.zh.md)

## Problem

The trajectory record/layout/timeline model lived inside `packages/client/ui-trajectory`, a React client bundle: `TrajectoryCellProps` extended `HTMLAttributes<HTMLDivElement>`, the details-panel tab projection took the table's React-side `TableRecord`, and `trajectory-record.ts`/`timeline.ts` sat next to the components that render them. The Phase 3 host-plane TUI details panel needs the same record/layout/timeline semantics, but importing ui-trajectory from the TUI would drag React and DOM types into a non-browser consumer. Before the TUI work could start, the model had to be extracted into a framework-neutral, zero-dependency package.

## Decision

A new client package `packages/client/trajectory-model/` (`@williamcodebox/omd-client-trajectory-model`) now owns the shared trajectory model, migrated from `ui-trajectory/src/client/`:

- `trajectory-record.ts` — the closed 7-kind `TrajectoryCellKind`, `TrajectoryCellProps`, and `trajectoryRecordId`/`formatDurationMillis`/`formatElapsedSeconds`.
- `layout-model.ts` — `TrajectoryTurnModel`/`TrajectoryGroupModel` (formerly declared in `layout.ts`).
- `timeline.ts` — `deriveTrajectoryTimeline`/`trajectoryTimelineFocusIndexes` and the timeline range/span types.
- `detail-tabs.ts` — `DetailTab`/`DetailTabItem`/`detailTabsFor`, decoupled from `TableRecord` and re-keyed on `TrajectoryCellProps`.

The package is framework-neutral with zero runtime dependencies. `promptDetail`/`previousPromptDetail` use a package-internal `TrajectoryPromptSnapshot` — structurally compatible with the runtime's `ConversationPromptSnapshot` (assignment-compatibility confirmed by `tsc`) — instead of importing the runtime type, so the host plane can consume the package without a client/runtime type dependency. `TrajectoryCellProps` no longer extends `HTMLAttributes<HTMLDivElement>`: the shared layer stays pure data, and the React side composes DOM attributes (`TrajectoryCellDomProps = TrajectoryCellProps & HTMLAttributes<HTMLDivElement>` in `TrajectoryCell.tsx`).

`ui-trajectory` deleted the two moved source files (`trajectory-record.ts`, `timeline.ts`), rewired every import to the shared package, and the details-panel callers now call `detailTabsFor(record.cell)`.

Repo wiring: `tsconfig.base.json` gained the `@williamcodebox/omd-client-trajectory-model` paths entry (the `omd-*` wildcard cannot derive `client-trajectory-model` → `trajectory-model`), `tsconfig.client.json` gained the aggregate reference, the `packages/client/README` triplet was updated, and `pnpm-lock.yaml` was regenerated.

Bundle purity: ui-trajectory's VALUE imports of the shared package trip the `dsh-client-bundle-purity` gate; `packages/client/tsdown.client.ts` added `client-trajectory-model` to the `INLINE_SAFE` whitelist — a pure model library with no runtime identity whose src only type-imports `cordis`/`omd-invariants`. The package's `invariant` companion (`invariant.ts`) registers a no-op installer under `client-trajectory-model-invariant`: record/layout/timeline semantics are asserted by the consuming packages' behavior specs.

## Boundaries

The following stay in `ui-trajectory` because they carry browser- or React-specific dependencies:

- `layout.ts`'s implementation — its input is the browser `ConversationSnapshot` shape.
- `trajectory-preview.ts` and `trajectory-search-index.ts` — they depend on the ui-primitives GFM markdown parser.
- `flattenRecords` — it depends on the React-side `TableRecord` internal structure.

## Alternatives considered

- **Extract the full `layout.ts`, implementation included** — rejected: its input is the browser `ConversationSnapshot` shape; moving it would drag browser-only types into a package the host-plane TUI must consume.
- **Import `ConversationPromptSnapshot` from client/runtime** — rejected: it would add a runtime type dependency, defeating the zero-dependency goal that lets the host plane consume the package.
- **Keep `TrajectoryCellProps` extending `HTMLAttributes<HTMLDivElement>`** — rejected: the shared layer must stay pure data; DOM attributes belong to the React composition side.
- **Move `trajectory-preview`/`trajectory-search-index`/`flattenRecords` too** — rejected: they depend on the ui-primitives markdown parser or React-side `TableRecord` internals.

## Consequences

- ui-trajectory behavior is unchanged: the independent verification agent ran the ui-trajectory tests (8 files, 107 cases) green; `tsc --noEmit` is clean for both packages and the client aggregate; no residual imports point at the deleted files; `verify-invariants`, `readme-limitations`, and `translation-pairing` (384 pairs) pass.
- After the blocker fix, `pnpm build:lib:client` passes all faces (12.84 s) and emits `lib/index.js` (7376 B) plus `lib/invariant.js` (1026 B). The re-review confirmed the `INLINE_SAFE` whitelist change has no side effects and approved the change for merge.
- The model is now consumable by the host-plane TUI details panel (Phase 3) without React, DOM, or runtime dependencies — the pure-model boundary costs ui-trajectory nothing and is enforced by `dsh-client-bundle-purity` via the `INLINE_SAFE` whitelist.

## Deferred

- Phase 3's TUI details panel will consume this package — the extraction exists to make that possible.
- A `size`-field diagnostic for context growth was suggested in a prior session's analysis; it is not part of this change.
