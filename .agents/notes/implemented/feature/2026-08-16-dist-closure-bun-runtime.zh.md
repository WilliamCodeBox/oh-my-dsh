# Agent Note: 分发闭包在打包的 bun 运行时上可启动

Status: implemented

[English](2026-08-16-dist-closure-bun-runtime.md) | 中文

## 问题

omd 分发 tarball（`build:dist`）的 `--version` 冒烟通过，但从未真正启动过任何 profile：每次运行都报 `plugin tree failed to load`。三个独立缺陷叠加导致失败：

1. **`pnpm deploy --prod` 裁掉 bundle 插件。** 根包没有 `dependencies`（只有 35 个 devDependencies），因此 pnpm 从它出发的 prod 闭包为空，base bundle 依赖的 28 个运行时插件（`omd-llm-deepseek`、`omd-subprocess-local`、`omd-sandbox-local`、`omd-lsp`……）从未进入部署树。旧冒烟只跑 `--version`，从不加载插件树。
2. **trim 步骤删除了运行时代码。** `trim-node-modules.py` 无差别删除所有 `src/` 与 `build/` 目录；`koffi` 把运行时代码放在 `src/` 下、`@opentelemetry/sdk-logs` 放在 `build/` 下，它们的 import 随即断裂（`Cannot find module '.../src/koffi/index.js'`）。
3. **打包的 bun 运行时缺少 Node 内部模块。** `node:module` 的 `stripTypeScriptTypes`（仅 ESM，被 `omd-code-runtime-worker-thread` 使用）与 Node 内部 ESM loader（`cordis-plugin-hmr` 必需）在 bun 上不存在；静态 import 与 HMR 构造函数在加载时炸掉整棵树。

## 决策

**deploy 不带 `--prod`，随后精确删除根 devDependencies 并把每个 workspace 包提升到顶层作用域。** assemble 脚本现在先跑 `pnpm deploy --legacy`（完整 workspace prod 闭包），再由 `drop-dev-deps.py` 删除根的 35 个 devDependency 条目（顶层 symlink 加无他人链接的虚拟 store 条目），然后 `promote-workspace-links.py` 把每个 workspace 包 symlink 进 `node_modules/@williamcodebox/`——app-boot 的 profile fallback 通过普通 node_modules 向上遍历从树根解析 bundle 依赖，而 pnpm deploy 只把 app 的直接依赖提升到顶层。

**trim 只裁测试/文档目录。** `trim-node-modules.py` 现在只删 `tests`/`test`/`testdata`/`__tests__`/`examples`/`.github`/`coverage`/`dist-src`/`benchmark`/`bench`；`src/` 与 `build/` 保留（包布局并不标准化：koffi、@opentelemetry）。

**bun 运行时守卫。** `omd-code-runtime-worker-thread` 在命名空间上检测 `node:module.stripTypeScriptTypes`，缺失时回退为恒等函数（bun worker 线程原生执行 TypeScript，strip 在那里语义冗余）。`vendor/hmr` 在 Node 内部 loader 不可用时降级为非活动服务（警告 + `registerConfig` no-op），不再抛错；base bundle 在分发 launcher 导出 `OMD_NO_HMR=1` 时禁用该行，launcher 同时传 `--expose-internals` 保持 Node 对齐。

**冒烟升级为真实启动 headless profile。** `build:dist` 现在执行 `omd --profile headless "smoke"`，仅在树成功加载时通过（无 key 时为 `MISSING_CREDENTIAL`，或干净运行）——用捕获的日志拒绝 `plugin tree failed to load`。

## 备选方案

**保留 `--prod` 并手工补回缺失的 28 个包。** 否决：缺失集合正是 base bundle 的传递 workspace 闭包，deploy 步骤需手工重解析；去掉 flag 再删除（空根）devDependencies 是用同一机制得到同一集合。

**改 `app-boot` 从虚拟 store 解析。** 否决：profile fallback 对 `node_modules` 的 BFS 是文档化的解析契约；改动它会影响源码树与 npm 安装布局，而不仅是组装树。

**让 HMR 在 bun 上工作。** 否决：bun 不实现 Node 内部 ESM loader（`--expose-internals` 可解析但内部模块不存在）；没有可挂钩的 API 面。降级为重启生效的配置编辑是分发运行时的正确产品行为。

## 影响

- 组装树可启动：`build:dist` 冒烟通过；pty 驱动的 TUI 运行约 2 秒渲染，可提交输入、到达模型步骤（状态栏显示 `deepseek-official/deepseek-v4-flash`）、呈现无 key 错误路径。
- tarball 从 82 MB（`--prod`、闭包破损）增至约 145 MB：根 devDependencies 的传递树仍留在虚拟 store（条目彼此互链）。体积回收延后；正确性优先。
- `vendor/hmr` 新增一处文档化本地修改（bun 降级），记录于 `vendor/README.md` 第 13 条。
- 无 key 模型路径是唯一未验证环节；真实端到端模型回复需要 `DEEPSEEK_API_KEY`。
