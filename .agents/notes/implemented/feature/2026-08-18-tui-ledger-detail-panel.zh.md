# Agent Note: TUI trajectory ledger and detail panel

Status: implemented

[English](2026-08-18-tui-ledger-detail-panel.md) | 中文

## Problem

TUI 表面（`packages/bundle/tui`）此前没有 trajectory 式记录视图：`@williamcodebox/omd-tui-renderer` 中的 transcript 折叠只把持久会话事件投影为展示条目，用户能滚动对话，却看不到按类别划分的记录（system/user/context/compacted/message/tool/subtool 行），也无法检查任何一条记录的载荷。Web 表面有 trajectory 语义；TUI 没有对应物。Phase 2 已将共享的 record/layout/timeline 模型抽取到 `@williamcodebox/omd-client-trajectory-model`（见 [trajectory shared model extraction](2026-08-18-trajectory-shared-model-extraction.md) 笔记），但尚无消费方——本次改动正是 TUI 对该模型的用户可见消费。

## Decision

TUI 现在拥有每条折叠事件的 trajectory 式台账（ledger）以及逐记录详情浮层，构建在 Phase 2 共享模型之上，且对其零改动：

- **`transcript.ts` 折叠扩展** — 折叠维护 `state.ledger`：一个 `TrajectoryCellProps` 行数组，按事件追加，配对事件结算时原地合并（工具结果按 call id、子工具结果按 sub call id、压缩 summary/end 按 compaction id），因此单事件成本保持 O(1)，数组引用稳定。七种 kind 全部产生：`system`（request/header 事件）、`user`/`context`（`user/message` 上直接提示与注入来源之分）、`compacted`（完整压缩生命周期：起始行、summary/end 合并、失败行）、`message`（assistant/message，含 token 用量与由逐步骤首 token 计时得出的 TTFT）、`tool` 与 `subtool`（tool/code-dispatch 调用与结果，存在时从 request header 的工具目录填充 `schemaDetail`）。
- **`transcript-view.ts` 的 `LedgerView`** — 每个 ledger 单元格一行（记录序号、kind、截断摘要、自身耗时），带聚焦行标记、记录/过滤头部、按键提示行与空态；焦点/滚动与 Enter/Esc 键由 presenter 持有。
- **`presenter.ts` 前台键位 seam** — presenter 最先注册其键位监听（先于 runner 的注册表与任何聚焦组件），台账/详情按键处理器在该 overlay 打开期间经由此 seam 运行。挂载于台账之上的交互 modal（审批/提问）会让位给 modal 自身的聚焦控件；详情浮层是唯一保持前台（用于切换 tab）的 overlay。`openLedger`/`showDetail` 挂载 pi-tui 浮层；详情浮层叠于台账之上，关闭时恢复台账。
- **`detail.ts` 的 `detailBody`** — 为共享模型 `detailTabsFor` 各分支提供真实 tab 内容并条件化：`input`/`output` tab 仅在单元格确实携带载荷时出现，`schema`/`timing` 恒在并降级为占位；`cappedLines` 将单个 tab 内容封顶为 40 行（`DETAIL_LINE_CAP`），超出部分以显式余量标记概括，而非行中截断。
- **`bundle/tui` 命令** — `/ledger` 切换台账视图（pipe 路径无 presenter，报 `ledger unavailable`）；`/filter <kind>` 设置 kind 过滤并做 7-kind 校验（单独 `/filter` 清除；未知 kind 给出状态 notice）。两者都出现在 workspace-autocomplete 描述中。
- **`bundle/tui/src/ledger.ts` 的 `LedgerProjection`** — runner 侧对折叠台账的 kind 过滤：惰性、带 memo 的过滤数组，每次折叠失效，因此单事件成本保持 O(1)，只有真正读取时才付出过滤扫描。
- **接线** — `tui-renderer` 与 `bundle/tui` 新增对 `@williamcodebox/omd-client-trajectory-model` 的 workspace 依赖（`tui-renderer` 另以 type-only 导入 `omd-tools`/`omd-compaction` 获取 tool/code-dispatch 与压缩事件形状）；两个 tsconfig 均引用共享包；`tsconfig.host.json` 从 host aggregate 引用 client 侧包并附注释说明跨 face 引用；`pnpm-lock.yaml` 重新生成。

## Boundaries

- 共享模型包未改动：本次仅消费它。记录语义由消费方包的测试断言。
- pipe（非 TTY）路径没有 presenter，因此 `/ledger` 报 `ledger unavailable`，绝不会提交后续轮次。
- `context` 单元格来自 source 非 user 的 `user/message` 事件（注入上下文），与 Web trajectory 的分割一致——而非来自 `request`/`context` 事件，后者不是 append-origin surface 材料。

## Alternatives considered

- **为台账另建一条 transcript 条目流** — 否决：台账是对同一批 append-origin surface 事件的投影；与展示条目一并折叠可保持单一真源，原地合并使单事件成本保持 O(1)，无需重新推导。
- **每次折叠都重推过滤后的台账** — 否决：`LedgerProjection` 对过滤数组做 memo 并在每次折叠时失效，渲染在底层单元格真正变化之前不会付出过滤扫描。
- **让台账键位走 runner 现有注册表** — 否决：台账或其详情浮层打开期间，Esc/Enter/Tab/箭头必须抢在注册表的退出机与输入编辑器之前被拦截；presenter 中最先注册的前台 seam 提供确定性优先级，交互 modal 则让位于自身聚焦控件。
- **无条件展示所有 tab 且不封顶** — 否决：`input`/`output` 仅在单元格携带载荷时出现（否则占位），`cappedLines` 为降级终端提供可读的非滚动正文，以显式余量标记替代行中截断。

## Consequences

- TUI 会话现在可以把每条事件当作分类台账记录浏览，并打开逐记录详情浮层（按 `detailTabsFor` 提供 overview/rendered/raw/source/input/output/schema/timing tab），`/filter` 可将视图收窄到单一 kind——这是 Phase 2 模型抽取的用户可见回报。
- 验证：225 个测试全绿——`tui-renderer` 147 个（8 个新 transcript、11 个 detail、5 个 presenter、5 个 ledger-view），`bundle/tui` 78 个（index 63，含 4 个针对 `/ledger`/`/filter` 的新 runner 测试、10 秒 `waitFor` 超时与 `createUserMessage` import 修复）——另有在真实 PTY 上演练 `/ledger` 与详情浮层的新 pty-snapshot 用例。
- 宿主 `typecheck` 干净：第一轮独立复核发现 8 处宿主 typecheck 错误，全部位于测试 fixture——vitest 不做类型检查，因此测试全程为绿；fixture 修复落地后，第二轮复核判定可合入。共两轮独立复核；共享模型零改动。
- 台账折叠不增加任何面向模型的表面：runner 仍提交普通用户消息，不新增提示词散文或工具 schema。

## Deferred

无。
