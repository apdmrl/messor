import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import type { ReactElement } from 'react'
import { CreateProjectForm } from './CreateProjectForm'
import { createProject, listProjects } from './projectsApi'
import type { ProjectSummary } from './types'
import './ProjectsPage.css'

const PROJECTS_QUERY_KEY = ['projects'] as const

const LIST_ERROR_FALLBACK = 'Projeler yüklenemedi. Lütfen tekrar deneyin.'

function roleLabel(role: ProjectSummary['currentUserRole']): string {
  switch (role) {
    case 'PROJECT_LEAD':
      return 'Proje lideri'
    case 'MEMBER':
      return 'Üye'
    case 'VIEWER':
      return 'İzleyici'
  }
}

export function ProjectsPage(): ReactElement {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const projectsQuery = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: listProjects,
  })

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
      navigate(`/projects/${project.key}/board`)
    },
  })

  return (
    <div className="projects-page">
      <section className="projects-list" aria-labelledby="projects-heading">
        <h2 id="projects-heading" className="projects-list__heading">
          Projeler
        </h2>

        {projectsQuery.isLoading && (
          <p className="projects-list__status" role="status">
            Projeler yükleniyor…
          </p>
        )}

        {projectsQuery.isError && (
          <p className="projects-list__error" role="alert">
            {LIST_ERROR_FALLBACK}
          </p>
        )}

        {projectsQuery.isSuccess &&
          projectsQuery.data.items.length === 0 && (
            <p className="projects-list__empty">
              Henüz proje yok. İlk projeni oluştur.
            </p>
          )}

        {projectsQuery.isSuccess && projectsQuery.data.items.length > 0 && (
          <ul className="projects-list__items">
            {projectsQuery.data.items.map((project) => (
              <li key={project.id} className="project-card">
                <Link
                  className="project-card__link"
                  to={`/projects/${project.key}/board`}
                >
                  <span className="project-card__key">{project.key}</span>
                  <span className="project-card__name">{project.name}</span>
                  {project.description !== null &&
                    project.description !== '' && (
                      <span className="project-card__description">
                        {project.description}
                      </span>
                    )}
                  <span className="project-card__role">
                    {roleLabel(project.currentUserRole)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="projects-create" aria-labelledby="create-heading">
        <h2 id="create-heading" className="projects-create__heading">
          Yeni proje
        </h2>
        <CreateProjectForm
          onSubmit={createMutation.mutateAsync}
          pending={createMutation.isPending}
        />
      </section>
    </div>
  )
}

export { PROJECTS_QUERY_KEY }
