/**
 * The tui-agent example's transcript snapshot: a recorded session event log
 * folds through the shipped `Transcript`/`TranscriptView` presentation
 * contract into the terminal transcript, compared against the expected lines.
 * Keyless and deterministic — no Loader boot, no PTY, no model. The PTY smoke
 * (`apps/cli/tests/tui-pty.snapshot.ts`) covers the assembled process journey.
 *
 * `pnpm run test:snapshot:refresh` rewrites the expected file from the
 * committed fixture; replay (the CI default) only compares.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { Transcript, TranscriptView } from '@deepseek-ai/dsh-tui-renderer'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const FIXTURE = fileURLToPath(new URL('./fixtures/transcript/session.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./snapshots/transcript/terminal.expected.txt', import.meta.url))

it('folds the recorded session into the rendered terminal transcript', async () => {
  const events = (await readFile(FIXTURE, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as SessionEvent)

  const transcript = new Transcript()
  for (const event of events) transcript.fold(event)

  // The compaction replacement (a model-visible surface op) must NOT erase
  // what the human already saw; it surfaces as a note on the state.
  expect(transcript.state.compactions).toEqual([{ seq: 15, start: 0, end: 3, shadowedSeqs: [1, 2, 7] }])

  const rendered = `${new TranscriptView(transcript).render(80).join('\n')}\n`
  if (process.env.DSH_SNAPSHOT === 'refresh') {
    await writeFile(EXPECTED, rendered)
    return
  }
  const expected = await readFile(EXPECTED, 'utf8')
  expect(rendered).toBe(expected)
})
