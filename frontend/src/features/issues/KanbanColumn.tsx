import type { DragEvent, ReactElement } from 'react'
import { useRef, useState } from 'react'
import type { WorkflowStatus } from '../projects/types'
import { WIP_LIMIT, isOverburdened } from './boardOrder'
import { IssueCard, type MoveDirection } from './IssueCard'
import type { Issue } from './types'

interface KanbanColumnProps {
  status: WorkflowStatus
  issues: Issue[]
  workflowStatuses: WorkflowStatus[]
  selectedIssueKey: string | null
  canMove: boolean
  moveDisabled: boolean
  movePendingKey: string | null
  selectionDisabled: boolean
  /** WIP threshold; a column exceeding it renders the overburdened warning. */
  wipLimit?: number
  /** When provided (authorized user), an empty column offers an add action. */
  onCreate?: () => void
  /** The card currently grabbed by pointer drag or keyboard, or null. */
  grabbedKey: string | null
  /** The status code that is the current keyboard move target, or null. */
  kbTargetKey: string | null
  statusLabel: (code: string) => string
  assigneeLabel: (id: string | null) => string
  onSelect: (issueKey: string) => void
  onStatusChange: (issueKey: string, targetStatusCode: string) => boolean
  onGrab: (issueKey: string) => void
  onKbArrow: (direction: MoveDirection) => void
  onKbDrop: (issueKey: string) => void
  onKbCancel: () => void
  onDragStart: (issueKey: string) => void
  onDragEnd: () => void
  /** Drop a dragged card into this column at an insertion index. */
  onDropCard: (draggedKey: string, targetStatusCode: string, targetIndex: number) => void
}

export function KanbanColumn({
  status,
  issues,
  workflowStatuses,
  selectedIssueKey,
  canMove,
  moveDisabled,
  movePendingKey,
  selectionDisabled,
  wipLimit = WIP_LIMIT,
  onCreate,
  grabbedKey,
  kbTargetKey,
  statusLabel,
  assigneeLabel,
  onSelect,
  onStatusChange,
  onGrab,
  onKbArrow,
  onKbDrop,
  onKbCancel,
  onDragStart,
  onDragEnd,
  onDropCard,
}: KanbanColumnProps): ReactElement {
  const rootRef = useRef<HTMLElement>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const overburdened = isOverburdened(issues.length, wipLimit)
  const isKbTarget = kbTargetKey === status.code

  // The insertion index is counted over the destination cards excluding the
  // dragged card, so a same-status reorder maps to the effective list the
  // server also operates on after removing the moved issue.
  const computeDropIndex = (clientY: number): number => {
    const root = rootRef.current
    if (root === null) {
      return issues.length
    }
    const cards = Array.from(
      root.querySelectorAll<HTMLElement>('.kanban-card'),
    )
    let index = 0
    for (const card of cards) {
      if (grabbedKey !== null && card.dataset.issueKey === grabbedKey) {
        continue
      }
      const rect = card.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) {
        break
      }
      index++
    }
    return index
  }

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (grabbedKey === null) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropIndex(computeDropIndex(event.clientY))
  }

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setDropIndex(null)
    if (grabbedKey === null) {
      return
    }
    onDropCard(grabbedKey, status.code, computeDropIndex(event.clientY))
  }

  return (
    <section
      ref={rootRef}
      className={
        isKbTarget ? 'kanban-column kanban-column--target' : 'kanban-column'
      }
      aria-label={`${status.displayName} sütunu, ${issues.length} kart`}
      aria-busy={movePendingKey !== null ? true : undefined}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={() => setDropIndex(null)}
    >
      <h4 className="kanban-column__heading">
        {status.displayName}
        <span className="kanban-column__count" aria-hidden="true">
          {issues.length}
        </span>
      </h4>
      {overburdened && (
        <p className="kanban-column__wip" role="status">
          WIP sınırı aşıldı: {issues.length} kart (sınır {wipLimit}).
        </p>
      )}
      {issues.length === 0 ? (
        <div className="kanban-column__empty">
          <p className="kanban-column__empty-text">Kart yok</p>
          {onCreate !== undefined && (
            <button
              type="button"
              className="kanban-column__add"
              onClick={onCreate}
            >
              Kart ekle
            </button>
          )}
        </div>
      ) : (
        <ul className="kanban-column__cards">
          {issues.map((issue) => (
            <IssueCard
              key={issue.issueKey}
              issue={issue}
              statusLabel={statusLabel}
              assigneeLabel={assigneeLabel}
              selected={issue.issueKey === selectedIssueKey}
              selectionDisabled={selectionDisabled}
              canMove={canMove}
              moveDisabled={moveDisabled}
              movePendingKey={movePendingKey}
              grabbedKey={grabbedKey}
              workflowStatuses={workflowStatuses}
              onSelect={onSelect}
              onStatusChange={onStatusChange}
              onGrab={onGrab}
              onKbArrow={onKbArrow}
              onKbDrop={onKbDrop}
              onKbCancel={onKbCancel}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </ul>
      )}
      {dropIndex !== null && (
        <div className="kanban-column__drop-guide" aria-hidden="true" />
      )}
    </section>
  )
}
