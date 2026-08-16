# subagent-cli

English | [中文](README.zh.md)

Out-of-process CLI subagent backend: drives any headless coding-agent CLI in a
spawned subprocess — pi (`pi -p "<prompt>"`), oh-my-pi (`omp -p`), opencode
(`opencode run`), and similar — feeds the task prompt and parses the final
text.

## Usage

Mount the plugin and register a provider:

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

Then select it from the model-facing consumer:

```yaml
- id: tool-subagent
  name: '@williamcodebox/omd-tool-subagent'
  config:
    provider: pi
    toolName: delegate_to_pi
    maxDepth: provider-managed
```

The child agent's own API key must be supplied via `env` (ambient parent
credentials are scrubbed); a missing or wrong key surfaces at runtime as a
401 → `error` result, not a startup failure.

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `providerName` | `cli` | Provider name on `ctx.subagents` |
| `command` | — | The executable to spawn (the child coding agent) |
| `args` | `[]` | Arguments passed to `command`, excluding the prompt |
| `promptStrategy` | `positional-tail` | Prompt delivery: appended as one trailing argument, or written to stdin |
| `cwd` | parent session cwd | Working directory for the child process |
| `env` | `{}` | Extra env for the child (its own API key, deployment facts) |
| `disposeEofGraceMs` | `6000` | EOF-driven quiesce window on dispose |
| `disposeGraceMs` | `3000` | SIGTERM→SIGKILL escalation grace |

## Error semantics

A non-zero exit, a spawn failure, or an empty stdout on exit 0 all settle as
`error` (never `completed`); only exit 0 with non-blank stdout is
`completed`. Cancellation teardown follows the seam's ladder: stdin EOF →
grace → terminate → whole-tree exit proof.

## Model Experience

Indirectly, through [`dsh-tool-subagent`](../tool-subagent/README.md), which renders the child's final text as a subagent result.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Text output only** — no structured result, so the provider advertises no
  start capabilities (no `outputSchema`, `depthLimit`, `toolFilter`, or
  `persona`).
- **stdout is the single success channel** — agents that print status chatter
  to stdout (rather than stderr) will have it folded into the final text;
  configure the child to keep diagnostics on stderr.
- **No wire-level cancel** — a bare CLI has no protocol-level cancellation, so
  cancellation settles via process teardown rather than a cooperative stop.
