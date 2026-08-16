# Agent Note: TUI 键位表与优雅 130 退出（M1b）

Status: implemented
Archived: 2026-08-16

[English](2026-08-15-tui-keymap-graceful-130-quit.md) | 中文

## 问题

pipe（非 TTY）表面没有键盘协议：ESC 序列被逐字节丢弃，方向键/Home/End/PgUp/PgDn/Delete 无法编辑输入行；Ctrl+C 退出码为 0，不符合用户中断应报告的 SIGINT 惯例码。

## 改动

- `packages/bundle/tui/src/keymap.ts` — 新增流式 ESC 序列解码器。ESC 跨块缓冲，等下一字节决定裸 Escape 还是 CSI/SS3 序列；CSI 序列等到 final 字节才提交；映射方向键、Home/End（CSI 字母、`1~`/`4~`/`7~`/`8~`）、PgUp/PgDn（`5~`/`6~`）、Delete（`3~`）、SS3 应用光标键、修饰参数归并到基础键；未知但良构的序列静默消费（延续 M0 契约：ESC 字节永不进入输入行）；EOF 时遗留 ESC 冲刷为 Escape。
- `packages/bundle/tui/src/index.ts` — `TuiKey` 增加 delete/escape/left/right/up/down/home/end/page-up/page-down；`StdinInputSource` 经 keymap 解码；`driveInput` 变为带光标的行编辑缓冲（Escape 清行、上/下历史环，最新在前、草稿恢复）。Ctrl+C 退出改 **130**（pipe 与 presenter 双路径）——优雅路径（presenter 停止、flush、终端恢复），绝非 crash-restore 硬退出；EOF 退出保持 0。
- `packages/bundle/tui/src/terminal.ts` — Ctrl+C 状态机文档改为陈述已落地策略。
- `packages/bundle/tui/README.md`/`README.zh.md` — pipe 表面与 gap 条目更新；配对哈希重记录。
- 测试：+11（键位序列族、跨块缓冲、EOF flush、光标编辑、历史回召）；过时的 ESC 丢弃与 quit-0 断言随行为一并修改。PTY smoke 期望退出码改为 130。

## 为何这样设计

- pi-tui 的 Editor 在 presenter 路径已消费方向键/PgUp/PgDn（自带光标与翻页键绑定），keymap 只解码没有编辑器的地方——pipe line-tracer 表面。
- 130 是 shell 对被 SIGINT 杀死的进程报告的码；TUI 退出是同一用户中断的优雅送达，退出码符合惯例而关闭路径保持干净。
- 历史是有界环：上键最新在前回召，下键回到回召前的草稿；提交则入环并复位。

## 验证

- `packages/bundle/tui` 测试 52/52（原 41）；`tsc -b` 0 错误；oxlint 0。
- PTY smoke 在 src 模式与 `DSH_EXAMPLE_MODE=lib` 下通过，断言 130 退出与终端恢复；完整 snapshot 门禁 14/14 文件、117/117 测试（此前偶发的 ACP goal 用例本次也通过）。

## 后续

- M2 交互适配器挂在 presenter seam 上；斜杠命令将在 pipe 路径复用键位词汇表处理 `/` 前缀行。
