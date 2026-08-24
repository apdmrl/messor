import type { Issue } from '../issues/types'
import type { ProjectSummary } from '../projects/types'

export interface DashboardMetrics {
  projects: number
  totalIssues: number
  completed: number
  inProgress: number
}

function normalizeStatus(statusCode: string): string {
  return statusCode.trim().toUpperCase().replace(/[-\s]+/g, '_')
}

export function deriveDashboardMetrics(
  projects: ProjectSummary[],
  issues: Issue[],
): DashboardMetrics {
  return {
    projects: projects.length,
    totalIssues: issues.length,
    completed: issues.filter((issue) =>
      ['DONE', 'COMPLETED', 'CLOSED'].includes(normalizeStatus(issue.statusCode)),
    ).length,
    inProgress: issues.filter((issue) =>
      ['IN_PROGRESS', 'INPROGRESS', 'ACTIVE', 'DOING'].includes(
        normalizeStatus(issue.statusCode),
      ),
    ).length,
  }
}
