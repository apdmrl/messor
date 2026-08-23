import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '../../app/apiClient'
import { SessionContext } from '../../app/session'
import type { SessionContextValue } from '../../app/session'
import { MembersPage } from './MembersPage'
import type { ProjectDetail, ProjectMember } from './types'

const projectDetail: ProjectDetail = {
  id: '11111111-1111-1111-1111-111111111111',
  key: 'MES',
  name: 'Messor',
  description: null,
  currentUserRole: 'PROJECT_LEAD',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  workflowStatuses: [],
}

const adminMember: ProjectMember = {
  userId: '11111111-1111-1111-1111-111111111111',
  email: 'admin@demo.messor.app',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'PROJECT_LEAD',
  version: 1,
}

const memberMember: ProjectMember = {
  userId: '22222222-2222-2222-2222-222222222222',
  email: 'member@demo.messor.app',
  firstName: 'Grace',
  lastName: 'Hopper',
  role: 'MEMBER',
  version: 2,
}

const viewerMember: ProjectMember = {
  userId: '33333333-3333-3333-3333-333333333333',
  email: 'viewer@demo.messor.app',
  firstName: 'Katherine',
  lastName: 'Johnson',
  role: 'VIEWER',
  version: 3,
}

vi.mock('./projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./projectsApi')>()
  return {
    ...actual,
    getProject: vi.fn(),
  }
})

vi.mock('./membershipApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./membershipApi')>()
  return {
    ...actual,
    listProjectMembers: vi.fn(),
    changeProjectMemberRole: vi.fn(),
    removeProjectMember: vi.fn(),
  }
})

import { getProject } from './projectsApi'
import {
  changeProjectMemberRole,
  listProjectMembers,
  removeProjectMember,
} from './membershipApi'

const getProjectMock = getProject as Mock
const listProjectMembersMock = listProjectMembers as Mock
const changeProjectMemberRoleMock = changeProjectMemberRole as Mock
const removeProjectMemberMock = removeProjectMember as Mock

const sessionValue: SessionContextValue = {
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

function renderMembersPage(projectKey = 'MES'): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={[`/projects/${projectKey}/members`]}>
          <Routes>
            <Route
              path="/projects/:projectKey/members"
              element={<MembersPage />}
            />
            <Route
              path="/projects/:projectKey/board"
              element={<div>BOARD</div>}
            />
            <Route
              path="/projects/:projectKey/settings"
              element={<div>SETTINGS</div>}
            />
            <Route path="/projects" element={<div>PROJECTS</div>} />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('MembersPage', () => {
  beforeEach(() => {
    getProjectMock.mockReset()
    listProjectMembersMock.mockReset()
    changeProjectMemberRoleMock.mockReset()
    removeProjectMemberMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('page states', () => {
    it('shows loading status and access legend', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockImplementation(
        () => new Promise<ProjectMember[]>(() => {}),
      )
      renderMembersPage()

      expect(
        screen.getByRole('heading', { name: 'Üyeler ve erişim', level: 2 }),
      ).toBeInTheDocument()
      expect(screen.getByText('Üyelikler yükleniyor…')).toBeInTheDocument()
      expect(
        screen.getByText('Erişim düzeyleri', { exact: false }),
      ).toBeInTheDocument()
    })

    it('shows a safe project-detail error without leaking backend detail', async () => {
      getProjectMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal project secret'),
      )
      listProjectMembersMock.mockResolvedValue([adminMember])
      renderMembersPage()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal project secret')
    })

    it('fails closed when project detail errors even if members load', async () => {
      getProjectMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal secret'),
      )
      listProjectMembersMock.mockResolvedValue([adminMember])
      renderMembersPage()

      await screen.findByRole('alert')
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('Ada Lovelace')
      expect(body).not.toContain('admin@demo.messor.app')
      expect(
        screen.queryByRole('button', { name: 'Ada Lovelace rolünü değiştir' }),
      ).not.toBeInTheDocument()
    })

    it('shows an empty state when there are no members', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([])
      renderMembersPage()

      expect(
        await screen.findByText('Henüz proje üyesi yok.'),
      ).toBeInTheDocument()
    })

    it('shows a safe member-list error without leaking backend detail', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal member list secret'),
      )
      renderMembersPage()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Üyelikler yüklenemedi. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal member list secret')
    })
  })

  describe('member table and access', () => {
    it('renders member rows with role and access summaries', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([
        adminMember,
        memberMember,
        viewerMember,
      ])
      renderMembersPage()

      const table = await screen.findByRole('table', {
        name: 'Proje üyeleri',
      })
      expect(
        within(table).getByText('Grace Hopper'),
      ).toBeInTheDocument()
      expect(
        within(table).getAllByText('member@demo.messor.app').length,
      ).toBeGreaterThan(0)
      // Role labels are shown as text for read access rows (lead edits via select).
      expect(within(table).getAllByText('İzleyici').length).toBeGreaterThan(0)
      // Access summary text renders per role.
      expect(
        within(table).getByText(
          'Yalnızca salt okunur erişime sahiptir.',
        ),
      ).toBeInTheDocument()
    })

    it('marks the current user with a Siz badge', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      renderMembersPage()

      await screen.findByRole('table', { name: 'Proje üyeleri' })
      expect(screen.getByText('Siz')).toBeInTheDocument()
    })

    it('filters members by name and email', async () => {
      const user = userEvent.setup()
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([
        adminMember,
        memberMember,
        viewerMember,
      ])
      renderMembersPage()

      const table = await screen.findByRole('table', {
        name: 'Proje üyeleri',
      })
      expect(within(table).getByText('Grace Hopper')).toBeInTheDocument()

      await user.type(screen.getByPlaceholderText('İsim veya e-posta'), 'hopper')

      expect(
        within(table).getByText('Grace Hopper'),
      ).toBeInTheDocument()
      expect(
        within(table).queryByText('Katherine Johnson'),
      ).not.toBeInTheDocument()

      await user.clear(screen.getByPlaceholderText('İsim veya e-posta'))
      await user.type(
        screen.getByPlaceholderText('İsim veya e-posta'),
        'viewer@demo.messor.app',
      )
      expect(
        within(table).queryByText('Grace Hopper'),
      ).not.toBeInTheDocument()
      expect(
        within(table).getByText('Katherine Johnson'),
      ).toBeInTheDocument()
    })

    it('shows a no-matches message when the filter matches nothing', async () => {
      const user = userEvent.setup()
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      renderMembersPage()

      await screen.findByRole('table', { name: 'Proje üyeleri' })
      await user.type(
        screen.getByPlaceholderText('İsim veya e-posta'),
        'no-such-user',
      )

      expect(
        await screen.findByText('Aradığın ölçütle eşleşen üye yok.'),
      ).toBeInTheDocument()
    })

    it('renders permission-aware navigation to board, settings and projects', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      renderMembersPage()

      await screen.findByRole('table', { name: 'Proje üyeleri' })
      expect(
        screen.getByRole('link', { name: 'Panoya dön' }),
      ).toHaveAttribute('href', '/projects/MES/board')
      expect(
        screen.getByRole('link', { name: 'Ayarlar' }),
      ).toHaveAttribute('href', '/projects/MES/settings')
      expect(
        screen.getByRole('link', { name: 'Projelere dön' }),
      ).toHaveAttribute('href', '/projects')
    })
  })

  describe('read-only and restricted states', () => {
    it('hides management controls for a MEMBER and shows a read-only notice', async () => {
      getProjectMock.mockResolvedValue({
        ...projectDetail,
        currentUserRole: 'MEMBER',
      })
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      renderMembersPage()

      const table = await screen.findByRole('table', {
        name: 'Proje üyeleri',
      })
      expect(
        screen.getByText(/Üyelikler salt okunur/),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /rolünü değiştir/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /üyeyi kaldır/i }),
      ).not.toBeInTheDocument()
      expect(
        within(table).queryByRole('combobox'),
      ).not.toBeInTheDocument()
      expect(within(table).getByText('Ada Lovelace')).toBeInTheDocument()
    })

    it('hides management controls for a VIEWER', async () => {
      getProjectMock.mockResolvedValue({
        ...projectDetail,
        currentUserRole: 'VIEWER',
      })
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      renderMembersPage()

      const table = await screen.findByRole('table', {
        name: 'Proje üyeleri',
      })
      expect(
        screen.getByText(/Üyelikler salt okunur/),
      ).toBeInTheDocument()
      expect(
        within(table).queryByRole('combobox'),
      ).not.toBeInTheDocument()
      expect(
        within(table).queryByRole('button', { name: /rolünü değiştir/i }),
      ).not.toBeInTheDocument()
    })

    it('shows management controls and role selects for a PROJECT_LEAD', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      renderMembersPage()

      const table = await screen.findByRole('table', {
        name: 'Proje üyeleri',
      })
      expect(
        within(table).getByRole('button', {
          name: 'Grace Hopper rolünü değiştir',
        }),
      ).toBeInTheDocument()
      expect(
        within(table).getByRole('button', {
          name: 'Grace Hopper üyeyi kaldır',
        }),
      ).toBeInTheDocument()
      expect(
        within(table).getByRole('combobox', {
          name: 'Grace Hopper rolü',
        }),
      ).toBeInTheDocument()
      // No read-only notice for a lead.
      expect(
        screen.queryByText(/Üyelikler salt okunur/),
      ).not.toBeInTheDocument()
    })
  })

  describe('role change', () => {
    it('sends the displayed member version and confirms after success', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      changeProjectMemberRoleMock.mockResolvedValue({
        ...memberMember,
        role: 'VIEWER',
        version: 3,
      })
      const user = userEvent.setup()
      renderMembersPage()

      await screen.findByRole('table', { name: 'Proje üyeleri' })

      await user.selectOptions(
        screen.getByLabelText('Grace Hopper rolü'),
        'VIEWER',
      )
      await user.click(
        screen.getByRole('button', {
          name: 'Grace Hopper rolünü değiştir',
        }),
      )

      await waitFor(() => {
        expect(changeProjectMemberRoleMock).toHaveBeenCalledWith(
          'MES',
          memberMember.userId,
          { role: 'VIEWER', expectedVersion: 2 },
        )
      })
      expect(
        await screen.findByRole('status'),
      ).toHaveTextContent('Grace Hopper rolü İzleyici olarak güncellendi.')
    })

    it('shows a client-owned message for LAST_PROJECT_LEAD_REQUIRED', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      changeProjectMemberRoleMock.mockRejectedValue(
        new ApiError(409, 'LAST_PROJECT_LEAD_REQUIRED', 'backend lead detail'),
      )
      const user = userEvent.setup()
      renderMembersPage()

      await screen.findByRole('table', { name: 'Proje üyeleri' })

      await user.selectOptions(
        screen.getByLabelText('Ada Lovelace rolü'),
        'MEMBER',
      )
      await user.click(
        screen.getByRole('button', {
          name: 'Ada Lovelace rolünü değiştir',
        }),
      )

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Projede en az bir proje lideri kalmalıdır.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend lead detail')
    })
  })

  describe('removal confirmation', () => {
    it('requires explicit confirmation and shows consequence scope', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      const user = userEvent.setup()
      renderMembersPage()

      await screen.findByRole('table', { name: 'Proje üyeleri' })

      await user.click(
        screen.getByRole('button', {
          name: 'Grace Hopper üyeyi kaldır',
        }),
      )

      expect(removeProjectMemberMock).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', {
          name: 'Grace Hopper kaldırmayı onayla',
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/projeye erişimini kaybeder/),
      ).toBeInTheDocument()
    })

    it('sends the member version on confirmed removal and confirms after success', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      removeProjectMemberMock.mockResolvedValue(undefined)
      const user = userEvent.setup()
      renderMembersPage()

      await screen.findByRole('table', { name: 'Proje üyeleri' })

      await user.click(
        screen.getByRole('button', {
          name: 'Grace Hopper üyeyi kaldır',
        }),
      )
      await user.click(
        screen.getByRole('button', {
          name: 'Grace Hopper kaldırmayı onayla',
        }),
      )

      await waitFor(() => {
        expect(removeProjectMemberMock).toHaveBeenCalledWith(
          'MES',
          memberMember.userId,
          2,
        )
      })
      expect(
        await screen.findByRole('status'),
      ).toHaveTextContent('Grace Hopper projeden kaldırıldı.')
    })

    it('cancels without sending a DELETE request', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      const user = userEvent.setup()
      renderMembersPage()

      await screen.findByRole('table', { name: 'Proje üyeleri' })

      await user.click(
        screen.getByRole('button', {
          name: 'Grace Hopper üyeyi kaldır',
        }),
      )
      await user.click(
        screen.getByRole('button', {
          name: 'Grace Hopper kaldırmadan vazgeç',
        }),
      )

      expect(removeProjectMemberMock).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('button', {
          name: 'Grace Hopper kaldırmayı onayla',
        }),
      ).not.toBeInTheDocument()
    })
  })

  describe('version conflict recovery', () => {
    it('refetches and shows the conflict message without leaking detail', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      changeProjectMemberRoleMock.mockRejectedValue(
        new ApiError(409, 'VERSION_CONFLICT', 'backend conflict detail'),
      )
      const user = userEvent.setup()
      renderMembersPage()

      await screen.findByRole('table', { name: 'Proje üyeleri' })

      await user.selectOptions(
        screen.getByLabelText('Grace Hopper rolü'),
        'VIEWER',
      )
      await user.click(
        screen.getByRole('button', {
          name: 'Grace Hopper rolünü değiştir',
        }),
      )

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Üyelik başka bir işlem tarafından güncellendi. Liste yenilendi; lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend conflict detail')
    })
  })

  describe('XSS safety', () => {
    it('renders malicious-looking member data as inert text', async () => {
      const xssMember: ProjectMember = {
        userId: '44444444-4444-4444-4444-444444444444',
        email: '<img src=x onerror="window.__xss=1">@demo.messor.app',
        firstName: '<script>window.__xss=2</script>',
        lastName: 'Evil',
        role: 'MEMBER',
        version: 1,
      }
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([xssMember])
      renderMembersPage()

      await screen.findByRole('table', { name: 'Proje üyeleri' })
      expect(
        screen.getByText('<script>window.__xss=2</script> Evil'),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          '<img src=x onerror="window.__xss=1">@demo.messor.app',
        ),
      ).toBeInTheDocument()
      expect(document.querySelector('img')).toBeNull()
      expect(document.querySelector('script')).toBeNull()
      expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
    })
  })
})
