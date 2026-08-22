import type { Issue } from './types'
import type { WorkflowStatus } from '../projects/types'

/**
 * Pure, deterministic board-ordering helpers. These functions own the rules for
 * grouping issues into server-ordered workflow columns, ordering cards, and
 * computing the exact {@link MoveIssueInput} neighbor payload for a move. They
 * are deliberately free of React, network, and query state so they can be unit
 * tested in isolation and reused by both the drag path and the accessible
 * movement-menu path without duplicating business logic.
 */

export interface BoardColumn {
  statusCode: string
  displayName: string
  issues: Issue[]
}

/**
 * Order cards within a column using server rank ascending, then issue number
 * ascending, then issueKey as a final deterministic tie-breaker. Archived
 * issues never appear. Workflow position (not alphabetical status) is the
 * column order; status display labels come only from {@code workflowStatuses}.
 */
export function columnIssues(issues: Issue[], statusCode: string): Issue[] {
  return issues
    .filter((issue) => !issue.archived && issue.statusCode === statusCode)
    .slice()
    .sort(compareIssues)
}

function compareIssues(a: Issue, b: Issue): number {
  if (a.rank !== b.rank) {
    return a.rank - b.rank
  }
  if (a.number !== b.number) {
    return a.number - b.number
  }
  if (a.issueKey < b.issueKey) {
    return -1
  }
  if (a.issueKey > b.issueKey) {
    return 1
  }
  return 0
}

/**
 * Build columns in server {@code workflowStatuses.position} order. Issues whose
 * status is unknown are dropped (never surfaced as an attacker-controlled
 * column or label). Cards within each column are ordered by {@link columnIssues}.
 */
export function buildColumns(
  workflowStatuses: WorkflowStatus[],
  issues: Issue[],
): BoardColumn[] {
  return workflowStatuses
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((status) => ({
      statusCode: status.code,
      displayName: status.displayName,
      issues: columnIssues(issues, status.code),
    }))
}

export interface MoveComputation {
  /** Server-ordered workflow statuses used to validate the target status. */
  workflowStatuses: WorkflowStatus[]
  issues: Issue[]
  draggedKey: string
  targetStatusCode: string
  /** Intended index of the dragged card in the destination column (after removal). */
  targetIndex: number
}

export type ComputeMoveResult =
  | { kind: 'invalid' }
  | { kind: 'noop' }
  | {
      kind: 'move'
      targetIndex: number
      expectedVersion: number
      payload: MoveNeighborPayload
    }

export interface MoveNeighborPayload {
  beforeIssueKey: string | null
  afterIssueKey: string | null
}

/**
 * Compute the exact neighbor payload for a move, following the board-ordering
 * contract. Unknown target statuses and a missing dragged issue fail closed
 * ({@code invalid}). A same-column drop that leaves the effective order
 * unchanged is a {@code noop} and must not reach the API.
 */
export function computeMove(params: MoveComputation): ComputeMoveResult {
  const { workflowStatuses, issues, draggedKey, targetStatusCode, targetIndex } = params

  const dragged = issues.find((issue) => issue.issueKey === draggedKey)
  if (dragged === undefined) {
    return { kind: 'invalid' }
  }

  const validStatuses = new Set(workflowStatuses.map((status) => status.code))
  if (!validStatuses.has(targetStatusCode)) {
    return { kind: 'invalid' }
  }

  // Destination column after removing the moving issue.
  const destination = columnIssues(issues, targetStatusCode).filter(
    (issue) => issue.issueKey !== draggedKey,
  )
  const position = clampIndex(targetIndex, destination.length)

  // A same-column drop that keeps the current order is a true no-op.
  if (targetStatusCode === dragged.statusCode) {
    const current = columnIssues(issues, dragged.statusCode).map((i) => i.issueKey)
    const next = reorderedKeys(destination, dragged, position)
    if (sameKeys(current, next)) {
      return { kind: 'noop' }
    }
  }

  const payload =
    destination.length === 0
      ? { beforeIssueKey: null, afterIssueKey: null }
      : position >= destination.length
        ? { beforeIssueKey: null, afterIssueKey: destination[destination.length - 1].issueKey }
        : { beforeIssueKey: destination[position].issueKey, afterIssueKey: null }

  return {
    kind: 'move',
    targetIndex: position,
    expectedVersion: dragged.version,
    payload,
  }
}

/**
 * Return a new issue array reflecting an optimistic move: the dragged issue's
 * status is updated and it is inserted at {@code targetIndex} in the
 * destination column with an interleaved rank. The server version is never
 * fabricated (it stays at the last known server value).
 */
export function applyOptimisticMove(
  issues: Issue[],
  params: { draggedKey: string; targetStatusCode: string; targetIndex: number },
): Issue[] {
  const { draggedKey, targetStatusCode, targetIndex } = params
  const dragged = issues.find((issue) => issue.issueKey === draggedKey)
  if (dragged === undefined) {
    return issues
  }

  const others = issues.filter((issue) => issue.issueKey !== draggedKey)
  const destination = columnIssues(others, targetStatusCode)
  const position = clampIndex(targetIndex, destination.length)

  const prevRank = position > 0 ? destination[position - 1].rank : -Infinity
  const nextRank = position < destination.length ? destination[position].rank : Infinity
  const optimisticRank = interleaveRank(prevRank, nextRank)

  const updated: Issue = {
    ...dragged,
    statusCode: targetStatusCode,
    rank: optimisticRank,
    version: dragged.version,
  }

  return others.concat(updated)
}

function interleaveRank(prevRank: number, nextRank: number): number {
  if (Number.isFinite(prevRank) && Number.isFinite(nextRank)) {
    return Math.floor((prevRank + nextRank) / 2)
  }
  if (Number.isFinite(nextRank)) {
    return nextRank - 1
  }
  if (Number.isFinite(prevRank)) {
    return prevRank + 1
  }
  return 0
}

function reorderedKeys(
  destination: Issue[],
  dragged: Issue,
  position: number,
): string[] {
  const keys = destination.map((issue) => issue.issueKey)
  keys.splice(position, 0, dragged.issueKey)
  return keys
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length))
}
