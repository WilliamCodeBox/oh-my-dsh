# subagent-cli

[English](README.md) | 中文

进程外 CLI 子代理后端：在独立子进程中驱动无头编码 agent CLI——pi（`pi -p "<prompt>"`）、oh-my-pi（`omp -p`）、opencode（`opencode run`）等——喂入任务提示词并解析最终文本。

## 使用

挂载插件并注册 provider：

```yaml
- id: subagent-cli
  name: '@williamcodebox/omd-subagent-cli'
  config:
    providerName: pi
    command: pi
    args: ['-p']
    promptStrategy: positional-tail
    env:
      DEEPSEEK_API_KEY: '{{ your key }}'
```

再从模型可见消费者中选择它：

```yaml
- id: tool-subagent
  name: '@williamcodebox/omd-tool-subagent'
  config:
    provider: pi
    toolName: delegate_to_pi
    maxDepth: provider-managed
```

子 agent 自己的 API key 必须经 `env` 提供（父环境凭据会被清理）；缺失或错误的 key 在运行时以 401 → `error` 结果呈现，而非启动失败。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `providerName` | `cli` | `ctx.subagents` 上的 provider 名 |
| `command` | — | 要生成的子 agent 可执行文件 |
| `args` | `[]` | 传给 `command` 的参数（不含提示词） |
| `promptStrategy` | `positional-tail` | 提示词传递：追加为尾参，或写入 stdin |
| `cwd` | 父会话 cwd | 子进程工作目录 |
| `env` | `{}` | 子进程额外环境（其自身 API key、部署事实） |
| `disposeEofGraceMs` | `6000` | dispose 时 EOF 静默窗口 |
| `disposeGraceMs` | `3000` | SIGTERM→SIGKILL 升级宽限 |

## 错误语义

非零退出、spawn 失败、退出码 0 但 stdout 为空，均以 `error` 结算（绝不 `completed`）；仅退出码 0 且 stdout 非空为 `completed`。取消清理遵循缝的阶梯：stdin EOF → 宽限 → terminate → 全树退出证明。

## 模型体验

间接通过 [`dsh-tool-subagent`](../tool-subagent/README.md)：该消费者把子 agent 的最终文本渲染为子代理结果。

#### KV 缓存效应

无直接失效；命名消费者拥有请求前缀变更。

## 已知限制与延后工作

- **仅文本输出**——无结构化结果，因此 provider 不宣传任何 start 能力（无 `outputSchema`、`depthLimit`、`toolFilter`、`persona`）。
- **stdout 是唯一成功通道**——把状态噪音打印到 stdout（而非 stderr）的 agent，其输出会被并入最终文本；请配置子 agent 将诊断留在 stderr。
- **无协议级取消**——裸 CLI 没有协议级取消，取消经由进程清理结算，而非协作式停止。
