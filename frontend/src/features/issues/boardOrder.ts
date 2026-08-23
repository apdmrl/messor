import type { Issue } from './types'
import type { WorkflowStatus } from '../projects/types'

/**
 * Pure, deterministic board-ordering helpers. These functions own the rules for
 * grouping issues into server-ordered workflow columns, ordering cards, and
 * deriving an optimistic move result plus the server insertion neighbors from a
 * target insertion index. It is deliberately free of React, network, and query
 * state so it can be unit tested in isolation.
 */

export interface BoardColumn {
  statusCode: string
  displayName: string
  issues: Issue[]
}

/**
 * Default WIP (work-in-progress) threshold used for the client-side column
 * overload warning. This is a presentational guard only: the backend has no WIP
 * limit contract, so the board never blocks movement based on it. A column whose
 * card count exceeds the limit is flagged {@code overburdened}.
 */
export const WIP_LIMIT = 5

/** True when a column holds more cards than the given (default) WIP limit. */
export function isOverburdened(count: number, limit = WIP_LIMIT): boolean {
  return count > limit
}

/**
 * The single normalized workflow-status sequence used everywhere the board
 * derives column order or movement controls. Immutable: sorts by server
 * {@code position}, then by {@code code} as a deterministic tie-break. Never
 * mutates the input and never trusts the client-provided array order.
 */
export function normalizeWorkflowStatuses(
  workflowStatuses: WorkflowStatus[],
): WorkflowStatus[] {
  return workflowStatuses
    .slice()
    .sort(
      (a, b) =>
        a.position - b.position || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    )
}

/**
 * Order cards within a column using server rank ascending, then issue number
 * ascending, then issueKey as a final deterministic tie-breaker. Archived
 * issues are excluded by default; pass {@code includeArchived} only for
 * read-only display when the archive filter includes archived issues. Workflow
 * position (not alphabetical status) is the column order; status display labels
 * come only from {@code workflowStatuses}.
 */
export function columnIssues(
  issues: Issue[],
  statusCode: string,
  includeArchived = false,
): Issue[] {
  return issues
    .filter(
      (issue) =>
        (includeArchived || !issue.archived) && issue.statusCode === statusCode,
    )
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
  includeArchived = false,
): BoardColumn[] {
  return normalizeWorkflowStatuses(workflowStatuses).map((status) => ({
    statusCode: status.code,
    displayName: status.displayName,
    issues: columnIssues(issues, status.code, includeArchived),
  }))
}

/**
 * Return a new issue array reflecting an optimistic status-only move: the moved
 * issue's status is updated and it is inserted into the destination column at
 * {@code targetIndex} with an interleaved rank. The server version is never
 * fabricated (it stays at the last known server value). A {@code targetIndex}
 * beyond the destination length clamps to the end, which is the status-change
 * append path.
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

/**
 * Map a target insertion index in the destination column to the before/after
 * neighbor keys the server expects. The destination is computed with the moved
 * issue excluded (mirroring {@link applyOptimisticMove}), so the keys reference
 * the list the backend also operates on after removing a same-status move.
 *
 * <p>Exactly one neighbor is emitted to satisfy the move request's mutual
 * exclusion: the next card is preferred (insert before it); only when appending
 * at the end does it fall back to the previous card (insert after it).</p>
 */
export function moveNeighbors(
  issues: Issue[],
  params: { draggedKey: string; targetStatusCode: string; targetIndex: number },
): { beforeIssueKey: string | null; afterIssueKey: string | null } {
  const { draggedKey, targetStatusCode, targetIndex } = params
  const others = issues.filter((issue) => issue.issueKey !== draggedKey)
  const destination = columnIssues(others, targetStatusCode)
  const position = clampIndex(targetIndex, destination.length)
  const beforeIssueKey =
    position < destination.length ? destination[position].issueKey : null
  const afterIssueKey =
    beforeIssueKey === null && position > 0
      ? destination[position - 1].issueKey
      : null
  return { beforeIssueKey, afterIssueKey }
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

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length))
}
