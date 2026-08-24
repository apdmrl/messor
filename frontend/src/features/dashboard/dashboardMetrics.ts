export interface DashboardMetrics {
  projects: number
  totalIssues: number
  completed: number
  inProgress: number
}

export interface DashboardMetricsSource {
  projectTotal: number
  issueTotal: number
  completedTotal: number
  inProgressTotal: number
}

export function deriveDashboardMetrics(source: DashboardMetricsSource): DashboardMetrics {
  return {
    projects: source.projectTotal,
    totalIssues: source.issueTotal,
    completed: source.completedTotal,
    inProgress: source.inProgressTotal,
  }
}
