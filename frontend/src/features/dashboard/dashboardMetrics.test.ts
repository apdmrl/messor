import { describe, expect, it } from 'vitest'
import { deriveDashboardMetrics } from './dashboardMetrics'

describe('deriveDashboardMetrics', () => {
  it('uses complete API totals instead of the first page item counts', () => {
    expect(
      deriveDashboardMetrics({
        projectTotal: 101,
        issueTotal: 121,
        completedTotal: 41,
        inProgressTotal: 37,
      }),
    ).toEqual({
      projects: 101,
      totalIssues: 121,
      completed: 41,
      inProgress: 37,
    })
  })
})
