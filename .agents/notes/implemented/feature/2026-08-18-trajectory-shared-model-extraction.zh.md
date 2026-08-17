# Agent Note: Trajectory shared model extraction

Status: implemented

[English](2026-08-18-trajectory-shared-model-extraction.md) | 中文

## Problem

trajectory record/layout/timeline 模型原本在 `packages/client/ui-trajectory` 内，这是一个 React client bundle：`TrajectoryCellProps` 继承 `HTMLAttributes<HTMLDivElement>`，详情面板的 tab 投影接收表格侧 React 的 `TableRecord`，`trajectory-record.ts`/`timeline.ts` 与渲染它们的组件同处一室。Phase 3 的宿主平面 TUI 详情面板需要相同的 record/layout/timeline 语义，但从 TUI 导入 ui-trajectory 会把 React 与 DOM 类型拖进非浏览器消费方。在 TUI 工作开始之前，模型必须先抽取为框架中立、零依赖的包。

## Decision

新的 client 包 `packages/client/trajectory-model/`（`@williamcodebox/omd-client-trajectory-model`）现在拥有共享 trajectory 模型，从 `ui-trajectory/src/client/` 迁入：

- `trajectory-record.ts` — 封闭的 7 类 `TrajectoryCellKind`、`TrajectoryCellProps`，以及 `trajectoryRecordId`/`formatDurationMillis`/`formatElapsedSeconds`。
- `layout-model.ts` — `TrajectoryTurnModel`/`TrajectoryGroupModel`（原先声明在 `layout.ts`）。
- `timeline.ts` — `deriveTrajectoryTimeline`/`trajectoryTimelineFocusIndexes` 及 timeline range/span 类型。
- `detail-tabs.ts` — `DetailTab`/`DetailTabItem`/`detailTabsFor`，与 `TableRecord` 解耦，改为以 `TrajectoryCellProps` 为键。

该包框架中立、零运行时依赖。`promptDetail`/`previousPromptDetail` 使用包内自含的 `TrajectoryPromptSnapshot`——与 runtime 的 `ConversationPromptSnapshot` 结构兼容（`tsc` 确认赋值兼容）——而不是导入 runtime 类型，因此宿主平面可以在无 client/runtime 类型依赖的情况下消费该包。`TrajectoryCellProps` 不再继承 `HTMLAttributes<HTMLDivElement>`：共享层保持纯数据，DOM 属性由 React 侧组合（`TrajectoryCell.tsx` 中 `TrajectoryCellDomProps = TrajectoryCellProps & HTMLAttributes<HTMLDivElement>`）。

`ui-trajectory` 删除两个迁出的源文件（`trajectory-record.ts`、`timeline.ts`），所有 import 改指向共享包，详情面板调用方改为调用 `detailTabsFor(record.cell)`。

仓库接线：`tsconfig.base.json` 增加 `@williamcodebox/omd-client-trajectory-model` paths 条目（`omd-*` 通配无法推导 `client-trajectory-model` → `trajectory-model`），`tsconfig.client.json` 增加 aggregate reference，`packages/client/README` 三件套更新，`pnpm-lock.yaml` 重新生成。

Bundle 纯度：ui-trajectory 对共享包的 VALUE import 会触发 `dsh-client-bundle-purity` 门禁；`packages/client/tsdown.client.ts` 把 `client-trajectory-model` 加入 `INLINE_SAFE` 白名单——纯模型库、无运行时身份，src 内仅 type-only 导入 `cordis`/`omd-invariants`。该包的 `invariant` 配套插件（`invariant.ts`）以 `client-trajectory-model-invariant` 注册 no-op installer：record/layout/timeline 语义由消费方的行为规格断言。

## Boundaries

以下内容留在 `ui-trajectory`，因为它们带有浏览器或 React 专属依赖：

- `layout.ts` 的实现——其输入是浏览器 `ConversationSnapshot` 形状。
- `trajectory-preview.ts` 与 `trajectory-search-index.ts`——依赖 ui-primitives 的 GFM markdown parser。
- `flattenRecords`——依赖 React 侧 `TableRecord` 内部结构。

## Alternatives considered

- **抽取完整 `layout.ts`（含实现）** — 否决：其输入是浏览器 `ConversationSnapshot` 形状；迁出会把浏览器专属类型拖进宿主平面 TUI 必须消费的包。
- **从 client/runtime 导入 `ConversationPromptSnapshot`** — 否决：会增加运行时类型依赖，破坏让宿主平面消费该包的零依赖目标。
- **保留 `TrajectoryCellProps` 继承 `HTMLAttributes<HTMLDivElement>`** — 否决：共享层必须保持纯数据；DOM 属性属于 React 组合侧。
- **一并迁移 `trajectory-preview`/`trajectory-search-index`/`flattenRecords`** — 否决：它们依赖 ui-primitives 的 markdown parser 或 React 侧 `TableRecord` 内部结构。

## Consequences

- ui-trajectory 行为不变：独立验证 agent 跑 ui-trajectory 测试（8 个文件、107 个用例）全绿；两个包与 client aggregate 的 `tsc --noEmit` 干净；无指向已删文件的残留 import；`verify-invariants`、`readme-limitations`、`translation-pairing`（384 对）通过。
- BLOCKER 修复后：`pnpm build:lib:client` 全 face 通过（12.84 s），产出 `lib/index.js`（7376 B）与 `lib/invariant.js`（1026 B）。复核确认 `INLINE_SAFE` 白名单改动无副作用，判定可合入。
- 模型现在可被宿主平面 TUI 详情面板（Phase 3）消费，无需 React、DOM 或运行时依赖——纯模型边界对 ui-trajectory 零成本，并由 `dsh-client-bundle-purity` 通过 `INLINE_SAFE` 白名单强制。

## Deferred

- Phase 3 的 TUI 详情面板将消费此包——抽取正是为此铺路。
- 上一轮 session 分析曾建议补 `size` 字段诊断上下文增长；不在本次范围内。
