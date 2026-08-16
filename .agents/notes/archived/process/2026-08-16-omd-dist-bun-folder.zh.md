# Agent Note: omd 分发——bun 运行时 + deploy 闭包文件夹

Status: implemented
Archived: 2026-08-16

[English](2026-08-16-omd-dist-bun-folder.md) | 中文

## Problem

omd CLI 需要一种能在 CentOS 7+（glibc 2.17）上运行、除 libc 外无系统依赖的分发形态。
单文件 bundle 路径均经实验否决：`pkg` 无法在快照内解析 ESM 裸导入（它只 patch CJS
`require`，而 240 包闭包全是 ESM）；`bun build --compile` / Bun.build 无法内嵌 cordis
插件树（插件运行时按包名从 node_modules 解析，依赖图不可静态 bundle）。自编完全静态
node（先 26 后 22）在可用 musl 工具链上失败（GCC 11.2 的 C++20 缺口、zig clang 的
evex512 目标冲突）——而这已无必要：bun 运行时二进制本身只链接 GLIBC_2.17 符号
（`readelf --version-info`），正是 CentOS 7 基线。

## 决策

以**文件夹**形式分发 omd：bun 运行时二进制 + launcher 的 deploy 闭包树（pnpm deploy）
+ 启动脚本。这沿袭 pi 的分发形态（`dist/` 文件夹内含编译二进制与资产）。文件夹整体
打成单个 tarball 分发。

- `scripts/assemble-omd-dist.ts`（`pnpm run build:dist`）：pnpm deploy launcher 闭包
  → 精简至发布语义（删 src/tests/docs/构建元数据；保留 symlink store 结构）→ 复制
  bun 运行时 + `omd` 启动脚本 → 在组装树上冒烟 `--version` → tar.gz。
- `.github/workflows/omd-dist.yml`：ubuntu-24.04（x64）与 ubuntu-24.04-arm（arm64）
  matrix 构建（setup-bun 提供运行时），`omd-v*` tag 或手动触发后上传 artifact。
- tarball 在 CentOS 7+（glibc 2.17）上运行，无需安装期编译。

## 否决的替代方案

- **单文件 bundle**（`pkg`、`bun --compile`）：ESM 快照解析与动态插件加载均不兼容；
  实验证实。
- **完全静态 node**（musl、`--fully-static`）：原理可行，但工具链成本（musl GCC 11
  对 node 22/26 的 C++ 太旧、musl.cc native 也是 GCC 11、zig clang 有 evex512 冲突）
  在已知 bun GLIBC_2.17 基线后不再值得。
- **自解压单文件**：可行，但文件夹形态（pi 同款）更易检查与调试；CentOS 7 需求
  不需要它。
