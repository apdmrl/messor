import { apiRequest } from '../../app/apiClient'
import type {
  CreateCommentInput,
  IssueComment,
  UpdateCommentInput,
} from './types'

const ISSUES_URL = '/api/issues'
const COMMENTS_URL = '/api/comments'

/** Encode a path segment so issue keys and comment ids are never injected. */
function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

/** List every comment (active and tombstones) for an issue, server-ordered. */
export async function listIssueComments(issueKey: string): Promise<IssueComment[]> {
  return apiRequest<IssueComment[]>(
    `${ISSUES_URL}/${encodeSegment(issueKey)}/comments`,
  )
}

export async function createComment(
  issueKey: string,
  input: CreateCommentInput,
): Promise<IssueComment> {
  return apiRequest<IssueComment>(
    `${ISSUES_URL}/${encodeSegment(issueKey)}/comments`,
    {
      method: 'POST',
      csrf: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function updateComment(
  commentId: string,
  input: UpdateCommentInput,
): Promise<IssueComment> {
  return apiRequest<IssueComment>(`${COMMENTS_URL}/${encodeSegment(commentId)}`, {
    method: 'PATCH',
    csrf: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function deleteComment(
  commentId: string,
  expectedVersion: number,
): Promise<IssueComment> {
  const query = new URLSearchParams({
    expectedVersion: String(expectedVersion),
  })
  return apiRequest<IssueComment>(
    `${COMMENTS_URL}/${encodeSegment(commentId)}?${query.toString()}`,
    {
      method: 'DELETE',
      csrf: true,
    },
  )
}
