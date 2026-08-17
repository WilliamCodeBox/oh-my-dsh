/**
 * The TUI agent-preset contract: the `tui` profile (base + tui bundle) must
 * present the same preset semantics as the Web surface. The tui patch mirrors
 * the web-app patch's agent-plane move — every model-facing tool row disabled
 * on the host plane, tools supplied per session by a preset — so a TUI agent
 * composed from `standard` sees the exact same catalog a Web agent does, and
 * a rosterless deployment keeps the base global layer.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Context } from '@williamcodebox/cordis'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@williamcodebox/omd-app-boot'
import { provideCmdline } from '@williamcodebox/omd-cmdline'
import { SessionId } from '@williamcodebox/omd-session'
import type { Agent } from '@williamcodebox/omd-agent'
import type { PatchOptions } from '@williamcodebox/cordis-plugin-include'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {} from '@williamcodebox/omd-tools'
import type {} from '@williamcodebox/omd-session-telemetry'

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
/** The shipped TUI surface: the dsh-base and dsh-tui bundle patches over an empty preset root. */
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const TUI_PATCH = join(REPO_ROOT, 'packages/bundle/tui/cordis.patch.yml')
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')

/**
 * Boot the shipped TUI composition, minus the rows that would own the
 * terminal or touch the network. The tui-runner owns the full screen and the
 * input loop, so it cannot activate in a test process; everything that
 * decides an agent's capabilities is the real thing, including both shipped
 * presets and the tui patch's disabled global layer.
 */
async function bootTui(settingsFile: string): Promise<Context> {
  const storageRoot = join(dirname(settingsFile), 'storages')
  const patches: PatchOptions[] = [
    ...loadOverlayPatches('dsh-test', BASE_PATCH),
    ...loadOverlayPatches('dsh-test', TUI_PATCH),
    // The settings row defaults to `$DSH_HOME/settings.yaml`; point it at a
    // temp file so a stored `agent-presets.default` cannot decide this run.
    { id: 'settings', config: { path: settingsFile, watch: false } },
    { id: 'storage-json', config: { root: storageRoot } },
    // The runner owns the terminal and drives the input loop; it would hang
    // a test process. The startup provider feeds it; both stay disabled.
    { id: 'tui-runner', disabled: true },
    { id: 'tui-startup', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    // The roster: only the shipped root, so a developer's own presets cannot
    // change this test's outcome.
    {
      id: 'agent-presets',
      config: {
        default: 'standard',
        roots: [{ path: join(CONFIG_DIR, 'agent-presets'), trust: 'system' }],
        includeUserRoot: false,
      },
    },
  ]
  const home = dirname(settingsFile)
  healProfilesModuleFallback(INSTALL_ANCHOR, home)
  const profileDir = join(home, 'profiles', 'spec')
  await mkdir(profileDir, { recursive: true })
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  return await boot('dsh-test', rootConfig, patches, (bootCtx) => {
    provideCmdline(bootCtx, { args: [], exit: () => {} })
  })
}

const toolNames = (ctx: Context, agent?: Agent): string[] =>
  ctx.tools.schemas(agent).map(schema => schema.name).sort()

let ctx: Context
beforeAll(async () => {
  const settingsFile = join(await mkdtemp(join(tmpdir(), 'dsh-tui-presets-')), 'settings.yaml')
  await writeFile(settingsFile, '{}\n')
  ctx = await bootTui(settingsFile)
}, 120_000)

afterAll(async () => {
  await ctx?.fiber.dispose()
})

describe('the shipped TUI composition', () => {
  it('leaves the global tool layer to the TUI-only lsp tool', () => {
    // Mirrors the Web surface: every model-facing tool belongs to a preset.
    // The ONE exception is `lsp`, which the base keeps globally for every
    // profile ("every mode"): the Web bundle does not depend on the lsp
    // packages, so the rows never activate there, while the TUI bundles
    // typescript-language-server and sees the tool for every session. A
    // regression here means another agent-plane row came back to the host
    // composition, leaking into every TUI session regardless of preset.
    expect(toolNames(ctx)).toEqual(['lsp'])
  })

  it('supplies the four shipped presets, system-trusted, standard by default', async () => {
    const listed = await ctx.agentPresets.list()
    expect(listed.map(preset => preset.id).sort()).toEqual(['code', 'cordis', 'minimal', 'standard'])
    expect(listed.every(preset => preset.trust === 'system')).toBe(true)
    expect(ctx.agentPresets.defaultId).toBe('standard')
  })

  it('composes the full agent from `standard` with the Web-exact catalog plus lsp', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('tui-preset-standard'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    try {
      // The EXACT catalog, not a spot-check — the same assertion the Web e2e
      // makes, so a TUI agent and a Web agent of the same preset present the
      // same model-visible surface. The single difference is `lsp`: the
      // global lsp tool the base mounts for every profile, which the Web
      // bundle never activates because it has no lsp dependency.
      // `glob`/`grep` are excluded for the same reason the Web e2e excludes
      // them: they depend on ripgrep being present on the machine.
      expect(toolNames(ctx, handle.agent).filter(name => name !== 'glob' && name !== 'grep')).toEqual([
        'ask_user_question', 'bash', 'create_goal', 'edit', 'exit_plan_mode',
        'get_goal', 'interrupt_agent', 'job_kill', 'job_list', 'job_output', 'list_agents', 'lsp', 'ralph', 'read', 'read_image', 'send_message', 'skill',
        'subagent', 'subagent_fork', 'todo_write', 'update_goal', 'web_search',
        'workflow', 'write',
      ])
    } finally {
      await handle.dispose()
    }
  })

  it('composes the two-tool surface from `minimal`', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('tui-preset-minimal'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    try {
      const assembly = await ctx.systemPrompt.assemble({ scope: handle.agent })
      expect(assembly.sections).toEqual([
        { name: 'deployment:persona', text: 'You are a helpful software engineer assistant.' },
      ])
      // Two preset tools plus the global lsp tool every TUI session sees.
      expect(assembly.tools.map(tool => tool.name)).toEqual(['bash', 'lsp', 'str_replace_editor'])
    } finally {
      await handle.dispose()
    }
  })
})
