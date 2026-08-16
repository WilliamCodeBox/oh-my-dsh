# oh-my-dsh

[English](README.md) | 中文

**oh-my-dsh**（命令名 `omd`）是一个开箱即用的编码 agent TUI，fork 自
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

**一切皆插件**。omd 是基于 [Cordis](https://github.com/cordiverse/cordis)
的插件宿主：launcher、TUI、各项能力（shell、文件系统、子进程、沙箱、技能、
会话、委派、审批）都是独立版本化的插件，按 profile 组合。裸调用 `omd`
打开交互式 TUI。

## 安装

从 [GitHub Releases](https://github.com/WilliamCodeBox/oh-my-dsh/releases)
下载（单个 tarball，内含 bun 运行时——CentOS 7+ 可跑，无需安装 Node）：

```sh
curl -fsSL https://raw.githubusercontent.com/WilliamCodeBox/oh-my-dsh/main/install.sh | sh
# 受限网络：
GH_PROXY=https://gh-proxy.com/ sh install.sh
# 指定版本或安装目录：
sh install.sh 0.1.0-rc.6
OMD_HOME=/opt/omd sh install.sh
```

## 使用

```sh
omd                                   # 交互式 TUI（默认 profile）
omd --profile headless "修复 README.md 里的错别字"
omd --profile tui --resume <session-id>
```

会话、goal/todo 跟踪、技能、委派均内置。架构见 [docs/](docs/)，
可运行组合示例见 [examples/](examples/)。

## 仓库布局

```
packages/    插件包（@williamcodebox/omd-*、vendored cordis）
apps/        launcher（omd CLI）
scripts/     发布与分发工具
vendor/      vendored Cordis 框架源码
docs/        架构与子系统文档
examples/    可运行 cordis.yml 示例
```

## 许可证

BSD-3-Clause。衍生自 DeepSeek Harness（BSD-3-Clause）。
