# Agent Note: TUI 语义主题与组件渲染

Status: implemented

[English](2026-08-16-tui-semantic-theme-rendering.md) | 中文

## 背景

`omd --profile tui` 表面此前为行式 tracer：4 种 ANSI 前景色、无 Markdown、无宽度感知，identity 默认主题保证快照 fixture 保持纯文本。用户认为不够美观。三个并行研究 agent 分别分析了当前渲染器、pi/oh-my-pi 参考 TUI、以及业界 coding-agent TUI（Claude Code、Codex CLI、opencode、Gemini CLI）。用户确认的 P0 方案：语义色 token 主题（dark/light，终端报告时派生）；消息背景分层；Markdown 渲染；工具调用状态卡片；宽度感知的 CJK 安全渲染。快照策略：identity 默认路径保留给 fixture，主题路径做结构化行为断言。

## 变更

`packages/interaction/tui-renderer/src/theme.ts` — 新增：`SemanticTheme`（256 色 SGR 的 fg/bg 包装）、`darkTheme`/`lightTheme`、`themeForScheme`。调色板用低饱和状态背景（dark 下 toolPendingBg 236 / toolSuccessBg 235 / toolErrorBg 52）。

`packages/interaction/tui-renderer/src/scheme.ts` — 新增：`detectTerminalScheme` 在 raw mode 接管 stdin 前查询 `\x1b[?997n` 并解析 dark/light 报告；300 ms 超时回退 dark。bundle 启动器在构造 presenter 前 await。

`packages/interaction/tui-renderer/src/transcript-view.ts` — 双渲染路径。无主题：identity 行（fixture 不变）。有主题：用户消息渲染在整行背景 Box（`Box` + `bg userBg`），助手消息走 pi-tui `Markdown` 组件（流式经 `setText` 更新而不重建），工具调用为状态色卡片（pending/success/error 背景），turn 括号 dim，斜杠命令用 command 色。Markdown 解析前先 sanitize。

`packages/interaction/tui-renderer/src/presenter.ts` — 接受可选 `SemanticTheme`（默认 dark），接入 `theme.editor` 与 SelectList 主题，状态行 dim。

`packages/bundle/tui/src/index.ts` — 查询终端 scheme 并传 `themeForScheme(...)` 给 presenter。

## 备选方案

- **所有表面共用一套硬编码颜色** — 否决，改用语义 token：dark/light 调色板（终端报告时派生）让渲染器与主题解耦且 CJK 安全。
- **主题渲染作为唯一路径** — 否决：identity 默认路径保留给快照 fixture 与 pipe 表面，保持其字节稳定；主题路径做结构化行为断言。

## 影响

- `vitest` tui-renderer + bundle：130 测试通过（新增 14）；两包 `tsc` 干净；改动文件 eslint 干净。
- 源码 TUI 的 PTY 实测：真实 turn 渲染；原始字节流含 `\x1b[48;5;237m`（用户背景）、其他 256 色 fg/bg、编辑器 accent 边框。`?997` scheme 查询到达终端（pyte 缺该报告处理，终端有应答）。
- Markdown/卡片渲染只在主题路径。已批准方案中的 P1（状态栏进度条、斜杠命令、鼠标）与 P2（语法高亮、IME、OSC 133）留待后续。避免 `theme!` 非空断言：identity 提前返回后的窄化直接可用，保持该形态。
