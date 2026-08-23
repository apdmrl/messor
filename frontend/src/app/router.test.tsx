import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from './router'
import { SessionContext } from './session'
import type { SessionContextValue } from './session'
import { ApiError } from './apiClient'
import type {
  PageResponse,
  ProjectDetail,
  ProjectMember,
  ProjectRole,
  ProjectSummary,
} from '../features/projects/types'
import type { Issue, IssuePage } from '../features/issues/types'

const projectDetail: ProjectDetail = {
  id: '11111111-1111-1111-1111-111111111111',
  key: 'MES',
  name: 'Messor',
  description: null,
  currentUserRole: 'PROJECT_LEAD',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  workflowStatuses: [
    { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
    { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
    { code: 'DONE', displayName: 'Bitti', position: 2 },
  ],
}

const emptyProjectsPage: PageResponse<ProjectSummary> = {
  items: [],
  page: 0,
  size: 100,
  totalItems: 0,
  totalPages: 0,
}
const emptyPage: IssuePage = {
  items: [],
  page: 0,
  size: 100,
  totalItems: 0,
  totalPages: 0,
}

vi.mock('../features/projects/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/projects/projectsApi')>()
  return {
    ...actual,
    getProject: vi.fn(),
    listProjectMembers: vi.fn(),
    listProjects: vi.fn(),
  }
})

vi.mock('../features/my-work/myWorkApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/my-work/myWorkApi')>()
  return {
    ...actual,
    listMyWork: vi.fn(),
  }
})

vi.mock('../features/issues/issuesApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/issues/issuesApi')>()
  return {
    ...actual,
    listIssues: vi.fn(),
    getIssue: vi.fn(),
    listIssueActivity: vi.fn(),
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    archiveIssue: vi.fn(),
  }
})

import {
  getProject,
  listProjectMembers,
  listProjects,
} from '../features/projects/projectsApi'
import { getIssue, listIssueActivity, listIssues } from '../features/issues/issuesApi'
import { listMyWork } from '../features/my-work/myWorkApi'

const getProjectMock = getProject as Mock
const listProjectMembersMock = listProjectMembers as Mock
const listProjectsMock = listProjects as Mock
const listMyWorkMock = listMyWork as Mock
const listIssuesMock = listIssues as Mock
const getIssueMock = getIssue as Mock
const listIssueActivityMock = listIssueActivity as Mock

const authenticatedSession: SessionContextValue = {
  session: {
    status: 'authenticated',
    user: {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'admin@demo.messor.app',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'ORG_ADMIN',
    },
  },
  bootstrap: () => {},
  handleAuthenticated: () => {},
  handleLogout: async () => {},
  logoutPending: false,
  logoutError: null,
}

const anonymousSession: SessionContextValue = {
  session: { status: 'anonymous' },
  bootstrap: () => {},
  handleAuthenticated: () => {},
  handleLogout: async () => {},
  logoutPending: false,
  logoutError: null,
}

function renderRouter(session: SessionContextValue): void {
  renderRouterAt(session, ['/projects/MES/board'])
}

function renderRouterAt(
  session: SessionContextValue,
  initialEntries: string[],
): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const memoryRouter = createMemoryRouter(routes, {
    initialEntries,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={session}>
        <RouterProvider router={memoryRouter} />
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('router', () => {
  beforeEach(() => {
    getProjectMock.mockReset()
    listProjectMembersMock.mockReset()
    listProjectsMock.mockReset()
    listMyWorkMock.mockReset()
    listIssuesMock.mockReset()
    getIssueMock.mockReset()
    listIssueActivityMock.mockReset()
  })

  it('routes /projects/:projectKey/board to the issue workspace for an authenticated user', async () => {
    getProjectMock.mockResolvedValue(projectDetail)
    listProjectMembersMock.mockResolvedValue([] as ProjectMember[])
    listIssuesMock.mockResolvedValue(emptyPage)
    renderRouter(authenticatedSession)

    expect(
      await screen.findByRole('heading', { name: 'Messor', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('MES')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'İşler' })).toBeInTheDocument()
  })

  it('renders the issue drawer for a direct /projects/:projectKey/issues/:issueKey load', async () => {
    const issue: Issue = {
      id: 'i-1',
      issueKey: 'MES-1',
      projectKey: 'MES',
      number: 1,
      type: 'TASK',
      title: 'First task',
      description: 'A description',
      statusCode: 'TO_DO',
      reporterId: '11111111-1111-1111-1111-111111111111',
      assigneeId: null,
      rank: 0,
      archived: false,
      version: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    getProjectMock.mockResolvedValue(projectDetail)
    listProjectMembersMock.mockResolvedValue([] as ProjectMember[])
    listIssuesMock.mockResolvedValue(emptyPage)
    getIssueMock.mockResolvedValue(issue)
    listIssueActivityMock.mockResolvedValue([])
    renderRouterAt(authenticatedSession, ['/projects/MES/issues/MES-1'])

    expect(
      await screen.findByRole('dialog', { name: 'MES-1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'MES-1', level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Aktivite' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Yorumlar' })).toBeInTheDocument()
  })

  it('routes /projects/:projectKey/members to the members page for an authenticated user', async () => {
    getProjectMock.mockResolvedValue(projectDetail)
    listProjectMembersMock.mockResolvedValue([] as ProjectMember[])
    renderRouterAt(authenticatedSession, ['/projects/MES/members'])

    expect(
      await screen.findByRole('heading', {
        name: 'Üyeler ve erişim',
        level: 2,
      }),
    ).toBeInTheDocument()
    expect(listProjectMembersMock).toHaveBeenCalledWith('MES')
  })

  it('redirects an anonymous user away from the protected board route to login', async () => {
    renderRouter(anonymousSession)

    // The login screen's unique support text renders after the redirect.
    await waitFor(() => {
      expect(
        screen.getByText('Çalışma alanına devam etmek için bilgilerini gir.'),
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('heading', { name: 'Messor', level: 2 }),
    ).not.toBeInTheDocument()
  })

  it('renders the My Work screen at /my-work for an authenticated user', async () => {
    listProjectsMock.mockResolvedValue({
      items: [] as ProjectSummary[],
      page: 0,
      size: 100,
      totalItems: 0,
      totalPages: 0,
    } as PageResponse<ProjectSummary>)
    listMyWorkMock.mockResolvedValue(emptyPage)
    renderRouterAt(authenticatedSession, ['/my-work'])

    expect(
      await screen.findByRole('heading', { name: 'Görevlerim', level: 2 }),
    ).toBeInTheDocument()
    expect(listMyWorkMock).toHaveBeenCalled()
  })
})

describe('authenticated shell', () => {
  beforeEach(() => {
    listProjectsMock.mockReset()
    listProjectsMock.mockResolvedValue(emptyProjectsPage)
  })

  it('renders the top bar, triggers, rail, and account menu for an authenticated user', async () => {
    renderRouterAt(authenticatedSession, ['/projects'])

    expect(
      await screen.findByRole('heading', { name: 'Messor', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Çalışma alanı')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Ara' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Oluştur' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sinyaller' })).toBeInTheDocument()

    const rail = screen.getByRole('navigation', { name: 'Ana gezinme' })
    expect(within(rail).getByRole('link', { name: 'Projeler' })).toBeInTheDocument()
    expect(
      within(rail).getByRole('link', { name: 'Görevlerim' }),
    ).toBeInTheDocument()

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Organizasyon yöneticisi')).toBeInTheDocument()
    expect(screen.getByText('admin@demo.messor.app')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Çıkış yap' }),
    ).toBeInTheDocument()
  })

  it('marks the active rail link with aria-current', async () => {
    renderRouterAt(authenticatedSession, ['/projects'])

    await screen.findByRole('heading', { name: 'Projeler', level: 2 })

    expect(screen.getByRole('link', { name: 'Projeler' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen.getByRole('link', { name: 'Görevlerim' }),
    ).not.toHaveAttribute('aria-current')
  })

  it('collapses and expands the project rail via the toggle', async () => {
    const user = userEvent.setup()
    renderRouterAt(authenticatedSession, ['/projects'])
    await screen.findByRole('heading', { name: 'Projeler', level: 2 })

    const expandToggle = screen.getByRole('button', {
      name: 'Proje çubuğunu daralt',
    })
    expect(expandToggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(expandToggle)
    expect(
      screen.getByRole('button', { name: 'Proje çubuğunu genişlet' }),
    ).toHaveAttribute('aria-expanded', 'false')

    await user.click(
      screen.getByRole('button', { name: 'Proje çubuğunu genişlet' }),
    )
    expect(
      screen.getByRole('button', { name: 'Proje çubuğunu daralt' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes the account menu on Escape and restores focus to the summary', async () => {
    const user = userEvent.setup()
    renderRouterAt(authenticatedSession, ['/projects'])
    await screen.findByRole('heading', { name: 'Projeler', level: 2 })

    const summary = screen
      .getByText('Ada Lovelace')
      .closest('summary') as HTMLElement
    await user.click(summary)

    const details = summary.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(true)

    await user.keyboard('{Escape}')

    expect(details.open).toBe(false)
    expect(summary).toHaveFocus()
  })

  function renderProject(role: ProjectRole): void {
    getProjectMock.mockResolvedValue({ ...projectDetail, currentUserRole: role })
    listProjectMembersMock.mockResolvedValue([] as ProjectMember[])
    listIssuesMock.mockResolvedValue(emptyPage)
    renderRouterAt(authenticatedSession, ['/projects/MES/board'])
  }


  it("renders project navigation with only routes registered by the router", async () => {
    renderProject("PROJECT_LEAD")
    await screen.findByRole("heading", { name: "Messor", level: 2 })

    const rail = screen.getByRole("navigation", { name: "Ana gezinme" })
    expect(within(rail).getByRole("link", { name: "Pano" })).toHaveAttribute(
      "href",
      "/projects/MES/board",
    )
    expect(within(rail).getByRole("link", { name: "Ayarlar" })).toHaveAttribute(
      "href",
      "/projects/MES/settings",
    )
    expect(within(rail).getByRole("link", { name: "Pano" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(
      within(rail).getByRole("link", { name: "Projeler" }),
    ).not.toHaveAttribute("aria-current")
    // No dead links: only destinations with registered routes are shown.
    expect(
      within(rail).queryByRole("link", { name: "İşler" }),
    ).not.toBeInTheDocument()
    expect(
      within(rail).queryByRole("link", { name: "Aktivite" }),
    ).not.toBeInTheDocument()
    expect(
      within(rail).queryByRole("link", { name: "Üyeler" }),
    ).not.toBeInTheDocument()
  })

  it("hides lead-only project links for a project member", async () => {
    renderProject("MEMBER")
    await screen.findByRole("heading", { name: "Messor", level: 2 })

    const rail = screen.getByRole("navigation", { name: "Ana gezinme" })
    expect(within(rail).getByRole("link", { name: "Pano" })).toBeInTheDocument()
    expect(
      within(rail).queryByRole("link", { name: "Ayarlar" }),
    ).not.toBeInTheDocument()
  })

  it("keeps primary navigation accessible across rail collapse states", async () => {
    const user = userEvent.setup()
    renderRouterAt(authenticatedSession, ["/projects"])
    await screen.findByRole("heading", { name: "Projeler", level: 2 })

    const rail = screen.getByRole("navigation", { name: "Ana gezinme" })
    expect(
      within(rail).getByRole("link", { name: "Projeler" }),
    ).toBeInTheDocument()
    expect(
      within(rail).getByRole("link", { name: "Görevlerim" }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Proje çubuğunu daralt" }),
    )
    expect(
      screen.getByRole("button", { name: "Proje çubuğunu genişlet" }),
    ).toHaveAttribute("aria-expanded", "false")
    expect(
      within(rail).getByRole("link", { name: "Projeler" }),
    ).toBeInTheDocument()
    expect(
      within(rail).getByRole("link", { name: "Görevlerim" }),
    ).toBeInTheDocument()

  })
})

describe('shared route boundaries', () => {
  const loadingSession: SessionContextValue = {
    session: { status: 'loading' },
    bootstrap: () => {},
    handleAuthenticated: () => {},
    handleLogout: async () => {},
    logoutPending: false,
    logoutError: null,
  }

  const errorSession: SessionContextValue = {
    session: { status: 'error' },
    bootstrap: () => {},
    handleAuthenticated: () => {},
    handleLogout: async () => {},
    logoutPending: false,
    logoutError: null,
  }

  it('renders the neutral not-found boundary for an invalid route', async () => {
    renderRouterAt(authenticatedSession, ['/no/such/route'])

    expect(
      await screen.findByRole('heading', { name: 'Sayfa bulunamadı' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Projelere dön' }),
    ).toHaveAttribute('href', '/projects')
  })

  it('renders a neutral restricted boundary for an inaccessible project route', async () => {
    getProjectMock.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'denied'))
    renderRouterAt(authenticatedSession, ['/projects/MES/board'])

    expect(
      await screen.findByRole('heading', { name: 'Erişim kısıtlı' }),
    ).toBeInTheDocument()
    // Neutral: the board content and project identity must not render.
    expect(
      screen.queryByRole('heading', { name: 'İşler' }),
    ).not.toBeInTheDocument()
    const body = document.body.textContent ?? ''
    expect(body).not.toContain('denied')
    // The project rail must not advertise the inaccessible project.
    expect(
      screen.queryByRole('link', { name: 'Pano' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projelere dön' })).toHaveAttribute(
      'href',
      '/projects',
    )
  })

  it('does not gate project routes on a missing project to a forbidden or missing state', async () => {
    // A project the member can read renders normally (not restricted).
    getProjectMock.mockResolvedValue({ ...projectDetail, currentUserRole: 'MEMBER' })
    listProjectMembersMock.mockResolvedValue([] as ProjectMember[])
    listIssuesMock.mockResolvedValue(emptyPage)
    renderRouterAt(authenticatedSession, ['/projects/MES/board'])

    expect(
      await screen.findByRole('heading', { name: 'İşler' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Erişim kısıtlı' }),
    ).not.toBeInTheDocument()
  })

  it('shows the loading boundary while the session is resolving', async () => {
    renderRouterAt(loadingSession, ['/projects'])

    expect(
      await screen.findByRole('heading', { name: 'Yükleniyor…' }),
    ).toBeInTheDocument()
    // Must not bounce to login before the session settles.
    expect(
      screen.queryByRole('heading', { name: 'Oturum aç', level: 2 }),
    ).not.toBeInTheDocument()
  })

  it('redirects a failed session to login', async () => {
    renderRouterAt(errorSession, ['/projects'])

    await waitFor(() => {
      expect(
        screen.getByText('Çalışma alanına devam etmek için bilgilerini gir.'),
      ).toBeInTheDocument()
    })
  })
})
