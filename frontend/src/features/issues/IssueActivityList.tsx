import type { ReactElement } from 'react'
import { issueTypeLabel } from './issueLabels'
import type { IssueActivity, IssueActivityType, IssueType } from './types'

interface IssueActivityListProps {
  activities: IssueActivity[]
  statusLabel: (code: string) => string
  assigneeLabel: (id: string | null) => string
}

/**
 * Render an activity record from only its controlled summary fields. The raw
 * summary object is never JSON-serialized, stringified, or injected as HTML;
 * every value is coerced into a plain text label.
 */
function activityText(
  activity: IssueActivity,
  statusLabel: (code: string) => string,
  assigneeLabel: (id: string | null) => string,
): string {
  const summary = activity.summary ?? {}

  const activityLabel = (type: IssueActivityType): string => {
    switch (type) {
      case 'CREATED':
        return 'Oluşturuldu'
      case 'UPDATED':
        return 'Güncellendi'
      case 'MOVED':
        return 'Durum değişti'
      case 'ARCHIVED':
        return 'Arşivlendi'
    }
  }

  switch (activity.type) {
    case 'CREATED': {
      const rawType = summary.type
      const type =
        rawType === 'STORY' || rawType === 'TASK' || rawType === 'BUG'
          ? issueTypeLabel(rawType as IssueType)
          : 'bilinmeyen tür'
      const status =
        typeof summary.statusCode === 'string'
          ? statusLabel(summary.statusCode)
          : 'bilinmeyen durum'
      const assignee = assigneeLabel(
        typeof summary.assigneeId === 'string' ? summary.assigneeId : null,
      )
      return `${activityLabel('CREATED')}: ${type}, ${status}, ${assignee}`
    }
    case 'UPDATED': {
      const fields = Array.isArray(summary.changedFields)
        ? summary.changedFields.filter(
            (field): field is string => typeof field === 'string',
          )
        : []
      const changed =
        fields.length > 0 ? fields.join(', ') : 'bilinmeyen alanlar'
      const assignee = assigneeLabel(
        typeof summary.assigneeId === 'string' ? summary.assigneeId : null,
      )
      return `${activityLabel('UPDATED')}: ${changed}, ${assignee}`
    }
    case 'MOVED': {
      const from =
        typeof summary.fromStatusCode === 'string'
          ? statusLabel(summary.fromStatusCode)
          : 'bilinmeyen'
      const to =
        typeof summary.toStatusCode === 'string'
          ? statusLabel(summary.toStatusCode)
          : 'bilinmeyen'
      return `${activityLabel('MOVED')}: ${from} → ${to}`
    }
    case 'ARCHIVED': {
      return activityLabel('ARCHIVED')
    }
    default: {
      return 'Bilinmeyen etkinlik'
    }
  }
}

export function IssueActivityList({
  activities,
  statusLabel,
  assigneeLabel,
}: IssueActivityListProps): ReactElement {
  return (
    <ul className="issue-activity" aria-label="Aktivite">
      {activities.map((activity) => (
        <li
          key={activity.id}
          className="issue-activity__item"
          aria-label={`${activity.createdAt} ${activityText(activity, statusLabel, assigneeLabel)}`}
        >
          <span className="issue-activity__text">
            {activityText(activity, statusLabel, assigneeLabel)}
          </span>
          <span className="issue-activity__time">
            {new Date(activity.createdAt).toLocaleString('tr-TR')}
          </span>
        </li>
      ))}
    </ul>
  )
}
