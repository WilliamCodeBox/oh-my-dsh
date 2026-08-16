# Agent Note: oh-my-dsh 的 AgentOS 化路线图（M4-M7），修订版

Status: proposed
Archived: 2026-08-16

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
credentials seam），但 AgentOS 效果尚未组装：沙箱是单一共享环境而非每任务环境，
权限模型只有文件效应维度（无网络/进程/凭据维度），workflow 引擎没有声明式模板
与检查点，goal 循环仅限会话内，也没有结构化的 git/GitHub/PR 能力。

本笔记记录组装这些效果的路线图。它是提案：不随附任何代码。初版经对抗式审查，
审查记录见文末。

**术语** — 本文 "task" 指具有明确生命周期的流水线工作单元：由流水线驱动者
创建、在 todo 列表中跟踪、由 agent（或 subagent）执行、验收标准通过即完成。
它与 session/agent/subagent/job/goal-round 刻意区分；凡有现成概念可对应之处
均指名。

## 现状（证据）

- `packages/e2b/` — E2B POC：单一共享沙箱，由单一生命周期所有者持有；
  `ctx.fs` + `ctx.subprocess` 指向其中；并非每任务一个。
- `packages/sandbox/` — 进程沙箱 seam：对与宿主共享内核的子进程做文件效应
  围栏；`SandboxMode` 词汇只有 read-only / workspace-write / danger-full-access。
  seam 契约明确：容器/microVM 不是该 seam 的后端——它们以环境一致组的形式
  替换整个能力 seam 的服务提供者。
- `native/landlock-run/` — 原生 launcher，实现 Landlock 文件规则（MAX_ABI=5）；
  ABI v4 新增 TCP 端口规则（`LANDLOCK_RULE_NET_PORT`）——仓库内无需容器即可
  表达网络出网限制的路径。
- `packages/workflow/` — workflow seam + worker-thread 引擎 +
  tool-workflow/tool-ralph；脚本由模型现场编写；无检查点、无持久化、无恢复；
  仅前台运行、run 归 holder 所有。
- `packages/goal/` + `packages/todo/` — goal 事件源化于会话日志（resume 保留
  目标/阶段/轮次但永不自动 arming）；todo 是每会话整表清单工具。
- `packages/preset/` — 按会话组合 agent；subagent 子代经 composeFrom 加入父代
  的 standing 组合，不能换一套。
- `packages/session/` — 持久会话日志（jsonl，默认 zstd 帧编码）、checkpoint
  policy：恢复的底座。
- `packages/credentials/` — 凭据 seam，已被 LLM 适配器消费（llm-deepseek、
  llm-pi-ai、web-search），按操作解析；空白是把凭据注入子进程/容器。
- `packages/token-meter/` — 每会话 token 折叠（已存在；尚未用于循环预算）。
- `packages/hooks/` — Claude Code/Codex hook 桥；并非 GitHub 集成。

## 路线图

### M4 — 容器化执行世界（可选加固）

目标：任务运行在与其它任务不共享文件系统与进程的隔离环境中；任务结束时环境
销毁（含异常与超时兜底），下个任务干净重建。

改动：本地容器**执行世界组合**（owner + fs/subprocess 适配器，E2B 三包模式）
——**不是 sandbox seam 的后端**（seam 契约禁止；容器以环境一致组替换整个
能力 seam）。Docker 是**可选加固 provider**；sandbox-local 的 bwrap→Landlock
阶梯保持默认，并在无 Docker 的主机上作为退化路径。范围：模板镜像（Node +
git）、工作区挂载、create/exec/destroy 生命周期、残留对账。

验证：串行任务相互隔离（运行间文件系统/进程不可见）；异常退出容器销毁、
`docker ps` 无残留。并行每任务容器池（池上限、标签、工作区同步/冲突策略）
明确排除在范围外，列为后续项。

需设计进去的风险：docker.sock ≈ root（模型可经 `docker run -v /:/host` 逃逸
——daemon 边界、rootless/socket 代理）；镜像供应链；CI Docker-in-Docker；
无 Docker 主机回退到 sandbox-local 阶梯。

工作量：中大（已缩减：无并行池、无同步）。

### M5 — 最小权限矩阵（同世界先行，容器化后行）

目标：agent 只能拿到显式授予的文件路径、网络白名单、可见进程、注入凭据——
默认拒绝。拆为同世界矩阵（不依赖容器）与容器化矩阵（建立在 M4 之上）。

改动：
- **同世界矩阵**：文件（SandboxMode 已覆盖）；网络——扩展原生 launcher 实现
  `LANDLOCK_RULE_NET_PORT`（ABI v4 TCP 规则），并在现有 probe/partial 报告
  模式下给出 denial 方言；进程——经现有 bwrap profile 做 pid 可见性；凭据——
  注入受限子进程 env（credentials seam 的第一个子进程向消费方）。
- **容器化矩阵**：每容器网络策略、PID namespace、secret 挂载（以 M4 为底座）。
- 与现有会话模型的兼容：每个维度有独立的 knob 事件 + fold（如 sandbox/mode）；
  escalation（拒绝后"严格更宽"策略重试）按维度定义；默认值来自配置
  （cordis.yml 清单），运行时覆盖来自会话事件。
- 凭据注入安全面：secret 经一次性 env/secret 文件挂载（绝不放 docker-inspect
  可见的 env）；轮换行为（按操作解析；运行中进程看不到旋转后的值——记录在案）；
  明文 `.credentials.yaml` 静止存储风险评估。

验证：白名单外的访问被拒绝（网络/文件/进程）；凭据只出现在被授权的环境中。

工作量：中。

### M6 — 声明式模板流水线 + git 工具（需求 → PR）

目标：一个功能通过声明式模板（YAML）推进——理解需求、分解任务、实现、测试、
评审、开 PR——带检查点（可恢复）与人工确认门。**git 工具移入本里程碑**（流水线
自己的验收路径需要它们）：结构化 git 工具（branch/commit/push）与 PR 集成，
均消费 credentials seam。

改动，分两片：
- **M6a — 模板格式 + 阶段执行器**：YAML 定义阶段（目标、工具集、完成标准、
  确认门）；阶段执行器直接驱动 subagents/工具（不依赖模型写 JS）；阶段角色
  复用同一 standing preset、工具集差异只做提示级纪律——或设计每阶段新 agent
  （开放决策：subagent seam 强制子代继承父 preset，今天无法表达按阶段工具集；
  跨阶段 todo 归属必须钉死——todo 今天是每会话单主）。
- **M6b — 检查点/恢复 + PR 集成**：阶段检查点持久化到会话日志（新事件族 +
  fold + invariant；只有声明式阶段边界可检查点——任意模型写的脚本中间状态
  不可恢复）；跨重启恢复；PR 创建/更新/请求评审工具，消费凭据（一次性 env +
  清理或 helper、scope 限定 token）。

验证：一个需求 md 驱动流水线到达 PR（或在确认门停下）；杀进程重启后从最后
检查点恢复。

工作量：大（两片）。

### M7 — 带预算与验证门的持久目标循环

目标：循环持续运行直到定义好的每项任务被勾选且 PR 创建/更新——带硬预算与
独立验证。

改动（goal 域已事件源化于会话日志；真正的增量是）：
- 重启后自动 arming（激活今天从不持久化；保留人工授权边界——arming 策略，
  不是静默自动恢复）；
- headless 常驻（headless 今天是"仅一次性任务"——增加不退出模式）；复用
  schedule/round-driver 的 idle 机制而非新造驱动；
- retry 策略作为显式决策记录（goal-round-driver 今天无自动重试——翻转它是
  刻意决策，带边界）；
- 预算：token 预算（复用 token-meter）+ 时长/费用硬上限（带默认值）；
- 完成标准：每项任务必须产出可验证证据（测试/构建结果）才能勾选；test 阶段
  是独立验证门，不是模型自证。

验证：一个需求 md 在预算内落地为自动创建的 PR；任务未完成时进程持续循环，
重启后仅在 arming 策略下恢复。

工作量：大。

## 实施顺序（审查后修订）

原 M4→M5 硬依赖是错的：矩阵的大多数维度可在同世界后端表达。修订顺序：

1. **git/GitHub 工具 + M6a**（模板流水线）——最先通向用户价值（需求 → PR），
   建立在现有 workflow/approval/preset/session seam 之上。
2. **M6b**（检查点/恢复 + PR 集成）。
3. **M5 同世界矩阵**（Landlock TCP、pid 可见性、子进程凭据注入）。
4. **M4 容器化执行世界**（可选加固；sandbox-local 保持默认）+ **M5 容器化矩阵**。
5. **M7**（arming 策略、headless 常驻、预算、验证门）。

里程碑编号保留原义（M4 容器、M5 权限、M6 流水线、M7 循环）；本节陈述实际
构建顺序。

## 决策

- 容器化执行世界是可选的加固 provider；sandbox-local 阶梯保持默认与退化路径。
- 网络限制先在 Landlock ABI v4 上实现（扩展原生 launcher），不用容器网络策略。
- git/GitHub 工具移入 M6（流水线的验收路径需要它们）。
- 凭据注入子进程/容器是 credentials seam 的第一个子进程向消费方（LLM 适配器
  早已消费）。
- M7 的 retry/arming 策略是显式决策记录，不是对 no-auto-retry 设计的静默翻转。
- 无人值守循环必须有预算（token/时长/费用）与独立验证门。
- 控制平面 UI（Kanban 看板、triggers、automations）不在 M4-M7 范围；现有
  TUI/CLI 就是控制平面。

## 审查记录

对抗式审查（2026-08-16，两位 reviewer）发现并被本修订采纳：
- M4 作为 sandbox seam 后端与 seam 契约矛盾——重定义为执行世界组合、可选加固、
  并行池排除在范围外。
- "credentials seam 无消费方"是事实错误（LLM 适配器已消费）——修正；注入空白
  是子进程/容器向。
- M6 的验收依赖 M7 的 git 工具——git/PR 工具移入 M6。
- M6 阶段→preset 映射在 subagent 继承规则下不可表达——记为开放设计决策，
  钉死 todo 归属。
- M6 检查点只在声明式阶段边界（模型写的脚本状态不可检查点）。
- M7 的 goal 持久化大部分已实现——增量重定义；retry/arming 需要显式决策记录。
- 无人值守循环需要 token/时长/费用预算与独立完成门——已加入。
- Docker 的 daemon 边界、镜像供应链、无 Docker 主机退化此前未覆盖——列为需
  设计进去的风险。
- "task"此前未定义——已在开头定义。
