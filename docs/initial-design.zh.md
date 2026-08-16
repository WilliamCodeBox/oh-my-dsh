# oh-my-dsh 初始设计

[English](initial-design.md) | 中文

本文档把已归档的 Agent Notes（`.agents/notes/archived/`）提炼为 oh-my-dsh
（`omd`）的初始设计：产品是什么、塑造它的决策、以及后续路线图。它是设计历史
的唯一入口；归档 notes 仍是每个决策的权威记录。

## 产品

oh-my-dsh 是一个开箱即用的编码 agent TUI，fork 自 DeepSeek Harness。它是基于
Cordis 的插件宿主：launcher、TUI 与每项能力（shell、文件系统、子进程、沙箱、
技能、会话、委派、审批）都是独立版本化的插件，按 profile 组合。裸调用 `omd`
打开交互式 TUI。

## 架构原则

- **一切皆插件。** 新行为落在文档化的扩展点上；改动 agent-loop 必须同步更新
  `docs/architecture.md`。
- **能力缝（capability seam）。** 一项能力包含 Service Definition / Service
  Provider / Consumer 三个角色，完整而非单角色。
- **模型可见 ⟺ 已记录。** 任何到达模型请求的内容必须能从会话日志重建；新的
  模型可见输入需要会话事件。
- **失败要响亮。** 配置错误在加载时失败（自包含时），否则在最早可解析点失败；
  绝不静默跳过缺失引用。
- **包边界显式优于隐式。** 默认值是显式的 `resolve(request): Spec` 步骤，绝不
  是 `run()` 里隐藏的 `?? default`。
- **无硬编码可调参数。** 部署相关的选择是 cordis.yml 可改的、经校验的 `Config`
  字段。
- **运行时不变式断言自有关系。** 检查权威事件流或可变数据，而非服务存在或固定
  纯示例。

## 里程碑

### 已完成

- **M0** — TUI 表面重建：行式渲染器、raw-mode 键盘、终端恢复、sanitizer、
  PTY 测试、replay 冒烟。
- **M1** — 渲染器 presenter 与 transcript 模型：agent/session/user 消息渲染、
  流式更新。
- **M2** — 交互适配器：用户提问、审批流、命令。
- **M3** — 丝滑与 replay：键位打磨、优雅退出（130/SIGINT）、快照驱动的
  transcript replay。
- **改名** — CLI 可执行名改为 `omd`；scope 改为 `@williamcodebox`；仓库元数据
  修正（npm 发布弃用，改 GitHub Releases 分发）。

### 路线图（提案，待实施）

- **M4** — 容器化执行世界（可选加固；本地 Docker 优先）。
- **M5** — 最小权限矩阵（同世界先行；Landlock ABI v4 TCP）。
- **M6** — 声明式模板流水线 + git 工具（git 工具先行）。
- **M7** — 持久目标循环 + 预算。

## 关键决策

- **分发：bun 运行时 + pnpm deploy 闭包树文件夹。** 单文件 bundle 因证据被否决
  （ESM 快照解析与动态 require 失败）；bun 的 GLIBC 2.17 基线满足 CentOS 7+。
  以 tarball 经 GitHub Releases 分发，curl 安装脚本（`install.sh`，支持
  `GH_PROXY` 镜像）。
- **deploy 闭包自包含。** 指向源码仓库的 workspace symlink 替换为真实复制
  （`scripts/unlink-workspace.py`）；开发工具链不得混入 tarball（pnpm deploy
  过滤）。
- **沙箱：基于 Landlock 的本地沙箱**（`native/landlock-run` 为原生 launcher 源，
  Windows ACL 作为 win32 链一环）。
- **持久化：JSONL 会话日志 + 写透式发布。**
- **LSP：保留并接线。** TypeScript/JavaScript 经 typescript-language-server
  随 tarball 分发；原生 server（clangd、rust-analyzer、gopls）为宿主机配置。
- **外部子代理 providers：保留并扩展。** 现有 Codex / Claude Code / ACP /
  DSH SDK；pi、oh-my-pi、opencode 为未来一等 providers。
- **web 搜索：保留 deepseek 默认，支持常见 providers**（Tavily、Brave、
  Serper）作为可挂载备选。
- **Python SDK：已删除。** python/ 树（PyPI 产品线）连同其 CI/发布通道与
  demo/ACP/SDK 插件家族一并移除。

## 仓库整理（2026-08-16）

fork 清理为单一初始提交：上游历史（12k 提交、38 位作者）squash、dependabot
禁用、README 重写、插件树裁剪到发布产品闭包（删除云/demo/SDK 死家族，保留
测试支撑包）。
