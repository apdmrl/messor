import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import type { UserSummary } from '../features/auth/types'
import type { PageResponse, ProjectSummary } from '../features/projects/types'

const adminUser: UserSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'admin@demo.messor.app',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'ORG_ADMIN',
}

const emptyProjects: PageResponse<ProjectSummary> = {
  items: [],
  page: 0,
  size: 100,
  totalItems: 0,
  totalPages: 0,
}

vi.mock('../features/auth/authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/auth/authApi')>()
  return {
    ...actual,
    getCurrentUser: vi.fn(),
  }
})

vi.mock('../features/projects/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../features/projects/projectsApi')
  >()
  return {
    ...actual,
    listProjects: vi.fn(),
    getProject: vi.fn(),
    listProjectMembers: vi.fn(),
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
  }
})

import { getCurrentUser } from '../features/auth/authApi'
import {
  getProject,
  listProjectMembers,
  listProjects,
} from '../features/projects/projectsApi'
import { listMyWork } from '../features/my-work/myWorkApi'
import { listIssues } from '../features/issues/issuesApi'

const getCurrentUserMock = getCurrentUser as Mock
const listProjectsMock = listProjects as Mock
const listMyWorkMock = listMyWork as Mock
const getProjectMock = getProject as Mock
const listProjectMembersMock = listProjectMembers as Mock
const listIssuesMock = listIssues as Mock

function renderAt(path: string): void {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  render(<App />)
}

describe('product smoke', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset()
    listProjectsMock.mockReset()
    listProjectsMock.mockResolvedValue(emptyProjects)
    listMyWorkMock.mockReset()
    listMyWorkMock.mockResolvedValue({
      items: [],
      page: 0,
      size: 20,
      totalItems: 0,
      totalPages: 0,
    })
    getProjectMock.mockReset()
    listProjectMembersMock.mockReset()
    listProjectMembersMock.mockResolvedValue([])
    listIssuesMock.mockReset()
    listIssuesMock.mockResolvedValue({
      items: [],
      page: 0,
      size: 20,
      totalItems: 0,
      totalPages: 0,
    })
    window.history.pushState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('bootstraps an authenticated user through the real app and lands on projects', async () => {
    getCurrentUserMock.mockResolvedValue(adminUser)
    renderAt('/projects')

    expect(
      await screen.findByRole('heading', { name: 'Projeler', level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Messor', level: 1 }),
    ).toBeInTheDocument()
  })

  it('navigates the real shell to My Work and back to Projects', async () => {
    getCurrentUserMock.mockResolvedValue(adminUser)
    renderAt('/projects')

    await screen.findByRole('heading', { name: 'Projeler', level: 2 })

    const u = userEvent.setup()
    await u.click(screen.getByRole('link', { name: 'Görevlerim' }))

    expect(
      await screen.findByRole('heading', { name: 'Görevlerim', level: 2 }),
    ).toBeInTheDocument()

    await u.click(screen.getByRole('link', { name: 'Projeler' }))

    expect(
      await screen.findByRole('heading', { name: 'Projeler', level: 2 }),
    ).toBeInTheDocument()
  })

  it('renders the neutral not-found boundary for an invalid deep route', async () => {
    getCurrentUserMock.mockResolvedValue(adminUser)
    renderAt('/definitely/not/a/route')

    expect(
      await screen.findByRole('heading', { name: 'Sayfa bulunamadı' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Projelere dön' }),
    ).toBeInTheDocument()
  })

  it('renders an anonymous user at the login screen', async () => {
    getCurrentUserMock.mockResolvedValue(null)
    renderAt('/projects')

    expect(
      await screen.findByRole('heading', { name: 'Oturum aç', level: 2 }),
    ).toBeInTheDocument()
  })
})
