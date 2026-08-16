# TUI backlog：LCS diff 排序、/editor 集成

## 背景

P2 note 的 backlog 项：正式 unified diff 排序（工具卡片查看器此前先倾倒新增再删除）与长草稿的 $EDITOR 集成。两项均已交付。

## 变更

`packages/interaction/tui-renderer/src/transcript-view.ts` — 行级最长公共子序列 diff：对 before/after 行做 O(n·m) DP，回溯交错输出上下文/删除/新增的 unified 顺序。空上下文/新增行跳过（噪音）；删除的空行仍渲染。

`packages/bundle/tui/src/index.ts` — `/editor` 挂起 presenter（`presenter.stop()`），把当前草稿写入临时文件，运行 `$VISUAL`/`$EDITOR`/`vi`（shell 启用以支持 `code -w` 风格、stdio 继承），读回结果到编辑器，恢复 presenter（`presenter.start()` 从 transcript 重绘）。成败经状态 notice 报告。`internals.runEditor` 可注入测试。

测试：LCS 顺序断言（ctx → del → add → ctx 序列）、/editor 挂起–替换–恢复周期（fake 终端）。171 通过。

## 验证

- vitest tui-renderer + bundle：171 测试通过（新增 2）。
- tsc 干净；eslint 干净。

## 备注

- LCS 表为 O(n·m) 内存；diff 是文件规模，有界。超大 diff 可后续换 Myers。
- /editor 用 stop/start 而非 pi-tui 的 preserveScreen（编辑器会话是完整终端交接而非 TUI 接管）；恢复时 transcript 重绘，无内容丢失。
