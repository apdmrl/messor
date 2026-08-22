import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  canonicalQueryString,
  parseFilters,
  serializeFilters,
} from './issueFilters'
import type { IssueFilterState } from './issueFilters'

describe('issueFilters parse/normalize/serialize', () => {
  it('round-trips a full filter set deterministically', () => {
    const state: IssueFilterState = {
      project: 'ALPHA',
      type: 'BUG',
      status: 'IN_PROGRESS',
      assignee: 'user-1',
      archive: 'archived',
      sort: { field: 'title', direction: 'desc' },
      page: 3,
      size: 50,
    }
    const serialized = serializeFilters(state)
    const parsed = parseFilters(serialized)
    expect(parsed).toEqual(state)
  })

  it('omits all defaults from the canonical URL', () => {
    expect(canonicalQueryString(DEFAULT_FILTERS)).toBe('')
    const params = serializeFilters(DEFAULT_FILTERS)
    expect([...params.entries()]).toHaveLength(0)
  })

  it('serializes parameters in a deterministic order', () => {
    const state: IssueFilterState = {
      project: 'ALPHA',
      type: null,
      status: null,
      assignee: null,
      archive: 'active',
      sort: { field: 'number', direction: 'asc' },
      page: 0,
      size: 20,
    }
    expect(canonicalQueryString(state)).toBe('?project=ALPHA')
  })

  it('emits only non-default archive and sort values', () => {
    const archived = parseFilters(new URLSearchParams('archive=archived'))
    expect(archived.archive).toBe('archived')
    expect(canonicalQueryString(archived)).toBe('?archive=archived')

    const sorted = parseFilters(new URLSearchParams('sort=title,desc'))
    expect(sorted.sort).toEqual({ field: 'title', direction: 'desc' })
    expect(canonicalQueryString(sorted)).toBe('?sort=title%2Cdesc')
  })

  it('normalizes hostile and unknown values to safe defaults', () => {
    const hostile = parseFilters(
      new URLSearchParams(
        'sort=passwordHash;select&type=EPIC&archive=everything&page=-5&size=9999',
      ),
    )
    expect(hostile.sort).toEqual(DEFAULT_FILTERS.sort)
    expect(hostile.type).toBeNull()
    expect(hostile.archive).toBe('active')
    expect(hostile.page).toBe(0)
    expect(hostile.size).toBe(20)
  })

  it('preserves a controlled unknown status value (never nulls nor forwards to sort)', () => {
    // A status code is project-specific; an unknown value is preserved so the
    // backend can return an empty result, but it is never used as a sort field.
    const hostile = parseFilters(new URLSearchParams('status=NOPE&sort=status,asc'))
    expect(hostile.status).toBe('NOPE')
    expect(hostile.sort).toEqual(DEFAULT_FILTERS.sort)
  })

  it('bounds page and size to the allowlisted ranges', () => {
    expect(parseFilters(new URLSearchParams('page=0&size=1')).page).toBe(0)
    expect(parseFilters(new URLSearchParams('page=0&size=1')).size).toBe(1)
    expect(parseFilters(new URLSearchParams('page=10000&size=100')).page).toBe(10000)
    expect(parseFilters(new URLSearchParams('page=10000&size=100')).size).toBe(100)
    expect(parseFilters(new URLSearchParams('page=10001')).page).toBe(0)
    expect(parseFilters(new URLSearchParams('size=101')).size).toBe(20)
    expect(parseFilters(new URLSearchParams('page=abc')).page).toBe(0)
    expect(parseFilters(new URLSearchParams('size=abc')).size).toBe(20)
  })

  it('normalizes a valid type and known archive', () => {
    const state = parseFilters(new URLSearchParams('type=TASK&archive=all'))
    expect(state.type).toBe('TASK')
    expect(state.archive).toBe('all')
  })

  it('round-trips the default archive=active to no archive param', () => {
    const parsed = parseFilters(new URLSearchParams('archive=active'))
    expect(parsed.archive).toBe('active')
    expect(canonicalQueryString(parsed)).toBe('')
  })
})
