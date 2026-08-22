import { apiRequest } from '../../app/apiClient'
import type {
  ArchiveIssueInput,
  CreateIssueInput,
  Issue,
  IssueActivity,
  IssueListFilters,
  IssuePage,
  UpdateIssueInput,
} from './types'

const PROJECTS_URL = '/api/projects'
const ISSUES_URL = '/api/issues'

/** Encode a path segment so project keys and issue keys are never injected. */
function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

/**
 * List active project issues with the fixed, server-approved bound parameters.
 */
export async function listIssues(
  projectKey: string,
  filters: IssueListFilters,
): Promise<IssuePage> {
  const query = new URLSearchParams({
    page: String(filters.page),
    size: String(filters.size),
    sort: filters.sort,
  })
  return apiRequest<IssuePage>(
    `${PROJECTS_URL}/${encodeSegment(projectKey)}/issues?${query.toString()}`,
  )
}

export async function createIssue(
  projectKey: string,
  input: CreateIssueInput,
): Promise<Issue> {
  return apiRequest<Issue>(
    `${PROJECTS_URL}/${encodeSegment(projectKey)}/issues`,
    {
      method: 'POST',
      csrf: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function getIssue(issueKey: string): Promise<Issue> {
  return apiRequest<Issue>(`${ISSUES_URL}/${encodeSegment(issueKey)}`)
}

export async function updateIssue(
  issueKey: string,
  input: UpdateIssueInput,
): Promise<Issue> {
  return apiRequest<Issue>(`${ISSUES_URL}/${encodeSegment(issueKey)}`, {
    method: 'PATCH',
    csrf: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function archiveIssue(
  issueKey: string,
  input: ArchiveIssueInput,
): Promise<Issue> {
  return apiRequest<Issue>(
    `${ISSUES_URL}/${encodeSegment(issueKey)}/archive`,
    {
      method: 'POST',
      csrf: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function listIssueActivity(
  issueKey: string,
): Promise<IssueActivity[]> {
  return apiRequest<IssueActivity[]>(
    `${ISSUES_URL}/${encodeSegment(issueKey)}/activity`,
  )
}
