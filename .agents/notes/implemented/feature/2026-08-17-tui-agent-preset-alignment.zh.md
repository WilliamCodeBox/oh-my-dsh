# Agent Note: TUI agent-preset alignment with the Web surface

Status: implemented

[English](2026-08-17-tui-agent-preset-alignment.md) | 中文

## Problem

Web 表面（web-app bundle）已将全部模型面向工具移入 agent preset：patch 在宿主平面禁用 23 个 base 行，会话按 agent 挂载一个 preset，resume 时用 `resolveSessionPreset` 按日志重建组合。TUI 保留了 base 全局工具层——base patch 注释称 "the base keeps them for the TUI, which is single-session and composes its agent process-wide"——因此 TUI agent 看到完整工具集且 preset 平面为空：无 roster、无 per-session 能力面、无用户自建 preset、组合不可从日志重建。同时使用两个表面的用户无法预测会话呈现哪些工具。

## Decision

`tui` bundle 现在镜像 Web 表面的 agent 平面：

- `packages/bundle/tui/cordis.patch.yml` — 复制 web-app patch 的 23 行 disable 集（tool-bash、tool-pwsh、tool-jobs、tool-fs、tool-fs-search、tool-str-replace-editor、skill-filesystem、tool-skill、tool-goal、plan-mode、compaction-basic、command-compact、tool-result-pruner、tool-subagent-control、tool-subagent-list-agents、tool-subagent、tool-subagent-fork、workflow-worker-thread、tool-workflow、tool-ralph、agent-instructions、tool-todo、tool-web），并插入 `@williamcodebox/omd-agent-presets` 行，`default: standard`。`profile-boot` 随后把随附的 `config/agent-presets` roots（standard/code/minimal/cordis）以 system trust 注入，另有 `$DSH_HOME/.agent-presets` 用户 root。`tool-lsp` 行保持全局——base 为每个 profile 挂载它，且 TUI bundle 自带 `typescript-language-server`，因此 `lsp` 是每个 TUI 会话可见的唯一全局工具（Web bundle 无 lsp 依赖，这些行从不激活）。

- `packages/bundle/tui/src/index.ts` — `composeAgent` 镜像 api-proxy：无 roster 部署（无 `agent-presets` 行）保留 base 全局层；否则新会话一次性解析部署默认并挂载（id 记录到 header），resume 会话在 factory setup 内从日志解析 `resolveSessionPreset`（无记录的老会话回落默认，与 Web cold-read 一致），新增 `/preset` 斜杠命令列出 roster、重检会话为空、`recompose` 并在 swap 提交后才 append `agent-preset/selected`。meta 行显示已组合的 preset id。

- `packages/interaction/tui-renderer/src/meta-row.ts` — `MetaRowData` 增加可选 `preset` 字段，渲染在左段。

## Alternatives considered

- **保留 TUI 全局层、旁边加 roster** — 否决：工具注册表的 `view()` 将全局层与 scope chain 层合并（最近同名条目胜出），preset 会话会看到全局超集加 preset，破坏 `minimal` 的双工具面与 `standard` 的精确目录。Web 的空全局层靠 disable 集实现，不存在屏蔽机制。
- **把 disable 集抽到 `dsh-base`** — 否决：headless 刻意无 roster，运行在全局层；disable 集属于使用 preset 的表面。
- **不做 `/preset` 命令、只加启动参数** — 否决：空白会话切换与 Web 选择器一致并保持日志诚实；启动参数只能选首个组合。

## Consequences

- `standard` 的 TUI 会话呈现 Web 精确目录加 `lsp`；`minimal` 呈现 `bash`、`str_replace_editor` 加 `lsp`。`lsp` 是文档化的唯一例外——TUI bundle 自带语言服务器而 Web bundle 从不激活它。
- 本次改动前创建的 TUI 会话没有 `agent-preset/selected` 事件；resume 时回落部署默认，与 Web cold-read 行为完全一致。这是文档化的，不是静默的。
- 默认 TUI 会话不再有 `str_replace_editor`（`standard` preset 不挂它，只有 `minimal` 挂）——接受为 Web 精确目录的代价。
- 验证：`verify-cordis-config` 通过（50 个配置）；tui bundle 单测 57 + renderer 187 通过；新增 `apps/cli/tests/tui-agent-presets.e2e.ts` 断言空全局层加 lsp、四个 system preset 且 `standard` 默认、`standard`/`minimal` 精确目录；`tui-pty.snapshot` 与 `built-bin.e2e`（18 项）在真实组合上通过。
