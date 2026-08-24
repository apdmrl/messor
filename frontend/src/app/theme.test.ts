import { describe, expect, it } from 'vitest'
import { initialAppTheme } from './theme'

describe('initialAppTheme', () => {
  it('uses the light product theme regardless of OS dark preference', () => {
    expect(initialAppTheme(true)).toBe('light')
    expect(initialAppTheme(false)).toBe('light')
  })
})
