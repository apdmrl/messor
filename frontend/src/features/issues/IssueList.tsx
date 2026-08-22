import type { ReactElement } from 'react'
import { issueTypeLabel } from './issueLabels'
import type { Issue } from './types'

interface IssueListProps {
  issues: Issue[]
  selectedIssueKey: string | null
  selectionDisabled?: boolean
  onSelect: (issueKey: string) => void
  statusLabel: (code: string) => string
  assigneeLabel: (id: string | null) => string
}

export function IssueList({
  issues,
  selectedIssueKey,
  selectionDisabled = false,
  onSelect,
  statusLabel,
  assigneeLabel,
}: IssueListProps): ReactElement {
  return (
    <ul className="issue-list" aria-label="İssue’lar">
      {issues.map((issue) => {
        const selected = issue.issueKey === selectedIssueKey
        return (
          <li key={issue.issueKey} className="issue-list__item">
            <button
              type="button"
              className="issue-list__button"
              aria-current={selected}
              aria-pressed={selected}
              disabled={selectionDisabled}
              aria-disabled={selectionDisabled}
              onClick={() => onSelect(issue.issueKey)}
            >
              <span className="issue-list__key">{issue.issueKey}</span>
              <span className="issue-list__title">{issue.title}</span>
              <span className="issue-list__meta">
                {issueTypeLabel(issue.type)} · {statusLabel(issue.statusCode)}
              </span>
              <span className="issue-list__assignee">
                {assigneeLabel(issue.assigneeId)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
