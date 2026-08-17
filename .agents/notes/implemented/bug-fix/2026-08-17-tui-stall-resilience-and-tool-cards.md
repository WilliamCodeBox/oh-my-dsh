# Agent Note: TUI stall resilience and tool-card redesign

Status: implemented

English | [中文](2026-08-17-tui-stall-resilience-and-tool-cards.zh.md)

## Problem

A TUI session freeze surfaced two gaps. The parent session's final LLM request
stalled at time-to-first-byte: the session log ends at `step/start` with no
chunks, no error, and no `turn/end`, and the user force-closed the terminal.
Nothing in the status row distinguished a stalled provider from a long
legitimate think — the only transient was a spinner, and the only bound was
the five-minute stream idle watchdog, longer than any user waits. Separately,
tool cards rendered as near-black background boxes (`toolPendingBg` 236 /
`toolSuccessBg` 235 / `toolErrorBg` 234 are indistinguishable from a dark
terminal background) with no foreground color, no border, and the title and
arguments on one line, and consecutive transcript items rendered without any
vertical separation.

## Decision

`packages/llm/llm-deepseek` — a new `requestTimeoutMs` config (default
120,000 ms) bounds the connect + first-response-byte phase separately from
stream reads. The fetch runs under a block-scoped `deadline` whose timer is
disposed once headers arrive, so a slow body keeps the longer
`streamIdleTimeoutMs` bound. A provider that never returns headers errors
`LlmError('TIMEOUT')`; `TIMEOUT` is in the default retryable set, so
`dsh-llm-retry` converts the stall into a bounded retry with backoff instead
of a hang. A caller abort during the first-byte wait still maps to `ABORTED`.

`packages/bundle/tui` — the running transient shows elapsed seconds
(`⠋ running 42s · esc to interrupt`); once the model has produced no session
event for 60 seconds it flips to the theme's warning color and names the
silence (`no response 61s`). The formatting lives in a pure exported helper
`runningTransient` (unit-tested), driven by `runStartedAt`/`lastActivityAt`
tracked in the runner.

`packages/interaction/tui-renderer` — tool cards are restructured around a
state-colored leading bar (`▌` in accent/success/error) instead of a
full-width background: title (`tool <name>` in `toolTitle` plus dim truncated
args), settled outcome (`✓ ok` / `✗ error <name>`), and any diffs on `│`
continuation lines. The unused `tool*Bg` theme tokens were removed. Items are
separated by one blank line in both the themed and identity render paths.

`cordis` composition — no change needed: `dsh-base` already mounts
`token-meter`, `compaction-basic`, and `compaction-tool-result-pruner`. The
freeze was not caused by their absence; the 800K-token pressure threshold
(0.8 × the deepseek route's published 1M window) is reachable only in
pathological sessions, which the TTFB timeout and retry now bound anyway.

## Alternatives considered

- **Event-loop block hypothesis** — investigated and largely ruled out: the
  renderer is fully cached, the serializer is linear, `deriveMessages` costs
  O(new nodes), and the final plan markdown had no pathological input. The
  log evidence (no events after `step/start`, no timeout error, user
  force-closed before the 5-minute watchdog) points to a TTFB stall.
- **High-contrast full-width card backgrounds** (deep green/red/blue tints) —
  rejected in favor of the leading color bar: it reads on any terminal
  background without glare and matches the diff colors the cards already use.
- **Lowering the compaction threshold or shrinking the published 1M context
  window** — rejected: deepseek-v4-flash genuinely supports a 1M window, and
  compacting at 128K would spend summarization tokens on every moderate
  session.

## Consequences

- A stalled provider is now visible (warning color + named silence) and
  bounded (120s TTFB, then up to two retries with backoff) instead of an
  indefinite silent hang; Escape still aborts at any point.
- Tool cards read as structured, state-colored surfaces, and transcript items
  breathe.
- New config surface: `requestTimeoutMs` on `llm-deepseek` (documented in
  README/zh; validated in `resolveAdapterOptions` like `streamIdleTimeoutMs`).
- The `tui-agent` identity-transcript snapshots were re-recorded for the
  blank-line spacing; the PTY snapshot asserts loose conditions and is
  unaffected.
- The repo's `doc-sync` gates were already red on the earlier TUI notes'
  format and pairing debt; this note follows the current
  `.agents/notes/README.md` format, and the pair is recorded.
