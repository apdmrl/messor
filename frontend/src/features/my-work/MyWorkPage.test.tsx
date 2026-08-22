import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

function renderMyWork(initialEntry = '/my-work'): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/my-work" element={<MyWorkPage />} />
          <Route
            path="/projects/:projectKey/issues/:issueKey"
            element={<div>Drawer route rendered</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
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
})
