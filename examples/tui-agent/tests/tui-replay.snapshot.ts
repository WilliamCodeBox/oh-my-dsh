/**
 * The tui-agent example's assembled replay case: boots the real
 * `omd --profile tui` composition with the `--patch` replay overlay (real
 * DeepSeek adapter disabled, `dsh-llm-replay` serving the recorded fixture
 * under the profile's default provider/model), drives a piped line through
 * the full agent loop, and asserts the trace stream — streamed chunks, the
 * finalized assistant message, and a completed turn. Keyless and
 * deterministic; it is the only case that exercises the assembled app's
 * model round-trip without a key.
 */

import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@williamcodebox/omd-loader-smoke'

const dshBinScript = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const replayPatch = fileURLToPath(new URL('../replay.cordis.yml', import.meta.url))
const sessionFixture = fileURLToPath(new URL('./fixtures/interaction/session.jsonl', import.meta.url))
const llmReplayPackage = fileURLToPath(new URL('../../../packages/test-support/llm-replay', import.meta.url))

it('replays the recorded model stream through the assembled tui profile', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tui-replay-'))
  try {
    // The built-lib Loader resolves patched-in plugin packages from the
    // profile directory upward; expose the replay package on that chain so
    // `--patch replay.cordis.yml` resolves in lib mode too (src mode already
    // sees it through the workspace root).
    const scoped = join(cwd, 'node_modules', '@deepseek-ai')
    await mkdir(scoped, { recursive: true })
    await symlink(llmReplayPackage, join(scoped, 'dsh-llm-replay'))
    const launch = resolveExampleLaunch({
      srcBin: dshBinScript,
      configArgs: ['--profile', 'tui', '--patch', replayPatch],
      tsconfigPath,
      env: {
        DSH_HOME: join(cwd, '.dsh'),
        DSH_SNAPSHOT_FILE: sessionFixture,
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    const result = await execa(launch.command, launch.args, {
      input: 'list transcript.ts\n',
      env: launch.env,
      timeout: LOADER_SMOKE_TEST_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      reject: false,
      stripFinalNewline: false,
    })
    if (result.timedOut) {
      throw new Error(`tui replay did not exit. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    // The trace stream: the user line, the replayed streamed chunks, the
    // finalized assistant message, and the completed turn bracket.
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[user] list transcript.ts')
    expect(result.stdout).toContain('[assistant] The fold')
    expect(result.stdout).toContain('[assistant] The fold model keeps append-origin events only.')
    expect(result.stdout).toContain('[turn/end] 1 completed')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
