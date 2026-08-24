import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '../../app/apiClient'
import { ProjectSettingsPage } from './ProjectSettingsPage'
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
    listProjectMembers: vi.fn(),
    addProjectMember: vi.fn(),
    changeProjectMemberRole: vi.fn(),
    removeProjectMember: vi.fn(),
  }
})

import {
  addProjectMember,
  changeProjectMemberRole,
  getProject,
  listProjectMembers,
  removeProjectMember,
} from './projectsApi'

const getProjectMock = getProject as Mock
const listProjectMembersMock = listProjectMembers as Mock
const addProjectMemberMock = addProjectMember as Mock
const changeProjectMemberRoleMock = changeProjectMemberRole as Mock
const removeProjectMemberMock = removeProjectMember as Mock

function renderSettingsPage(projectKey = 'MES'): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${projectKey}/settings`]}>
        <Routes>
          <Route
            path="/projects/:projectKey/settings"
            element={<ProjectSettingsPage />}
          />
          <Route
            path="/projects/:projectKey/board"
            element={<div>BOARD</div>}
          />
          <Route path="/projects" element={<div>PROJECTS</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

async function openMembersTab(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('tab', { name: 'Üyeler' }))
}

describe('ProjectSettingsPage', () => {
  beforeEach(() => {
    getProjectMock.mockReset()
    listProjectMembersMock.mockReset()
    addProjectMemberMock.mockReset()
    changeProjectMemberRoleMock.mockReset()
    removeProjectMemberMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('page states', () => {
    it('shows a loading status while fetching project and members', async () => {
      getProjectMock.mockImplementation(
        () => new Promise<ProjectDetail>(() => {}),
      )
      listProjectMembersMock.mockImplementation(
        () => new Promise<ProjectMember[]>(() => {}),
      )
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
      expect(
        screen.getByText('Proje bilgileri yükleniyor…'),
      ).toBeInTheDocument()
      expect(screen.getByText('Üyelikler yükleniyor…')).toBeInTheDocument()
    })

    it('shows project-detail loading at page scope on a direct settings visit', async () => {
      getProjectMock.mockImplementation(
        () => new Promise<ProjectDetail>(() => {}),
      )
      listProjectMembersMock.mockResolvedValue([adminMember])
      renderSettingsPage()

      // Overview is the default section; the page reports the project-detail
      // fetch without requiring the user to open the Members panel first.
      expect(
        screen.getByText('Proje bilgileri yükleniyor…'),
      ).toBeInTheDocument()
    })

    it('shows a page-scope project-detail error on a direct settings visit', async () => {
      getProjectMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal project secret'),
      )
      listProjectMembersMock.mockResolvedValue([adminMember])
      renderSettingsPage()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal project secret')
      // The identity header does not render without project data.
      expect(
        screen.queryByRole('heading', { name: 'Messor', level: 3 }),
      ).not.toBeInTheDocument()
    })

    it('renders the settings heading and navigation back to the board', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      renderSettingsPage()

      expect(
        await screen.findByRole('heading', {
          name: 'Proje ayarları',
          level: 2,
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Panoya dön' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Projelere dön' }),
      ).toBeInTheDocument()
      // Project identity header renders name, key and role.
      expect(
        await screen.findByRole('heading', { name: 'Messor', level: 3 }),
      ).toBeInTheDocument()
      expect(screen.getAllByText('MES').length).toBeGreaterThan(0)
      expect(screen.getByText('Proje lideri')).toBeInTheDocument()

      // Section navigation exposes overview, workflow, members, appearance
      // and danger zone entry points.
      expect(
        screen.getByRole('tab', { name: 'Genel Bakış' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('tab', { name: 'İş Akışı' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Üyeler' })).toBeInTheDocument()
    })

    it('shows a safe error when the member list fails to load', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal member list secret'),
      )
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Üyelikler yüklenemedi. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal member list secret')
    })

    it('fails closed when the project detail fails but members load', async () => {
      getProjectMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal project detail secret'),
      )
      listProjectMembersMock.mockResolvedValue([adminMember])
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal project detail secret')
      expect(body).not.toContain('Ada Lovelace')
      expect(body).not.toContain('admin@demo.messor.app')
      expect(
        screen.queryByRole('heading', { name: 'Üye ekle', level: 3 }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Ada Lovelace rolünü değiştir' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Ada Lovelace üyeyi kaldır' }),
      ).not.toBeInTheDocument()
    })

    it('shows an empty state when there are no members', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([])
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      expect(
        await screen.findByText('Henüz proje üyesi yok.'),
      ).toBeInTheDocument()
    })

    it('renders each member name, email and role in an accessible list', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([
        adminMember,
        memberMember,
        viewerMember,
      ])
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      const memberList = await screen.findByRole('list', {
        name: 'Proje üyeleri',
      })
      expect(memberList).toBeInTheDocument()
      expect(within(memberList).getByText('Ada Lovelace')).toBeInTheDocument()
      expect(
        within(memberList).getAllByText('admin@demo.messor.app').length,
      ).toBeGreaterThan(0)
      expect(within(memberList).getByText('Grace Hopper')).toBeInTheDocument()
      expect(
        within(memberList).getAllByText('member@demo.messor.app').length,
      ).toBeGreaterThan(0)
      expect(
        within(memberList).getByText('Katherine Johnson'),
      ).toBeInTheDocument()
      expect(
        within(memberList).getByText('viewer@demo.messor.app'),
      ).toBeInTheDocument()
    })
  })

  describe('section navigation', () => {
    it('shows read-only overview metadata with no edit controls', async () => {
      getProjectMock.mockResolvedValue({
        ...projectDetail,
        description: 'Bir iz takip projesi.',
      })
      listProjectMembersMock.mockResolvedValue([adminMember])
      renderSettingsPage()

      const overviewPanel = await screen.findByRole('tabpanel', {
        name: 'Proje bilgileri',
      })
      expect(within(overviewPanel).getByText('Anahtar')).toBeInTheDocument()
      expect(within(overviewPanel).getByText('MES')).toBeInTheDocument()
      expect(within(overviewPanel).getByText('Açıklama')).toBeInTheDocument()
      expect(
        within(overviewPanel).getByText('Bir iz takip projesi.'),
      ).toBeInTheDocument()
      // Project metadata stays read-only: no edit inputs.
      expect(
        within(overviewPanel).queryByRole('textbox'),
      ).not.toBeInTheDocument()
      expect(
        within(overviewPanel).queryByRole('button'),
      ).not.toBeInTheDocument()
    })

    it('lists workflow statuses in server order within the workflow section', async () => {
      getProjectMock.mockResolvedValue({
        ...projectDetail,
        workflowStatuses: [
          { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
          { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
          { code: 'DONE', displayName: 'Bitti', position: 2 },
        ],
      })
      listProjectMembersMock.mockResolvedValue([adminMember])
      const user = userEvent.setup()
      renderSettingsPage()

      await user.click(screen.getByRole('tab', { name: 'İş Akışı' }))

      const workflowList = await screen.findByRole('list', {
        name: 'İş akışı durumları',
      })
      const items = within(workflowList).getAllByRole('listitem')
      expect(items).toHaveLength(3)
      expect(items[0]).toHaveTextContent('Yapılacak')
      expect(items[1]).toHaveTextContent('Sürüyor')
      expect(items[2]).toHaveTextContent('Bitti')
      expect(items[0]).toHaveTextContent('TO_DO')
    })

    it('shows an empty message when no workflow statuses exist', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      const user = userEvent.setup()
      renderSettingsPage()

      await user.click(screen.getByRole('tab', { name: 'İş Akışı' }))

      expect(
        await screen.findByText('Henüz iş akışı durumu tanımlanmadı.'),
      ).toBeInTheDocument()
    })

    it('switches between sections via the navigation tabs', async () => {
      getProjectMock.mockResolvedValue({
        ...projectDetail,
        description: 'Açıklama',
      })
      listProjectMembersMock.mockResolvedValue([adminMember])
      const user = userEvent.setup()
      renderSettingsPage()

      // Overview is the default section.
      expect(
        await screen.findByRole('tabpanel', { name: 'Proje bilgileri' }),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Üyeler' }))
      expect(
        screen.queryByRole('tabpanel', { name: 'Proje bilgileri' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('tabpanel', { name: 'Üyeler ve erişim' }),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Genel Bakış' }))
      expect(
        screen.getByRole('tabpanel', { name: 'Proje bilgileri' }),
      ).toBeInTheDocument()
    })

    it('exposes appearance and danger-zone entry points without inventing mutations', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      const user = userEvent.setup()
      renderSettingsPage()

      await screen.findByRole('tab', { name: 'Genel Bakış' })
      expect(screen.getByRole('tab', { name: 'Görünüm' })).toBeInTheDocument()
      expect(
        screen.getByRole('tab', { name: 'Tehlikeli Bölge' }),
      ).toBeInTheDocument()

      // Appearance is presentational: a read-only note, no editable controls.
      await user.click(screen.getByRole('tab', { name: 'Görünüm' }))
      const appearancePanel = await screen.findByRole('tabpanel', {
        name: 'Görünüm',
      })
      expect(within(appearancePanel).getByRole('note')).toBeInTheDocument()
      expect(
        within(appearancePanel).queryByRole('button'),
      ).not.toBeInTheDocument()
      expect(
        within(appearancePanel).queryByRole('textbox'),
      ).not.toBeInTheDocument()

      // Danger zone is presentation only: no destructive control triggers an
      // unsupported backend mutation.
      await user.click(screen.getByRole('tab', { name: 'Tehlikeli Bölge' }))
      const dangerPanel = await screen.findByRole('tabpanel', {
        name: 'Tehlikeli Bölge',
      })
      expect(within(dangerPanel).getByText('Projeyi silme')).toBeInTheDocument()
      expect(within(dangerPanel).getByRole('note')).toBeInTheDocument()
      expect(
        within(dangerPanel).queryByRole('button'),
      ).not.toBeInTheDocument()
    })

    it('links the members section to the dedicated members page', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      const membersPanel = await screen.findByRole('tabpanel', {
        name: 'Üyeler ve erişim',
      })
      const link = within(membersPanel).getByRole('link', {
        name: 'Üyeleri görüntüle',
      })
      expect(link).toHaveAttribute('href', '/projects/MES/members')
    })
  })

  describe('role-aware controls', () => {
    it('shows management controls for a PROJECT_LEAD', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Ada Lovelace')

      expect(
        screen.getByRole('heading', { name: 'Üye ekle', level: 3 }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Üye ekle' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Ada Lovelace rolünü değiştir' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Ada Lovelace üyeyi kaldır' }),
      ).toBeInTheDocument()
    })

    it('hides management controls for a MEMBER', async () => {
      getProjectMock.mockResolvedValue({
        ...projectDetail,
        currentUserRole: 'MEMBER',
      })
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      const memberList = await screen.findByRole('list', {
        name: 'Proje üyeleri',
      })
      // A read-only notice explains the lack of management controls.
      expect(
        screen.getByText(/Üyelikler salt okunur. Üyeleri yalnızca proje liderleri/),
      ).toBeInTheDocument()

      // The add form is not rendered for a read-only member.
      expect(
        screen.queryByRole('heading', { name: 'Üye ekle', level: 3 }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Üye ekle' }),
      ).not.toBeInTheDocument()
      // No role combobox/save or removal controls exist inside the member list.
      expect(
        within(memberList).queryByRole('combobox'),
      ).not.toBeInTheDocument()
      expect(
        within(memberList).queryByRole('button', { name: /rolünü değiştir/i }),
      ).not.toBeInTheDocument()
      expect(
        within(memberList).queryByRole('button', { name: /üyeyi kaldır/i }),
      ).not.toBeInTheDocument()
      expect(within(memberList).getByText('Ada Lovelace')).toBeInTheDocument()
    })

    it('hides management controls for a VIEWER', async () => {
      getProjectMock.mockResolvedValue({
        ...projectDetail,
        currentUserRole: 'VIEWER',
      })
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      const memberList = await screen.findByRole('list', {
        name: 'Proje üyeleri',
      })

      // The add form is not rendered for a read-only viewer.
      expect(
        screen.queryByRole('heading', { name: 'Üye ekle', level: 3 }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Üye ekle' }),
      ).not.toBeInTheDocument()
      // No role combobox/save or removal controls exist inside the member list.
      expect(
        within(memberList).queryByRole('combobox'),
      ).not.toBeInTheDocument()
      expect(
        within(memberList).queryByRole('button', { name: /rolünü değiştir/i }),
      ).not.toBeInTheDocument()
      expect(
        within(memberList).queryByRole('button', { name: /üyeyi kaldır/i }),
      ).not.toBeInTheDocument()
      expect(within(memberList).getByText('Ada Lovelace')).toBeInTheDocument()
    })
  })

  describe('add member', () => {
    it('adds a member and invalidates the exact member query', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      addProjectMemberMock.mockResolvedValue(memberMember)
      const user = userEvent.setup()
      const queryClient = renderSettingsPage()
      await openMembersTab(user)
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await screen.findByText('Ada Lovelace')

      await user.selectOptions(
        screen.getByLabelText('E-posta'),
        'member@demo.messor.app',
      )
      await user.selectOptions(screen.getByLabelText('Rol'), 'MEMBER')
      await user.click(screen.getByRole('button', { name: 'Üye ekle' }))

      await waitFor(() => {
        expect(addProjectMemberMock).toHaveBeenCalledWith('MES', {
          email: 'member@demo.messor.app',
          role: 'MEMBER',
        })
      })
      // The member query is invalidated with the exact member query key.
      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['projects', 'MES', 'members'],
          exact: true,
        })
      })
      // The member query is refetched after success.
      await waitFor(() => {
        expect(listProjectMembersMock).toHaveBeenCalledTimes(2)
      })
    })

    it('disables duplicate submissions while pending', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      let resolveAdd: (value: ProjectMember) => void = () => {}
      addProjectMemberMock.mockImplementation(
        () =>
          new Promise<ProjectMember>((resolve) => {
            resolveAdd = resolve
          }),
      )
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Ada Lovelace')

      await user.selectOptions(
        screen.getByLabelText('E-posta'),
        'member@demo.messor.app',
      )
      await user.selectOptions(screen.getByLabelText('Rol'), 'MEMBER')
      await user.click(screen.getByRole('button', { name: 'Üye ekle' }))

      const pendingButton = await screen.findByRole('button', {
        name: 'Ekleniyor…',
      })
      expect(pendingButton).toBeDisabled()

      await user.click(pendingButton)
      expect(addProjectMemberMock).toHaveBeenCalledTimes(1)

      resolveAdd(memberMember)
    })

    it('shows a client-owned message for MEMBER_ALREADY_EXISTS', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      addProjectMemberMock.mockRejectedValue(
        new ApiError(409, 'MEMBER_ALREADY_EXISTS', 'backend duplicate detail'),
      )
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Ada Lovelace')

      await user.selectOptions(
        screen.getByLabelText('E-posta'),
        'member@demo.messor.app',
      )
      await user.selectOptions(screen.getByLabelText('Rol'), 'MEMBER')
      await user.click(screen.getByRole('button', { name: 'Üye ekle' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Bu kullanıcı zaten proje üyesi.')
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend duplicate detail')
    })

    it('shows a client-owned message for USER_NOT_FOUND', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      addProjectMemberMock.mockRejectedValue(
        new ApiError(404, 'USER_NOT_FOUND', 'backend user detail'),
      )
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Ada Lovelace')

      await user.selectOptions(
        screen.getByLabelText('E-posta'),
        'member@demo.messor.app',
      )
      await user.selectOptions(screen.getByLabelText('Rol'), 'MEMBER')
      await user.click(screen.getByRole('button', { name: 'Üye ekle' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Bu e-posta adresiyle etkin bir kullanıcı bulunamadı.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend user detail')
    })

    it('does not leak an unknown/internal add error into the DOM', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      addProjectMemberMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal add secret'),
      )
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Ada Lovelace')

      await user.selectOptions(
        screen.getByLabelText('E-posta'),
        'member@demo.messor.app',
      )
      await user.selectOptions(screen.getByLabelText('Rol'), 'MEMBER')
      await user.click(screen.getByRole('button', { name: 'Üye ekle' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal add secret')
    })
  })

  describe('role change', () => {
    it('sends the displayed member version and refetches on success', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      changeProjectMemberRoleMock.mockResolvedValue({
        ...memberMember,
        role: 'VIEWER',
        version: 3,
      })
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Grace Hopper')

      await user.selectOptions(
        screen.getByLabelText('Grace Hopper rolü'),
        'VIEWER',
      )
      await user.click(
        screen.getByRole('button', { name: 'Grace Hopper rolünü değiştir' }),
      )

      await waitFor(() => {
        expect(changeProjectMemberRoleMock).toHaveBeenCalledWith(
          'MES',
          memberMember.userId,
          { role: 'VIEWER', expectedVersion: 2 },
        )
      })
      await waitFor(() => {
        expect(listProjectMembersMock).toHaveBeenCalledTimes(2)
      })
    })

    it('shows a client-owned message for LAST_PROJECT_LEAD_REQUIRED', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember])
      changeProjectMemberRoleMock.mockRejectedValue(
        new ApiError(409, 'LAST_PROJECT_LEAD_REQUIRED', 'backend lead detail'),
      )
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Ada Lovelace')

      await user.selectOptions(
        screen.getByLabelText('Ada Lovelace rolü'),
        'MEMBER',
      )
      await user.click(
        screen.getByRole('button', { name: 'Ada Lovelace rolünü değiştir' }),
      )

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Projede en az bir proje lideri kalmalıdır.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend lead detail')
    })

    it('does not leak an unknown/internal role-change error into the DOM', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      changeProjectMemberRoleMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal role secret'),
      )
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Grace Hopper')

      await user.selectOptions(
        screen.getByLabelText('Grace Hopper rolü'),
        'VIEWER',
      )
      await user.click(
        screen.getByRole('button', { name: 'Grace Hopper rolünü değiştir' }),
      )

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal role secret')
    })
  })

  describe('removal confirmation', () => {
    it('requires an explicit confirmation before sending DELETE', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Grace Hopper')

      await user.click(
        screen.getByRole('button', { name: 'Grace Hopper üyeyi kaldır' }),
      )

      expect(removeProjectMemberMock).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', { name: 'Grace Hopper kaldırmayı onayla' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Grace Hopper kaldırmadan vazgeç' }),
      ).toBeInTheDocument()
    })

    it('sends the displayed member version on confirmed removal and refetches', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      removeProjectMemberMock.mockResolvedValue(undefined)
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Grace Hopper')

      await user.click(
        screen.getByRole('button', { name: 'Grace Hopper üyeyi kaldır' }),
      )
      await user.click(
        screen.getByRole('button', { name: 'Grace Hopper kaldırmayı onayla' }),
      )

      await waitFor(() => {
        expect(removeProjectMemberMock).toHaveBeenCalledWith(
          'MES',
          memberMember.userId,
          2,
        )
      })
      await waitFor(() => {
        expect(listProjectMembersMock).toHaveBeenCalledTimes(2)
      })
    })

    it('cancels without sending a DELETE request', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Grace Hopper')

      await user.click(
        screen.getByRole('button', { name: 'Grace Hopper üyeyi kaldır' }),
      )
      await user.click(
        screen.getByRole('button', { name: 'Grace Hopper kaldırmadan vazgeç' }),
      )

      expect(removeProjectMemberMock).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('button', { name: 'Grace Hopper kaldırmayı onayla' }),
      ).not.toBeInTheDocument()
    })

    it('does not leak an unknown/internal removal error into the DOM', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue([adminMember, memberMember])
      removeProjectMemberMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal remove secret'),
      )
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('Grace Hopper')

      await user.click(
        screen.getByRole('button', { name: 'Grace Hopper üyeyi kaldır' }),
      )
      await user.click(
        screen.getByRole('button', { name: 'Grace Hopper kaldırmayı onayla' }),
      )

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal remove secret')
    })
  })

  describe('version conflict recovery', () => {
    it('refetches the exact member query and only then shows the conflict message', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      let resolveRefetch: (value: ProjectMember[]) => void = () => {}
      let memberListCalls = 0
      listProjectMembersMock.mockImplementation(() => {
        memberListCalls += 1
        if (memberListCalls === 1) {
          return Promise.resolve([adminMember, memberMember])
        }
        return new Promise<ProjectMember[]>((resolve) => {
          resolveRefetch = resolve
        })
      })
      changeProjectMemberRoleMock.mockRejectedValue(
        new ApiError(409, 'VERSION_CONFLICT', 'backend conflict detail'),
      )
      const user = userEvent.setup()
      const queryClient = renderSettingsPage()
      await openMembersTab(user)
      const refetchSpy = vi.spyOn(queryClient, 'refetchQueries')

      await screen.findByText('Grace Hopper')

      await user.selectOptions(
        screen.getByLabelText('Grace Hopper rolü'),
        'VIEWER',
      )
      await user.click(
        screen.getByRole('button', { name: 'Grace Hopper rolünü değiştir' }),
      )

      // The exact member query is refetched after a version conflict.
      await waitFor(() => {
        expect(refetchSpy).toHaveBeenCalledWith({
          queryKey: ['projects', 'MES', 'members'],
          exact: true,
          type: 'active',
        })
      })
      await waitFor(() => {
        expect(listProjectMembersMock).toHaveBeenCalledTimes(2)
      })

      // While the refetch is still pending, the conflict message is not shown.
      expect(
        screen.queryByText(
          'Üyelik başka bir işlem tarafından güncellendi. Liste yenilendi; lütfen tekrar deneyin.',
        ),
      ).not.toBeInTheDocument()

      // Resolve the deferred refetch; only then is the safe message shown.
      resolveRefetch([adminMember, memberMember])

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
      const user = userEvent.setup()
      renderSettingsPage()
      await openMembersTab(user)

      await screen.findByText('<script>window.__xss=2</script> Evil')
      expect(
        screen.getByText('<img src=x onerror="window.__xss=1">@demo.messor.app'),
      ).toBeInTheDocument()
      expect(document.querySelector('img')).toBeNull()
      expect(document.querySelector('script')).toBeNull()
      expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
    })
  })
})
