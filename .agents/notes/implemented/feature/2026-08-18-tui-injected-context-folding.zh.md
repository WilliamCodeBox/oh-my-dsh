# Agent Note：TUI 注入上下文折叠（与 Web 对齐）

Status: implemented

[English](2026-08-18-tui-injected-context-folding.md) | 中文

## 问题

TUI 会话的第一次输入会把注入上下文整段铺满 transcript：`agent-instructions`
基线（完整 `AGENTS.md`，约 16 KB）和技能目录（约 50 条）被渲染为全宽
user 背景 Markdown 气泡，无预览上限、无折叠、无任何按键可收起
（`packages/interaction/tui-renderer/src/transcript-view.ts` 此前对每个
`user` 项都渲染全文）。Web 端把相同内容渲染为默认折叠的 disclosure 行
（`ContextInjectionRow.tsx`）。内容本身对模型是必要的——工作区规则与技能
发现，两者都已有上限（`maxBytes: 65536`、`catalogDescriptionMaxLength`）
且设计上明确不做摘要（见 workspace-context 与 skill-system 笔记）——因此
修复属于显示层，而不是注入层。

## 决策

- `packages/interaction/tui-renderer/src/transcript-view.ts` —
  `TranscriptView` 新增 `contextExpanded`（默认 `false`）。`source` 存在且
  `kind !== 'user'` 的 user 项默认渲染一行暗色 `▸ context · <label> ·
  ctrl+o expands`，展开后渲染完整卡片。label 对齐 Web 的 provenance 标签：
  `agent-instructions` 取加载的文件路径、`skill-catalog` 为 `skill catalog`、
  `skill-invocation` 为 `skill <name>`，其余取 source kind。flag 在每次渲染
  时读取，因此 item 缓存无需失效即可跟随切换。identity（无主题）渲染路径
  不变——快照夹具与 pipe 表面仍显示全文。
- `packages/interaction/tui-renderer/src/presenter.ts` — `TuiPresenter`
  持有 `TranscriptView` 引用，暴露 `toggleContextExpanded()`（翻转 flag 并
  请求重绘）与 `contextExpanded` getter。
- `packages/bundle/tui/src/index.ts` — `drivePresenter` 在键位注册表中注册
  `Ctrl+O`（`\x0f`）；`?` 帮助浮层自动列出该键位。
- `packages/bundle/tui/README.md` / `README.zh.md` — presenter 段落记录该
  折叠与按键。

## 备选方案

- **逐行选中 + Enter 展开** — 否决：主 transcript 没有行选中模型；全局
  切换是 Web 逐行点击在终端下的等价物，且旧版 TUI 设计中的 `Ctrl+O`
  三态折叠已是既有词汇。
- **字母键切换** — 否决：可打印键必须保留给输入框打字；`Ctrl+O` 不与
  任何现有键冲突，也不是 modal 键。
- **裁剪或摘要注入内容** — 否决：workspace-context 与 skill-system 笔记
  明确否决摘要化，包测试钉死完整内容，且内容面向模型；缩小它会改变模型
  行为。

## 影响

- 第一次输入每块注入内容只显示一行暗色摘要，不再整屏铺开。模型可见内容
  字节级不变（model-visible ⟺ logged 未动）；只有 TTY presenter 显示变化。
- `Ctrl+O` 出现在 `?` 帮助浮层；折叠行自身提示该键，发现不依赖帮助。
- pipe 与快照 identity 表面不变；恢复的会话同样折叠（fold 依据持久化的
  `source`）。
- 验证：`tsc -b tsconfig.host.json` 干净；所动三个 spec 文件 99 个测试
  通过（新增 6 个：默认折叠、展开切换、来源 label、直接提示不受影响、
  presenter 切换、Ctrl+O 不泄漏进输入框）；`tui-pty.snapshot` 断言基于
  标记，不受影响。
