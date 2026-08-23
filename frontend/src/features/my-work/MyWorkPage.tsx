import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { listProjects } from '../projects/projectsApi'
import { getProject, listProjectMembers } from '../projects/projectsApi'
import { parseFilters, serializeFilters, MY_WORK_FILTER_CONTEXT } from '../issues/issueFilters'
import type { IssueFilterState, SortSpec } from '../issues/issueFilters'
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
const NO_ASSIGNMENTS = 'Sana atanmış iş bulunamadı.'
const NO_RESULTS = 'Seçili filtrelerle eşleşen iş bulunamadı.'
const LOADING = 'Görevlerim yükleniyor…'
const WORKLOAD_LABEL = 'İş yükü'

/**
 * The three canonical workflow status codes. My Work groups its attention
 * queue by these buckets. There is no "blocked" status, priority, or due-date
 * field in the {@link Issue} contract, so the product never fabricates a
 * blocked/urgent bucket from unavailable data.
 */
const IN_PROGRESS_CODE = 'IN_PROGRESS'
const QUEUE_CODE = 'TO_DO'
const COMPLETED_CODE = 'DONE'

const DEFAULT_SORT: SortSpec = { field: 'number', direction: 'asc' }
const RECENT_SORT: SortSpec = { field: 'updatedAt', direction: 'desc' }

interface WorkGroup {
  code: string
  label: string
}

/** Attention-queue section order: attention first, finished work last. */
const WORK_GROUPS: WorkGroup[] = [
  { code: IN_PROGRESS_CODE, label: 'Sürüyor' },
  { code: QUEUE_CODE, label: 'Kuyruk' },
  { code: COMPLETED_CODE, label: 'Son tamamlananlar' },
]

interface SummaryPreset {
  key: string
  label: string
  /** Patch applied to the current filters (the page is always reset to 0). */
  patch: Partial<IssueFilterState>
  isActive: (filters: IssueFilterState) => boolean
}

/** Quick-view summary links, each backed by a supported URL filter state. */
const SUMMARY_PRESETS: SummaryPreset[] = [
  {
    key: 'assigned',
    label: 'Atanmış',
    patch: {
      project: null,
      type: null,
      status: null,
      archive: 'active',
      sort: { ...DEFAULT_SORT },
    },
    isActive: (f) =>
      f.status === null &&
      f.type === null &&
      f.project === null &&
      f.archive === 'active' &&
      f.sort.field === DEFAULT_SORT.field &&
      f.sort.direction === DEFAULT_SORT.direction,
  },
  {
    key: 'in-progress',
    label: 'Sürüyor',
    patch: { status: IN_PROGRESS_CODE },
    isActive: (f) => f.status === IN_PROGRESS_CODE,
  },
  {
    key: 'queue',
    label: 'Kuyruk',
    patch: { status: QUEUE_CODE },
    isActive: (f) => f.status === QUEUE_CODE,
  },
  {
    key: 'completed',
    label: 'Tamamlanan',
    patch: { status: COMPLETED_CODE },
    isActive: (f) => f.status === COMPLETED_CODE,
  },
  {
    key: 'recent',
    label: 'Son güncellenen',
    patch: { sort: { ...RECENT_SORT } },
    isActive: (f) =>
      f.sort.field === RECENT_SORT.field && f.sort.direction === RECENT_SORT.direction,
  },
]

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
  const [railOpen, setRailOpen] = useState(true)
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

  // Group the loaded page into attention sections. Pagination is preserved, so
  // counts reflect the loaded results; each group only renders when it has
  // items to avoid an empty queue of headings.
  const groups: { group: WorkGroup; items: Issue[] }[] = useMemo(() => {
    const byCode = new Map<string, Issue[]>()
    for (const issue of myWorkQuery.data?.items ?? []) {
      const bucket = byCode.get(issue.statusCode)
      if (bucket === undefined) {
        byCode.set(issue.statusCode, [issue])
      } else {
        bucket.push(issue)
      }
    }
    return WORK_GROUPS.map((group) => ({ group, items: byCode.get(group.code) ?? [] }))
      .filter((g) => g.items.length > 0)
  }, [myWorkQuery.data])

  // A non-default status/type/project/archive means the user actively narrowed
  // the queue, so an empty page is a "no results" rather than "no assignments".
  const hasActiveFilters =
    filters.status !== null ||
    filters.type !== null ||
    filters.project !== null ||
    filters.archive !== 'active'

  // Workload rail counts, derived only from data actually loaded for the
  // current page. No team/priority/blocked figures exist in the contract, so
  // they are never inferred.
  const workload = useMemo(() => {
    const items = myWorkQuery.data?.items ?? []
    const count = (code: string): number =>
      items.reduce((n, i) => (i.statusCode === code ? n + 1 : n), 0)
    const perProject = new Map<string, number>()
    for (const issue of items) {
      perProject.set(issue.projectKey, (perProject.get(issue.projectKey) ?? 0) + 1)
    }
    const projects = [...perProject.entries()]
      .map(([key, count]) => ({
        key,
        count,
        name: metaQuery.data?.projectName.get(key) ?? key,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    const maxProjectCount = projects.reduce((max, p) => Math.max(max, p.count), 0)
    return {
      assigned: myWorkQuery.data?.totalItems ?? 0,
      inProgress: count(IN_PROGRESS_CODE),
      queue: count(QUEUE_CODE),
      completed: count(COMPLETED_CODE),
      projects,
      maxProjectCount,
    }
  }, [myWorkQuery.data, metaQuery.data])

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
      <div className="my-work__layout">
        <div className="my-work__content">
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

          <nav className="my-work__summary" aria-label="Hızlı görünümler">
            {SUMMARY_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="my-work__summary-link"
                aria-pressed={preset.isActive(filters)}
                onClick={() => updateFilters(preset.patch)}
              >
                {preset.label}
              </button>
            ))}
          </nav>

          {metaQuery.isError && pageProjects.length > 0 && (
            <p className="my-work__error" role="alert">
              {META_ERROR}
            </p>
          )}

          {myWorkQuery.isLoading && (
            <p className="my-work__status" role="status">
              {LOADING}
            </p>
          )}
          {myWorkQuery.isError && (
            <p className="my-work__error" role="alert">
              {GENERIC_ERROR}
            </p>
          )}
          {myWorkQuery.isSuccess && myWorkQuery.data.items.length === 0 && (
            <p className="my-work__empty">
              {hasActiveFilters ? NO_RESULTS : NO_ASSIGNMENTS}
            </p>
          )}

          {myWorkQuery.isSuccess && myWorkQuery.data.items.length > 0 && (
            <div className="my-work__groups">
              {groups.map(({ group, items }) => (
                <section
                  key={group.code}
                  className="my-work__group"
                  aria-labelledby={`my-work-group-${group.code}`}
                >
                  <h3
                    id={`my-work-group-${group.code}`}
                    className="my-work__group-heading"
                  >
                    <span>{group.label}</span>
                    <span className="my-work__group-count">{items.length}</span>
                  </h3>
                  <ul className="my-work__list" aria-label={group.label}>
                    {items.map((issue) => (
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
                </section>
              ))}
            </div>
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

        {myWorkQuery.isSuccess && myWorkQuery.data.items.length > 0 && (
          <aside className="my-work__rail" aria-label={WORKLOAD_LABEL}>
            <div className="my-work__rail-head">
              <h3 className="my-work__rail-title">{WORKLOAD_LABEL}</h3>
              <button
                type="button"
                className="my-work__rail-toggle"
                aria-expanded={railOpen}
                aria-controls="my-work-rail-body"
                onClick={() => setRailOpen((open) => !open)}
              >
                {railOpen ? 'Gizle' : 'Göster'}
              </button>
            </div>
            {railOpen && (
              <div id="my-work-rail-body" className="my-work__rail-body">
                <dl className="my-work__workload">
                  <div className="my-work__workload-row">
                    <dt>Atanan</dt>
                    <dd>{workload.assigned}</dd>
                  </div>
                  <div className="my-work__workload-row">
                    <dt>Sürüyor</dt>
                    <dd>{workload.inProgress}</dd>
                  </div>
                  <div className="my-work__workload-row">
                    <dt>Kuyruk</dt>
                    <dd>{workload.queue}</dd>
                  </div>
                  <div className="my-work__workload-row">
                    <dt>Tamamlanan</dt>
                    <dd>{workload.completed}</dd>
                  </div>
                </dl>
                {workload.projects.length > 0 && (
                  <div className="my-work__rail-projects">
                    <h4 className="my-work__rail-subtitle">Aktif projeler</h4>
                    <div className="my-work__project-bars">
                      {workload.projects.map((project) => (
                        <div key={project.key} className="my-work__project-bar">
                          <span className="my-work__project-bar-label">
                            {project.name}
                          </span>
                          <span className="my-work__project-bar-track">
                            <span
                              className="my-work__project-bar-fill"
                              style={{
                                width: workload.maxProjectCount === 0
                                  ? '0%'
                                  : `${Math.round((project.count / workload.maxProjectCount) * 100)}%`,
                              }}
                            />
                          </span>
                          <span className="my-work__project-bar-count">
                            {project.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
