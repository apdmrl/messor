import { apiRequest } from '../../app/apiClient'
import type {
  CreateProjectInput,
  PageResponse,
  ProjectDetail,
  ProjectSummary,
} from './types'

const PROJECTS_URL = '/api/projects'

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
