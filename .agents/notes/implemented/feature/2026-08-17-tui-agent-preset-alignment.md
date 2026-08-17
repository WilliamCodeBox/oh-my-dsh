# Agent Note: TUI agent-preset alignment with the Web surface

Status: implemented

English | [中文](2026-08-17-tui-agent-preset-alignment.zh.md)

## Problem

The Web surface (web-app bundle) moved every model-facing tool behind agent
presets: the patch disables 23 base rows on the host plane, a session mounts
one preset per agent, and `resolveSessionPreset` rebuilds the recorded
composition on resume. The TUI kept the base global tool layer — the base
patch comment said "the base keeps them for the TUI, which is single-session
and composes its agent process-wide" — so a TUI agent saw the full tool set
with an empty preset plane: no roster, no per-session capability surface, no
user-authored presets, and no log-reconstructable composition. Users of both
surfaces could not predict which tools a session presented.

## Decision

The `tui` bundle now mirrors the Web surface's agent plane:

- `packages/bundle/tui/cordis.patch.yml` — copies the web-app patch's 23-row
  disable set (tool-bash, tool-pwsh, tool-jobs, tool-fs, tool-fs-search,
  tool-str-replace-editor, skill-filesystem, tool-skill, tool-goal,
  plan-mode, compaction-basic, command-compact, tool-result-pruner,
  tool-subagent-control, tool-subagent-list-agents, tool-subagent,
  tool-subagent-fork, workflow-worker-thread, tool-workflow, tool-ralph,
  agent-instructions, tool-todo, tool-web) and inserts the
  `@williamcodebox/omd-agent-presets` row with `default: standard`.
  `profile-boot` then injects the shipped `config/agent-presets` roots
  (standard/code/minimal/cordis) as system-trusted, plus any
  `$DSH_HOME/.agent-presets` user root. The `tool-lsp` row stays global —
  the base mounts it for every profile and the TUI bundle ships
  `typescript-language-server`, so `lsp` is the one global tool every TUI
  session sees (the Web bundle has no lsp dependency, so the rows never
  activate there).

- `packages/bundle/tui/src/index.ts` — `composeAgent` mirrors the api-proxy:
  a rosterless deployment (no `agent-presets` row) keeps the base global
  layer; otherwise a fresh session resolves the deployment default once and
  mounts it (recording the id on the header), a resumed session resolves
  `resolveSessionPreset` from its log inside the factory setup (an
  unrecorded legacy session falls back to the default, matching the Web
  cold-read), and the new `/preset` slash command lists the roster, re-checks
  the session is blank, `recompose`s, and appends `agent-preset/selected`
  only after the swap commits. The meta row shows the composed preset id.

- `packages/interaction/tui-renderer/src/meta-row.ts` — `MetaRowData` gains
  an optional `preset` field rendered in the left segment.

## Alternatives considered

- **Keep the TUI global layer, add the roster beside it** — rejected: the
  tool registry's `view()` merges the global layer with scope-chain layers
  (nearest same-name entry wins), so a preset session would see the global
  superset plus the preset, destroying `minimal`'s two-tool surface and
  `standard`'s exact catalog. The Web surface's empty global layer is
  achieved by the disable set, not by any shadowing mechanism.
- **Extract the disable set into `dsh-base`** — rejected: headless is
  intentionally rosterless and runs on the global layer; the disable set
  belongs to the surfaces that use presets.
- **No `/preset` command, startup flag only** — rejected: switching a blank
  session matches the Web picker and keeps the composition log-honest; a
  startup flag would only choose the first composition.

## Consequences

- A TUI session of `standard` presents the Web-exact catalog plus `lsp`;
  `minimal` presents `bash`, `str_replace_editor`, plus `lsp`. `lsp` is the
  documented single exception, an artifact of the TUI bundle shipping a
  language server the Web bundle never activates.
- Existing TUI sessions created before this change have no
  `agent-preset/selected` event; resuming one falls back to the deployment
  default, exactly the Web cold-read behavior. This is documented, not
  silent.
- `str_replace_editor` is no longer available on the default TUI session
  (the `standard` preset does not mount it; only `minimal` does) — accepted
  as the price of Web-identical catalogs.
- Verification: `verify-cordis-config` passes (50 configs); tui bundle unit
  tests 57 + renderer 187 pass; new `apps/cli/tests/tui-agent-presets.e2e.ts`
  asserts the empty-global-plus-lsp layer, the four system presets with
  `standard` default, and the exact `standard`/`minimal` catalogs;
  `tui-pty.snapshot` and `built-bin.e2e` (18) pass on the real composition.
