import { describe, expect, it } from 'vitest'
import { initialRailCollapsed } from './AuthenticatedShell'

describe('initialRailCollapsed', () => {
  it('collapses the rail on compact viewports', () => {
    expect(initialRailCollapsed(true)).toBe(true)
    expect(initialRailCollapsed(false)).toBe(false)
  })
})
