# TUI 审批适配器（M2a）

## 问题

每个需要审批的工具调用都 fail-closed 到 `'unavailable'`：TUI 没有 `approval/request` waterfall 的应答者，敏感操作永远无法交互式放行。

## 改动

- `packages/interaction/tui-renderer/src/presenter.ts` — presenter seam 上的 overlay 模态：`askApproval(toolName, reason)` 经 `showOverlay` 挂一张 pi-tui overlay 卡片（标题 + 理由 + Allow/Reject 的 `SelectList`），焦点抢到列表，按键后以所选 outcome 决议。Escape 或 Ctrl+C 取消（`'cancelled'`）；决议后模态恢复 editor 焦点并自行隐藏。`approvalPending` 与 `isStarted` getter 向 runner 暴露模态状态。
- `packages/bundle/tui/src/index.ts` — 应答者：`ctx.on('approval/request', ...)` 把组合表面的每个审批路由到活动 presenter 的模态；无 presenter（pipe 路径）时调用 `next()`，waterfall 落入 fail-closed `'unavailable'`。runner 的 Ctrl+C 监听在 `approvalPending` 期间让位：SelectList 自己的 cancel 绑定（Escape/Ctrl+C）决议提示，而非驱动退出机器。
- 依赖：renderer 与 bundle 各加 `@williamcodebox/omd-user-approval` peer+dev（其 `./types` 子路径 wire-safe）；renderer tsconfig 增加 user-approval project reference。

## 为何这样设计

- pi-tui 的 `showOverlay`/`hideOverlay` 自行管理焦点、堆叠与恢复——无需换 layout root；既有 `EDITOR_THEME.selectList` 样式复用作模态列表主题。
- TUI 应答所有 agent 的审批（含 subagent）：用户就在终端前，审计配对仍落在请求方 session 的日志上。
- pipe 路径保持文档化的 fail-closed 契约——任何地方都不存在静默自动放行。

## 验证

- +5 测试：bundle 在 fake terminal 上驱动 Allow（Enter）、Reject（down+Enter）、Cancel（Ctrl+C，随后一次 Ctrl+C 退出 130），pipe 路径返回 `'unavailable'`；renderer 直接测模态生命周期（allow/reject/cancel、`approvalPending` 迁移）。
- bundle + renderer 单测 100/100；`tsc -b` 0 错误；oxlint 0。

## 后续

- M2b：`ask_user_question` 选择器挂到同一模态机制；斜杠命令菜单把 `/` 前缀行经命令运行时派发，并新增 `command` 转录条目。
