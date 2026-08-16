# oh-my-dsh

English | [中文](README.zh.md)

**oh-my-dsh** (`omd`) is an out-of-the-box coding agent TUI, forked from
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

**Everything is a plugin.** omd is a plugin host powered by
[Cordis](https://github.com/cordiverse/cordis): the launcher, the TUI, the
capabilities (shell, filesystem, subprocess, sandbox, skills, sessions,
delegation, approval) are all independently versioned plugins composed per
profile. Bare `omd` opens the interactive TUI.

## Install

From [GitHub Releases](https://github.com/WilliamCodeBox/oh-my-dsh/releases)
(a single tarball with the bun runtime — runs on CentOS 7+, no Node needed):

```sh
curl -fsSL https://raw.githubusercontent.com/WilliamCodeBox/oh-my-dsh/main/install.sh | sh
# restricted networks:
GH_PROXY=https://gh-proxy.com/ sh install.sh
# pin a version or override the install dir:
sh install.sh 0.1.0-rc.6
OMD_HOME=/opt/omd sh install.sh
```

## Usage

```sh
omd                                   # interactive TUI (default profile)
omd --profile headless "fix the typo in README.md"
omd --profile tui --resume <session-id>
```

Sessions, goal/todo tracking, skills, and delegation are built in. See
[docs/](docs/) for the architecture and [examples/](examples/) for runnable
compositions.

## Repository layout

```
packages/    plugin packages (@williamcodebox/omd-*, vendored cordis)
apps/        launcher (omd CLI)
scripts/     release and distribution tooling
vendor/      vendored Cordis framework sources
docs/        architecture and subsystem documentation
examples/    runnable cordis.yml leaves
```

## License

BSD-3-Clause. Derived from DeepSeek Harness (BSD-3-Clause).
