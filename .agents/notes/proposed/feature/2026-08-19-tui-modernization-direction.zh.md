# Agent Note: TUI 现代化方向——差距调研与借鉴清单

Status: proposed

[English](2026-08-19-tui-modernization-direction.md) | 中文

## 问题

一次 TUI 差距调研(2026-08-19,主 agent 编排:三个只读 scout 分别侦察本地
oh-my-dsh、oh-my-pi 的 pi-tui 与 opencode 的 TUI 源码,外加针对 Claude Code
与 Codex CLI 的 web 调研)发现:oh-my-dsh TUI 的渲染层——折叠事件流卡片、
语义 dark/light 主题、统一顺序 diff 的工具卡片、带明细 tab 的 O(1) 轨迹
ledger——是四个项目中最有深度的。真正的差距在功能面(多视图、滚动回看、
通知、可配置性)与发现性(帮助/命令面板),以及一大片已 vendored 进
`tui-renderer` 的 pi-tui 能力没有被接上。

## 提案

以下述按成本分级的借鉴清单作为后续方向。已交付的项(多行输入、`/todos`
叠加层、欢迎/空态、`/workspace`、`/editor`、subagent 行、reasoning/错误行、
LCS diff 顺序、ledger 明细面板、注入上下文折叠、状态行模式显示)已剔除,
不再重复规划。

### A 级——低成本,pi-tui 已有能力(1–3 天)

| # | 项 | 来源 | 现状差距 |
|---|---|---|---|
| A1 | 桌面通知(任务完成时 OSC 99 / D-Bus) | pi-tui `desktop-notify.ts` | 无;长任务没有完成信号 |
| A2 | which-key 帮助面板(快捷键分组、滚动、dock/overlay) | opencode `which-key.tsx` | `keybindings.ts` 的 help 是静态列表 |
| A3 | SGR 鼠标(滚轮滚动、点击/ hover 命中区) | pi-tui `mouse.ts` | 纯键盘;长消息只能翻页键 |
| A4 | ESC 可取消 Loader(返回 AbortSignal) | pi-tui `cancellable-loader.ts` | spinner 不可取消;只能 Ctrl+C 取消整条链 |
| A5 | Markdown 增强:OSC8 链接、mermaid→ASCII、内嵌图 | pi-tui `markdown.ts` | 未全部接入 transcript 渲染器 |
| A6 | 原生滚动回看(长输出不再行数封顶) | pi-tui scrollback 提交 | detail 体行数封顶;只能翻页 |
| A7 | 会话成本显示(tokens + cost) | Claude Code `/cost` | 状态行只有 tokens,无 cost |

### B 级——新开发,借鉴 opencode / Claude Code(约 1 周)

| # | 项 | 来源 | 现状差距 |
|---|---|---|---|
| B1 | 多会话 TabBar | pi-tui `tab-bar.ts`、opencode 多会话 | `/sessions` 循环切换;无并排标签 |
| B2 | 独立 `/diff` 查看器(文件树、split/unified、hunk 跳转、per-turn diff) | opencode `diff-viewer.tsx`、Claude Code `/diff` | 工具卡片有 diff;无跨 turn diff 视图 |
| B3 | permission 决策记忆(edit diff 预览 + always/reject 分级) | opencode `permission.tsx` | 有审批模态;无预览、不记住决策 |
| B4 | 主题可定制(JSON token 覆盖 + 预设库、daltonized 变体) | Claude Code 主题 JSON、opencode 35 主题 | 只有 dark/light,不可覆盖 |
| B5 | 命令面板(可搜索的 `/` 命令发现) | opencode keymap、Codex Cmd+Shift+P | 命令靠记忆;无发现面板 |
| B6 | home 会话选择(欢迎块已有;补会话列表) | opencode `home.tsx`、Codex resume | 欢迎块已有;无会话列表可选 |
| B7 | 会话 fork/export | opencode fork/export、Codex resume/archive | 只有 `--resume`;无 fork/导出 |

### C 级——架构级,需先定产品定位

| # | 项 | 来源 | 说明 |
|---|---|---|---|
| C1 | 状态行可编程(自定义 widget / shell 命令、Powerline 风格) | Claude Code `/statusline` | 状态行是硬编码字段;可配置是产品级特性 |
| C2 | 内嵌终端视图(运行命令→看实时输出,而非只收工具卡片) | Codex Cmd+J、pi-tui `ProcessTerminal` | shell 从结果展示变为过程可见;联动 e2b/shell 包 |
| C3 | checkpoint / rewind(Esc 多层:回退到任意 turn) | Claude Code | 需要会话快照机制,动 session 包,风险较高 |
| C4 | 特性插件化槽(todo/diff/帮助都变注册式扩展) | opencode pluginRuntime | 架构重构;收益在长期扩展性 |

## 备选方案

- **全面重写为声明式框架(opencode 式,Solid.js)** — 否决:已 vendored 的
  pi-tui 差分渲染加语义主题已覆盖渲染基线;重写是以成熟的终端工程换框架
  新鲜感。
- **直接跳到 C 级** — 否决:没有产品定位判断(oh-my-dsh TUI 是发布级 agent
  表面还是内部 harness?)之前,架构投资是投机;A 级以近零成本带来日常可见
  收益。
- **原样照搬 Claude Code 的 statusline / rewind** — 推迟到 C1/C3:两者都
  需要配置格式与会话格式决策,属 C 级范围。

## 验收标准

- A 级:七项全部落地并带单元测试;每项对应一个可观察表面(通知触发、帮助
  面板分组可滚动、滚轮滚动、ESC 取消长工具调用、OSC8 链接可激活、长输出
  流入 scrollback、状态行出现 cost)。
- B 级:每项独立成笔记后交付;B1/B2/B4 优先。
- C 级:每项实施前先开自己的 proposed 笔记;C3 明确需要会话格式影响评估。
- 每个已交付层级保持 model-visible ⟺ logged 不变(纯显示层改动,与
  surface-parity 批次一致)。

## 风险

- **pi-tui 版本漂移** — oh-my-pi 锁定 17.3.1;接入更多表面(鼠标、通知、
  scrollback)加深对其行为的耦合。缓解:能力探测 + 优雅回退(pi-tui 两者
  都有)。
- **鼠标误触** — 点击/hover 需保守或默认关闭;第一步只做滚轮滚动最安全。
- **通知噪音** — 需要配置开关;默认关或仅完成时。
- **B 级触及会话语义**(B1 多会话、B7 fork)— 复用现有 session 模型;不得
  另造并行会话存储。
- **发现面板范围蔓延** — which-key(A2)与命令面板(B5)必须是现有注册表
  上的只读表面,而非新命令系统。
