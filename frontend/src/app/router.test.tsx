import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from './router'
import { SessionContext } from './session'
import type { SessionContextValue } from './session'
import { MyWorkPlaceholder } from '../features/my-work/MyWorkPlaceholder'
import type { ProjectDetail, ProjectMember } from '../features/projects/types'
import type { IssuePage } from '../features/issues/types'

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
} from '../features/projects/projectsApi'
import { listIssues } from '../features/issues/issuesApi'

const getProjectMock = getProject as Mock
const listProjectMembersMock = listProjectMembers as Mock
const listIssuesMock = listIssues as Mock

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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const memoryRouter = createMemoryRouter(routes, {
    initialEntries: ['/projects/MES/board'],
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
    listIssuesMock.mockReset()
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
    expect(screen.getByText('İssue’lar')).toBeInTheDocument()
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

  it('renders the My Work placeholder with a named future-package message', () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <SessionContext.Provider value={anonymousSession}>
          <MyWorkPlaceholder />
        </SessionContext.Provider>
      </QueryClientProvider>,
    )

    expect(
      screen.getByRole('heading', { name: 'Görevlerim', level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Görevlerim ekranı sonraki pakette tamamlanacak.'),
    ).toBeInTheDocument()
  })
})
