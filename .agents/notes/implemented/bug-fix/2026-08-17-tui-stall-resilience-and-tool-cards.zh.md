# Agent Note: TUI 卡死韧性（stall resilience）与工具卡重设计

Status: implemented

[English](2026-08-17-tui-stall-resilience-and-tool-cards.md) | 中文

## Problem

一次 TUI 会话卡死暴露了两个缺口。父会话最后一次 LLM 请求停在"等待首个字节"阶段：会话日志止于 `step/start`，之后既无 chunk、无错误、也无 `turn/end`，用户强杀了终端。状态行没有任何信息能区分"提供方停滞"与"正常的长思考"——唯一的 transient 是转圈，唯一的时限是五分钟的流空闲看门狗，比任何用户愿意等待的时间都长。另外，工具卡片渲染成近黑背景框（`toolPendingBg` 236 / `toolSuccessBg` 235 / `toolErrorBg` 234 在深色终端背景下几乎不可见），无前景色、无边框，标题与参数挤在一行；相邻转录条目之间也没有任何垂直分隔。

## Decision

`packages/llm/llm-deepseek` — 新增 `requestTimeoutMs` 配置（默认 120,000 ms），单独限制 connect + 首个响应字节阶段。fetch 运行在块作用域 `deadline` 之下，响应头到达即释放定时器，因此缓慢的 body 仍使用更长的 `streamIdleTimeoutMs` 上限。提供方始终不返回响应头时以 `LlmError('TIMEOUT')` 报错；`TIMEOUT` 属于默认可重试集合，`dsh-llm-retry` 会把停滞转换为带退避的有界重试，而不是挂起。首字节等待期间的调用方 abort 仍映射为 `ABORTED`。

`packages/bundle/tui` — 运行中 transient 显示已耗时秒数（`⠋ running 42s · esc to interrupt`）；模型连续 60 秒未产生任何会话事件时，整体切换到主题 warning 色并点名静默时长（`no response 61s`）。格式化逻辑抽成纯导出函数 `runningTransient`（有单测），由 runner 内跟踪的 `runStartedAt`/`lastActivityAt` 驱动。

`packages/interaction/tui-renderer` — 工具卡围绕状态色前导条（`▌`，accent/success/error）重构，不再用整行背景：标题行（`tool <name>` 用 `toolTitle` 色 + dim 截断参数）、结果行（`✓ ok` / `✗ error <name>`）、diff 区均挂在 `│` 续行符下。移除不再使用的 `tool*Bg` 主题 token。主题与 identity 两条渲染路径都在条目之间插入一个空行。

`cordis` 组合 — 无需改动：`dsh-base` 已挂载 `token-meter`、`compaction-basic` 与 `compaction-tool-result-pruner`。卡死并非因它们缺失；800K token 的压力阈值（0.8 × deepseek 路由公布的 1M 窗口）只在病态会话才可达，而 TTFB 超时与重试现在无论如何都会约束住这类会话。

## Alternatives considered

- **事件循环阻塞假说** — 已排查并基本排除：渲染全缓存化、序列化线性、`deriveMessages` 代价 O(新节点)、最终方案 markdown 无病态输入。日志证据（`step/start` 后零事件、无超时错误、用户在看门狗到期前强杀）指向 TTFB 停滞。
- **高对比整卡背景**（深绿/深红/深蓝）— 否决，改用前导色条：任何终端背景下都可读、无眩光，且与卡片已有的 diff 颜色体系一致。
- **调低压缩阈值或缩小公布的 1M 上下文窗口** — 否决：deepseek-v4-flash 确实支持 1M 窗口，按 128K 压缩会在每个中等会话上浪费摘要 token。

## Consequences

- 提供方停滞现在可见（warning 色 + 点名静默）且有界（120s TTFB，随后至多两次带退避重试），不再是无限期静默挂起；Escape 仍可随时中止。
- 工具卡呈现为结构化、按状态着色的表面，转录条目之间有了呼吸感。
- 新增配置面：`llm-deepseek` 的 `requestTimeoutMs`（README/zh 已记录；与 `streamIdleTimeoutMs` 一样在 `resolveAdapterOptions` 中校验）。
- `tui-agent` 的 identity 转录快照已按空行分隔重新录制；PTY 快照只断言宽松条件，不受影响。
- 仓库 `doc-sync` 门因更早 TUI notes 的格式与配对欠债本就为红；本条按当前 `.agents/notes/README.md` 格式书写，并已记录配对。
