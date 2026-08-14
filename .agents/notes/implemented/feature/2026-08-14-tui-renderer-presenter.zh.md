# Agent Note：TUI 渲染器 presenter（M1a presenter slice）

Status: implemented

## Problem

转录折叠模型（[2026-08-14-tui-renderer-transcript-model](2026-08-14-tui-renderer-transcript-model.md)）是渲染器的数据地基，但 TTY 表面仍是 M0 逐行 tracer。双层渲染器——备用屏幕上的滚动转录、状态行与输入编辑器——需要把 pi-tui presenter 接入 runner，并将 raw mode 与输入所有权从 bundle 迁出。

## Decision

`packages/interaction/tui-renderer` 新增呈现层：

- **`TranscriptView`/`StatusRow`** —— 将折叠条目与动态状态行经展示净化器渲染为 pi-tui `Component`。
- **`TuiPresenter`** —— `TuiAltScreen` + `setLayoutRoot` `VStack`：`ScrollView`（follow-end、primary）包转录、状态行、pi-tui `Editor`。`start()`/`stop()` 独占 raw mode 与备用屏幕；`onSubmit` 转发编辑器行；`onKey` 让 runner 消费原始按键（Ctrl+C）；`setInput`/`getInput` 服务 Ctrl+C 的清空/空输入判断。`processTerminal()` 是生产后端；测试中 bundle 注入内存版 `Terminal`。
- **`format`/`sanitize`** —— 条目转行格式化与展示净化器，自 bundle 迁出（净化器属呈现关注点；bundle 旧副本已删）。

bundle 的 `tui-runner` 将每个属主会话事件折叠进 `Transcript`，并按 `process.stdin.isTTY` 分支：

- **TTY** —— presenter 独占表面；resume 先折叠 `agent.session.events`（构造函数 seed 不会经 `session/event` 重发）；崩溃处理器停止 presenter。
- **非 TTY** —— M0 逐行 tracer 保留为 pipe 表面；`TerminalSession` 被删除，因为两条路径都不再使用它（TTY 的 raw mode 归 presenter；pipe 本就不进入 raw mode）。

## Alternatives considered

### 为何不把逐行 tracer 留作 TTY 表面？

渲染器里程碑的契约：呈现层迁出 bundle，tracer 在人类表面上被替换。保留它会保住 M0 测试，但交付不了渲染器。

### 为何 bundle 按 `isTTY` 分支而非 fail loud？

严格 TTY 契约是 M1b 里程碑的决策（"拒绝启动或显式降级"）。pipe 路径在之前保留 M0 行为（脚本化 stdin）；M1b 再移除或加固。

### 为何删除 `TerminalSession`？

presenter 在 TTY 独占 raw mode、pipe 从不进入 raw mode 后，`TerminalSession.enter()` 在两条路径都是死代码。崩溃处理器改为停止 presenter，一并恢复 raw mode 与备用屏幕。

## Consequences

- TTY 上 `dsh --profile tui` 呈现双层表面：可滚动转录（user/assistant/tool/turn 条目）、状态行（模型路由、todo 计数、压缩计数）与输入编辑器。Enter 提交 follow-up 或 steering；Ctrl+C 经 presenter 原始按键监听运行同一三态机（清空 → 取消 → 退出 → 强退）。
- bundle 的 M0 pipe 测试重定基到非 TTY 路径；新增 presenter 测试经内存版 `Terminal` 驱动 runner（编辑器提交、Ctrl+C 取消/强退、resume seed 折叠、崩溃恢复）。bundle 与 renderer 两包共 84 个测试通过；typecheck、lint、构建、workspace 约束与 Model Experience 文档门禁全部通过。
- `@earendil-works/pi-tui@0.84.2`（ESM，Node ≥ 22.19，依赖：marked + get-east-asian-width）成为 renderer 包的运行依赖；旧 dsh patch（编辑器提示前缀）未上游化，暂不重打。
- 里程碑弧线剩余：keymap 精化（ESC 序列、Shift+Enter、Ctrl+C 优雅 130 退出）、交互适配器（审批/提问/命令）、主题与 diff 卡片、PTY 验收 harness（M3a）。
