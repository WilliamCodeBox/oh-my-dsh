# Agent Note: oh-my-dsh 的 AgentOS 化路线图（M4-M7）

Status: proposed

[English](2026-08-16-agentos-roadmap-m4-m7.md) | 中文

## Problem

Danny Postma 的 "AgentOS"（构建于 Claude Agent SDK 之上；2026-08-14 演讲
_How I Built My Own AgentOS on Claude's Agent SDK_）是个人自建的 agent 控制平面，
不是开源产品：每个 agent 会话运行在全新的临时容器中，只被授予完成任务所需的
最小权限（默认拒绝，文件/网络/密钥/进程显式白名单），声明式模板流水线把一个
功能从需求文档推进到评审通过的 PR，目标循环持续运行直到定义好的每项任务都被
勾选完成。公开可用的架构细节来自社区重建（Ian Nuttall 的 blueprint gist），
并非作者源码。

oh-my-dsh 已具备大部分执行 seam（fs/shell/subprocess/sandbox/E2B、会话持久化、
goal/todo、subagent 委派、workflow 引擎、按会话 preset 组合、审批/权限、hooks、
尚无消费方的 credentials seam），但 AgentOS 效果尚未组装：沙箱是单一共享环境
而非每任务容器，权限模型只有文件效应维度（无网络/进程/凭据维度），workflow
引擎没有声明式模板与检查点，goal 循环仅限会话内，也没有结构化的 git/GitHub/PR
能力。

本笔记记录组装这些效果的路线图（里程碑 M4-M7）。它是提案：不随附任何代码。

## 现状（证据）

- `packages/e2b/` — E2B POC：单一共享沙箱，由单一生命周期所有者持有；
  `ctx.fs` + `ctx.subprocess` 指向其中；并非每任务一个。
- `packages/sandbox/` — 进程沙箱 seam：对与宿主共享内核的子进程做文件效应
  围栏；`SandboxMode` 词汇只有 read-only / workspace-write / danger-full-access。
- `packages/workflow/` — workflow seam + worker-thread 引擎 +
  tool-workflow/tool-ralph；脚本由模型现场编写；无检查点、无持久化、无恢复。
- `packages/goal/` + `packages/todo/` — 会话内 goal，带轮次预算；todo 是纯列表工具。
- `packages/preset/` — 按会话从 cordis.yml preset 组合 agent。
- `packages/session/` — 持久会话日志（jsonl/sqlite）、checkpoint policy：恢复的底座。
- `packages/credentials/` — 凭据 seam + local provider；无消费方。
- `packages/hooks/` — Claude Code/Codex hook 桥；并非 GitHub 集成。

## 路线图

### M4 — 每任务隔离执行环境

目标：每个任务运行在独立的临时容器中；环境互相不可见；任务结束时容器销毁
（含异常与超时兜底），下个任务干净重建。

改动：新增本地容器 provider（Docker）实现 sandbox seam——从模板镜像
create / exec / destroy 生命周期；基础镜像含 Node + git 工具链；工作区挂载；
把 `ctx.fs`/`ctx.shell`/`ctx.subprocess` 指向容器内（E2B 式适配器替换，
provider 换成 Docker）。

验证：两个任务并行运行，文件系统与进程互不可见；异常退出容器也销毁；
`docker ps` 无残留。

工作量：中大。

### M5 — 最小权限模型（默认拒绝）

目标：agent 只能拿到显式授予的文件路径、网络白名单、可见进程、注入凭据——
四维权限矩阵，默认拒绝。

改动：把 sandbox seam 扩展为矩阵（文件/网络/进程/凭据）；容器网络策略限制
出网；PID namespace 隔离；通过现有 `credentials` seam 注入凭据（其第一个
消费方，例如 GitHub token 只注入被授权的容器）；cordis.yml 声明权限清单。

验证：白名单外的访问被拒绝（网络/文件/进程）；凭据只出现在被授权的容器内。

工作量：中。

### M6 — 声明式模板流水线（需求 → PR）

目标：一个功能通过声明式模板（YAML）推进——理解需求、分解任务、实现、测试、
评审、开 PR——带检查点（可恢复）与人工确认门。

改动：流水线模板格式（阶段：目标、工具集、完成标准、确认门）；workflow 引擎
增加阶段检查点持久化（写入会话日志）与跨重启恢复；阶段→agent 角色映射走
preset 机制（plan/implement/review agent）；需求文档作为输入分解为 todo 列表；
人工门走现有 approval seam。

验证：一个需求 md 驱动流水线到达 PR（或在确认门停下）；杀进程重启后从最后
检查点恢复。

工作量：大。

### M7 — 持久目标循环 + 自动 PR

目标：目标循环跨重启持续运行，直到定义好的每项任务都被勾选完成，然后自动
创建/更新 PR。

改动：goal 状态持久化到会话日志并恢复循环；headless/后台模式 idle 驱动继续，
带重试与轮次上限；结构化 git 工具（branch/commit/push）替代裸 shell git；
GitHub 集成消费 credentials seam（PR 创建/更新/请求评审）。

验证：一个需求 md 落地为自动创建的 PR；任务未完成时进程持续循环，重启后恢复。

工作量：大。

## 依赖与顺序

- M4 → M5（M5 建立在容器之上）；M6 → M7（M7 建立在流水线 + git/GitHub 工具之上）。
- M6 不依赖 M4/M5——两组可并行推进。
- 编号延续已全部交付的 TUI 里程碑 M0-M3。

## 决策

- M4 用本地容器 provider（Docker）——不用云沙箱（E2B 仍作为 seam 后的备选
  provider）。
- 权限矩阵默认拒绝；每个维度显式授予。
- 凭据注入是现有 credentials seam 的第一个消费方。
- 控制平面 UI（Kanban 看板、triggers、automations）不在 M4-M7 范围；现有
  TUI/CLI 就是控制平面。
