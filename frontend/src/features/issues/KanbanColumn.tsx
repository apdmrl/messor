import type { ReactElement } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { WorkflowStatus } from '../projects/types'
import { IssueCard } from './IssueCard'
import type { Issue } from './types'

interface KanbanColumnProps {
  status: WorkflowStatus
  issues: Issue[]
  workflowStatuses: WorkflowStatus[]
  columnIndex: number
  totalColumns: number
  selectedIssueKey: string | null
  canMove: boolean
  moveDisabled: boolean
  selectionDisabled: boolean
  statusLabel: (code: string) => string
  assigneeLabel: (id: string | null) => string
  onSelect: (issueKey: string) => void
  onMove: (issueKey: string, targetStatusCode: string, targetIndex: number) => void
}

export function KanbanColumn({
  status,
  issues,
  workflowStatuses,
  columnIndex,
  totalColumns,
  selectedIssueKey,
  canMove,
  moveDisabled,
  selectionDisabled,
  statusLabel,
  assigneeLabel,
  onSelect,
  onMove,
}: KanbanColumnProps): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${status.code}` })

  return (
    <section
      className="kanban-column"
      ref={setNodeRef}
      aria-label={`${status.displayName} sütunu, ${issues.length} kart`}
      data-over={isOver ? 'true' : 'false'}
    >
      <h4 className="kanban-column__heading">
        {status.displayName}
        <span className="kanban-column__count" aria-hidden="true">
          {issues.length}
        </span>
      </h4>
      {issues.length === 0 ? (
        <p className="kanban-column__empty">Kart yok</p>
      ) : (
        <ul className="kanban-column__cards">
          {issues.map((issue, cardIndex) => (
            <IssueCard
              key={issue.issueKey}
              issue={issue}
              statusLabel={statusLabel}
              assigneeLabel={assigneeLabel}
              selected={issue.issueKey === selectedIssueKey}
              selectionDisabled={selectionDisabled}
              canMove={canMove}
              moveDisabled={moveDisabled}
              workflowStatuses={workflowStatuses}
              columnIndex={columnIndex}
              cardIndex={cardIndex}
              columnIssueCount={issues.length}
              totalColumns={totalColumns}
              onSelect={onSelect}
              onMove={onMove}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
