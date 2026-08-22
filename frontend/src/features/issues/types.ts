export type IssueType = 'STORY' | 'TASK' | 'BUG'

export type IssueActivityType = 'CREATED' | 'UPDATED' | 'MOVED' | 'ARCHIVED'

/**
 * Safe flat projection of an issue exactly matching the backend
 * {@code IssueResponse} contract. JPA entities and nested user/status objects
 * are never exposed by the server.
 */
export interface Issue {
  id: string
  issueKey: string
  projectKey: string
  number: number
  type: IssueType
  title: string
  description: string | null
  statusCode: string
  reporterId: string
  assigneeId: string | null
  rank: number
  archived: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export interface IssuePage {
  items: Issue[]
  page: number
  size: number
  totalItems: number
  totalPages: number
}

/**
 * A single activity record. {@code summary} is the controlled, server-built
 * JSON document; the UI must render only known controlled fields as text and
 * never serialize the raw object as JSON/HTML.
 */
export interface IssueActivity {
  id: string
  type: IssueActivityType
  actorId: string
  summary: Record<string, unknown>
  createdAt: string
}

export interface CreateIssueInput {
  type: IssueType
  title: string
  description: string | null
  assigneeId: string | null
}

export interface UpdateIssueInput {
  title: string
  description: string | null
  assigneeId: string | null
  expectedVersion: number
}

export interface ArchiveIssueInput {
  expectedVersion: number
}

/**
 * Move an issue to a target workflow status and position. The server derives
 * rank and validates neighbors; the client only supplies the target status and
 * an insertion neighbor (before XOR after), never a client-owned rank.
 */
export interface MoveIssueInput {
  targetStatusCode: string
  beforeIssueKey: string | null
  afterIssueKey: string | null
  expectedVersion: number
}
