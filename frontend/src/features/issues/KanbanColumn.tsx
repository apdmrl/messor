import type { ReactElement } from 'react'
import type { WorkflowStatus } from '../projects/types'
import { WIP_LIMIT, isOverburdened } from './boardOrder'
import { IssueCard } from './IssueCard'
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
  statusLabel: (code: string) => string
  assigneeLabel: (id: string | null) => string
  onSelect: (issueKey: string) => void
  onStatusChange: (issueKey: string, targetStatusCode: string) => boolean
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
  statusLabel,
  assigneeLabel,
  onSelect,
  onStatusChange,
}: KanbanColumnProps): ReactElement {
  const overburdened = isOverburdened(issues.length, wipLimit)
  return (
    <section
      className="kanban-column"
      aria-label={`${status.displayName} sütunu, ${issues.length} kart`}
      aria-busy={movePendingKey !== null ? true : undefined}
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
              workflowStatuses={workflowStatuses}
              onSelect={onSelect}
              onStatusChange={onStatusChange}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
