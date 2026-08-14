# Agent Note：TUI 渲染器转录模型（M1a 折叠模型 slice）

Status: implemented

## Problem

[TUI 重新引入](2026-08-14-tui-surface-reintroduction-m0.md)的渲染器里程碑需要一个呈现基础，而当前 bundle 只有逐行 tracer。双层渲染器需要一个持久的转录模型——把 session 事件流折叠为展示条目，能正确处理流式输出、工具配对、turn 边界与压缩——之后才能在它之上构建视口与 pi-tui 表面。

## Decision

新包 `packages/interaction/tui-renderer`（`@deepseek-ai/dsh-tui-renderer`）承载折叠模型；interaction/ 组为其确认归属（已解散的 `ui/` 组不复活）。`Transcript` 按序列顺序将一个会话的 `session/event` 流折叠为展示条目：

- **user** 消息，携带生产者 source 与折叠时打开的 turn；
- **assistant** 消息：`text-delta` chunk 流式累积，装配消息到达时定稿（携带 `usage` 与装配消息本身）；
- **tool** 调用/结果卡片按 call id 合并（配对 id 位于 `tool/result` 的 message 块中，而非事件 data），携带失败身份与展示 `meta`；
- **turn** 括号：`turn/start` 打开，`turn/end` 以结束原因关闭。

旁路状态挂在投影上：todo 快照、request header、provider 路由上下文、end-seed 标记与观察到的压缩替换。bundle 的逐行 tracer 将在下一个 slice 被基于该模型的 pi-tui presenter 取代；折叠模型是两者之间的稳定契约。

**转录材料仅限 append-origin surface 事件。** 会话 surface 契约（`packages/core/session/src/surface.ts` 的 `isAppendSurfaceEvent`）将 append-origin 事件命名为"转录的持久材料"，替换副本仅保留在 model-visible 面：压缩替换落地会抹掉用户已看到的对话。因此替换仅记录为 `CompactionNote`，折叠条目不受影响。这修正了"model-visible surface（会遮蔽被替换区间）即转录来源"的朴素假设。

## Alternatives considered

### 为何不复用 dsh-session 的 `foldSurface`？

`foldSurface` 投影的是 *model-visible* surface：替换会抹掉被遮蔽的节点。这对人类转录恰恰是错误投影，且其输出（surface 节点 seq）不携带渲染器需要的展示条目——工具卡片、turn 括号、流式状态。折叠模型是展示投影，而非重建。

### 为何不把模型留在 bundle？

M0 note 的边界明确：呈现层不得留在 `packages/bundle/tui`。模型是呈现层的地基，与其同住 `interaction/`。

### 为何不累积 reasoning delta？

chunk 累积仅保留 `text-delta`；装配后的 `assistant/message` 被保留，供需要完整块结构的渲染器使用。reasoning 渲染是渲染器里程碑的设计决策，不是模型关注点。

## Consequences

- `packages/interaction/tui-renderer` 交付 `Transcript`、`textOf`、条目/状态类型与 invariant 伴生插件；16 个行为测试覆盖流式、工具配对、turn 括号、压缩注记与旁路状态。typecheck、workspace 约束与 Model Experience 文档门禁全部通过。
- bundle 的 `traceLine`/`StdinInputSource`/`TerminalSession` 机制在 presenter slice 落地前保持不动；M0 表面契约不受本 note 影响。
- resume 重放尚未接线：存储的 seed 事件不会经 `session/event` 重发（构造函数 seed 不 emit），runner 需读取存储并在实时事件前折叠 seed 事件。该工作归 presenter slice。
- M0 note 中悬而未决的渲染器包归属决策已落定：`interaction/`。
