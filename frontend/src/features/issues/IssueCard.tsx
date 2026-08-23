import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { WorkflowStatus } from '../projects/types'
import { issueTypeLabel } from './issueLabels'
import type { Issue } from './types'

interface IssueCardProps {
  issue: Issue
  statusLabel: (code: string) => string
  assigneeLabel: (id: string | null) => string
  selected: boolean
  selectionDisabled: boolean
  /** True when the current user may change issue status (PROJECT_LEAD/MEMBER). */
  canMove: boolean
  /** True while any mutation is pending; disables every status trigger. */
  moveDisabled: boolean
  /** The issueKey currently being moved, or null; drives pending text/aria-busy. */
  movePendingKey: string | null
  workflowStatuses: WorkflowStatus[]
  onSelect: (issueKey: string) => void
  onStatusChange: (issueKey: string, targetStatusCode: string) => boolean
}

export function IssueCard({
  issue,
  statusLabel,
  assigneeLabel,
  selected,
  selectionDisabled,
  canMove,
  moveDisabled,
  movePendingKey,
  workflowStatuses,
  onSelect,
  onStatusChange,
}: IssueCardProps): ReactElement {
  const [disclosureOpen, setDisclosureOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Archived issues are read-only; VIEWERs have no movement control. Both
  // render a status chip only, never an actionable-looking trigger.
  const movable = canMove && !issue.archived
  const isMoving = movePendingKey === issue.issueKey

  const accessibleName = `${issue.issueKey}, ${issue.title}, ${statusLabel(issue.statusCode)}`

  // A pending mutation closes any open disclosure so no stale options linger.
  useEffect(() => {
    if (moveDisabled) {
      setDisclosureOpen(false)
    }
  }, [moveDisabled])

  // Escape closes the disclosure and returns focus to the trigger; clicking
  // outside the card closes it without moving.
  useEffect(() => {
    if (!disclosureOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDisclosureOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      const card = triggerRef.current?.closest('.kanban-card')
      if (card !== null && card !== undefined && !card.contains(target)) {
        setDisclosureOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [disclosureOpen])

  return (
    <li
      className={isMoving ? 'kanban-card kanban-card--dragging' : 'kanban-card'}
      aria-busy={isMoving ? true : undefined}
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

        <div className="kanban-card__status">
          <span className="kanban-card__status-chip" aria-hidden="true">
            {statusLabel(issue.statusCode)}
          </span>
          {movable && (
            <button
              type="button"
              ref={triggerRef}
              id={`kanban-card-status-${issue.issueKey}`}
              className="kanban-card__status-toggle"
              aria-label={`${issue.issueKey} için durumu değiştir`}
              aria-expanded={disclosureOpen}
              aria-controls={`kanban-card-status-pop-${issue.issueKey}`}
              disabled={moveDisabled}
              onClick={() => setDisclosureOpen((open) => !open)}
            >
              {isMoving ? 'Taşınıyor…' : 'Durumu değiştir'}
            </button>
          )}
        </div>
      </div>

      {movable && disclosureOpen && !moveDisabled && (
        <div
          id={`kanban-card-status-pop-${issue.issueKey}`}
          className="kanban-card__status-pop"
          role="group"
          aria-label={`${issue.issueKey} için durum seçenekleri`}
        >
          {workflowStatuses.map((status) => {
            const isCurrent = status.code === issue.statusCode
            return (
              <button
                key={status.code}
                type="button"
                className="kanban-card__status-action"
                aria-current={isCurrent ? 'true' : undefined}
                disabled={isCurrent || moveDisabled}
                onClick={() => {
                  if (isCurrent) {
                    return
                  }
                  onStatusChange(issue.issueKey, status.code)
                  setDisclosureOpen(false)
                }}
              >
                {status.displayName} durumuna taşı
              </button>
            )
          })}
        </div>
      )}
    </li>
  )
}
