# @williamcodebox/omd-client-trajectory-model

[English](README.md) | 中文

面向 trajectory 视图的框架中立模型层：trajectory UI 消费端共享的纯数据契约与纯投影。该包不含任何 React，也不做任何渲染——`TrajectoryCellProps` 是纯数据契约，其 DOM 呈现属性由各消费端自行组合；turn/group 布局模型（`TrajectoryTurnModel` / `TrajectoryGroupModel`）以及操作序列与记录时间的时间线投影（`deriveTrajectoryTimeline`、`trajectoryTimelineFocusIndexes`）只在该数据之上计算。它被 [`ui-trajectory`](../ui-trajectory/README.md) 引入，任何渲染同一 ledger 的其他消费端都可以复用它，而无需拉入浏览器插件。

## 约定

投影的单元是 **trajectory record**（`TrajectoryCellProps`）：一种封闭 kind 的 cell，携带身份（`trajectoryRecordId`）、摘要文本、可选的完整 input/output/thinking/prompt 内容、source 与 output 块、assistant 时序/令牌事实以及自身时长字段。`promptDetail` 与 `previousPromptDetail` 使用该包自包含的 `TrajectoryPromptSnapshot`（config、system prompt 文本、工具目录）——与浏览器快照产出的形态一致，但在此声明，使模型层永不 import runtime。`layout-model.ts` 把 records 折叠为 groups 与 turns；`timeline.ts` 把任意 layout 投影为稳定的三车道时间线，支持四种模式（`'sequence' | 'duration' | 'time' | 'actual'`）；`detail-tabs.ts` 为一个 record 推导详情面板可用的标签（`detailTabsFor(cell)`）。时长通过 `formatDurationMillis` / `formatElapsedSeconds` / `formatTimelineOffset` 格式化，带千分位分隔符，未知值用破折号。

## 消费方式

从包根引入：

```ts
import type { TrajectoryCellProps, TrajectoryTurnModel } from '@williamcodebox/omd-client-trajectory-model'
import { deriveTrajectoryTimeline, trajectoryRecordId } from '@williamcodebox/omd-client-trajectory-model'
```

`./src/*` 子路径为直接编译仓库源码的打包器工具导出源码。`./invariant` companion 向 invariants 服务注册该包的归属权；它没有任何运行时行为。

## 模型体验

### Trajectory record 投影

#### 模型看到什么

没有任何 `TrajectoryCellProps` 值会进入模型请求：该包在浏览器中投影已记录的会话数据，不注册任何 prompt、工具 schema 或模型上下文。`TrajectoryToolSchema` 形状只是照录调用时的工具目录，作为详情面板的已记录数据。

#### Token 影响

无。该包既不组装也不发送提供方请求；token 计数（`input`、`output`、`think`、`cacheRead`、`cacheWrite`）只是 record 携带的只读事实。

#### KV Cache 影响

无。该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **不含 layout 派生**——由浏览器 `ConversationSnapshot` 折叠的 `layout.ts` 逻辑留在 `ui-trajectory`；本包消费折叠后的 `TrajectoryTurnModel`，不从原始 nodes 重建它。
- **不含 markdown 预览与搜索索引**——预览文本与增量搜索依赖 `ui-primitives` 渲染器（`extractMarkdownPlainText`），并留在浏览器消费端（`trajectory-preview.ts`、`trajectory-search-index.ts`）；本包仅把 record 内容作为数据携带。
