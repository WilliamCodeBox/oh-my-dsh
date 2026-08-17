# Agent Note: TUI P2 — 语法高亮、工具 diff 卡片、会话成本

Status: implemented

[English](2026-08-16-tui-p2-highlight-diff-cost.md) | 中文

## 背景

对抗式方案的 P2：theme token 扩充（syntax/diff 角色）、经 pi-tui Markdown `highlightCode` hook 接入语法高亮、工具卡片最小 diff 查看器、配置驱动的会话成本。鼠标/IME 保持 pi-tui 内置能力（验证项）。`#` 行范围补全与 $EDITOR 集成留待后续。

## 变更

`packages/interaction/tui-renderer/src/theme.ts` — `ColorToken` 增加 9 个 syntax 角色与 4 个 diff 角色；两套调色板映射（dark：keyword 177、string 114、function 117、comment 243、added 114、removed 167、hunk 179）。

`packages/interaction/tui-renderer/src/highlight.ts` — 新增：正则 tokenizer（按语言族 ts/js/py/sh/go/rs 的关键字、字符串、注释、数字、函数、类型、运算符、标点；JSON 键；纯文本兜底）喂给 Markdown `highlightCode` hook。流式时对最后一个代码块逐帧重高亮足够快；空行与纯文本原样通过。

`packages/interaction/tui-renderer/src/transcript-view.ts` — 工具卡片渲染 tool-fs `{ diffs }` meta 载荷中的内嵌 diff：行级增/删/上下文用 diff 角色，hunk 头带路径。renderer 自行解析 meta 形状（无 tool-fs 依赖）。

`packages/bundle/tui/src/index.ts` — `Config` 增加可选 `costPerInputToken`/`costPerOutputToken`；配置后状态行追加会话成本（`$0.001234` 风格，由 transcript usage 计算）。无价格时成本隐藏。

## 备选方案

- **现在就做带 LCS 排序的完整 diff 查看器** — 推迟：卡片先渲染行级 hunk（先新增后删除）；带上下文的 unified 排序由下一个 backlog 项落地。
- **硬编码 provider 每 token 价格** — 否决：会话成本由部署配置；adapter 未来可发布每 token 定价。

## 影响

- vitest tui-renderer + bundle：168 测试通过（新增 8）；两包 tsc 干净；eslint 干净。
- PTY 实测：meta 行照常渲染模型/目录/git；代码块渲染后原始字节流出现 syntax 角色（单测断言精确 token 颜色）。
- `@file#L10-L20` 行范围补全与 $EDITOR 集成仍在 P2 待办。
