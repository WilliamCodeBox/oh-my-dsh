# Agent Note: TUI 界面重新引入（M0 骨架）

Status: implemented

[English](2026-08-14-tui-surface-reintroduction-m0.md) | 中文

## 问题

[remove-tui-package](../../implemented/simplification/2026-08-04-remove-tui-package.md) 删除终端前端后，dsh 只剩 Web 一个交互式人类界面。该记录留下的重入条件——具名的产品/部署、显式的包边界、具体的交互 provider、装配级生命周期与转录验收——一直未被回应。本记录记下 `dsh --profile tui` 的分阶段重新引入，以及每条条件如何被满足或被命名为某个里程碑的出口标准。

## 决定

`@deepseek-ai/dsh-tui` 以可安装的 profile bundle 回归，位于 `packages/bundle/tui`（补丁层 + `tui-startup` 命令行 provider + `tui-runner` glue 插件），以 `dsh --profile tui` 启动。M0 界面是骑在 `dsh-base` 上的逐行事件追踪——不挂 Host、HTTP、Web runtime 或浏览器行。

重入条件，逐条：

1. **具名的产品/部署——已满足。** `dsh --profile tui` 是产品入口；包 README 与本记录定义该部署及其 M0 契约。
2. **显式的包边界——已满足。** glue bundle 位于 `packages/bundle/tui`。表现层不进 bundle；渲染里程碑再决定其包归属（`ui/` 组已被 [regrouping RFC](../../../docs/AGENTS.md) 解散，本次变更不复活它）。
3. **具体的交互 provider——已命名、延后。** approval / user-questions / commands 适配器是交互里程碑的交付物。在那之前审批落入 fail-closed 的 `unavailable` 结局、提问落入 `NO_PROVIDER`；任何情况都不静默降级。
4. **装配级生命周期与转录验收——已命名、延后。** 测试里程碑补齐人类可见界面策略要求的 runnable-example 无钥快照与 PTY case；M0 的包测试覆盖 runner 的各个 seam。

M0 runner 通过 `ctx.agents` 创建或恢复一个 Agent，追踪过滤到本会话的 durable `session/event` 事实（subagent 会话永不进入转录），空闲时以 follow-up turn 提交用户输入、运行中以 steering 打断，并全权掌管终端生命周期：

- **输入**：Enter 提交当前行；退格编辑；Ctrl+C 走 raw-mode 键状态机（清输入 → 以 `keepInbox: true` 取消回合 → 退出 → 强制退出），绝不走 launcher 的信号链——raw mode 把 Ctrl+C 变成字节 `0x03`。
- **终端恢复**：启动时进入 raw mode，退出、未捕获异常、以及崩溃恢复处理器的第一动作都会同步恢复终端，失败的运行不会把用户的 shell 留在 raw 状态。
- **消毒器**：每条追踪行在到达终端前都过 `sanitizeText`，提示注入的 C0/C1 控制序列渲染为可见十六进制转义而不是执行。
- **命令行**：`--resume <session-id>`（走 `ctx.agents.resume`）、`--workspace <path>`、`--model <provider/model>`（拆成 agent options）、`--permission <preset>`（走 `ctx.permissionPresets.set`），由普通 `tui-startup` provider 经 `dsh-cmdline` 解析。

## 备选方案

### 为什么不直接重新引入旧的全屏 TUI？

被删包的渲染器、适配器与快照都是为已移除的产品入口构建的，需要的返工与里程碑做的一样多。按删除记录自己的建议，从当前 host 与交互需求重新开始，可以让 bundle 保持薄、表现层决策保持开放。

### 为什么不先做进程外前端？

SDK JSON-RPC 通道的 server→client 请求是 dead capability，因此审批、提问、命令今天都没有 wire 往返。仓库里正在服役的进程外交互通道是 ApiProxy 四象限契约；复用它的第二前端是更晚的里程碑，不是 M0 的骨干。

### 为什么不复活 `ui/` 组放表现层？

regrouping RFC 解散了 `ui/`（tui 并入 `interaction/` 方向、app-boot 并入 `boot/`、scaffold 取代 `sdk/`）。纯渲染器的新组归属是渲染里程碑结合 spike 证据做的开放决策；M0 没有表现层可放。

## 后果

- `dsh --profile tui` 重新可用：经 `dsh plugin --profile tui add <spec>` 安装、打印自己的 `--help`、启动 base 树，并在每条退出路径（退出、EOF、崩溃）恢复终端。
- 在交互里程碑之前，审批与提问工具保持 fail-closed——这是显式记录在案的缺口，不是静默降级。
- Ctrl+C 语义是骨架；"取消后优雅 130 退出"的精化策略与完整 keymap 随交互里程碑落地。
- launcher 的 SIGINT/SIGTERM 链只是 cooked 窗口与外部信号的安全网；raw mode 独占用户的 Ctrl+C。
- 渲染里程碑用两层渲染器替换追踪器并把表现层移出 bundle；在那之前界面是逐行的、无 scrollback。
