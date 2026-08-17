# Agent Note: TUI 对抗式审查修复（背靠背）

Status: implemented

[English](2026-08-16-tui-adversarial-review-fixes.md) | 中文

## 背景

三个独立 reviewer 对全量 TUI 面做背靠背对抗式审查（正确性/生命周期、健壮性/安全、性能/UX）。发现交叉比对：多 agent 独立发现的（lcsDiff 上限、git 轮询、/editor 错误路径）视为最高置信。全部 P1 已修；P2 记入 note。

## 变更

十三项修复：

1. lcsDiff O(n·m) 无上限 → 行数上限（每侧 1500）+ 超大 diff 线性 add/remove 退化（两个 reviewer 独立确认）。
2. git 轮询任何瞬时失败即永久停止 → readGitStatus 区分非仓库（停止）与瞬时 status 失败（抛出）；watcher 退避重试并保留上次快照（三个 reviewer）。
3. /editor 异步 IIFE 写失败时 raw 模式搁浅 → try/catch + finally 每条路径恢复 presenter（两个 reviewer）。
4. 模态 overlay 并发挂载堆叠（/sessions 期间审批到达）→ mountOverlay 排队，关闭时推进并恢复焦点（正确性 reviewer）。
5. 工具卡片指纹漏 result.meta → 空文本 diff 永不渲染；指纹改为 open/settled + error + meta 存在性，不再拼接 MB 级 result 文本（正确性 + 性能）。
6. keybinding handler 抛错穿透到 uncaughtException（硬退出、丢失 flush）→ dispatch 包含 handler（正确性）。
7. presenter 路径空 Enter 提交空 user 消息 → dispatchLine 守卫（正确性）。
8. lineRangeSuggestions 同步读任意路径（FIFO/GB 文件冻结主线程）→ statSync 大小上限（1MB）+ 普通文件检查（健壮性）。
9. 文件系统可控字符串的 ANSI 注入 → meta-row cwd、补全 label/description、overlay 标题统一 sanitizeText（健壮性）。
10. persistentBg 的 fill 自带尾部 reset 抵消自身修复 → fill 去掉尾部 reset，重施加的背景存活（健壮性）。
11. '?' 被无条件消费（输入框无法输入问号）→ 无模态时放行（性能/UX）。
12. 流式 setText 每 chunk 全量 re-lex（O(n²)）→ setText 节流至 ~80ms（性能/UX）。
13. spinner 无定时驱动（帧静止）+ 首轮左空时消失 → transient 独立渲染，运行中 ~100ms interval 驱动重绘（性能/UX）。

另：/model 要求 provider/model 分隔符（fail loud）；overlay 标题净化；工具指纹不再哈希完整 result 文本。

## 备选方案

- **只修最高置信（多 reviewer）发现** — 否决：每个 P1 发现都可复现且修复便宜；推迟任一项都会在交付表面留下已知缺陷。
- **推倒重做而非定点修复** — 否决：背靠背审查发现的是缺陷而非结构问题；定点修复保留了已审查的架构。

## 影响

- vitest tui-renderer + bundle：178 测试通过（新增 7）；两包 tsc 干净；eslint 干净。
- 对抗流程捕获了单轮审查遗漏的真实缺陷（无界 LCS、raw 模式搁浅、ANSI 注入、O(n²) 流式）；交叉比对提供了置信度排序。
- P2 发现推迟：symlink 目录处理、更深指纹陈旧、大仓库 git porcelain 成本、context 条语义（会话累计 usage vs 单请求 window——clamp 条为文档化行为）、$EDITOR shell 引号。
