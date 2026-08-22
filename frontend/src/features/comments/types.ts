/**
 * Safe flat projection of an issue comment exactly matching the backend
 * {@code CommentResponse} contract. JPA entities and nested author objects are
 * never exposed by the server. Tombstones carry {@code body = null} and
 * {@code deleted = true}.
 */
export interface IssueComment {
  id: string
  issueKey: string
  authorId: string
  body: string | null
  deleted: boolean
  createdAt: string
  updatedAt: string
  version: number
}

export interface CreateCommentInput {
  body: string
}

export interface UpdateCommentInput {
  body: string
  expectedVersion: number
}
