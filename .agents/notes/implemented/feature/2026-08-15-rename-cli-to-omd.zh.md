# CLI 可执行名改名为 omd

## 问题

官方 `@deepseek-ai/dsh` CLI 已在本机全局安装（且已发布到 npm），本地 `dsh` 可执行文件会遮蔽或与之冲突。oh-my-dsh fork 的启动器需要自己的命令名。

## 改动

- `apps/cli/package.json` 的 `bin` 改为 `{ "omd": "lib/bin.js" }`；根 `pnpm dsh` script 改为 `pnpm omd`。
- 命令名表面：`args.ts` 的 commander `.name('omd')`、`loadLayeredEnv('omd')` 诊断前缀、profile-boot/plugin/dump-config 的 `NAME` 常量、runner 的 `omd: <error>` stderr 前缀、`--help` 输出（`Usage: omd --profile <name>`）。
- 全仓文档、示例、测试与注释中的每一处 `dsh` 命令用法引用（230+ 文件，含双语 `docs/user` 教程）均改为 `omd`。归档 Agent Notes 冻结不动。
- 保留的技术标识符：`@deepseek-ai/dsh-*` 包名、`DSH_HOME`/`DSH_*` 环境变量、`dsh.bundle`/`dsh.profile` manifest 键、`~/.dsh` home、`dsh-` 前缀的插件/特性名（如 `dsh-badge` skill）——那些是协议或包标识，不是命令名。

## 验证

- `pnpm omd --profile tui --help` 打印 `Usage: omd --profile tui` 并退出 0；built bin 携带改名后的前缀。
- 单测 61/61（bundle）+ renderer；tsc 0、oxlint 0；PTY smoke 与组装重放通过；完整 snapshot 门禁 16/16 文件、119/119 测试。
