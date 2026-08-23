import { describe, expect, it } from 'vitest'
import type { Issue } from './types'
import {
  WIP_LIMIT,
  applyOptimisticMove,
  buildColumns,
  columnIssues,
  isOverburdened,
  normalizeWorkflowStatuses,
} from './boardOrder'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: '00000000-0000-0000-0000-00000000000' + (overrides.number ?? 1),
    issueKey: 'MES-1',
    projectKey: 'MES',
    number: 1,
    type: 'TASK',
    title: 'issue',
    description: null,
    statusCode: 'TO_DO',
    reporterId: 'u1',
    assigneeId: null,
    rank: 0,
    archived: false,
    version: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// One issue per column of the default workflow, with ranks 1024 apart.
const a = makeIssue({ issueKey: 'MES-1', number: 1, rank: 1024 })
const b = makeIssue({ issueKey: 'MES-2', number: 2, rank: 2048 })
const c = makeIssue({ issueKey: 'MES-3', number: 3, rank: 3072 })
const d = makeIssue({
  issueKey: 'MES-4',
  number: 4,
  statusCode: 'IN_PROGRESS',
  rank: 1024,
})

const STATUSES = [
  { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
  { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
  { code: 'DONE', displayName: 'Bitti', position: 2 },
]

describe('columnIssues', () => {
  it('filters archived issues out and sorts by rank then number then key', () => {
    const archived = makeIssue({
      issueKey: 'MES-9',
      number: 9,
      rank: 500,
      archived: true,
    })
    const result = columnIssues([c, a, archived, b], 'TO_DO')
    expect(result.map((i) => i.issueKey)).toEqual(['MES-1', 'MES-2', 'MES-3'])
  })

  it('uses issue number then issueKey as deterministic tie-breakers when ranks tie', () => {
    const x = makeIssue({ issueKey: 'MES-5', number: 5, rank: 2048 })
    const y = makeIssue({ issueKey: 'MES-6', number: 6, rank: 2048 })
    const result = columnIssues([y, x], 'TO_DO')
    expect(result.map((i) => i.issueKey)).toEqual(['MES-5', 'MES-6'])
  })

  it('does not order columns alphabetically nor trust issue-provided labels', () => {
    const hostile = makeIssue({ statusCode: 'ZZZ', issueKey: 'MES-7' })
    const cols = buildColumns(STATUSES, [hostile, a, d])
    expect(cols.map((c) => c.statusCode)).toEqual(['TO_DO', 'IN_PROGRESS', 'DONE'])
  })
})

describe('buildColumns', () => {
  it('groups issues under their server workflow status positions', () => {
    const cols = buildColumns(STATUSES, [a, b, c, d])
    expect(cols.map((c) => c.statusCode)).toEqual(['TO_DO', 'IN_PROGRESS', 'DONE'])
    expect(cols[0].issues.map((i) => i.issueKey)).toEqual(['MES-1', 'MES-2', 'MES-3'])
    expect(cols[1].issues.map((i) => i.issueKey)).toEqual(['MES-4'])
    expect(cols[2].issues).toEqual([])
  })

  it('unknown statuses never produce an attacker-controlled column', () => {
    const hostile = makeIssue({ statusCode: '<script>evil</script>', issueKey: 'MES-7' })
    const cols = buildColumns(STATUSES, [a, hostile])
    expect(cols).toHaveLength(3)
    expect(cols.flatMap((c) => c.issues.map((i) => i.issueKey))).toEqual([
      'MES-1',
    ])
  })
})

describe('normalizeWorkflowStatuses', () => {
  it('sorts by position then by code as a deterministic tie-break', () => {
    const result = normalizeWorkflowStatuses([
      { code: 'DONE', displayName: 'Bitti', position: 2 },
      { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
      { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
    ])
    expect(result.map((s) => s.code)).toEqual(['TO_DO', 'IN_PROGRESS', 'DONE'])
  })

  it('returns a new immutable array and never mutates the input', () => {
    const input = [
      { code: 'DONE', displayName: 'Bitti', position: 2 },
      { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
      { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
    ]
    const snapshot = input.map((s) => s.code)
    const result = normalizeWorkflowStatuses(input)
    expect(result).not.toBe(input)
    expect(input.map((s) => s.code)).toEqual(snapshot)
  })
})

describe('applyOptimisticMove', () => {
  it('moves a card across columns with updated status and interleaved rank', () => {
    const issues = [a, b, c, d]
    const moved = applyOptimisticMove(issues, {
      draggedKey: 'MES-1',
      targetStatusCode: 'IN_PROGRESS',
      targetIndex: 1,
    })
    const dest = moved.filter((i) => i.statusCode === 'IN_PROGRESS')
    expect(dest.map((i) => i.issueKey)).toEqual(['MES-4', 'MES-1'])
    const updated = moved.find((i) => i.issueKey === 'MES-1')!
    expect(updated.statusCode).toBe('IN_PROGRESS')
    expect(updated.version).toBe(a.version)
    // source column no longer contains it
    expect(moved.filter((i) => i.statusCode === 'TO_DO').map((i) => i.issueKey)).toEqual([
      'MES-2',
      'MES-3',
    ])
  })

  it('appends to the end of the destination with an out-of-range index', () => {
    const issues = [a, b, c, d]
    const moved = applyOptimisticMove(issues, {
      draggedKey: 'MES-1',
      targetStatusCode: 'IN_PROGRESS',
      targetIndex: Number.MAX_SAFE_INTEGER,
    })
    const dest = moved.filter((i) => i.statusCode === 'IN_PROGRESS')
    expect(dest.map((i) => i.issueKey)).toEqual(['MES-4', 'MES-1'])
  })

  it('does not fabricate a server version', () => {
    const issues = [a, b, c, d]
    const moved = applyOptimisticMove(issues, {
      draggedKey: 'MES-1',
      targetStatusCode: 'DONE',
      targetIndex: 0,
    })
    expect(moved.find((i) => i.issueKey === 'MES-1')!.version).toBe(a.version)
  })
})
describe('isOverburdened', () => {
  it('flags a column once its count exceeds the WIP limit', () => {
    expect(isOverburdened(0)).toBe(false)
    expect(isOverburdened(WIP_LIMIT)).toBe(false)
    expect(isOverburdened(WIP_LIMIT + 1)).toBe(true)
  })

  it('honors a custom limit', () => {
    expect(isOverburdened(3, 3)).toBe(false)
    expect(isOverburdened(4, 3)).toBe(true)
  })
})
