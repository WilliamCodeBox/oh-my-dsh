# Agent Note: TUI 丝滑收尾与组装重放（M3b）

Status: implemented
Archived: 2026-08-16

[English](2026-08-15-tui-smoothness-and-replay.md) | 中文

## 问题

TUI 功能已齐但不够丝滑：无法上翻历史、状态行缺 token/耗时信息、转录单色无层次、工具卡片可能被超长参数刷屏、resize 未验证；最大缺口是——没有任何测试在无密钥下跑过组装应用的真实模型往返（流式 chunk → 转录 → 渲染）。

## 改动

- `packages/interaction/tui-renderer`：
  - `TuiPresenter` 持有转录 `ScrollView` 并暴露 `scrollTranscript(lines)`；runner 的键监听把 PgUp/PgDn（含 Shift 变体）路由为历史翻页；pi-tui 的 `scrollBy` 语义只在回看时脱离 end-following，回到底部即恢复跟随。
  - `Transcript` 累加已定稿助手消息的 token 用量（`state.usage`）；`formatStatus` 显示 `tokens i+o` 与最近完成 turn 的耗时。
  - `TranscriptView` 接受可选 `TranscriptTheme`；默认 identity（快照 fixture 保持纯文本），presenter 传 16 色 ANSI 主题（用户青色、工具黄、turn 灰、命令品红）。
  - `formatItem` 把工具/命令参数与结果行截断在 300 字符并附显式 `…(+N)`。
- `packages/bundle/tui` — pipe 路径 EOF 时先 `await agent.whenIdle()` 再退出，`echo task | omd --profile tui` 会把管道任务跑完而不是在流末尾中止。
- `apps/cli/tests/tui-pty.snapshot.ts` — PTY 驱动新增 `resize` action（TIOCSWINSZ + SIGWINCH）；case 中途 resize 仍断言干净退出 130 与备用屏恢复。
- `examples/tui-agent` — 交互旅程快照（`tui-interaction.snapshot.ts`）钉死每个适配器产出的条目渲染（审批放行的工具卡片、命令卡片、aborted turn）；组装重放 case（`tui-replay.snapshot.ts`）启动 `omd --profile tui --patch replay.cordis.yml`——禁用真实 DeepSeek 适配器，`dsh-llm-replay` 在 profile 默认 provider/model 下服务 fixture——管道输入一行，跑完整 agent loop，断言 trace 流（chunks、定稿消息、完成的 turn）。lib 模式下重放包经临时 profile 祖先链上的 `node_modules` symlink 解析（built loader 从 profile 目录解析 patch 内插件）。

## 为何这样设计

- 历史翻页是"滚动回看"与"单屏回声"的分界；pi-tui 的 `scrollBy` 已实现离开/恢复跟随，runner 只需路由按键。
- 样式 opt-in，确定性的快照表面（纯文本行）永不变；彩色转录是呈现选择。
- 重放 case 是唯一 keyless 证明组装应用的模型往返可用——流式 chunk 落进转录、turn 关闭、pipe 路径排空后退出。`--patch` overlay 复用出厂 profile 机制而非测试专用组合。

## 验证

- 单测 116/116（bundle + renderer，+7：翻页、usage、截断、EOF 排空）；tsc 0；oxlint 0。
- PTY smoke 在 src 与 built-lib 模式通过，含中途 resize。
- 重放与交互快照在 src 与 lib 模式通过；完整 snapshot 门禁 16/16 文件、119/119 测试。

## 后续

- M4 out-of-process 前端；主题/卡片打磨（markdown、diff 卡片）可建在 `TranscriptTheme` seam 上。
