import type { ReactElement, RefObject } from 'react'
import { issueTypeLabel } from './issueLabels'
import { IssueActivityList } from './IssueActivityList'
import type { Issue, IssueActivity } from './types'

interface IssueDetailsPanelProps {
  issue: Issue
  activity: IssueActivity[] | undefined
  activityLoading: boolean
  statusLabel: (code: string) => string
  assigneeLabel: (id: string | null) => string
  canMutate: boolean
  editing: boolean
  confirmingArchive: boolean
  archivePending: boolean
  onEdit: () => void
  onArchive: () => void
  onConfirmArchive: () => void
  onCancelArchive: () => void
  editButtonRef: RefObject<HTMLButtonElement | null>
  archiveTriggerRef: RefObject<HTMLButtonElement | null>
}

export function IssueDetailsPanel({
  issue,
  activity,
  activityLoading,
  statusLabel,
  assigneeLabel,
  canMutate,
  editing,
  confirmingArchive,
  archivePending,
  onEdit,
  onArchive,
  onConfirmArchive,
  onCancelArchive,
  editButtonRef,
  archiveTriggerRef,
}: IssueDetailsPanelProps): ReactElement {
  return (
    <section className="issue-details" aria-labelledby="issue-details-heading">
      <h3 id="issue-details-heading" className="issue-details__heading">
        {issue.issueKey}
      </h3>
      <p className="issue-details__title">{issue.title}</p>

      <dl className="issue-details__meta">
        <div className="issue-details__meta-row">
          <dt>Tür</dt>
          <dd>{issueTypeLabel(issue.type)}</dd>
        </div>
        <div className="issue-details__meta-row">
          <dt>Durum</dt>
          <dd>{statusLabel(issue.statusCode)}</dd>
        </div>
        <div className="issue-details__meta-row">
          <dt>Atanan</dt>
          <dd>{assigneeLabel(issue.assigneeId)}</dd>
        </div>
      </dl>

      {issue.description !== null && issue.description !== '' && (
        <p className="issue-details__description">{issue.description}</p>
      )}

      {canMutate && !issue.archived && (
        <div className="issue-details__actions">
          {!editing && (
            <button
              type="button"
              className="issue-details__action"
              ref={editButtonRef}
              onClick={onEdit}
            >
              Düzenle
            </button>
          )}
          {!editing && !confirmingArchive && (
            <button
              type="button"
              className="issue-details__action issue-details__action--danger"
              ref={archiveTriggerRef}
              onClick={onArchive}
            >
              Arşivle
            </button>
          )}
          {confirmingArchive && (
            <span className="issue-details__confirm">
              <span className="issue-details__confirm-text">
                Bu issue arşivlensin mi?
              </span>
              <button
                type="button"
                className="issue-details__action issue-details__action--danger"
                onClick={onConfirmArchive}
                disabled={archivePending}
              >
                Arşivlemeyi onayla
              </button>
              <button
                type="button"
                className="issue-details__action"
                onClick={onCancelArchive}
                disabled={archivePending}
              >
                Vazgeç
              </button>
            </span>
          )}
        </div>
      )}

      <div className="issue-details__activity">
        <h4 className="issue-details__activity-heading">Aktivite</h4>
        {activityLoading && (
          <p className="issue-details__status" role="status">
            Aktivite yükleniyor…
          </p>
        )}
        {!activityLoading &&
          activity !== undefined &&
          activity.length === 0 && (
            <p className="issue-details__empty">Henüz aktivite yok.</p>
          )}
        {!activityLoading && activity !== undefined && activity.length > 0 && (
          <IssueActivityList
            activities={activity}
            statusLabel={statusLabel}
            assigneeLabel={assigneeLabel}
          />
        )}
      </div>
    </section>
  )
}
