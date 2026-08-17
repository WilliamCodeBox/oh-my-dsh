# Agent Note: TUI P1 — 状态栏、分页与工作区补全

Status: implemented

[English](2026-08-16-tui-p1-status-bar-completion.md) | 中文

## 背景

P0 已交付语义主题与组件渲染。P1（已批准方案：状态栏、滚动/overlay、多行输入、快捷语法）收敛为自包含项：状态行上下文窗口进度条、视口分页、编辑器补全（`@` 文件引用 + 斜杠命令）。pi-tui 0.84.2 已内置差分渲染，无闪烁项无需工作。

## 变更

`packages/interaction/tui-renderer/src/format.ts` — `contextBar(ratio, width)` 渲染 `████░░░░░░ 45%` 进度条字符（纯字符；阈值着色在 presenter）。

`packages/interaction/tui-renderer/src/presenter.ts` — 状态行组合：左侧 runner 文本（dim）+ 上下文进度条（<70% dim、70-90% warning、>90% error）+ muted 的 provider/model，按视口截断。`pageTranscript(dir)` 按终端高度减 chrome 行数分页；`scrollTranscript` 保留给行级增量。`workspaceAutocomplete(commands, basePath)` 构建编辑器补全 provider。

`packages/interaction/tui-renderer/src/autocomplete.ts` — 新增：`WorkspaceAutocomplete` 实现斜杠命令补全（对命令列表 fuzzyFilter）与 `@` 文件补全（readdir 递归，深度 2，跳过隐藏项，目录补全带尾斜杠）。pi-tui 的 CombinedAutocompleteProvider 把 `@` 补全委托给外部 `fd` 二进制——开箱即用安装不能依赖它——本 provider 是无 fd 的同表面替代。

`packages/bundle/tui/src/index.ts` — PgUp/PgDn 改为分页而非固定 10 行；presenter 收到由 `commands.list(agent)` 在工作区目录上构建的补全 provider。

## 备选方案

- **pi-tui 的 CombinedAutocompleteProvider + 外部 `fd` 二进制** — 否决：开箱即用安装不能依赖系统二进制；readdir 实现保持分发零额外依赖。
- **PgUp/PgDn 固定 10 行滚动** — 否决，改用按终端高度视口分页，更符合分页键的用户预期。

## 影响

- vitest tui-renderer + bundle：140 测试通过（新增 10）；两包 tsc 干净；改动文件 eslint 干净。
- 源码 TUI 的 PTY 实测：`@p` 弹出 30 项文件建议列表（相对显示路径），Tab 应用首个建议（`@THIRD_PARTY_NOTICES.md`），列表显示 `(1/30)` 滚动指示。
- P1 的多行输入与鼠标支持留待后续；pi-tui 的 Editor 已支持多行文本（反斜杠前缀换行），方案的鼠标项暂缓。
