import type { ReactElement } from 'react'
import { useCallback, useState } from 'react'
import type { WorkflowStatus } from '../projects/types'
import {
  WIP_LIMIT,
  buildColumns,
  normalizeWorkflowStatuses,
} from './boardOrder'
import { KanbanColumn } from './KanbanColumn'
import type { MoveDirection } from './IssueCard'
import type { Issue } from './types'

interface ProjectBoardProps {
  workflowStatuses: WorkflowStatus[]
  issues: Issue[]
  selectedIssueKey: string | null
  /** True when the current user may change issue status (PROJECT_LEAD/MEMBER). */
  canMove: boolean
  /** True while any mutation is pending; disables every status trigger. */
  moveDisabled: boolean
  /** The issueKey currently being moved, or null; drives pending text/aria-busy. */
  movePendingKey: string | null
  selectionDisabled: boolean
  /** When true, archived issues are shown as read-only cards (never movable). */
  includeArchived: boolean
  /** WIP threshold for the per-column overburdened warning. */
  wipLimit?: number
  /** When provided (authorized user), empty columns offer an add action. */
  onCreate?: () => void
  statusLabel: (code: string) => string
  assigneeLabel: (id: string | null) => string
  onSelect: (issueKey: string) => void
  /** Move an issue; an omitted targetIndex appends to the destination. */
  onStatusChange: (issueKey: string, targetStatusCode: string, targetIndex?: number) => boolean
}

export function ProjectBoard({
  workflowStatuses,
  issues,
  selectedIssueKey,
  canMove,
  moveDisabled,
  movePendingKey,
  selectionDisabled,
  includeArchived,
  wipLimit = WIP_LIMIT,
  onCreate,
  statusLabel,
  assigneeLabel,
  onSelect,
  onStatusChange,
}: ProjectBoardProps): ReactElement {
  // One normalized, immutable status sequence drives column order and the
  // per-card status disclosure options.
  const normalizedStatuses = normalizeWorkflowStatuses(workflowStatuses)
  const columns = buildColumns(normalizedStatuses, issues, includeArchived)

  // The card currently grabbed by pointer drag or by keyboard Space.
  const [grabbedKey, setGrabbedKey] = useState<string | null>(null)
  // Keyboard move state: the grabbed key and the live insertion target.
  const [kbMove, setKbMove] = useState<{
    key: string
    statusCode: string
    index: number
  } | null>(null)

  const clearMove = useCallback((): void => {
    setGrabbedKey(null)
    setKbMove(null)
  }, [])

  const effectiveColumnLength = useCallback(
    (statusCode: string): number => {
      const column = columns.find((c) => c.statusCode === statusCode)
      if (column === undefined) {
        return 0
      }
      const draggedCard =
        grabbedKey !== null
          ? issues.find((i) => i.issueKey === grabbedKey)
          : undefined
      const sameStatus = draggedCard?.statusCode === statusCode
      return sameStatus ? Math.max(0, column.issues.length - 1) : column.issues.length
    },
    [columns, issues, grabbedKey],
  )

  const onGrab = useCallback(
    (issueKey: string): void => {
      if (moveDisabled) {
        return
      }
      const card = issues.find((i) => i.issueKey === issueKey)
      if (card === undefined) {
        return
      }
      const column = columns.find((c) => c.statusCode === card.statusCode)
      const position = column?.issues.findIndex((i) => i.issueKey === issueKey) ?? 0
      setGrabbedKey(issueKey)
      setKbMove({
        key: issueKey,
        statusCode: card.statusCode,
        index: Math.max(0, position),
      })
    },
    [issues, columns, moveDisabled],
  )

  const onKbArrow = useCallback(
    (direction: MoveDirection): void => {
      setKbMove((prev) => {
        if (prev === null) {
          return prev
        }
        const statusIndex = normalizedStatuses.findIndex(
          (s) => s.code === prev.statusCode,
        )
        let statusCode = prev.statusCode
        if (direction === 'left') {
          statusCode =
            normalizedStatuses[Math.max(0, statusIndex - 1)]?.code ?? prev.statusCode
        } else if (direction === 'right') {
          statusCode =
            normalizedStatuses[Math.min(normalizedStatuses.length - 1, statusIndex + 1)]
              ?.code ?? prev.statusCode
        }
        const length = effectiveColumnLength(statusCode)
        let index = prev.index
        if (direction === 'up') {
          index = Math.max(0, index - 1)
        } else if (direction === 'down') {
          index = Math.min(length, index + 1)
        } else {
          index = Math.min(index, length)
        }
        return { ...prev, statusCode, index }
      })
    },
    [normalizedStatuses, effectiveColumnLength],
  )

  const onKbDrop = useCallback(
    (issueKey: string): void => {
      if (kbMove === null) {
        return
      }
      onStatusChange(issueKey, kbMove.statusCode, kbMove.index)
      clearMove()
    },
    [kbMove, onStatusChange, clearMove],
  )

  const handleDragStart = useCallback((issueKey: string): void => {
    setGrabbedKey(issueKey)
    setKbMove(null)
  }, [])

  const handleDropCard = useCallback(
    (draggedKey: string, targetStatusCode: string, targetIndex: number): void => {
      onStatusChange(draggedKey, targetStatusCode, targetIndex)
      clearMove()
    },
    [onStatusChange, clearMove],
  )

  return (
    <div className="kanban-board" role="region" aria-label="Kanban panosu">
      {columns.map((column, index) => (
        <KanbanColumn
          key={column.statusCode}
          status={{ code: column.statusCode, displayName: column.displayName, position: index }}
          issues={column.issues}
          workflowStatuses={normalizedStatuses}
          selectedIssueKey={selectedIssueKey}
          canMove={canMove}
          moveDisabled={moveDisabled}
          movePendingKey={movePendingKey}
          selectionDisabled={selectionDisabled}
          wipLimit={wipLimit}
          onCreate={onCreate}
          grabbedKey={grabbedKey}
          kbTargetKey={kbMove?.statusCode ?? null}
          statusLabel={statusLabel}
          assigneeLabel={assigneeLabel}
          onSelect={onSelect}
          onStatusChange={onStatusChange}
          onGrab={onGrab}
          onKbArrow={onKbArrow}
          onKbDrop={onKbDrop}
          onKbCancel={clearMove}
          onDragStart={handleDragStart}
          onDragEnd={clearMove}
          onDropCard={handleDropCard}
        />
      ))}
    </div>
  )
}
