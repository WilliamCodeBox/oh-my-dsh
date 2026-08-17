# @williamcodebox/omd-client-trajectory-model

English | [中文](README.zh.md)

Framework-neutral model layer for the trajectory views: the pure data contracts and pure projections the trajectory UI consumers share. The package owns no React and no rendering — `TrajectoryCellProps` is a plain data contract whose DOM presentation attributes are composed by each consumer, and the turn/group layout model (`TrajectoryTurnModel` / `TrajectoryGroupModel`) plus the operation-sequence and recorded-time timeline projections (`deriveTrajectoryTimeline`, `trajectoryTimelineFocusIndexes`) compute only over that data. It is imported by [`ui-trajectory`](../ui-trajectory/README.md) and may be reused by any other consumer that renders the same ledger without pulling in the browser plugin.

## Contract

The unit of projection is the **trajectory record** (`TrajectoryCellProps`): a closed-kind cell carrying identity (`trajectoryRecordId`), summary text, optional full input/output/thinking/prompt content, source and output blocks, assistant timing/token facts, and own-duration fields. `promptDetail` and `previousPromptDetail` are the package's self-contained `TrajectoryPromptSnapshot` (config, system prompt text, tool catalog) — the same shape the browser snapshot produces, declared here so the model layer never imports the runtime. `layout-model.ts` folds records into groups and turns; `timeline.ts` projects any layout into a stable three-lane timeline in one of four modes (`'sequence' | 'duration' | 'time' | 'actual'`), and `detail-tabs.ts` derives the details-panel tabs available for one record (`detailTabsFor(cell)`). Durations format through `formatDurationMillis` / `formatElapsedSeconds` / `formatTimelineOffset` with thousands separators and an em dash for unknown values.

## Consumption

Import from the package root:

```ts
import type { TrajectoryCellProps, TrajectoryTurnModel } from '@williamcodebox/omd-client-trajectory-model'
import { deriveTrajectoryTimeline, trajectoryRecordId } from '@williamcodebox/omd-client-trajectory-model'
```

The `./src/*` subpath exports source for bundler tooling that compiles repository sources directly. The `./invariant` companion registers the package's ownership with the invariants service; it has no runtime behavior.

## Model Experience

### Trajectory record projection

#### What the model sees

No `TrajectoryCellProps` value reaches a model request: the package projects already-recorded session data in the browser and registers no prompt, tool schema, or model context of its own. The `TrajectoryToolSchema` shape mirrors the call-time tool catalog only as recorded data for the details panel.

#### Token effect

None; the package neither assembles nor sends a provider request, and token counts (`input`, `output`, `think`, `cacheRead`, `cacheWrite`) are read-only facts carried by records.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No layout derivation** — `layout.ts` folding from a browser `ConversationSnapshot` stays in `ui-trajectory`; this package consumes the folded `TrajectoryTurnModel` and does not reconstruct it from raw nodes.
- **No markdown preview or search index** — preview text and incremental search depend on the `ui-primitives` renderer (`extractMarkdownPlainText`) and stay with the browser consumers (`trajectory-preview.ts`, `trajectory-search-index.ts`); this package carries record content as data.
