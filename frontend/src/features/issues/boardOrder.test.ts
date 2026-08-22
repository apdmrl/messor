import { describe, expect, it } from 'vitest'
import type { Issue } from './types'
import {
  applyOptimisticMove,
  buildColumns,
  columnIssues,
  computeMove,
  normalizeWorkflowStatuses,
  resolveDragEnd,
  resolveDropIndex,
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

describe('computeMove', () => {
  it('inserts before a card cross-column', () => {
    const issues = [a, b, c, d]
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-1',
      targetStatusCode: 'IN_PROGRESS',
      targetIndex: 0,
    })
    expect(result).toEqual({
      kind: 'move',
      expectedVersion: a.version,
      targetIndex: 0,
      payload: { beforeIssueKey: 'MES-4', afterIssueKey: null },
    })
  })

  it('appends after the last card cross-column', () => {
    const issues = [a, b, c, d]
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-1',
      targetStatusCode: 'IN_PROGRESS',
      targetIndex: 1,
    })
    expect(result).toEqual({
      kind: 'move',
      expectedVersion: a.version,
      targetIndex: 1,
      payload: { beforeIssueKey: null, afterIssueKey: 'MES-4' },
    })
  })

  it('moves into an empty destination with both neighbors null', () => {
    const issues = [a, b, c]
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-1',
      targetStatusCode: 'DONE',
      targetIndex: 0,
    })
    expect(result).toEqual({
      kind: 'move',
      expectedVersion: a.version,
      targetIndex: 0,
      payload: { beforeIssueKey: null, afterIssueKey: null },
    })
  })

  it('moves to the first position of a non-empty destination', () => {
    const x = makeIssue({ issueKey: 'MES-5', number: 5, statusCode: 'DONE', rank: 1024 })
    const issues = [a, x]
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-1',
      targetStatusCode: 'DONE',
      targetIndex: 0,
    })
    expect(result).toEqual({
      kind: 'move',
      expectedVersion: a.version,
      targetIndex: 0,
      payload: { beforeIssueKey: 'MES-5', afterIssueKey: null },
    })
  })

  it('moves up within the same column (before a card)', () => {
    const issues = [a, b, c]
    // Move MES-3 before MES-1
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-3',
      targetStatusCode: 'TO_DO',
      targetIndex: 0,
    })
    expect(result).toEqual({
      kind: 'move',
      expectedVersion: c.version,
      targetIndex: 0,
      payload: { beforeIssueKey: 'MES-1', afterIssueKey: null },
    })
  })

  it('moves down within the same column (after a card)', () => {
    const issues = [a, b, c]
    // Move MES-1 to after MES-3
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-1',
      targetStatusCode: 'TO_DO',
      targetIndex: 2,
    })
    expect(result).toEqual({
      kind: 'move',
      expectedVersion: a.version,
      targetIndex: 2,
      payload: { beforeIssueKey: null, afterIssueKey: 'MES-3' },
    })
  })

  it('treats a single-card source and single-card destination correctly', () => {
    const issues = [a, d]
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-1',
      targetStatusCode: 'IN_PROGRESS',
      targetIndex: 0,
    })
    expect(result).toEqual({
      kind: 'move',
      expectedVersion: a.version,
      targetIndex: 0,
      payload: { beforeIssueKey: 'MES-4', afterIssueKey: null },
    })
  })

  it('never references the dragged issue as its own neighbor', () => {
    const issues = [a, b, c]
    // Move MES-3 to sit before MES-2; the dragged card is removed first so the
    // computed neighbor is MES-2, never MES-3 itself.
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-3',
      targetStatusCode: 'TO_DO',
      targetIndex: 1,
    })
    expect(result).toEqual({
      kind: 'move',
      expectedVersion: c.version,
      targetIndex: 1,
      payload: { beforeIssueKey: 'MES-2', afterIssueKey: null },
    })
    expect(result.kind === 'move' && result.payload).not.toContain('MES-3')
  })

  it('returns a no-op for a same-column drop that keeps the same order', () => {
    const issues = [a, b, c]
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-2',
      targetStatusCode: 'TO_DO',
      targetIndex: 1,
    })
    expect(result.kind).toBe('noop')
  })

  it('is an effective move when a same-column drop changes the order', () => {
    const issues = [a, b, c]
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-2',
      targetStatusCode: 'TO_DO',
      targetIndex: 2,
    })
    expect(result).toEqual({
      kind: 'move',
      expectedVersion: b.version,
      targetIndex: 2,
      payload: { beforeIssueKey: null, afterIssueKey: 'MES-3' },
    })
  })

  it('rejects an unknown target status (fails closed)', () => {
    const issues = [a, b, c]
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-1',
      targetStatusCode: 'NOT_REAL',
      targetIndex: 0,
    })
    expect(result.kind).toBe('invalid')
  })

  it('rejects a missing dragged issue (fails closed)', () => {
    const issues = [a, b, c]
    const result = computeMove({
      workflowStatuses: STATUSES,
      issues,
      draggedKey: 'MES-999',
      targetStatusCode: 'TO_DO',
      targetIndex: 0,
    })
    expect(result.kind).toBe('invalid')
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

describe('resolveDropIndex', () => {
  it('moves the first card over the last card downward (becomes last)', () => {
    const issues = [a, b, c]
    const index = resolveDropIndex({ issues, draggedKey: 'MES-1', overKey: 'MES-3' })
    expect(index).toBe(2)
  })

  it('moves the last card over the first card upward (becomes first)', () => {
    const issues = [a, b, c]
    const index = resolveDropIndex({ issues, draggedKey: 'MES-3', overKey: 'MES-1' })
    expect(index).toBe(0)
  })

  it('moves a middle card downward', () => {
    const issues = [a, b, c]
    const index = resolveDropIndex({ issues, draggedKey: 'MES-2', overKey: 'MES-3' })
    expect(index).toBe(2)
  })

  it('moves a middle card upward', () => {
    const issues = [a, b, c]
    const index = resolveDropIndex({ issues, draggedKey: 'MES-2', overKey: 'MES-1' })
    expect(index).toBe(0)
  })

  it('handles adjacent down (first over second)', () => {
    const issues = [a, b, c]
    const index = resolveDropIndex({ issues, draggedKey: 'MES-1', overKey: 'MES-2' })
    expect(index).toBe(1)
  })

  it('handles adjacent up (second over first)', () => {
    const issues = [a, b, c]
    const index = resolveDropIndex({ issues, draggedKey: 'MES-2', overKey: 'MES-1' })
    expect(index).toBe(0)
  })

  it('returns null for a drop on itself', () => {
    const issues = [a, b, c]
    const index = resolveDropIndex({ issues, draggedKey: 'MES-1', overKey: 'MES-1' })
    expect(index).toBeNull()
  })

  it('inserts before the over card for a cross-column drop', () => {
    const issues = [a, b, c, d]
    const index = resolveDropIndex({ issues, draggedKey: 'MES-1', overKey: 'MES-4' })
    expect(index).toBe(0)
  })
})

describe('resolveDragEnd', () => {
  it('first card dragged over last resolves to append after the last card', () => {
    const issues = [a, b, c]
    const result = resolveDragEnd({ issues, activeId: 'MES-1', overId: 'MES-3' })
    expect(result).toEqual({ targetStatusCode: 'TO_DO', targetIndex: 2 })
  })

  it('last card dragged over first resolves to the first position', () => {
    const issues = [a, b, c]
    const result = resolveDragEnd({ issues, activeId: 'MES-3', overId: 'MES-1' })
    expect(result).toEqual({ targetStatusCode: 'TO_DO', targetIndex: 0 })
  })

  it('resolves a cross-column drop over a card to that column', () => {
    const issues = [a, b, c, d]
    const result = resolveDragEnd({ issues, activeId: 'MES-1', overId: 'MES-4' })
    expect(result).toEqual({ targetStatusCode: 'IN_PROGRESS', targetIndex: 0 })
  })

  it('resolves an empty-column drop by appending with the column target', () => {
    const issues = [a, b, c]
    const result = resolveDragEnd({ issues, activeId: 'MES-1', overId: 'column-DONE' })
    expect(result).toEqual({
      targetStatusCode: 'DONE',
      targetIndex: Number.MAX_SAFE_INTEGER,
    })
  })

  it('returns null for a drop on itself so no API call is issued', () => {
    const issues = [a, b, c]
    const result = resolveDragEnd({ issues, activeId: 'MES-1', overId: 'MES-1' })
    expect(result).toBeNull()
  })

  it('ignores an unknown over id (fails closed)', () => {
    const issues = [a, b, c]
    const result = resolveDragEnd({ issues, activeId: 'MES-1', overId: 'NOT_REAL' })
    expect(result).toBeNull()
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
