# TUI 输入元信息行：模型、思考、目录、git、context

## 背景

用户要求 oh-my-pi 的输入区设计：输入框上方一行显示当前 LLM 模型、思考等级、工作目录、git 状态、context window。两个研究 agent 分析了参考实现（pi footer / oh-my-pi powerline 分段 / opencode prompt meta 行）与 7 个业界产品（Claude Code、Codex CLI、opencode、Gemini CLI、crush、goose、Cursor）。用户确认：五要素全量、2s git 轮询。

## 变更

`packages/interaction/tui-renderer/src/meta-row.ts` — 新增：`MetaRow` 组件 + `renderMetaRow()` 组合三段——左（模型/思考）、中（目录/git）、右（context 条 + 窗口标签）。context 阈值着色（50/70/90 → dim/muted/warning/error，oh-my-pi 的更细网格）。截断先裁左侧段，context 条永不消失；空数据显示为空行。

`packages/interaction/tui-renderer/src/presenter.ts` — VStack 在状态行与编辑器之间加 meta 行；`setMetaData(read)` 接入 runner 数据源；`requestRender()` 由 started 标志保护（setMetaData 可能在 start 前调用）。

`packages/bundle/tui/src/git.ts` — 新增：`readGitStatus()`（分支 + porcelain 已暂存/未暂存/未跟踪计数）与 `watchGitStatus()` 每 2s 轮询，非仓库时停止。

`packages/bundle/tui/src/index.ts` — meta 数据源读取 selection ref（模型/思考）、显示 cwd（~ 折叠）、轮询的 git 状态、transcript context 用量。`/thinking <level>` 更新 `selectionRef.current.reasoningEffort`（显示为 `⟳ level`）。状态行移除模型与 context 条（移到 meta 行）；`formatStatus` 只保留运行事实。/model、/thinking、/sessions 加入斜杠补全。

测试：`meta-row.spec.ts`（组合、阈值、截断、空数据、窗口标签）、formatStatus 去模型、status-bar/keybindings 更新。160 通过。

## 验证

- vitest tui-renderer + bundle：160 测试通过（审查轮后新增 10）。
- 两包 tsc 干净；eslint 干净。
- 源码 TUI 的 PTY 实测：meta 行显示 `deepseek-official/deepseek-v4-flash  ~/work/oh-my-dsh  ⎇ main +1 *8 ?4`（真实 git 工作树计数）；`/thinking medium` 添加 `⟳ medium`；context 条在 turn 最终化 usage 后出现。

## 备注

- context 条需要最终化 usage（transcript 总量在 assistant/message 时累加）；流式 input-token 显示留待后续。
- 思考等级边框色（pi 的双通道）推迟：meta 行已用文字显示等级，边框色需要依赖 adapter 特定 effort id 的逐级调色板。
