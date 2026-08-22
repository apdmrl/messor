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
  return normalizeWorkflowStatuses(workflowStatuses).map((status) => ({
    statusCode: status.code,
    displayName: status.displayName,
    issues: columnIssues(issues, status.code),
  }))
}

export interface DropIndexParams {
  issues: Issue[]
  draggedKey: string
  overKey: string
}

/**
 * Resolve the insertion index (in the reduced destination column, after the
 * active card is removed) for a drop of {@code draggedKey} over {@code overKey}.
 * Returns {@code null} for a true no-op (dropping a card on itself) so the
 * caller never reaches the API.
 *
 * Direction rule:
 * - Cross-column: always insert before the over card (a tested, explicit rule).
 * - Same-column downward (dragged originally above the over card): insert after
 *   the over card, compensating for the active card's own removal.
 * - Same-column upward (dragged originally below the over card): insert before
 *   the over card.
 */
export function resolveDropIndex(params: DropIndexParams): number | null {
  const { issues, draggedKey, overKey } = params
  if (draggedKey === overKey) {
    return null
  }
  const dragged = issues.find((issue) => issue.issueKey === draggedKey)
  const over = issues.find((issue) => issue.issueKey === overKey)
  if (dragged === undefined || over === undefined) {
    return null
  }

  const source = columnIssues(issues, dragged.statusCode)
  const destination = columnIssues(issues, over.statusCode).filter(
    (issue) => issue.issueKey !== draggedKey,
  )
  const overIndexInDestination = destination.findIndex(
    (issue) => issue.issueKey === overKey,
  )
  if (overIndexInDestination === -1) {
    return null
  }

  if (dragged.statusCode !== over.statusCode) {
    return overIndexInDestination
  }

  const sourceIndex = source.findIndex((issue) => issue.issueKey === draggedKey)
  const overSourceIndex = source.findIndex((issue) => issue.issueKey === overKey)
  if (sourceIndex === -1 || overSourceIndex === -1) {
    return null
  }

  if (sourceIndex < overSourceIndex) {
    return overIndexInDestination + 1
  }
  return overIndexInDestination
}

export interface DragEndResolution {
  targetStatusCode: string
  targetIndex: number
}

/**
 * Normalize a dnd-kit drag-end event (active/over ids) into the target status
 * and insertion index that {@link computeMove} consumes. This is the pointer
 * drag-end path: a card over id targets that card's column, and a column id
 * targets the empty/whitespace append. Returns {@code null} to signal a true
 * no-op or an unknown target so no API call is issued.
 */
export function resolveDragEnd(params: {
  issues: Issue[]
  activeId: string
  overId: string
}): DragEndResolution | null {
  const { issues, activeId, overId } = params
  if (overId.startsWith('column-')) {
    return {
      targetStatusCode: overId.slice('column-'.length),
      targetIndex: Number.MAX_SAFE_INTEGER,
    }
  }
  const over = issues.find((issue) => issue.issueKey === overId)
  if (over === undefined) {
    return null
  }
  const index = resolveDropIndex({ issues, draggedKey: activeId, overKey: overId })
  if (index === null) {
    return null
  }
  return { targetStatusCode: over.statusCode, targetIndex: index }
}

export type DragEndAnnouncement = 'moved' | 'unchanged'

/**
 * Client-owned Turkish announcement text for a drag end. {@code 'moved'} is
 * used only when a valid move was actually accepted for mutation; every other
 * outcome (self-drop, invalid/unknown target, no-op, lock-rejected) uses the
 * neutral fixed string. Never interpolates raw status or hostile server text.
 */
export function dragEndAnnouncement(
  activeId: string,
  outcome: DragEndAnnouncement,
): string {
  return outcome === 'moved'
    ? `Kart ${activeId} yeni konumuna taşındı.`
    : 'Kartın konumu değişmedi.'
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
