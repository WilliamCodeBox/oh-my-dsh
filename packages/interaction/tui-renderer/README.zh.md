# @deepseek-ai/dsh-tui-renderer

[English](README.md) | 中文

`dsh --profile tui` 表面的折叠式终端转录模型与基于 pi-tui 的呈现层。转录模型将一个会话的持久 `session/event` 流投影为展示条目；presenter 在备用屏幕（alternate screen）上以滚动视口、状态行与输入编辑器渲染它们。交互适配器将在后续里程碑中建立在 presenter seam 之上。

## 转录模型

`Transcript` 按序列顺序折叠事件——resume 时先喂存储的 seed 事件，再喂实时事件——投影为展示条目：

- **user** 消息，携带其生产者 source 与折叠时打开的 turn；
- **assistant** 消息：文本从 chunk 流式累积，在装配消息到达时定稿（携带其 token usage 与装配消息本身）；
- **tool** 调用/结果卡片按 call id 合并，携带模型可见的结果文本、失败身份与工具私有展示 `meta`（如 `dsh-tool-fs` 的上下文 diff）；
- **turn** 括号：`turn/start` 打开，`turn/end` 以结束原因关闭。

渲染器在转录旁展示的旁路状态同样挂在折叠投影上：最新 todo 快照、request header、provider 路由上下文、`session/end-seed` 标记与观察到的压缩替换。

转录材料**仅限 append-origin surface 事件**。会话 surface 契约（`packages/core/session/src/surface.ts` 的 `isAppendSurfaceEvent`）将 append-origin 事件命名为"转录的持久材料"，替换副本仅保留在 model-visible 面——压缩替换落地会抹掉用户已看到的对话。因此替换仅以 `CompactionNote` 条目呈现，渲染器可据此提示上下文已被压缩，而不抹除用户已见内容。

## 公开模块

| 导出 | 职责 |
|---|---|
| `./transcript` | `Transcript` 折叠模型与 `textOf` 块文本提取器。 |
| `./presenter` | `TuiPresenter` — pi-tui 备用屏幕表面（滚动视口、状态行、编辑器）与 `processTerminal()` 生产后端。 |
| `./sanitize` | 面向不可信模型/工具文本的 `sanitizeText`/`needsSanitize` 展示净化器。 |
| `./format` | 折叠条目与状态行的 `formatItem`/`formatStatus` 展示格式化。 |
| `./invariant` | 包内不变量伴生插件（无运行时不变量；折叠是投影，事件校验由 session 层负责）。 |

## Model Experience

无——转录模型仅将持久 session 事件折叠为展示条目，自身不注册任何 prompt、工具 schema 或模型上下文。

#### KV Cache effect

无；模型不折叠任何请求前缀。

## 已知限制与延期工作

- **纯文本 presenter**——转录以净化后的纯文本行渲染，无 markdown 渲染、diff 卡片、颜色或主题；主题与卡片里程碑构建在 `TuiPresenter` seam 之上。
- **无交互适配器**——审批提示、问题选择器与斜杠命令属后续里程碑；presenter 已暴露它们挂载所需的编辑器与原始按键监听。
- **仅可见文本**——chunk 累积保留 `text-delta` 内容；reasoning delta 与工具调用内容块不单独累积（保留装配后的 `assistant/message`，供需要完整块结构的渲染器使用）。
- **无顺序校验**——折叠信任 session 层的序列顺序；乱序事件按收到顺序折叠。
