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
const UPDATED_FIELD_LABELS: Record<string, string> = {
  title: 'Başlık',
  description: 'Açıklama',
  assigneeId: 'Atanan',
}

const FALLBACK_FIELDS = 'bilinmeyen alanlar'
const FALLBACK_STATUS = 'bilinmeyen durum'
const FALLBACK_ASSIGNEE = 'Bilinmeyen atanan'

function changedFieldsLabel(raw: unknown): string {
  if (!Array.isArray(raw)) {
    return FALLBACK_FIELDS
  }
  const labels: string[] = []
  for (const field of raw) {
    if (typeof field === 'string' && field in UPDATED_FIELD_LABELS) {
      labels.push(UPDATED_FIELD_LABELS[field])
    }
  }
  if (labels.length === 0) {
    return FALLBACK_FIELDS
  }
  return [...new Set(labels)].join(', ')
}

function assigneeLabelSafe(
  raw: unknown,
  assigneeLabel: (id: string | null) => string,
): string {
  if (raw === null) {
    return assigneeLabel(null)
  }
  if (typeof raw === 'string') {
    return assigneeLabel(raw)
  }
  return FALLBACK_ASSIGNEE
}

function statusLabelSafe(
  raw: unknown,
  statusLabel: (code: string) => string,
): string {
  return typeof raw === 'string' ? statusLabel(raw) : FALLBACK_STATUS
}

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
      const status = statusLabelSafe(summary.statusCode, statusLabel)
      const assignee = assigneeLabelSafe(summary.assigneeId, assigneeLabel)
      return `${activityLabel('CREATED')}: ${type}, ${status}, ${assignee}`
    }
    case 'UPDATED': {
      const changed = changedFieldsLabel(summary.changedFields)
      const assignee = assigneeLabelSafe(summary.assigneeId, assigneeLabel)
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
      const status = statusLabelSafe(summary.statusCode, statusLabel)
      return `${activityLabel('ARCHIVED')}: ${status}`
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
