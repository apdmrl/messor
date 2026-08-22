import type { CSSProperties, ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { WorkflowStatus } from '../projects/types'
import { issueTypeLabel } from './issueLabels'
import type { Issue } from './types'

/** True when the user prefers reduced motion; disables drag transitions. */
function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const supportsMatchMedia =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const [reduced, setReduced] = useState(
    () => supportsMatchMedia && window.matchMedia(query).matches,
  )
  useEffect(() => {
    if (!supportsMatchMedia) {
      return
    }
    const mq = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [supportsMatchMedia])
  return reduced
}

interface IssueCardProps {
  issue: Issue
  statusLabel: (code: string) => string
  assigneeLabel: (id: string | null) => string
  selected: boolean
  selectionDisabled: boolean
  canMove: boolean
  /** True while any mutation is pending; disables every movement control. */
  moveDisabled: boolean
  workflowStatuses: WorkflowStatus[]
  columnIndex: number
  cardIndex: number
  columnIssueCount: number
  totalColumns: number
  onSelect: (issueKey: string) => void
  onMove: (issueKey: string, targetStatusCode: string, targetIndex: number) => boolean
}

export function IssueCard({
  issue,
  statusLabel,
  assigneeLabel,
  selected,
  selectionDisabled,
  canMove,
  moveDisabled,
  workflowStatuses,
  columnIndex,
  cardIndex,
  columnIssueCount,
  totalColumns,
  onSelect,
  onMove,
}: IssueCardProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuToggleRef = useRef<HTMLButtonElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  // The sortable listeners/attributes live on a dedicated drag handle so dnd-kit
  // never swallows keyboard activation of the descendant select/menu buttons.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: issue.issueKey,
      data: { type: 'issue', statusCode: issue.statusCode },
    })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    ...(isDragging ? { zIndex: 1, opacity: 0.85 } : {}),
  }

  const accessibleName = `${issue.issueKey}, ${issue.title}, ${statusLabel(issue.statusCode)}`
  const previousStatus = columnIndex > 0 ? workflowStatuses[columnIndex - 1] : null
  const nextStatus =
    columnIndex < totalColumns - 1 ? workflowStatuses[columnIndex + 1] : null

  const triggerMenuMove = (): void => {
    setMenuOpen(false)
  }

  useEffect(() => {
    if (!menuOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        // Return focus to the toggle rather than leaving it on the now-unmounted
        // menu action.
        menuToggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  return (
    <li
      className="kanban-card"
      style={style}
      ref={setNodeRef}
      data-dragging={isDragging ? 'true' : 'false'}
    >
      <div className="kanban-card__main">
        <button
          type="button"
          id={`kanban-card-${issue.issueKey}`}
          className="kanban-card__select"
          aria-label={accessibleName}
          aria-pressed={selected}
          aria-current={selected}
          aria-disabled={selectionDisabled}
          disabled={selectionDisabled}
          onClick={() => onSelect(issue.issueKey)}
        >
          <span className="kanban-card__key">{issue.issueKey}</span>
          <span className="kanban-card__title">{issue.title}</span>
          <span className="kanban-card__meta">
            {issueTypeLabel(issue.type)} · {statusLabel(issue.statusCode)}
          </span>
          <span className="kanban-card__assignee">{assigneeLabel(issue.assigneeId)}</span>
        </button>

        {canMove && !moveDisabled && (
          <button
            type="button"
            className="kanban-card__drag-handle"
            aria-label={`${issue.issueKey} sürükle`}
            {...attributes}
            {...listeners}
          >
            Sürükle
          </button>
        )}
      </div>

      {canMove && (
        <div className="kanban-card__menu">
          <button
            type="button"
            ref={menuToggleRef}
            className="kanban-card__menu-toggle"
            aria-label={`${issue.issueKey} için taşıma menüsü`}
            aria-expanded={menuOpen}
            disabled={moveDisabled}
            onClick={() => setMenuOpen((open) => !open)}
          >
            Taşı
          </button>
          {menuOpen && (
            <div className="kanban-card__menu-pop" role="group" aria-label="Taşıma seçenekleri">
              <button
                type="button"
                className="kanban-card__menu-action"
                disabled={moveDisabled || previousStatus === null}
                onClick={() => {
                  if (previousStatus) {
                    onMove(issue.issueKey, previousStatus.code, Number.MAX_SAFE_INTEGER)
                  }
                  triggerMenuMove()
                }}
              >
                Önceki sütuna taşı
              </button>
              <button
                type="button"
                className="kanban-card__menu-action"
                disabled={moveDisabled || nextStatus === null}
                onClick={() => {
                  if (nextStatus) {
                    onMove(issue.issueKey, nextStatus.code, Number.MAX_SAFE_INTEGER)
                  }
                  triggerMenuMove()
                }}
              >
                Sonraki sütuna taşı
              </button>
              <button
                type="button"
                className="kanban-card__menu-action"
                disabled={moveDisabled || cardIndex === 0}
                onClick={() => {
                  onMove(issue.issueKey, issue.statusCode, Math.max(0, cardIndex - 1))
                  triggerMenuMove()
                }}
              >
                Yukarı taşı
              </button>
              <button
                type="button"
                className="kanban-card__menu-action"
                disabled={moveDisabled || cardIndex >= columnIssueCount - 1}
                onClick={() => {
                  onMove(issue.issueKey, issue.statusCode, cardIndex + 1)
                  triggerMenuMove()
                }}
              >
                Aşağı taşı
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}
