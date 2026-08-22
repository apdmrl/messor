import type { ReactElement } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { WorkflowStatus } from '../projects/types'
import { buildColumns, columnIssues } from './boardOrder'
import { KanbanColumn } from './KanbanColumn'
import type { Issue } from './types'

interface ProjectBoardProps {
  workflowStatuses: WorkflowStatus[]
  issues: Issue[]
  selectedIssueKey: string | null
  canMove: boolean
  moveDisabled: boolean
  selectionDisabled: boolean
  statusLabel: (code: string) => string
  assigneeLabel: (id: string | null) => string
  onSelect: (issueKey: string) => void
  onMove: (issueKey: string, targetStatusCode: string, targetIndex: number) => void
}

export function ProjectBoard({
  workflowStatuses,
  issues,
  selectedIssueKey,
  canMove,
  moveDisabled,
  selectionDisabled,
  statusLabel,
  assigneeLabel,
  onSelect,
  onMove,
}: ProjectBoardProps): ReactElement {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const columns = buildColumns(workflowStatuses, issues)

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (over === null) {
      return
    }
    const draggedKey = String(active.id)
    const overId = String(over.id)
    let targetStatusCode: string
    let targetIndex: number

    if (overId.startsWith('column-')) {
      targetStatusCode = overId.slice('column-'.length)
      targetIndex = Number.MAX_SAFE_INTEGER
    } else {
      const overCard = issues.find((issue) => issue.issueKey === overId)
      if (overCard === undefined) {
        return
      }
      targetStatusCode = overCard.statusCode
      const destination = columnIssues(
        issues.filter((issue) => issue.issueKey !== draggedKey),
        targetStatusCode,
      )
      targetIndex = destination.findIndex((issue) => issue.issueKey === overId)
    }

    onMove(draggedKey, targetStatusCode, targetIndex)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={handleDragEnd}>
      <div className="kanban-board" role="region" aria-label="Kanban panosu">
        {columns.map((column, index) => (
          <KanbanColumn
            key={column.statusCode}
            status={{ code: column.statusCode, displayName: column.displayName, position: index }}
            issues={column.issues}
            workflowStatuses={workflowStatuses}
            columnIndex={index}
            totalColumns={columns.length}
            selectedIssueKey={selectedIssueKey}
            canMove={canMove}
            moveDisabled={moveDisabled}
            selectionDisabled={selectionDisabled}
            statusLabel={statusLabel}
            assigneeLabel={assigneeLabel}
            onSelect={onSelect}
            onMove={onMove}
          />
        ))}
      </div>
    </DndContext>
  )
}
