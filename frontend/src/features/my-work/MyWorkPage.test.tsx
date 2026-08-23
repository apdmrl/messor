import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { PageResponse, ProjectDetail, ProjectMember, ProjectSummary } from '../projects/types'
import type { Issue, IssuePage } from '../issues/types'
import { MyWorkPage } from './MyWorkPage'

const projectDetail: ProjectDetail = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  key: 'ALPHA',
  name: 'Alpha Project',
  description: null,
  currentUserRole: 'PROJECT_LEAD',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  workflowStatuses: [
    { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
    { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
  ],
}

const projectSummary: ProjectSummary = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  key: 'ALPHA',
  name: 'Alpha Project',
  description: null,
  currentUserRole: 'PROJECT_LEAD',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const member: ProjectMember = {
  userId: '22222222-2222-2222-2222-222222222222',
  email: 'member@demo.messor.app',
  firstName: 'Grace',
  lastName: 'Hopper',
  role: 'MEMBER',
  version: 1,
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'a0000000-0000-0000-0000-000000000001',
    issueKey: 'ALPHA-1',
    projectKey: 'ALPHA',
    number: 1,
    type: 'TASK',
    title: 'First task',
    description: 'A description',
    statusCode: 'IN_PROGRESS',
    reporterId: '22222222-2222-2222-2222-222222222222',
    assigneeId: '22222222-2222-2222-2222-222222222222',
    rank: 1024,
    archived: false,
    version: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const issue = makeIssue()

const emptyPage: IssuePage = {
  items: [],
  page: 0,
  size: 20,
  totalItems: 0,
  totalPages: 0,
}

const pageWithIssues: IssuePage = {
  items: [issue],
  page: 0,
  size: 20,
  totalItems: 1,
  totalPages: 1,
}

const multiPage: IssuePage = {
  items: [issue],
  page: 0,
  size: 1,
  totalItems: 3,
  totalPages: 3,
}

vi.mock('../projects/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../projects/projectsApi')>()
  return {
    ...actual,
    listProjects: vi.fn(),
    getProject: vi.fn(),
    listProjectMembers: vi.fn(),
  }
})

vi.mock('./myWorkApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./myWorkApi')>()
  return {
    ...actual,
    listMyWork: vi.fn(),
  }
})

import { listProjects, getProject, listProjectMembers } from '../projects/projectsApi'
import { listMyWork } from './myWorkApi'

const listProjectsMock = listProjects as Mock
const getProjectMock = getProject as Mock
const listProjectMembersMock = listProjectMembers as Mock
const listMyWorkMock = listMyWork as Mock

function renderMyWork(
  initialEntry = '/my-work',
): ReturnType<typeof createMemoryRouter> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const memoryRouter = createMemoryRouter(
    [
      { path: '/my-work', element: <MyWorkPage /> },
      {
        path: '/projects/:projectKey/issues/:issueKey',
        element: <div>Drawer route rendered</div>,
      },
    ],
    { initialEntries: [initialEntry] },
  )
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={memoryRouter} />
    </QueryClientProvider>,
  )
  return memoryRouter
}

describe('MyWorkPage', () => {
  beforeEach(() => {
    listProjectsMock.mockReset()
    listMyWorkMock.mockReset()
    getProjectMock.mockReset()
    listProjectMembersMock.mockReset()

    listProjectsMock.mockResolvedValue({
      items: [projectSummary],
      page: 0,
      size: 100,
      totalItems: 1,
      totalPages: 1,
    } as PageResponse<ProjectSummary>)
    getProjectMock.mockResolvedValue(projectDetail)
    listProjectMembersMock.mockResolvedValue([member])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders controlled labels, never raw ids or status codes', async () => {
    listMyWorkMock.mockResolvedValue(pageWithIssues)
    renderMyWork()

    expect(
      await screen.findByRole('heading', { name: 'Görevlerim', level: 2 }),
    ).toBeInTheDocument()
    expect(await screen.findByText('First task')).toBeInTheDocument()

    const item = await screen.findByRole('listitem')
    expect(within(item).getByText('ALPHA-1')).toBeInTheDocument()
    expect(await within(item).findByText('Alpha Project')).toBeInTheDocument()
    expect(await within(item).findByText('Sürüyor')).toBeInTheDocument()
    expect(await within(item).findByText('Grace Hopper')).toBeInTheDocument()
    expect(within(item).getByText('Görev')).toBeInTheDocument()

    // Raw member id and raw status code must never appear as text.
    const body = document.body.textContent ?? ''
    expect(body).not.toContain(member.userId)
    expect(body).not.toContain('IN_PROGRESS')
  })

  it('renders the empty state', async () => {
    listMyWorkMock.mockResolvedValue(emptyPage)
    renderMyWork()

    expect(
      await screen.findByText('Sana atanmış iş bulunamadı.'),
    ).toBeInTheDocument()
  })

  it('renders a safe error state without backend detail', async () => {
    listMyWorkMock.mockRejectedValue(
      new Error('internal my-work secret detail must not leak'),
    )
    renderMyWork()

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('Görevlerim yüklenemedi. Lütfen tekrar deneyin.')
    expect(document.body.textContent).not.toContain('internal my-work secret detail')
  })

  it('navigates to the route-backed drawer when an issue is selected', async () => {
    listMyWorkMock.mockResolvedValue(pageWithIssues)
    const user = userEvent.setup()
    renderMyWork()

    const link = await screen.findByRole('link', { name: /First task/ })
    await user.click(link)
    expect(
      await screen.findByText('Drawer route rendered'),
    ).toBeInTheDocument()
  })

  it('shows pagination and moves to the next page via the URL', async () => {
    listMyWorkMock.mockResolvedValue(multiPage)
    const user = userEvent.setup()
    renderMyWork()

    const next = await screen.findByRole('button', { name: 'Sonraki' })
    expect(screen.getByText('Sayfa 1 / 3')).toBeInTheDocument()

    await user.click(next)
    // The URL gains page=1 and the query keyed on the effective filters refetches.
    await waitFor(() => {
      expect(listMyWorkMock).toHaveBeenCalledTimes(2)
    })
    const lastCall = listMyWorkMock.mock.calls[1][0] as { page: number }
    expect(lastCall.page).toBe(1)
  })

  it('resets the page to 0 when a filter changes', async () => {
    listMyWorkMock.mockResolvedValue(multiPage)
    const user = userEvent.setup()
    renderMyWork('/my-work?page=2')

    // Filters live behind the compact `Filtreler` disclosure until expanded.
    await user.click(await screen.findByRole('button', { name: /Filtreler/ }))
    const type = await screen.findByLabelText('Tür')
    await user.selectOptions(type, 'BUG')

    await waitFor(() => {
      const calls = listMyWorkMock.mock.calls
      const last = calls[calls.length - 1][0] as { page: number; type: string | null }
      expect(last.page).toBe(0)
      expect(last.type).toBe('BUG')
    })
  })

  it('marks archived issues as read-only with no mutation controls', async () => {
    listMyWorkMock.mockResolvedValue({
      ...pageWithIssues,
      items: [makeIssue({ archived: true, statusCode: 'TO_DO' })],
    })
    renderMyWork()

    expect(
      await screen.findByText('Arşivlenmiş'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Arşivle|Düzenle|Sil/ })).toBeNull()
  })

  it('does not render an assignee filter selector', async () => {
    listMyWorkMock.mockResolvedValue(pageWithIssues)
    const user = userEvent.setup()
    renderMyWork()

    await screen.findByText('First task')
    // My Work is principal-scoped: there is no "Atanan" filter control, even
    // once the filter panel is expanded.
    await user.click(screen.getByRole('button', { name: /Filtreler/ }))
    expect(screen.queryByLabelText('Atanan')).toBeNull()
    expect(screen.queryByLabelText('Tüm atananlar')).toBeNull()
  })

  it('never sends an assignee parameter to the My Work API', async () => {
    listMyWorkMock.mockResolvedValue(pageWithIssues)
    // A hostile/legacy assignee value in the URL must be dropped.
    renderMyWork('/my-work?assignee=user-9')

    await screen.findByText('First task')
    const lastCall = listMyWorkMock.mock.calls.at(-1)?.[0] as { assignee: string | null }
    expect(lastCall.assignee).toBeNull()
  })

  it('canonicalizes a hostile direct URL by replace, without a history entry', async () => {
    listMyWorkMock.mockResolvedValue(pageWithIssues)
    const router = renderMyWork('/my-work?assignee=victim&page=1&page=2')

    await screen.findByText('First task')
    // The URL is normalized to the canonical (empty) search via replace.
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    // The request used only the canonical effective state (no assignee).
    const lastCall = listMyWorkMock.mock.calls.at(-1)?.[0] as {
      assignee: string | null
      page: number
    }
    expect(lastCall.assignee).toBeNull()
    expect(lastCall.page).toBe(0)
    expect(listMyWorkMock).toHaveBeenCalledTimes(1)
  })

  it('groups the queue into in-progress, queue, and completed sections', async () => {
    listMyWorkMock.mockResolvedValue({
      items: [
        makeIssue({ issueKey: 'ALPHA-3', number: 3, statusCode: 'TO_DO' }),
        makeIssue({ issueKey: 'ALPHA-2', number: 2, statusCode: 'DONE' }),
        makeIssue(),
      ],
      page: 0,
      size: 20,
      totalItems: 3,
      totalPages: 1,
    })
    renderMyWork()

    // Each group heading carries its count as part of its accessible name.
    expect(
      await screen.findByRole('heading', { name: /Sürüyor\s*1/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Kuyruk\s*1/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Son tamamlananlar\s*1/ }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('summary status preset filters to that status and resets the page', async () => {
    listMyWorkMock.mockResolvedValue(pageWithIssues)
    const user = userEvent.setup()
    renderMyWork('/my-work?page=2')

    await screen.findByText('First task')
    await user.click(screen.getByRole('button', { name: 'Kuyruk' }))

    await waitFor(() => {
      const calls = listMyWorkMock.mock.calls
      const last = calls[calls.length - 1][0] as { status: string | null; page: number }
      expect(last.status).toBe('TO_DO')
      expect(last.page).toBe(0)
    })
  })

  it('summary recency preset applies a supported sort and resets the page', async () => {
    listMyWorkMock.mockResolvedValue(pageWithIssues)
    const user = userEvent.setup()
    renderMyWork('/my-work?page=3')

    await screen.findByText('First task')
    await user.click(screen.getByRole('button', { name: 'Son güncellenen' }))

    await waitFor(() => {
      const calls = listMyWorkMock.mock.calls
      const last = calls[calls.length - 1][0] as {
        sort: { field: string; direction: string }
        page: number
      }
      expect(last.sort.field).toBe('updatedAt')
      expect(last.sort.direction).toBe('desc')
      expect(last.page).toBe(0)
    })
  })

  it('distinguishes no-results from no assignments when a filter is active', async () => {
    listMyWorkMock.mockResolvedValue(emptyPage)
    renderMyWork('/my-work?status=IN_PROGRESS')

    expect(
      await screen.findByText('Seçili filtrelerle eşleşen iş bulunamadı.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Sana atanmış iş bulunamadı.')).toBeNull()
  })

  it('renders the pending state while loading', async () => {
    listMyWorkMock.mockReturnValue(new Promise<IssuePage>(() => {}))
    renderMyWork()

    expect(
      await screen.findByText('Görevlerim yükleniyor…'),
    ).toBeInTheDocument()
  })

  it('renders the workload rail with counts and per-project numeric bars', async () => {
    listMyWorkMock.mockResolvedValue({
      items: [
        makeIssue({ statusCode: 'IN_PROGRESS' }),
        makeIssue({ issueKey: 'ALPHA-2', number: 2, statusCode: 'TO_DO' }),
      ],
      page: 0,
      size: 20,
      totalItems: 2,
      totalPages: 1,
    })
    renderMyWork()

    const rail = await screen.findByRole('complementary', { name: 'İş yükü' })
    expect(within(rail).getByText('Bu sayfadaki işler.')).toBeInTheDocument()
    expect(within(rail).getByText('Sürüyor')).toBeInTheDocument()
    expect(within(rail).getByText('Kuyruk')).toBeInTheDocument()
    expect(within(rail).getByText('Tamamlanan')).toBeInTheDocument()
    // Per-project active-work bar label and count (name resolves after meta).
    expect(await within(rail).findByText('Alpha Project')).toBeInTheDocument()
    expect(within(rail).getByText('2')).toBeInTheDocument()
  })

  it('labels the workload rail as current-page and never shows a global aggregate', async () => {
    // totalItems is 3 but only 1 item is on this page; the rail must show only
    // the page-local count, never the global total.
    listMyWorkMock.mockResolvedValue(multiPage)
    renderMyWork()

    const rail = await screen.findByRole('complementary', { name: 'İş yükü' })
    expect(within(rail).getByText('Bu sayfadaki işler.')).toBeInTheDocument()
    expect(within(rail).getAllByText('1').length).toBeGreaterThan(0)
    expect(within(rail).queryByText('3')).toBeNull()
  })

  it('keeps the workload rail page-scoped when a filter is active', async () => {
    listMyWorkMock.mockResolvedValue(pageWithIssues)
    renderMyWork('/my-work?status=IN_PROGRESS')

    const rail = await screen.findByRole('complementary', { name: 'İş yükü' })
    expect(within(rail).getByText('Bu sayfadaki işler.')).toBeInTheDocument()
  })

  it('collapses the rail so the column contracts while staying reachable', async () => {
    listMyWorkMock.mockResolvedValue(pageWithIssues)
    const user = userEvent.setup()
    renderMyWork()

    const rail = await screen.findByRole('complementary', { name: 'İş yükü' })
    const layout = rail.parentElement as HTMLElement
    expect(layout.className).not.toContain('my-work__layout--rail-collapsed')

    await user.click(within(rail).getByRole('button', { name: 'Gizle' }))

    // The column contracts: the layout switches to a narrow rail track.
    expect(layout.className).toContain('my-work__layout--rail-collapsed')
    // The disclosure target stays mounted (hidden) so aria-controls resolves.
    const body = document.getElementById('my-work-rail-body') as HTMLElement
    expect(body).not.toBeNull()
    expect(body.hidden).toBe(true)
    expect(
      within(rail).getByRole('button', { name: 'Göster' }),
    ).toBeInTheDocument()
  })
})
