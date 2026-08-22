import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  MY_WORK_FILTER_CONTEXT,
  PROJECT_FILTER_CONTEXT,
  canonicalQueryString,
  parseFilters,
  serializeFilters,
} from './issueFilters'
import type { IssueFilterContext, IssueFilterState } from './issueFilters'

const PROJ = PROJECT_FILTER_CONTEXT
const MY = MY_WORK_FILTER_CONTEXT

describe('issueFilters parse/normalize/serialize', () => {
  it('round-trips a full project-workspace filter set deterministically', () => {
    const state: IssueFilterState = {
      project: null,
      type: 'BUG',
      status: 'IN_PROGRESS',
      assignee: 'user-1',
      archive: 'archived',
      sort: { field: 'title', direction: 'desc' },
      page: 3,
      size: 50,
    }
    const parsed = parseFilters(serializeFilters(state, PROJ), PROJ)
    expect(parsed).toEqual(state)
  })

  it('round-trips a My Work filter set (project kept, assignee never)', () => {
    const state: IssueFilterState = {
      project: 'ALPHA',
      type: 'TASK',
      status: 'TO_DO',
      assignee: 'user-9',
      archive: 'all',
      sort: { field: 'updatedAt', direction: 'asc' },
      page: 1,
      size: 40,
    }
    const parsed = parseFilters(serializeFilters(state, MY), MY)
    expect(parsed).toEqual({
      ...state,
      assignee: null,
    })
  })

  it('omits all defaults from the canonical URL per context', () => {
    const projDefaults: IssueFilterState = { ...DEFAULT_FILTERS, size: PROJ.defaultSize }
    expect(canonicalQueryString(projDefaults, PROJ)).toBe('')
    expect([...serializeFilters(projDefaults, PROJ).entries()]).toHaveLength(0)

    const myDefaults: IssueFilterState = { ...DEFAULT_FILTERS, size: MY.defaultSize }
    expect(canonicalQueryString(myDefaults, MY)).toBe('')
    expect([...serializeFilters(myDefaults, MY).entries()]).toHaveLength(0)
  })

  it('serializes parameters in a deterministic order', () => {
    const state: IssueFilterState = { ...DEFAULT_FILTERS, project: 'ALPHA' }
    expect(canonicalQueryString(state, MY)).toBe('?project=ALPHA')
  })

  it('emits only non-default archive and sort values', () => {
    const archived = parseFilters(new URLSearchParams('archive=archived'), PROJ)
    expect(archived.archive).toBe('archived')
    expect(canonicalQueryString(archived, PROJ)).toBe('?archive=archived')

    const sorted = parseFilters(new URLSearchParams('sort=title,desc'), PROJ)
    expect(sorted.sort).toEqual({ field: 'title', direction: 'desc' })
    expect(canonicalQueryString(sorted, PROJ)).toBe('?sort=title%2Cdesc')
  })

  it('normalizes hostile and unknown values to safe defaults', () => {
    const hostile = parseFilters(
      new URLSearchParams(
        'sort=passwordHash;select&type=EPIC&archive=everything&page=-5&size=9999',
      ),
      PROJ,
    )
    expect(hostile.sort).toEqual(DEFAULT_FILTERS.sort)
    expect(hostile.type).toBeNull()
    expect(hostile.archive).toBe('active')
    expect(hostile.page).toBe(0)
    expect(hostile.size).toBe(PROJ.defaultSize)
  })

  it('preserves a controlled unknown status value', () => {
    const hostile = parseFilters(new URLSearchParams('status=NOPE&sort=status,asc'), PROJ)
    expect(hostile.status).toBe('NOPE')
    expect(hostile.sort).toEqual(DEFAULT_FILTERS.sort)
  })

  it('bounds page and size to the allowlisted ranges', () => {
    expect(parseFilters(new URLSearchParams('page=0&size=1'), PROJ).size).toBe(1)
    expect(parseFilters(new URLSearchParams('page=10000&size=100'), PROJ).size).toBe(100)
    expect(parseFilters(new URLSearchParams('page=10001'), PROJ).page).toBe(0)
    expect(parseFilters(new URLSearchParams('size=101'), PROJ).size).toBe(PROJ.defaultSize)
  })

  it('normalizes a valid type and known archive', () => {
    const state = parseFilters(new URLSearchParams('type=TASK&archive=all'), PROJ)
    expect(state.type).toBe('TASK')
    expect(state.archive).toBe('all')
  })

  it('round-trips the default archive=active to no archive param', () => {
    const parsed = parseFilters(new URLSearchParams('archive=active'), PROJ)
    expect(parsed.archive).toBe('active')
    expect(canonicalQueryString(parsed, PROJ)).toBe('')
  })

  it('applies the project-workspace default size of 100 and never emits it', () => {
    const parsed = parseFilters(new URLSearchParams(''), PROJ)
    expect(parsed.size).toBe(100)
    expect(canonicalQueryString(parsed, PROJ)).toBe('')
    const withSize = parseFilters(new URLSearchParams('size=100'), PROJ)
    expect(canonicalQueryString(withSize, PROJ)).toBe('')
  })

  it('applies the My Work default size of 20 and never emits it', () => {
    const parsed = parseFilters(new URLSearchParams(''), MY)
    expect(parsed.size).toBe(20)
    expect(canonicalQueryString(parsed, MY)).toBe('')
  })

  // ------------------------------------------------------------------
  // Strict numeric parsing
  // ------------------------------------------------------------------

  it('rejects partial numeric values that parseInt would accept', () => {
    const contexts: IssueFilterContext[] = [PROJ, MY]
    for (const ctx of contexts) {
      for (const bad of ['1junk', '1.5', '+1', ' 1', '1 ', '1e3']) {
        const page = parseFilters(new URLSearchParams(`page=${encodeURIComponent(bad)}`), ctx)
        expect(page.page, `page=${bad}`).toBe(0)
        const size = parseFilters(new URLSearchParams(`size=${encodeURIComponent(bad)}`), ctx)
        expect(size.size, `size=${bad}`).toBe(ctx.defaultSize)
      }
      // A valid full decimal integer is accepted within range.
      expect(parseFilters(new URLSearchParams('page=7'), ctx).page).toBe(7)
      expect(parseFilters(new URLSearchParams('size=42'), ctx).size).toBe(42)
    }
  })

  it('requires sort to be exactly two comma segments', () => {
    for (const bad of ['number,asc,evil', 'number', 'number,', ',asc', 'number,,asc']) {
      const parsed = parseFilters(new URLSearchParams(`sort=${encodeURIComponent(bad)}`), PROJ)
      expect(parsed.sort, `sort=${bad}`).toEqual(DEFAULT_FILTERS.sort)
    }
  })

  it('collapses repeated singleton parameters to the default', () => {
    const repeated = new URLSearchParams()
    repeated.append('type', 'TASK')
    repeated.append('type', 'BUG')
    repeated.append('sort', 'number,asc')
    repeated.append('sort', 'title,desc')
    repeated.append('page', '1')
    repeated.append('page', '2')
    const parsed = parseFilters(repeated, PROJ)
    expect(parsed.type).toBeNull()
    expect(parsed.sort).toEqual(DEFAULT_FILTERS.sort)
    expect(parsed.page).toBe(0)
  })

  it('normalizes empty project/status/assignee to null', () => {
    const parsed = parseFilters(
      new URLSearchParams('project=&status=&assignee='),
      PROJ,
    )
    expect(parsed.project).toBeNull()
    expect(parsed.status).toBeNull()
    expect(parsed.assignee).toBeNull()
  })

  it('canonical URL clears unsupported and hostile parameters', () => {
    const parsed = parseFilters(
      new URLSearchParams('archive=active&sort=number,asc&evil=1&x=<script>'),
      PROJ,
    )
    const canonical = canonicalQueryString(parsed, PROJ)
    expect(canonical).toBe('')
    expect(canonical).not.toContain('evil')
    expect(canonical).not.toContain('<script>')
  })

  // ------------------------------------------------------------------
  // Context separation
  // ------------------------------------------------------------------

  it('My Work drops assignee and never emits it', () => {
    const hostile = parseFilters(new URLSearchParams('assignee=user-9'), MY)
    expect(hostile.assignee).toBeNull()
    expect(canonicalQueryString(hostile, MY)).toBe('')

    const withAssignee = { ...DEFAULT_FILTERS, assignee: 'user-1' }
    expect(canonicalQueryString(withAssignee, MY)).toBe('')
    expect(serializeFilters(withAssignee, MY).has('assignee')).toBe(false)
  })

  it('project workspace keeps assignee', () => {
    const hostile = parseFilters(new URLSearchParams('assignee=user-1'), PROJ)
    expect(hostile.assignee).toBe('user-1')
    expect(canonicalQueryString(hostile, PROJ)).toBe('?assignee=user-1')
  })

  it('project workspace drops the project parameter (route-based)', () => {
    const parsed = parseFilters(new URLSearchParams('project=ALPHA'), PROJ)
    expect(parsed.project).toBeNull()
    expect(canonicalQueryString(parsed, PROJ)).toBe('')
  })

  it('My Work keeps the project parameter', () => {
    const parsed = parseFilters(new URLSearchParams('project=ALPHA'), MY)
    expect(parsed.project).toBe('ALPHA')
    expect(canonicalQueryString(parsed, MY)).toBe('?project=ALPHA')
  })
})
