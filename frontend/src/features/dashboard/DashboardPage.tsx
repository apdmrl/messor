import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { ReactElement } from 'react'
import { DEFAULT_FILTERS } from '../issues/issueFilters'
import { listMyWork } from '../my-work/myWorkApi'
import { listProjects } from '../projects/projectsApi'
import { deriveDashboardMetrics } from './dashboardMetrics'
import './DashboardPage.css'

const PROJECTS_QUERY_KEY = ['projects'] as const
const DASHBOARD_WORK_QUERY_KEY = ['dashboard', 'my-work', 'all'] as const
const DASHBOARD_IN_PROGRESS_QUERY_KEY = ['dashboard', 'my-work', 'in-progress'] as const
const DASHBOARD_COMPLETED_QUERY_KEY = ['dashboard', 'my-work', 'completed'] as const

function statusLabel(statusCode: string): string {
  const normalized = statusCode.trim().toUpperCase().replace(/[-\s]+/g, '_')
  if (['DONE', 'COMPLETED', 'CLOSED'].includes(normalized)) return 'Tamamlandı'
  if (['IN_PROGRESS', 'INPROGRESS', 'ACTIVE', 'DOING'].includes(normalized)) {
    return 'In Progress'
  }
  return 'Backlog'
}

function formatRole(role: string): string {
  if (role === 'PROJECT_LEAD') return 'Project Lead'
  if (role === 'VIEWER') return 'Viewer'
  return 'Member'
}

export function DashboardPage(): ReactElement {
  const projectsQuery = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: listProjects,
  })
  const workQuery = useQuery({
    queryKey: DASHBOARD_WORK_QUERY_KEY,
    queryFn: () => listMyWork(DEFAULT_FILTERS),
  })
  const inProgressQuery = useQuery({
    queryKey: DASHBOARD_IN_PROGRESS_QUERY_KEY,
    queryFn: () => listMyWork({ ...DEFAULT_FILTERS, status: 'IN_PROGRESS' }),
  })
  const completedQuery = useQuery({
    queryKey: DASHBOARD_COMPLETED_QUERY_KEY,
    queryFn: () => listMyWork({ ...DEFAULT_FILTERS, status: 'DONE' }),
  })

  if (
    projectsQuery.isPending ||
    workQuery.isPending ||
    inProgressQuery.isPending ||
    completedQuery.isPending
  ) {
    return (
      <section className="dashboard-page" aria-labelledby="dashboard-title">
        <header className="dashboard-page__header">
          <p className="dashboard-page__eyebrow">Messor</p>
          <h1 id="dashboard-title">Genel Bakış</h1>
          <p>İş akışınızı tek bakışta takip edin.</p>
        </header>
        <div className="dashboard-skeleton" aria-label="Yükleniyor" />
      </section>
    )
  }

  if (
    projectsQuery.isError ||
    workQuery.isError ||
    inProgressQuery.isError ||
    completedQuery.isError
  ) {
    const message = 'Genel bakış verileri yüklenemedi. Lütfen tekrar deneyin.'
    return (
      <section className="dashboard-page" aria-labelledby="dashboard-title">
        <header className="dashboard-page__header">
          <p className="dashboard-page__eyebrow">Messor</p>
          <h1 id="dashboard-title">Genel Bakış</h1>
        </header>
        <div className="dashboard-state dashboard-state--error" role="alert">
          <strong>{message}</strong>
          <p>Veriler korunuyor; bağlantı sağlandığında tekrar deneyebilirsiniz.</p>
        </div>
      </section>
    )
  }

  const projects = projectsQuery.data.items
  const issues = workQuery.data.items
  const metrics = deriveDashboardMetrics({
    projectTotal: projectsQuery.data.totalItems,
    issueTotal: workQuery.data.totalItems,
    completedTotal: completedQuery.data.totalItems,
    inProgressTotal: inProgressQuery.data.totalItems,
  })

  return (
    <section className="dashboard-page" aria-labelledby="dashboard-title">
      <header className="dashboard-page__header">
        <p className="dashboard-page__eyebrow">Messor — Genel Bakış</p>
        <h1 id="dashboard-title">Merhaba 👋</h1>
        <p>Solo geliştirici portföyü için sade proje takip arayüzü</p>
      </header>

      <div className="dashboard-metrics" aria-label="Özet metrikler">
        <article className="dashboard-metric"><span>Projeler</span><strong>{metrics.projects}</strong></article>
        <article className="dashboard-metric"><span>Toplam İş</span><strong>{metrics.totalIssues}</strong></article>
        <article className="dashboard-metric"><span>Tamamlanan</span><strong>{metrics.completed}</strong></article>
        <article className="dashboard-metric"><span>Devam Eden</span><strong>{metrics.inProgress}</strong></article>
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-panel" aria-labelledby="assigned-title">
          <div className="dashboard-panel__heading"><h2 id="assigned-title">Atanan İşler</h2><Link to="/my-work">Tümünü gör</Link></div>
          {issues.length === 0 ? (
            <p className="dashboard-empty">Size atanmış açık iş bulunmuyor.</p>
          ) : (
            <ul className="dashboard-list">
              {issues.slice(0, 5).map((issue) => (
                <li key={issue.issueKey}>
                  <Link to={`/projects/${encodeURIComponent(issue.projectKey)}/issues/${encodeURIComponent(issue.issueKey)}`}>
                    <strong>{issue.title}</strong>
                    <span>{issue.issueKey} · {statusLabel(issue.statusCode)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dashboard-panel" aria-labelledby="activity-title">
          <div className="dashboard-panel__heading"><h2 id="activity-title">Son Aktiviteler</h2></div>
          <p className="dashboard-empty">Proje bazlı aktivite akışı ilgili proje ekranlarında görüntülenir.</p>
          <div className="dashboard-panel__action"><Link to="/projects">Projeleri aç</Link></div>
        </section>

        <section className="dashboard-panel" aria-labelledby="roles-title">
          <div className="dashboard-panel__heading"><h2 id="roles-title">Projelerdeki Roller</h2></div>
          {projects.length === 0 ? (
            <p className="dashboard-empty">Henüz erişebildiğiniz bir proje yok.</p>
          ) : (
            <ul className="dashboard-role-list">
              {projects.slice(0, 4).map((project) => (
                <li key={project.key}><Link to={`/projects/${encodeURIComponent(project.key)}/overview`}>{project.name}</Link><span>{formatRole(project.currentUserRole)}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  )
}
