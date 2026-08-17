# Agent Note: TUI P1 修正版 — 模型切换、瞬态状态行、键位注册表、会话切换

Status: implemented

[English](2026-08-16-tui-p1-revised-session-model-keys.md) | 中文

## 背景

对抗式方案审查（opencode 源码 + 业界实践）指出路线图五个 P1 缺口：会话管理、帮助/which-key、/model 切换、运行状态可见性、键位注册表。本 note 记录其实现。OSC 133/7 prompt 标记推迟：在 alt-screen 内会与 pi-tui 自身渲染交错，且 pi-tui 的语义跳转绑定需先有框架支持。

## 变更

`packages/interaction/tui-renderer/src/keybindings.ts` — 新增：`KeybindingRegistry`（last-wins 分发、opt-out handler、每个绑定的显示名、帮助列表）。

`packages/interaction/tui-renderer/src/presenter.ts` — `showHelp(entries)` 渲染只读 overlay（esc/enter 关闭）；`setHaltHandler`/`halt` 让命令以任意负载结束 drive 循环；状态行新增瞬态右段（spinner/retry/esc 提示），截断永不裁掉它（先缩左侧段）。

`packages/bundle/tui/src/index.ts` —
- /model <provider>/<model> 更新可变 `ModelSelectionRef`（组装监听器每请求读 ref.current）；裸 /model 显示当前选择；列入斜杠补全。
- 瞬态状态回调：turn 运行时显示 spinner + 'esc to interrupt'。
- drivePresenter 经注册表注册 PgUp/PgDn（含 Shift 变体）、?、Ctrl+C；? 用同一注册表打开帮助 overlay。
- /sessions 经 ctx.sessionPersistence.list() 列出持久化会话，通过问题弹窗选择；drive 以 resume id 终止，外层循环重建 agent（apply 内 runOnce + switch 循环）。
- 无 persistence 服务时 fail-soft：'sessions unavailable' 提示。

## 备选方案

- **现在就加 OSC 133/7 prompt 标记** — 否决：在 alt-screen 内会与 pi-tui 自身渲染交错，语义跳转绑定需先有框架支持。
- **斜杠命令在 dispatchLine 内联执行** — 否决，改用命令运行时：运行时提供已落定的命令卡片与会话切换所需的 drive halt seam（`setHaltHandler`）。

## 影响

- vitest tui-renderer + bundle：157 测试通过（审查后新增 9）；两包 tsc 干净；eslint 干净。
- 源码 TUI 的 PTY 实测：? 打开键位帮助 overlay；/model 报告当前选择；/sessions 打开 16 项会话选择器（id/createdAt/cwd + 滚动指示）。
- 键位注册表是 which-key/命令面板的基础：绑定即数据，帮助与分发器同源。会话切换在进程内重建 agent（presenter stop → resume → 全新 presenter）；管道路径保持单次运行语义。
