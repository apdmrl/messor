import type { ReactElement } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type DndContextProps,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { WorkflowStatus } from '../projects/types'
import { buildColumns, normalizeWorkflowStatuses, resolveDragEnd } from './boardOrder'
import { KanbanColumn } from './KanbanColumn'
import type { Issue } from './types'

/**
 * Controlled Turkish screen-reader instructions for a drag. Text is fully
 * authored client-side and never embeds raw/hostile server values.
 */
const screenReaderInstructions: ScreenReaderInstructions = {
  draggable: `
    Sürüklenebilir bir kartı seçmek için boşluk tuşuna basın.
    Sürüklerken ok tuşlarını kullanarak kartı hareket ettirin.
    Yeni konumuna bırakmak için tekrar boşluk tuşuna basın.
    Sürüklemeyi iptal etmek için escape tuşuna basın.
  `,
}

/** Safe human label for a drag target id; never echoes hostile/raw text. */
function dragTargetLabel(id: string): string {
  if (id.startsWith('column-')) {
    return 'bir sütun'
  }
  // Card ids are server-issued issue keys (project key + number), safe to read.
  return id
}

/**
 * Controlled Turkish announcements for drag start, over, end and cancel. Every
 * message is authored here; only safe ids (issue keys) or fixed labels are
 * interpolated, so hostile status text is never announced.
 */
const accessibility: DndContextProps['accessibility'] = {
  announcements: {
    onDragStart(event) {
      return `Sürüklenen kart ${String(event.active.id)}.`
    },
    onDragOver(event) {
      return event.over
        ? `Kart ${String(event.active.id)} üzerinde: ${dragTargetLabel(String(event.over.id))}.`
        : `Kart ${String(event.active.id)} şu anda bir hedefin üzerinde değil.`
    },
    onDragEnd(event) {
      return event.over
        ? `Kart ${String(event.active.id)} yeni konumuna taşındı.`
        : `Kart ${String(event.active.id)} taşındı.`
    },
    onDragCancel(event) {
      return `Kart ${String(event.active.id)} sürüklemesi iptal edildi.`
    },
  },
  screenReaderInstructions,
}

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

  // One normalized, immutable status sequence drives column order, card
  // previous/next movement controls, and cross-column keyboard math.
  const normalizedStatuses = normalizeWorkflowStatuses(workflowStatuses)
  const columns = buildColumns(normalizedStatuses, issues)

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (over === null) {
      return
    }
    const draggedKey = String(active.id)
    const overId = String(over.id)
    const resolution = resolveDragEnd({ issues, activeId: draggedKey, overId })
    // A null resolution is a true no-op (drop on itself) or an unknown target;
    // never reach the API and never announce a successful move.
    if (resolution === null) {
      return
    }
    onMove(draggedKey, resolution.targetStatusCode, resolution.targetIndex)
  }

  const handleDragCancel = (): void => {
    // Escape during an active drag cancels here. No move is issued, so no API
    // request is made and no successful-move announcement is triggered.
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      accessibility={accessibility}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="kanban-board" role="region" aria-label="Kanban panosu">
        {columns.map((column, index) => (
          <KanbanColumn
            key={column.statusCode}
            status={{ code: column.statusCode, displayName: column.displayName, position: index }}
            issues={column.issues}
            workflowStatuses={normalizedStatuses}
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
