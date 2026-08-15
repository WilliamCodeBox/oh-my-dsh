/**
 * The tui-agent example's interaction-journey snapshot: a recorded session
 * covering the full interaction surface — streamed assistant turns, a tool
 * call decided through the approval modal, a slash command with its result,
 * todos, and an aborted second turn — folds through the shipped
 * `Transcript`/`TranscriptView` presentation contract into the rendered
 * terminal transcript, compared against the expected lines. Keyless and
 * deterministic; the PTY case in `apps/cli/tests/tui-pty.snapshot.ts` covers
 * the assembled process journey, and this fixture pins the rendering of
 * every item kind the adapters produce.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { Transcript, TranscriptView } from '@deepseek-ai/dsh-tui-renderer'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const FIXTURE = fileURLToPath(new URL('./fixtures/interaction/session.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./snapshots/interaction/terminal.expected.txt', import.meta.url))

it('renders the interaction journey (approval-decided tool, command, aborted turn)', async () => {
  const events = (await readFile(FIXTURE, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as SessionEvent)

  const transcript = new Transcript()
  for (const event of events) transcript.fold(event)

  const rendered = `${new TranscriptView(transcript).render(80).join('\n')}\n`
  if (process.env.DSH_SNAPSHOT === 'refresh') {
    await writeFile(EXPECTED, rendered)
    return
  }
  expect(rendered).toBe(await readFile(EXPECTED, 'utf8'))
})
