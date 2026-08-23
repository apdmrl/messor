import type { ReactElement } from 'react'
import type { WorkflowStatus } from '../projects/types'
import { WIP_LIMIT, buildColumns, normalizeWorkflowStatuses } from './boardOrder'
import { KanbanColumn } from './KanbanColumn'
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
  onStatusChange: (issueKey: string, targetStatusCode: string) => boolean
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
          statusLabel={statusLabel}
          assigneeLabel={assigneeLabel}
          onSelect={onSelect}
          onStatusChange={onStatusChange}
        />
      ))}
    </div>
  )
}
