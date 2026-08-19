# Agent Note：TUI 表面一致性批次（欢迎页、todo、多行、子代理、错误行）

Status: implemented

[English](2026-08-18-tui-surface-parity-batch.md) | 中文

## 问题

一次 TUI-vs-Web 表面审计（scout，代码确认）按用户影响排序出六项真实的
功能一致性差距。第一项——注入上下文渲染为无法区分、无上限的全文字气泡——
已单独修复（见注入上下文折叠笔记）。其余五项：欢迎/空态与工作区切换；子代理
活动在主表面不可见；完整 todo 列表被压缩为状态行计数；单行输入；以及 turn
错误 / 超限 / 推理细节被压平到 turn 括号或 `/ledger` 标签页。

## 决策

五项全部落地在 TUI 表面，纯显示层（模型可见内容字节级不变；
model-visible ⟺ logged 未动）：

- **欢迎 / 空态** — `TranscriptView` 新增可选 `empty()` 渲染器，折叠
  transcript 无条目时显示；`TuiPresenter` 接入欢迎块（模型优先取折叠的
  request header，工作区、preset、提示行），欢迎激活时抑制 meta 行，
  避免模型名重复渲染。
- **Todo 列表** — `TuiPresenter.openTodos()` 渲染状态字形（✓/◐/○）
  叠加层，可滚动，每次渲染前重读，`todo/write` 实时更新；`/todos` 打开。
- **工作区切换** — `/workspace <path>` 切换 runner 的工作区覆盖
  （meta 行显示、`@`-文件补全根、git 监视），并如实说明边界：fs 工具根
  仍是会话创建时固定的 header cwd，提示与 bundle README 均写明。
- **多行输入** — pi-tui 内建 `tui.input.newLine` 绑定（`shift+enter` /
  `ctrl+j`）原生插入换行；runner 不拦截这些键，Enter 仍提交整份草稿，
  编辑器布局可增长（minSize 3）。pipe 键位图不变：裸 `\x0a` 仍提交，
  保证 `echo task | omd` 可用。
- **子代理活动** — runner 在被驱动 agent 的 scoped ctx 上订阅父级作用域的
  `subagent/start` / `subagent/end` cordis 事件，转发为
  `Transcript.subagentLifecycle` 边；fold 追加 `subagent` 条目（运行中），
  settle 时原地合并状态（done / failed + 停止原因）。边不是会话事件，
  恢复会话时不从存储重放。
- **错误 / 推理行** — `AssistantItem` 捕获 `reasoning` 内容块；主题渲染器
  在回复上方以暗色显示，上限 10 行并附续行说明。Turn 括号按结果着色：
  `error` 用错误色并附结构化错误消息行，`max-tokens` 用警告色。

## 备选方案

- **逐行选中展开** — 否决（见折叠笔记）：主 transcript 没有行选中模型；
  全局交互更符合终端。
- **自研多行编辑器组件** — 否决：pi-tui 的 Editor 已通过
  `tui.input.newLine` 插入并渲染换行；手写编辑器会重复既有代码
  （依赖优先于手搓）。
- **`/workspace` 改写会话 header cwd** — 否决：header 是持久的创建时
  记录，fs 工具逐请求解析；会话中改写不是受支持的操作。runner 级覆盖
  加明确边界提示是诚实的范围。
- **子代理行由会话事件驱动** — 否决：子代理会话按设计不折入主表面；
  作用域生命周期事件是受认可的观察通道，且携带运行身份。

## 影响

- TUI 主 transcript 现在能一眼区分注入上下文、子代理活动、推理与失败
  turn；`/todos`、`/workspace`、多行草稿无需 Web 侧行为变更即可用。
- 子代理生命周期行是运行局部的：恢复会话不重放过去的子代理活动
  （边从不持久化），与 append-origin transcript 策略一致。
- `/workspace` 有意不移动 fs 工具根；提示与 README 写明该边界，
  而非默默声称已切换。
- 验证（独立验证 agent，三轮）：`tsc -b tsconfig.host.json` 干净；
  tui-renderer + bundle/tui 单元套件 265 个测试通过（含欢迎 meta 行
  抑制回归）；无密钥 `tui profile` PTY 快照门通过；`git diff --name-only`
  范围仅 tui-renderer、bundle/tui 与 pnpm-lock.yaml。
