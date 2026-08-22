import { apiRequest } from '../../app/apiClient'
import { serializeApiFilters, PROJECT_FILTER_CONTEXT } from './issueFilters'
import type { IssueFilterState } from './issueFilters'
import type {
  ArchiveIssueInput,
  CreateIssueInput,
  Issue,
  IssueActivity,
  IssuePage,
  MoveIssueInput,
  UpdateIssueInput,
} from './types'

const PROJECTS_URL = '/api/projects'
const ISSUES_URL = '/api/issues'

/** Encode a path segment so project keys and issue keys are never injected. */
function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

/**
 * List project issues with the URL-backed filters. The project key comes from
 * the route, so the project context never emits a project parameter. The API
 * serializer always sends the effective page/size explicitly (size=100 by
 * default for the workspace) so the request never relies on the backend's
 * fallback default of 20.
 */
export async function listIssues(
  projectKey: string,
  filters: IssueFilterState,
): Promise<IssuePage> {
  const query = serializeApiFilters(filters, PROJECT_FILTER_CONTEXT).toString()
  return apiRequest<IssuePage>(
    `${PROJECTS_URL}/${encodeSegment(projectKey)}/issues?${query}`,
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

export async function moveIssue(
  issueKey: string,
  input: MoveIssueInput,
): Promise<Issue> {
  return apiRequest<Issue>(`${ISSUES_URL}/${encodeSegment(issueKey)}/move`, {
    method: 'PATCH',
    csrf: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function listIssueActivity(
  issueKey: string,
): Promise<IssueActivity[]> {
  return apiRequest<IssueActivity[]>(
    `${ISSUES_URL}/${encodeSegment(issueKey)}/activity`,
  )
}
