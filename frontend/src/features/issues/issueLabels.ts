import type { IssueType } from './types'

export const ISSUE_TYPES: IssueType[] = ['STORY', 'TASK', 'BUG']

export function issueTypeLabel(type: IssueType): string {
  switch (type) {
    case 'STORY':
      return 'Hikaye'
    case 'TASK':
      return 'Görev'
    case 'BUG':
      return 'Hata'
  }
}
