/**
 * Behavioral tests for the input meta row: three-segment composition
 * (model/thinking | cwd/git | context bar), context threshold colors,
 * truncation priorities, and empty data.
 */

import { describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { renderMetaRow, contextTokenFor } from '../src/meta-row.ts'
import { darkTheme } from '../src/theme.ts'
import { contextBar } from '../src/format.ts'

const base = {
  model: { provider: 'deepseek', model: 'deepseek-v4-flash' },
  cwd: '~/work/oh-my-dsh',
  context: { ratio: 0.45, window: 200_000, used: 90_000 },
}

describe('renderMetaRow', () => {
  it('composes model, thinking, cwd, git, and the context bar', () => {
    const line = renderMetaRow({
      ...base,
      thinking: 'medium',
      git: { branch: 'main', unstaged: 2, staged: 1, untracked: 3 },
    }, darkTheme, 100)
    expect(line).toContain('deepseek/deepseek-v4-flash')
    expect(line).toContain('⟳ medium')
    expect(line).toContain('~/work/oh-my-dsh')
    expect(line).toContain('⎇ main')
    expect(line).toContain('+1')
    expect(line).toContain('*2')
    expect(line).toContain('?3')
    expect(line).toContain(contextBar(0.45, 10))
    expect(line).toContain('90.0k/200k')
  })

  it('colors the context bar by thresholds', () => {
    expect(contextTokenFor(0.3)).toBe('dim')
    expect(contextTokenFor(0.6)).toBe('muted')
    expect(contextTokenFor(0.8)).toBe('warning')
    expect(contextTokenFor(0.95)).toBe('error')
    expect(renderMetaRow({ ...base, context: { ratio: 0.95, window: 100, used: 95 } }, darkTheme, 80))
      .toContain(darkTheme.fg('error', contextBar(0.95, 10)))
  })

  it('truncates the left segment first, keeping the context bar', () => {
    const line = renderMetaRow(base, darkTheme, 50)
    expect(line).toContain('45%')
    expect(line).not.toContain('deepseek/deepseek-v4-flash')
    expect(visibleWidth(line)).toBeLessThanOrEqual(50)
  })

  it('renders empty for no data', () => {
    expect(renderMetaRow({}, darkTheme, 80)).toBe('')
  })

  it('drops the window label when the window is unknown', () => {
    const line = renderMetaRow({ ...base, context: { ratio: 0.5, used: 100 } }, darkTheme, 80)
    expect(line).toContain(contextBar(0.5, 10))
    expect(line).not.toContain('200000')
  })
})
