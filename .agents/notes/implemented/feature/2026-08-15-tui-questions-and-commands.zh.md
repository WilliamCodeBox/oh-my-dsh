# TUI 用户问题与斜杠命令（M2b）

## 问题

剩余交互 seam 静默失效：`ask_user_question` 因无 provider 抛 `NO_PROVIDER`；`/` 前缀行被当普通文本提交给模型，而不是走命令运行时。

## 改动

- `packages/interaction/tui-renderer/src/presenter.ts` — 模态机制从审批推广到问题：`askQuestions` 逐题渲染 overlay——选项问题用 SelectList，多选问题循环重显剩余选项直到 Escape，无选项问题用自由文本 `Input` 模态；Escape 表示该题不答。`promptSelect`/`promptText` 共享 `mountOverlay` 槽；`approvalPending` 更名 `interactionPending`，runner 的 Ctrl+C 监听对所有模态让位（SelectList/Input 的 cancel 绑定含 Escape 与 Ctrl+C）。
- `packages/interaction/tui-renderer/src/transcript.ts` — 新增 `command` 条目：`command/run` 开卡片，配对的 `command/done`（按 `commandId` 从尾部匹配）合并 `success`/`error` 结果。命令是 turn 外 log-only 追加，卡片不开关 turn 括号。`format.ts` 渲染 `command /name args` + `  -> <text>`（error 带前缀）。
- `packages/bundle/tui/src/index.ts` — `dispatchLine` 分流提交行：可解析的斜杠命令走 `ctx.commands.execute`（绝不进模型）；未知命令在 presenter 状态行或 pipe 的 `[command] unknown:` 行报告；handler 失败被包含（其 `command/done` error 卡片已渲染）。presenter 运行时注册唯一的 user-questions provider；pipe 路径不注册，保持文档化的 `NO_PROVIDER` 失败。runner 的 inject 增加 `userQuestions` 与 `commands`（base 均已挂载）。`traceLine` 增加命令事件摘要。
- 依赖：renderer 与 bundle 加 `@deepseek-ai/dsh-commands` 与 `@deepseek-ai/dsh-user-questions`（peer+dev）；renderer tsconfig 加两个 project reference；`command/run`/`command/done` 事件形状随 CommandRuntime merge 生效。

## 为何这样设计

- 问题模态逐字复用审批模态：单一交互槽、单一取消约定、单一 Ctrl+C 协调规则。
- 斜杠命令是人的 UI 手势：绝不可到达模型。命令运行时自己的生命周期事件就是转录的持久记录——renderer 像其他事件一样折叠，卡片在 resume 重放时无需 bundle 侧状态即可存活。
- pipe 路径保持 fail-closed 姿态：无 presenter 即无问题 provider；未知命令以 trace 行浮现而非消失。

## 验证

- +9 测试（bundle：已知/未知命令分流、问题模态应答、pipe NO_PROVIDER；renderer：命令折叠配对、单选/多选/文本问题流程）。单测 109/109，tsc 0，oxlint 0；PTY smoke 在 src 与 built-lib 模式通过；完整 snapshot 门禁 14/14。

## 后续

- M3b 快照 fixtures 覆盖交互旅程（approval + question + command 转录），经组装应用重放。
