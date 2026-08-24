import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import type { ReactElement } from 'react'
import { getProject } from './projectsApi'
import { RestrictedPage } from '../../app/routeBoundaries'
import type { ProjectRole } from './types'
import './ProjectOverviewPage.css'

const PROJECT_ERROR_FALLBACK =
  'Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.'

function roleLabel(role: ProjectRole): string {
  switch (role) {
    case 'PROJECT_LEAD':
      return 'Proje lideri'
    case 'MEMBER':
      return 'Üye'
    case 'VIEWER':
      return 'İzleyici'
  }
}

/**
 * Project landing / overview surface. Composes the existing project detail API
 * with links to the real board, issue list, members, and settings surfaces. It
 * never invents backend behavior: it shows the fields the project endpoint
 * already returns and only links to routes that exist.
 */
export function ProjectOverviewPage(): ReactElement {
  const { projectKey } = useParams<{ projectKey: string }>()
  const key = projectKey ?? ''

  const projectQuery = useQuery({
    queryKey: ['projects', key],
    queryFn: () => getProject(key),
    enabled: key !== '',
  })

  if (projectQuery.isError) {
    return (
      <div className="project-overview">
        <p className="project-overview__error" role="alert">
          {PROJECT_ERROR_FALLBACK}
        </p>
      </div>
    )
  }

  if (!projectQuery.isSuccess || projectQuery.data === undefined) {
    return (
      <div className="project-overview">
        <p className="project-overview__status" role="status">
          Proje yükleniyor…
        </p>
      </div>
    )
  }

  const project = projectQuery.data
  const canManage = project.currentUserRole === 'PROJECT_LEAD'

  return (
    <div className="project-overview">
      <header className="project-overview__header">
        <div className="project-overview__heading-block">
          <h2 className="project-overview__heading">{project.name}</h2>
          <p className="project-overview__key">{project.key}</p>
        </div>
        <span className="project-overview__role">
          {roleLabel(project.currentUserRole)}
        </span>
      </header>

      {project.description !== null && project.description !== '' && (
        <p className="project-overview__description">{project.description}</p>
      )}

      <section
        className="project-overview__statuses"
        aria-labelledby="overview-statuses-heading"
      >
        <h3 id="overview-statuses-heading" className="project-overview__section">
          İş akışı durumları
        </h3>
        <ul className="project-overview__status-list">
          {project.workflowStatuses.map((status) => (
            <li key={status.code} className="project-overview__status-item">
              {status.displayName}
            </li>
          ))}
        </ul>
      </section>

      <nav className="project-overview__actions" aria-label="Proje kısayolları">
        <Link className="project-overview__action" to={`/projects/${key}/board`}>
          Pano
        </Link>
        <Link className="project-overview__action" to={`/projects/${key}/issues`}>
          İşler
        </Link>
        <Link className="project-overview__action" to={`/projects/${key}/members`}>
          Üyeler
        </Link>
        {canManage && (
          <Link
            className="project-overview__action"
            to={`/projects/${key}/settings`}
          >
            Ayarlar
          </Link>
        )}
      </nav>
    </div>
  )
}
