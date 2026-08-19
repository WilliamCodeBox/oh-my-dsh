# Agent Note: 底部锚定的 TUI 对话框与 ledger 修复

Status: implemented

English | [中文](2026-08-19-tui-dialog-bottom-anchored-and-ledger-fixes.zh.md)

## 问题

用户在 TUI 中输入 `ledger` 后暴露了三个缺陷：

1. **交互对话框在屏幕中央渲染，且无背景色。** `TuiPresenter` 挂载所有
   模态（`ask_user_question` 选项、审批、文本输入、帮助卡片、ledger
   详情面板）都通过无选项的 `showOverlay`，pi-tui 把组件锚定在终端中央；
   卡片是裸 `Box(1, 1)` 且无 `bgFn` —— 对话框文字直接叠在底层 transcript
   文字上，无法阅读。
2. **`ask_user_question` 选项没有编写指导。** 模型用实现词汇生成选项
   标签与描述（`packages/bundle/tui/src/ledger.ts`、`tui-renderer ledger
   view`），用户无从选择；工具描述从未约束选项编写方式。
3. **ledger 折叠会丢弃配对的 `tool/code-dispatch-start` 未折叠时的
   `tool/code-dispatch` 结算事件**，静默丢失 subtool 结果 —— 与
   `mergeToolLedgerCell` 的防御性创建不对称。

## 决策

- `packages/interaction/tui-renderer/src/overlay-box.ts`（新建）——
  从 oh-my-pi overlay 移植的 box-drawing 边框：`topBorder`（accent
  标题嵌框）、`divider`、`bottomBorder`、`row`，以及 `DialogBox` 组件：
  包裹子组件、把子行渲染为带边框内容行、追加可选 footer 提示、给每一行
  刷 `modalBg` 背景，使面板成为一整块不透明区域。
- `packages/interaction/tui-renderer/src/theme.ts` —— `BgToken` 在
  `userBg` 旁新增 `modalBg`（深色 235，浅色 255）。
- `packages/interaction/tui-renderer/src/presenter.ts` ——
  `mountOverlay` 改为 `showOverlay(component, { anchor:
  'bottom-center', margin: 1, maxHeight: '70%' })`；四个对话框构建
  （经 `promptSelect` 的 `askApproval`、`promptSelect`、`promptText`、
  `showHelp`）与 `showDetail` 全部改用 `DialogBox` 而非裸 `Box`。所有
  交互模态现在从底部升起、上限为终端 70%、带边框、footer 提示与不透明
  背景。
- `packages/interaction/tool-ask-user/src/index.ts` ——
  `ask_user_question` 描述现在要求选项使用纯用户语言（禁止仓库路径、
  模块名、实现词汇），并按用户想要的结果切分选项（查看/修改/解释，而非
  按代码归属）。`label` schema 描述重申纯语言约束。
- `packages/interaction/tui-renderer/src/transcript.ts` ——
  `tool/code-dispatch` 折叠在配对 start 未折叠时防御性创建 subtool
  cell，与 `mergeToolLedgerCell` 对称。
- `packages/interaction/tui-renderer/src/detail.ts` —— `detailBody`
  参数收窄为 `RenderedDetailTab = Exclude<DetailTab, 'options' |
  'usage'>`（`detailTabsFor` 从不产出的 Web-only tab）；删除不可达的
  `options`/`usage` case，调用方一处断言并附注释。

## 备选方案

- **对话框后加全屏暗色遮罩** —— 否决：pi-tui 0.84.2 overlay 无遮罩
  选项；自建需要终端尺寸感知与额外组件。不透明卡片背景已足够分离对话框
  与 transcript。
- **把对话框挂进布局（oh-my-pi 的 editor-container 机制）** —— 否决：
  pi-tui 0.84.2 已支持 `anchor: 'bottom-center'` 及 `margin`/
  `maxHeight`，视觉结果（底部面板、稳定尺寸）用一个 `showOverlay`
  选项即可达成，无需重排 presenter 布局。
- **从共享 `DetailTab` union 删除 `options`/`usage`** —— 否决：Web
  trajectory 表格用这些 id 构建自己的 tab 列表；union 是共享契约。
  终端侧改为收窄。
- **保留 `detailBody` 死 case** —— 否决：它们不可达，收窄使其成为
  类型层面的事实。

## 影响

- 所有交互模态（ask、审批、提示、帮助、详情）现在渲染为底部锚定的带边框
  面板与不透明背景；ledger 详情面板共用同一套边框。Esc/Enter/tab 行为
  不变 —— 只有呈现位置改变。
- `ask_user_question` 工具描述对模型可见；此改动后的 prompt 应不再把
  仓库路径泄露进选项。无 pin 的 snapshot 引用旧文本。
- 游离的 `tool/code-dispatch` 现在记录 subtool 行而非消失；
  `transcript.spec.ts` 已更新断言防御性 cell。
- 验证：host typecheck 干净；tui-renderer + tui 包 237 个测试通过
  （新增 7 个：边框行、截断、DialogBox 结构/背景/占位/无 footer、
  底部锚定 overlay 选项）；keyless `tui-pty.snapshot` ledger 旅程
  （打开、详情、切 tab、关闭）仍通过。oxlint 树在未触碰文件中有
  既有错误（`detail.ts:102`、`transcript.ts:592-685`、tests）——
  新增或编辑的行均无。
