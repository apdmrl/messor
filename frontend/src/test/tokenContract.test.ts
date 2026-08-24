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

  it('primary comment action keeps normal-text contrast in both themes', () => {
    // The primary comment action uses amber (signal-active) text on surface-1.
    // Both must be the approved channel tokens and the pairing must clear the
    // 4.5:1 WCAG normal-text threshold in light and dark themes.
    expect(commentsCss).toMatch(
      /\.comment-item__action--primary\s*\{[\s\S]*?background:\s*rgb\(var\(--messor-surface-1\)\)[\s\S]*?color:\s*rgb\(var\(--messor-signal-active\)\)/,
    )
    expect(commentsCss).toMatch(
      /\.comment-form__submit\s*\{[\s\S]*?background:\s*rgb\(var\(--messor-surface-1\)\)[\s\S]*?color:\s*rgb\(var\(--messor-signal-active\)\)/,
    )

    function channelLuminance(r: number, g: number, b: number): number {
      const lin = (c: number): number => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
    function contrastRatio(
      fg: [number, number, number],
      bg: [number, number, number],
    ): number {
      const l1 = channelLuminance(fg[0], fg[1], fg[2])
      const l2 = channelLuminance(bg[0], bg[1], bg[2])
      const hi = Math.max(l1, l2)
      const lo = Math.min(l1, l2)
      return (hi + 0.05) / (lo + 0.05)
    }
    function channelsOf(css: string, token: string): [number, number, number] {
      const re = new RegExp(
        `${token.replace(/[-]/g, '\\-')}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`,
      )
      const m = re.exec(css)
      if (m === null) {
        throw new Error(`missing channel values for ${token}`)
      }
      return [Number(m[1]), Number(m[2]), Number(m[3])]
    }

    const lightCss = indexCss.split("[data-theme='dark']")[0] ?? ''
    const darkCss = indexCss.split("[data-theme='dark']")[1] ?? ''

    for (const [label, themeCss] of [
      ['light', lightCss],
      ['dark', darkCss],
    ] as const) {
      const fg = channelsOf(themeCss, '--messor-signal-active')
      const bg = channelsOf(themeCss, '--messor-surface-1')
      expect(
        contrastRatio(fg, bg),
        `${label} primary-action contrast must meet WCAG normal-text (>= 4.5:1)`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})
