import { apiRequest } from '../../app/apiClient'
import type {
  AddProjectMemberInput,
  ChangeProjectMemberRoleInput,
  CreateProjectInput,
  PageResponse,
  ProjectDetail,
  ProjectMember,
  ProjectSummary,
} from './types'

const PROJECTS_URL = '/api/projects'

/** Encode a path segment so project keys and user ids are never injected. */
function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

/**
 * List projects using fixed, safe query parameters within the backend's
 * approved pagination bounds (page 0, size 100, sort by key ascending).
 */
export async function listProjects(): Promise<PageResponse<ProjectSummary>> {
  return apiRequest<PageResponse<ProjectSummary>>(
    `${PROJECTS_URL}?page=0&size=100&sort=key,asc`,
  )
}

export async function createProject(
  input: CreateProjectInput,
): Promise<ProjectDetail> {
  return apiRequest<ProjectDetail>(PROJECTS_URL, {
    method: 'POST',
    csrf: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function getProject(projectKey: string): Promise<ProjectDetail> {
  return apiRequest<ProjectDetail>(
    `${PROJECTS_URL}/${encodeSegment(projectKey)}`,
  )
}

export async function listProjectMembers(
  projectKey: string,
): Promise<ProjectMember[]> {
  return apiRequest<ProjectMember[]>(
    `${PROJECTS_URL}/${encodeSegment(projectKey)}/members`,
  )
}

export async function addProjectMember(
  projectKey: string,
  input: AddProjectMemberInput,
): Promise<ProjectMember> {
  return apiRequest<ProjectMember>(
    `${PROJECTS_URL}/${encodeSegment(projectKey)}/members`,
    {
      method: 'POST',
      csrf: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function changeProjectMemberRole(
  projectKey: string,
  userId: string,
  input: ChangeProjectMemberRoleInput,
): Promise<ProjectMember> {
  return apiRequest<ProjectMember>(
    `${PROJECTS_URL}/${encodeSegment(projectKey)}/members/${encodeSegment(userId)}`,
    {
      method: 'PATCH',
      csrf: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function removeProjectMember(
  projectKey: string,
  userId: string,
  expectedVersion: number,
): Promise<void> {
  const query = new URLSearchParams({
    expectedVersion: String(expectedVersion),
  })
  return apiRequest<void>(
    `${PROJECTS_URL}/${encodeSegment(projectKey)}/members/${encodeSegment(userId)}?${query.toString()}`,
    {
      method: 'DELETE',
      csrf: true,
    },
  )
}
