import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Token-contract tests for the Burrow Instrument collaboration surfaces.
 *
 * jsdom does not resolve `rgb(var(--messor-*))` into computed colors, so the
 * dark/light rendering contract cannot be asserted from `getComputedStyle`.
 * Instead these tests pin the source contract: the collaboration CSS must
 * consume only the approved channel-valued semantic tokens via `rgb(...)`,
 * never the undefined legacy aliases or hard-coded palette hex/white fallbacks,
 * and the dark theme must map every consumed token to a dark channel value.
 */

const commentsCss = readFileSync(
  join(process.cwd(), 'src/features/comments/IssueComments.css'),
  'utf8',
)
const drawerCss = readFileSync(
  join(process.cwd(), 'src/features/issues/IssueDrawer.css'),
  'utf8',
)
const indexCss = readFileSync(
  join(process.cwd(), 'src/index.css'),
  'utf8',
)

// Undefined legacy aliases that were previously consumed with hex fallbacks.
// They are NOT defined by index.css, so any remaining usage silently falls back
// to a light hex and breaks the dark theme.
const LEGACY_UNDEFINED = [
  '--messor-danger',
  '--messor-border',
  '--messor-surface',
  '--messor-primary',
]

// Approved channel-valued tokens defined in index.css.
const APPROVED_TOKENS = [
  '--messor-canvas',
  '--messor-surface-1',
  '--messor-surface-2',
  '--messor-surface-3',
  '--messor-surface-inverse',
  '--messor-text-primary',
  '--messor-text-secondary',
  '--messor-text-muted',
  '--messor-border-subtle',
  '--messor-border-strong',
  '--messor-signal-active',
  '--messor-signal-active-soft',
  '--messor-signal-danger',
  '--messor-signal-success',
  '--messor-signal-info',
  '--messor-signal-warning',
]

function findTokenUsages(css: string, token: string): string[] {
  const out: string[] = []
  // The trailing lookahead prevents a legacy prefix (e.g. --messor-border)
  // from matching the approved --messor-border-subtle token.
  const re = new RegExp(
    `var\\(${token.replace(/[-]/g, '\\-')}(?![a-z0-9-])[^)]*\\)`,
    'g',
  )
  for (const match of css.matchAll(re)) {
    out.push(match[0])
  }
  return out
}

function collectAllVarUsages(css: string): string[] {
  const out: string[] = []
  for (const m of css.matchAll(/var\((--messor-[a-z0-9-]+)[^)]*\)/g)) {
    out.push(m[0])
  }
  return out
}

describe('collaboration CSS semantic-token contract', () => {
  it('IssueComments.css uses no undefined legacy tokens or hard-coded white', () => {
    for (const token of LEGACY_UNDEFINED) {
      expect(findTokenUsages(commentsCss, token)).toEqual([])
    }
    expect(commentsCss).not.toMatch(/#ffffff/i)
    expect(commentsCss).not.toMatch(/rgba\(255\s*,\s*255\s*,\s*255/i)
  })

  it('IssueDrawer.css uses no undefined legacy tokens or hard-coded white', () => {
    for (const token of LEGACY_UNDEFINED) {
      expect(findTokenUsages(drawerCss, token)).toEqual([])
    }
    // The sticky header must be a theme-aware surface, never a hard-coded
    // white/light overlay.
    expect(drawerCss).not.toMatch(/rgba\(255\s*,\s*255\s*,\s*255/i)
  })

  it('every --messor-* token consumed in these surfaces is an approved channel token via rgb()', () => {
    for (const file of [commentsCss, drawerCss]) {
      const usages = collectAllVarUsages(file)
      expect(usages.length).toBeGreaterThan(0)
      for (const usage of usages) {
        const token = /var\((--messor-[a-z0-9-]+)/.exec(usage)?.[1]
        expect(token).toBeDefined()
        expect(APPROVED_TOKENS).toContain(token)
        // Channel-valued tokens are consumed via rgb(var(...)) / rgb(var(...) / alpha).
        expect(usage).toMatch(/^var\(--messor-[a-z0-9-]+\)$/u)
        expect(usage.startsWith('var(')).toBe(true)
      }
      // Guard: the consuming declaration uses rgb( around the token, so a token
      // left bare (unwrapped) would appear outside a rgb(...) call.
      const bare = /(?<!rgb\()var\(--messor-[a-z0-9-]+\)/g
      expect([...file.matchAll(bare)].length).toBe(0)
    }
  })

  it('the drawer header background is theme-aware and translucent over a semantic surface', () => {
    // The sticky header declaration must reference a messor surface channel
    // token, not a literal white.
    const header = drawerCss
      .split('}')
      .find(
        (block) =>
          block.includes('.issue-drawer__header') &&
          block.includes('position: sticky'),
      )
    expect(header).toBeDefined()
    expect(header).toMatch(/rgb\(var\(--messor-surface-2\)\s*\/\s*0?\.?94/i)
  })

  it('dark theme maps every consumed collaboration token to a dark channel value', () => {
    const darkBlock = indexCss
      .split('[data-theme=\'dark\']')[1] ?? ''
    const consumed = new Set<string>()
    for (const file of [commentsCss, drawerCss]) {
      for (const m of file.matchAll(/var\((--messor-[a-z0-9-]+)/g)) {
        consumed.add(m[1])
      }
    }
    for (const token of consumed) {
      const re = new RegExp(
        `${token.replace(/[-]/g, '\\-')}:\\s*([\\d\\s]+);`,
      )
      const match = re.exec(darkBlock)
      expect(
        match,
        `dark theme must define channel values for consumed token ${token}`,
      ).not.toBeNull()
      // The value is space-separated RGB channels (e.g. "21 21 19"), never a hex.
      expect(match![1].trim()).toMatch(/^\d+\s+\d+\s+\d+$/)
    }
  })
})
