import { describe, expect, it } from 'vitest'
import type { Issue } from '../issues/types'
import type { ProjectSummary } from '../projects/types'
import { deriveDashboardMetrics } from './dashboardMetrics'

const issue = (statusCode: string): Issue => ({
  id: statusCode,
  issueKey: `MES-${statusCode}`,
  projectKey: 'MES',
  number: 1,
  type: 'TASK',
  title: statusCode,
  description: null,
  statusCode,
  reporterId: 'user-1',
  assigneeId: 'user-1',
  rank: 1,
  archived: false,
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
})

const project: ProjectSummary = {
  id: 'project-1',
  key: 'MES',
  name: 'Messor',
  description: null,
  currentUserRole: 'PROJECT_LEAD',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('deriveDashboardMetrics', () => {
  it('counts projects and assigned issues by normalized workflow status', () => {
    expect(
      deriveDashboardMetrics([project], [issue('BACKLOG'), issue('IN_PROGRESS'), issue('DONE')]),
    ).toEqual({
      projects: 1,
      totalIssues: 3,
      completed: 1,
      inProgress: 1,
    })
  })
})
