import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useEffect, useMemo } from 'react'
import { listProjects } from '../projects/projectsApi'
import { getProject, listProjectMembers } from '../projects/projectsApi'
import { parseFilters, serializeFilters, MY_WORK_FILTER_CONTEXT } from '../issues/issueFilters'
import type { IssueFilterState } from '../issues/issueFilters'
import { issueTypeLabel } from '../issues/issueLabels'
import { IssueFilters } from '../issues/IssueFilters'
import type { ProjectOption, StatusOption } from '../issues/IssueFilters'
import { listMyWork } from './myWorkApi'
import type { Issue } from '../issues/types'
import './MyWorkPage.css'
import '../issues/IssueFilters.css'

const GENERIC_ERROR = 'Görevlerim yüklenemedi. Lütfen tekrar deneyin.'
const PROJECTS_ERROR = 'Proje listesi yüklenemedi. Lütfen tekrar deneyin.'
const META_ERROR = 'Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.'

function memberLabel(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim()
}

/**
 * The authenticated principal's assigned work, backed entirely by URL query
 * state (the single source of truth). The query key is the normalized effective
 * filter set, so back/forward and deep links restore the exact screen and query
 * key state. Issues are rendered as text labels only; selecting one navigates to
 * the existing route-backed board drawer, which validates the issue's project
 * before loading detail/activity/comments. This page never queries on behalf of
 * another user.
 */
export function MyWorkPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(
    () => parseFilters(searchParams, MY_WORK_FILTER_CONTEXT),
    [searchParams],
  )

  // Real URL canonicalization: drop unsupported/hostile/repeated params (e.g.
  // an assignee target, a repeated page) by rewriting to the canonical search
  // via replace, so no extra history entry is added. It converges (canonical
  // parse -> canonical serialize) so it cannot loop.
  const canonicalSearch = useMemo(
    () => serializeFilters(filters, MY_WORK_FILTER_CONTEXT).toString(),
    [filters],
  )
  useEffect(() => {
    if (searchParams.toString() !== canonicalSearch) {
      setSearchParams(canonicalSearch, { replace: true })
    }
  }, [searchParams, canonicalSearch, setSearchParams])

  const myWorkQuery = useQuery({
    queryKey: ['my-work', filters],
    queryFn: () => listMyWork(filters),
  })

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })

  const projectOptions: ProjectOption[] = useMemo(
    () =>
      (projectsQuery.data?.items ?? []).map((p) => ({ key: p.key, name: p.name })),
    [projectsQuery.data],
  )

  // Resolve project/status/assignee labels for the projects present on the
  // current page. Each distinct project key drives one metadata query so the
  // page never renders raw status codes or raw member ids as text.
  const pageProjects = useMemo(
    () =>
      [...new Set((myWorkQuery.data?.items ?? []).map((i) => i.projectKey))].sort(),
    [myWorkQuery.data],
  )

  const metaQuery = useQuery({
    queryKey: ['my-work', 'meta', pageProjects],
    queryFn: async () => {
      const entries = await Promise.all(
        pageProjects.map(async (projectKey) => {
          const [detail, members] = await Promise.all([
            getProject(projectKey),
            listProjectMembers(projectKey),
          ])
          return { projectKey, detail, members }
        }),
      )
      return {
        projectName: new Map(entries.map((e) => [e.projectKey, e.detail.name])),
        statusLabel: new Map(
          entries.map((e) => [
            e.projectKey,
            new Map(e.detail.workflowStatuses.map((s) => [s.code, s.displayName])),
          ]),
        ),
        assigneeLabel: new Map(
          entries.map((e) => [
            e.projectKey,
            new Map(e.members.map((m) => [m.userId, memberLabel(m.firstName, m.lastName)])),
          ]),
        ),
      }
    },
    enabled: pageProjects.length > 0,
  })

  // Status options reflect the currently selected project (or all when none).
  const statusOptions: StatusOption[] = useMemo(() => {
    const meta = metaQuery.data
    if (filters.project === null || meta === undefined) {
      return []
    }
    const statuses = meta.statusLabel.get(filters.project)
    return statuses === undefined
      ? []
      : [...statuses.entries()].map(([code, displayName]) => ({ code, displayName }))
  }, [filters.project, metaQuery.data])

  const updateFilters = (patch: Partial<IssueFilterState>): void => {
    const next = { ...filters, ...patch, page: 0 }
    setSearchParams(serializeFilters(next, MY_WORK_FILTER_CONTEXT))
  }

  const goToPage = (page: number): void => {
    setSearchParams(serializeFilters({ ...filters, page }, MY_WORK_FILTER_CONTEXT))
  }

  const statusFor = (issue: Issue): string =>
    metaQuery.data?.statusLabel.get(issue.projectKey)?.get(issue.statusCode) ?? issue.statusCode
  const assigneeFor = (issue: Issue): string =>
    issue.assigneeId === null
      ? 'Atanmamış'
      : metaQuery.data?.assigneeLabel.get(issue.projectKey)?.get(issue.assigneeId) ??
        'Bilinmeyen kullanıcı'
  const projectFor = (issue: Issue): string =>
    metaQuery.data?.projectName.get(issue.projectKey) ?? issue.projectKey

  const page = filters.page
  const totalPages = myWorkQuery.data?.totalPages ?? 0
  const hasPrev = page > 0
  const hasNext = myWorkQuery.data !== undefined && page < totalPages - 1

  return (
    <div className="my-work">
      <header className="my-work__header">
        <h2 className="my-work__heading">Görevlerim</h2>
        <p className="my-work__subheading">
          Sana atanmış işlerin görünür projelerdeki listesi.
        </p>
      </header>

      {projectsQuery.isError && (
        <p className="my-work__error" role="alert">
          {PROJECTS_ERROR}
        </p>
      )}

      {!projectsQuery.isError && (
        <IssueFilters
          filters={filters}
          projects={projectOptions}
          statuses={statusOptions}
          members={[]}
          showProject
          onChange={updateFilters}
        />
      )}

      {metaQuery.isError && pageProjects.length > 0 && (
        <p className="my-work__error" role="alert">
          {META_ERROR}
        </p>
      )}

      {myWorkQuery.isLoading && (
        <p className="my-work__status" role="status">
          Görevlerim yükleniyor…
        </p>
      )}
      {myWorkQuery.isError && (
        <p className="my-work__error" role="alert">
          {GENERIC_ERROR}
        </p>
      )}
      {myWorkQuery.isSuccess && myWorkQuery.data.items.length === 0 && (
        <p className="my-work__empty">Sana atanmış iş bulunamadı.</p>
      )}

      {myWorkQuery.isSuccess && myWorkQuery.data.items.length > 0 && (
        <ul className="my-work__list" aria-label="Atanmış işler">
          {myWorkQuery.data.items.map((issue) => (
            <li key={issue.issueKey} className="my-work__item">
              <Link
                className="my-work__link"
                to={`/projects/${encodeURIComponent(issue.projectKey)}/issues/${encodeURIComponent(issue.issueKey)}`}
                state={{ fromMyWork: true }}
              >
                <span className="my-work__key">{issue.issueKey}</span>
                <span className="my-work__title">{issue.title}</span>
                <span className="my-work__meta my-work__meta--type">
                  {issueTypeLabel(issue.type)}
                </span>
                <span className="my-work__meta">{projectFor(issue)}</span>
                <span className="my-work__meta">{statusFor(issue)}</span>
                <span className="my-work__meta">{assigneeFor(issue)}</span>
                {issue.archived && (
                  <span className="my-work__archived">Arşivlenmiş</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {myWorkQuery.isSuccess && totalPages > 1 && (
        <nav className="my-work__pagination" aria-label="Sayfalama">
          <button
            type="button"
            className="my-work__page"
            onClick={() => goToPage(page - 1)}
            disabled={!hasPrev}
            aria-disabled={!hasPrev}
          >
            Önceki
          </button>
          <span className="my-work__page-info">
            Sayfa {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            className="my-work__page"
            onClick={() => goToPage(page + 1)}
            disabled={!hasNext}
            aria-disabled={!hasNext}
          >
            Sonraki
          </button>
        </nav>
      )}
    </div>
  )
}
