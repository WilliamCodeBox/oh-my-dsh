# Agent Note: TUI PTY 冒烟与转录快照（M3a）

Status: implemented
Archived: 2026-08-16

[English](2026-08-15-tui-pty-smoke-transcript-snapshot.md) | 中文

## 问题

`omd --profile tui` 的完整旅程——启动、渲染、输入、退出、终端恢复——缺少组装级验收。`process.stdin` 输入从未送达 presenter，Ctrl+C 时进程静默以 1 退出；两者都是真实 bug 而非测试基建缺口，只有真实 PTY 才能暴露。

## 改动

- `packages/bundle/tui/src/index.ts` — 修复两个 bug：
  - `apply()` 无条件创建 `StdinInputSource`，它给 `process.stdin` 挂了 `data` 监听器。pi-tui 的 `ProcessTerminal.start()` 会调用 `setEncoding('utf8')`，回调收到的是字符串，`TextDecoder.decode(string)` 在监听器内抛 `TypeError`，崩溃了 EventEmitter 分发，crash-restore 硬退出抢先于任何错误输出。现在输入源只在非 TTY 路径创建（`internals.createInput()`）；TTY 模式下 stdin 归 presenter 独占。
  - `apply()` 的 catch 先 `crash()`（同步硬退出）再写错误信息，错误被静默丢弃；现在先写后 crash。
- `packages/boot/app-boot/src/profile.ts` — 注册 `tui` profile 模板（`base` + `tui`），全新 `DSH_HOME` 自动初始化该 profile；PTY 冒烟与真实用户无需预装即可启动。
- `apps/cli/tests/tui-pty.snapshot.ts` — snapshot 门禁内的 keyless PTY case：POSIX python 驱动把 `omd --profile tui` fork 进 pty，等 editor 边框 marker，输入，提交 keyless 后续回合，等待，发 Ctrl+C，断言退出码 0、输入已渲染、备用屏已恢复（`ESC[?1049l`）。`describe.skipIf(win32)`；src 与 built-lib 两种模式都跑。
- `examples/tui-agent/` — 新示例持有转录快照：录制的 `session.jsonl`（turn 括号、流式 chunk、tool call/result 配对、compaction replace、aborted turn）经 `Transcript`/`TranscriptView` 折叠后与 `terminal.expected.txt` 比对。compaction 断言钉死"replace surface op 不得抹掉人类已见内容"的决策。依赖声明进 `examples/package.json`。

## 为何这样设计

- PTY case 放 snapshot 门禁而非 e2e 白名单：snapshot 门禁在 CI 强制 keyless replay，且不需要 built-lib 白名单条目。
- 驱动按 marker 门控、以 `delayMs` 兜底：src 模式（~12s tsx/typert 预热）与 built lib（~2s）的启动耗时差异巨大，纯墙钟睡眠会 flake；editor 边框就是渲染就绪信号。
- fixture 是提交的会话日志而非现场录制：确定、可审阅、与模型输出无关。snapshot 门禁的 `refresh` 模式可重写预期文件。

## 验证

- `pnpm vitest run --config vitest.snapshot.config.ts apps/cli/tests/tui-pty.snapshot.ts examples/tui-agent/tests/tui-transcript.snapshot.ts` 在 src 模式与 `DSH_EXAMPLE_MODE=lib`（CI snapshot 门禁模式，先 `pnpm run build:lib`）下均通过。
- `pnpm run typecheck` 干净；oxlint 干净；`packages/bundle/tui` + `packages/interaction/tui-renderer` 单测 84/84。
- 修复前探针精确复现故障（输入不送达、退出 1、stderr 空）；修复后探针显示输入渲染、回合提交、Ctrl+C 退出 0 且终端恢复。

## 后续

- M3b 交互适配器（键绑定、提示符、补全）与 M4 打磨沿用同一 PTY case；驱动的 `waitFor`/`delayMs` action 列表随之一并增长。
- Windows PTY 支持不在范围（skipIf win32）；TUI 表面正式支持 Windows 时再议。
