import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '../../app/apiClient'
import { SessionContext } from '../../app/session'
import { IssueWorkspacePage } from './IssueWorkspacePage'
import type { ProjectDetail, ProjectMember } from '../projects/types'
import type { Issue, IssueActivity, IssuePage } from './types'

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
  version: 1,
}

const members: ProjectMember[] = [adminMember, memberMember]

const ISSUE_FILTERS = { page: 0, size: 100, sort: 'number,asc' }

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'a0000000-0000-0000-0000-000000000001',
    issueKey: 'MES-1',
    projectKey: 'MES',
    number: 1,
    type: 'TASK',
    title: 'First task',
    description: 'A description',
    statusCode: 'TO_DO',
    reporterId: adminMember.userId,
    assigneeId: null,
    rank: 0,
    archived: false,
    version: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const issue1 = makeIssue()
const issue2 = makeIssue({
  id: 'a0000000-0000-0000-0000-000000000002',
  issueKey: 'MES-2',
  number: 2,
  type: 'BUG',
  title: 'Second bug',
  statusCode: 'IN_PROGRESS',
  assigneeId: memberMember.userId,
  version: 1,
})

const emptyPage: IssuePage = {
  items: [],
  page: 0,
  size: 100,
  totalItems: 0,
  totalPages: 0,
}

const pageWithIssues: IssuePage = {
  items: [issue1, issue2],
  page: 0,
  size: 100,
  totalItems: 2,
  totalPages: 1,
}

const activity: IssueActivity[] = [
  {
    id: 'act-1',
    type: 'CREATED',
    actorId: adminMember.userId,
    summary: { type: 'TASK', statusCode: 'TO_DO', assigneeId: null },
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'act-2',
    type: 'MOVED',
    actorId: memberMember.userId,
    summary: { fromStatusCode: 'TO_DO', toStatusCode: 'IN_PROGRESS' },
    createdAt: '2026-01-02T00:00:00Z',
  },
]

vi.mock('./issuesApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./issuesApi')>()
  return {
    ...actual,
    listIssues: vi.fn(),
    getIssue: vi.fn(),
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    archiveIssue: vi.fn(),
    moveIssue: vi.fn(),
    listIssueActivity: vi.fn(),
  }
})

vi.mock('../projects/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../projects/projectsApi')>()
  return {
    ...actual,
    getProject: vi.fn(),
    listProjectMembers: vi.fn(),
  }
})

vi.mock('../comments/commentsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comments/commentsApi')>()
  return {
    ...actual,
    listIssueComments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
  }
})

import {
  listIssues,
  getIssue,
  createIssue,
  updateIssue,
  archiveIssue,
  moveIssue,
  listIssueActivity,
} from './issuesApi'
import { getProject, listProjectMembers } from '../projects/projectsApi'
import { listIssueComments, createComment } from '../comments/commentsApi'

const listIssuesMock = listIssues as Mock
const getIssueMock = getIssue as Mock
const createIssueMock = createIssue as Mock
const updateIssueMock = updateIssue as Mock
const archiveIssueMock = archiveIssue as Mock
const moveIssueMock = moveIssue as Mock
const listIssueActivityMock = listIssueActivity as Mock
const getProjectMock = getProject as Mock
const listProjectMembersMock = listProjectMembers as Mock
const listIssueCommentsMock = listIssueComments as Mock
const createCommentMock = createComment as Mock

function renderWorkspace(initialEntry = '/projects/MES/board'): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const sessionValue = {
    session: {
      status: 'authenticated' as const,
      user: {
        id: adminMember.userId,
        email: 'admin@demo.messor.app',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'ORG_ADMIN' as const,
      },
    },
    bootstrap: () => {},
    handleAuthenticated: () => {},
    handleLogout: async () => {},
    logoutPending: false,
    logoutError: null,
  }
  render(
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={sessionValue}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              path="/projects/:projectKey/board"
              element={<IssueWorkspacePage />}
            />
            <Route
              path="/projects/:projectKey/issues/:issueKey"
              element={<IssueWorkspacePage />}
            />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return queryClient
}

async function selectIssue(issueKey = 'MES-1'): Promise<void> {
  const user = userEvent.setup()
  await screen.findByText(issueKey === 'MES-1' ? 'First task' : 'Second bug')
  await user.click(screen.getByRole('button', { name: new RegExp(`^${issueKey},`) }))
}

describe('IssueWorkspacePage', () => {
  beforeEach(() => {
    getProjectMock.mockReset()
    listProjectMembersMock.mockReset()
    listIssuesMock.mockReset()
    getIssueMock.mockReset()
    createIssueMock.mockReset()
    updateIssueMock.mockReset()
    archiveIssueMock.mockReset()
    moveIssueMock.mockReset()
    listIssueActivityMock.mockReset()
    listIssueCommentsMock.mockReset()
    listIssueCommentsMock.mockResolvedValue([])
    createCommentMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('page states', () => {
    it('shows a loading status while the issue list is fetching', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockImplementation(
        () => new Promise<IssuePage>(() => {}),
      )
      renderWorkspace()

      expect(await screen.findByRole('status')).toBeInTheDocument()
      expect(
        screen.getByText('İssue’lar yükleniyor…'),
      ).toBeInTheDocument()
    })

    it('shows a safe error when the issue list fails to load', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal issue list secret'),
      )
      renderWorkspace()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'İssue’lar yüklenemedi. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal issue list secret')
    })

    it('shows an empty state when there are no active issues', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(emptyPage)
      renderWorkspace()

      expect(await screen.findByText('Henüz issue yok.')).toBeInTheDocument()
    })

    it('renders populated board columns with key, title, status and assignee', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      renderWorkspace()

      const board = await screen.findByRole('region', { name: 'Kanban panosu' })
      expect(within(board).getByText('MES-1')).toBeInTheDocument()
      expect(within(board).getByText('First task')).toBeInTheDocument()
      expect(within(board).getByText('Second bug')).toBeInTheDocument()
      // status displayName mapping from the project workflow
      expect(
        within(board).getByRole('button', { name: 'MES-1, First task, Yapılacak' }),
      ).toBeInTheDocument()
      expect(
        within(board).getByRole('button', { name: 'MES-2, Second bug, Sürüyor' }),
      ).toBeInTheDocument()
      // assignee mapping: null -> Atanmamış, member -> name
      expect(within(board).getByText('Atanmamış')).toBeInTheDocument()
      expect(within(board).getByText('Grace Hopper')).toBeInTheDocument()
      // server workflow position ordering of columns
      expect(
        screen.getByRole('region', { name: 'Yapılacak sütunu, 1 kart' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('region', { name: 'Sürüyor sütunu, 1 kart' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('region', { name: 'Bitti sütunu, 0 kart' }),
      ).toBeInTheDocument()
    })

    it('shows the project and settings links and never resurrects the removed "Board’a dön" link', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      renderWorkspace()

      await screen.findByText('First task')
      expect(
        screen.getByRole('link', { name: 'Proje ayarları' }),
      ).toHaveAttribute('href', '/projects/MES/settings')
      expect(
        screen.getByRole('link', { name: 'Projelere dön' }),
      ).toHaveAttribute('href', '/projects')
      expect(
        screen.queryByRole('link', { name: /Board'a dön/ }),
      ).not.toBeInTheDocument()
    })
  })

  describe('labels', () => {
    it('maps an unknown assignee to a safe fallback label', async () => {
      listIssuesMock.mockResolvedValue({
        ...pageWithIssues,
        items: [
          makeIssue({ assigneeId: '99999999-9999-9999-9999-999999999999' }),
        ],
      })
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      renderWorkspace()

      const board = await screen.findByRole('region', { name: 'Kanban panosu' })
      expect(within(board).getByText('Bilinmeyen kullanıcı')).toBeInTheDocument()
    })

    it('shows controlled issue details and activity for a selected issue', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      renderWorkspace()

      await selectIssue('MES-1')

      expect(
        await screen.findByRole('heading', { name: 'MES-1', level: 2 }),
      ).toBeInTheDocument()
      expect(screen.getAllByText('First task').length).toBeGreaterThan(0)
      expect(screen.getByText('A description')).toBeInTheDocument()
      // controlled activity rendering, never raw JSON
      expect(screen.getByText(/Oluşturuldu: Görev, Yapılacak, Atanmamış/)).toBeInTheDocument()
      expect(screen.getByText(/Durum değişti: Yapılacak → Sürüyor/)).toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('changedFields')
      expect(body).not.toContain('summary')
    })
  })

  describe('role-aware controls', () => {
    it('shows create/edit/archive controls for a PROJECT_LEAD', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      renderWorkspace()

      expect(
        await screen.findByRole('button', { name: 'Yeni issue' }),
      ).toBeInTheDocument()
      await selectIssue('MES-1')
      expect(
        await screen.findByRole('button', { name: 'Düzenle' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Arşivle' }),
      ).toBeInTheDocument()
    })

    it('shows mutation controls for a MEMBER', async () => {
      getProjectMock.mockResolvedValue({
        ...projectDetail,
        currentUserRole: 'MEMBER',
      })
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      renderWorkspace()

      expect(
        await screen.findByRole('button', { name: 'Yeni issue' }),
      ).toBeInTheDocument()
      await selectIssue('MES-1')
      expect(
        await screen.findByRole('button', { name: 'Düzenle' }),
      ).toBeInTheDocument()
    })

    it('hides all mutation controls for a VIEWER while read/detail/activity still work', async () => {
      getProjectMock.mockResolvedValue({
        ...projectDetail,
        currentUserRole: 'VIEWER',
      })
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      renderWorkspace()

      await screen.findByText('First task')
      expect(
        screen.queryByRole('button', { name: 'Yeni issue' }),
      ).not.toBeInTheDocument()

      await selectIssue('MES-1')
      expect(
        await screen.findByRole('heading', { name: 'MES-1', level: 2 }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Düzenle' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Arşivle' }),
      ).not.toBeInTheDocument()
      expect(screen.getByText(/Oluşturuldu/)).toBeInTheDocument()
    })
  })

  describe('create', () => {
    it('validates a blank title without sending a request', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      const user = userEvent.setup()
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'Yeni issue' }))
      await user.click(screen.getByRole('button', { name: 'Oluştur' }))

      expect(
        await screen.findByText('Başlık boş bırakılamaz.'),
      ).toBeInTheDocument()
      expect(createIssueMock).not.toHaveBeenCalled()
    })

    it('creates an issue and invalidates the exact list query', async () => {
      const newIssue = makeIssue({
        issueKey: 'MES-3',
        number: 3,
        title: 'Third task',
      })
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      createIssueMock.mockResolvedValue(newIssue)
      getIssueMock.mockResolvedValue(newIssue)
      listIssueActivityMock.mockResolvedValue(activity)
      const user = userEvent.setup()
      const queryClient = renderWorkspace()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await user.click(await screen.findByRole('button', { name: 'Yeni issue' }))
      await user.type(screen.getByLabelText('Başlık'), 'Third task')
      await user.click(screen.getByRole('button', { name: 'Oluştur' }))

      await waitFor(() => {
        expect(createIssueMock).toHaveBeenCalledWith('MES', {
          type: 'TASK',
          title: 'Third task',
          description: null,
          assigneeId: null,
        })
      })
      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['issues', 'MES', ISSUE_FILTERS],
          exact: true,
        })
      })
      // the new issue is selected and its detail/activity fetched
      await waitFor(() => {
        expect(getIssueMock).toHaveBeenCalledWith('MES-3')
        expect(listIssueActivityMock).toHaveBeenCalledWith('MES-3')
      })
    })

    it('blocks duplicate submissions while pending', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      let resolveCreate: (value: Issue) => void = () => {}
      createIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveCreate = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'Yeni issue' }))
      await user.type(screen.getByLabelText('Başlık'), 'Third task')
      await user.click(screen.getByRole('button', { name: 'Oluştur' }))

      const pendingButton = await screen.findByRole('button', {
        name: 'Oluşturuluyor…',
      })
      expect(pendingButton).toBeDisabled()
      await user.click(pendingButton)
      expect(createIssueMock).toHaveBeenCalledTimes(1)

      resolveCreate(
        makeIssue({ issueKey: 'MES-3', number: 3, title: 'Third task' }),
      )
    })

    it('shows a client-owned message for VALIDATION_FAILED without leaking detail', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      createIssueMock.mockRejectedValue(
        new ApiError(400, 'VALIDATION_FAILED', 'backend validation secret'),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'Yeni issue' }))
      await user.type(screen.getByLabelText('Başlık'), 'Third task')
      await user.click(screen.getByRole('button', { name: 'Oluştur' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Girilen bilgiler doğrulanamadı. Lütfen kontrol edip tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend validation secret')
    })
  })

  describe('update', () => {
    it('updates a selected issue with its current version and invalidates caches', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      updateIssueMock.mockResolvedValue({ ...issue1, title: 'Renamed', version: 1 })
      const user = userEvent.setup()
      const queryClient = renderWorkspace()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      const titleInput = screen.getByLabelText('Başlık')
      await user.clear(titleInput)
      await user.type(titleInput, 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      await waitFor(() => {
        expect(updateIssueMock).toHaveBeenCalledWith('MES-1', {
          title: 'Renamed',
          description: 'A description',
          assigneeId: null,
          expectedVersion: 0,
        })
      })
      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['issue', 'MES-1'],
          exact: true,
        })
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['issue', 'MES-1', 'activity'],
          exact: true,
        })
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['issues', 'MES', ISSUE_FILTERS],
          exact: true,
        })
      })
      // form closes after success
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Güncelle' }),
        ).not.toBeInTheDocument()
      })
    })

    it('validates a blank title in the edit form', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      const titleInput = screen.getByLabelText('Başlık')
      await user.clear(titleInput)
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      expect(
        await screen.findByText('Başlık boş bırakılamaz.'),
      ).toBeInTheDocument()
      expect(updateIssueMock).not.toHaveBeenCalled()
    })

    it('preserves leading and trailing whitespace in the description to the API', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      updateIssueMock.mockResolvedValue({ ...issue1, version: 1 })
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      const desc = screen.getByLabelText('Açıklama')
      await user.clear(desc)
      await user.type(desc, '  padded  description  ')
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      await waitFor(() => {
        expect(updateIssueMock).toHaveBeenCalledWith('MES-1', {
          title: 'First task',
          description: '  padded  description  ',
          assigneeId: null,
          expectedVersion: 0,
        })
      })
    })

    it('preserves a whitespace-only description to the API', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      updateIssueMock.mockResolvedValue({ ...issue1, version: 1 })
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      const desc = screen.getByLabelText('Açıklama')
      await user.clear(desc)
      await user.type(desc, '   ')
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      await waitFor(() => {
        expect(updateIssueMock).toHaveBeenCalledWith('MES-1', {
          title: 'First task',
          description: '   ',
          assigneeId: null,
          expectedVersion: 0,
        })
      })
    })

    it('preserves the unsaved draft and refetches on VERSION_CONFLICT', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      updateIssueMock.mockRejectedValue(
        new ApiError(409, 'VERSION_CONFLICT', 'backend conflict secret'),
      )
      const user = userEvent.setup()
      const queryClient = renderWorkspace()
      const refetchSpy = vi.spyOn(queryClient, 'refetchQueries')

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      const titleInput = screen.getByLabelText('Başlık')
      await user.clear(titleInput)
      await user.type(titleInput, 'My unsaved draft')
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      // detail/list/activity are refetched
      await waitFor(() => {
        expect(refetchSpy).toHaveBeenCalledWith({
          queryKey: ['issue', 'MES-1'],
          exact: true,
          type: 'active',
        })
        expect(getIssueMock).toHaveBeenCalledTimes(2)
      })
      // the form stays open with the draft intact
      expect(
        screen.getByRole('button', { name: 'Güncelle' }),
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Başlık')).toHaveValue('My unsaved draft')

      // a client-owned safe conflict message is shown
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/gözden geçirip gönder/)
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend conflict secret')
    })

    it('recovers from ISSUE_ARCHIVED by closing the form and hiding controls', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      let getCalls = 0
      getIssueMock.mockImplementation(() => {
        getCalls += 1
        return Promise.resolve(
          getCalls === 1 ? issue1 : makeIssue({ archived: true, version: 1 }),
        )
      })
      listIssueActivityMock.mockResolvedValue(activity)
      updateIssueMock.mockRejectedValue(
        new ApiError(409, 'ISSUE_ARCHIVED', 'backend archived secret'),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      const banner = await screen.findByText(
        'Bu issue arşivlendi; güncelleme yapılamıyor.',
      )
      expect(banner).toBeInTheDocument()
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Güncelle' }),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Düzenle' }),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Arşivle' }),
        ).not.toBeInTheDocument()
      })
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend archived secret')
    })
  })

  describe('archive', () => {
    it('requires confirmation before archiving and refetches on success', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      archiveIssueMock.mockResolvedValue(
        makeIssue({ archived: true, version: 1 }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))

      expect(archiveIssueMock).not.toHaveBeenCalled()
      const confirm = screen.getByRole('button', {
        name: 'Arşivlemeyi onayla',
      })
      expect(confirm).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Vazgeç' }),
      ).toBeInTheDocument()

      await user.click(confirm)
      await waitFor(() => {
        expect(archiveIssueMock).toHaveBeenCalledWith('MES-1', {
          expectedVersion: 0,
        })
      })
      await waitFor(() => {
        expect(listIssuesMock).toHaveBeenCalledTimes(2)
      })
      // selection closes after archive
      await waitFor(() => {
        expect(
          screen.queryByRole('heading', { name: 'MES-1', level: 2 }),
        ).not.toBeInTheDocument()
      })
      expect(screen.getByText('Issue arşivlendi.')).toBeInTheDocument()
    })

    it('keeps the confirmation open and refetches on VERSION_CONFLICT', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      archiveIssueMock.mockRejectedValue(
        new ApiError(409, 'VERSION_CONFLICT', 'backend archive conflict secret'),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))
      await user.click(
        screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
      )

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/gözden geçirip gönder/)
      // confirmation stays open so the user can retry
      expect(
        screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
      ).toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend archive conflict secret')
    })

    it('returns focus to the archive trigger after a generic archive error', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      archiveIssueMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'backend archive internal secret'),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))
      await user.click(
        screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
      )

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      )
      // confirmation closes and focus returns to the archive trigger
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Arşivle' }),
        ).toHaveFocus()
      })
      expect(
        screen.queryByRole('button', { name: 'Arşivlemeyi onayla' }),
      ).not.toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend archive internal secret')
    })

    it('returns focus to the list heading after ISSUE_ARCHIVED during archive', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      let getCalls = 0
      getIssueMock.mockImplementation(() => {
        getCalls += 1
        return Promise.resolve(
          getCalls === 1 ? issue1 : makeIssue({ archived: true, version: 1 }),
        )
      })
      listIssueActivityMock.mockResolvedValue(activity)
      archiveIssueMock.mockRejectedValue(
        new ApiError(409, 'ISSUE_ARCHIVED', 'backend archive archived secret'),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))
      await user.click(
        screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
      )

      const banner = await screen.findByText(
        'Bu issue arşivlendi; güncelleme yapılamıyor.',
      )
      expect(banner).toBeInTheDocument()
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Arşivlemeyi onayla' }),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Arşivle' }),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Düzenle' }),
        ).not.toBeInTheDocument()
      })
      // focus returns to a stable living target: the list heading
      const listHeading = screen.getByRole('heading', {
        name: 'İssue’lar',
      })
      await waitFor(() => {
        expect(listHeading).toHaveFocus()
      })
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend archive archived secret')
    })
  })

  describe('edit/archive mutual exclusion', () => {
    it('hides the edit trigger while the archive confirmation is open', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))

      expect(
        screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Düzenle' }),
      ).not.toBeInTheDocument()
    })

    it('cannot start an archive while an update is in flight, nor an edit while archive is in flight', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      let resolveUpdate: (value: Issue) => void = () => {}
      updateIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveUpdate = resolve
          }),
      )
      let resolveArchive: (value: Issue) => void = () => {}
      archiveIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveArchive = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      // start a deferred update
      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      const titleInput = screen.getByLabelText('Başlık')
      await user.clear(titleInput)
      await user.type(titleInput, 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      // while the update is pending, neither edit nor archive can start
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Arşivle' }),
        ).not.toBeInTheDocument()
      })
      expect(
        screen.queryByRole('button', { name: 'Düzenle' }),
      ).not.toBeInTheDocument()

      // complete the update; only then can archive open
      resolveUpdate({ ...issue1, title: 'Renamed', version: 1 })
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Güncelle' }),
        ).not.toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: 'Arşivle' }))
      await user.click(
        screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
      )

      // while the archive is pending, edit is hidden and confirm/cancel disabled
      await waitFor(() => {
        expect(archiveIssueMock).toHaveBeenCalledTimes(1)
      })
      expect(
        screen.queryByRole('button', { name: 'Düzenle' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
      ).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Vazgeç' })).toBeDisabled()

      // only one mutation ever fires per phase; both complete cleanly
      expect(updateIssueMock).toHaveBeenCalledTimes(1)
      resolveArchive({ ...issue1, archived: true, version: 2 })
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Arşivlemeyi onayla' }),
        ).not.toBeInTheDocument()
      })
    })
  })

  describe('create/update/archive mutual exclusion', () => {
    it('blocks opening or submitting create while an update is pending and keeps the edit form intact', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      let resolveUpdate: (value: Issue) => void = () => {}
      updateIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveUpdate = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      const titleInput = screen.getByLabelText('Başlık')
      await user.clear(titleInput)
      await user.type(titleInput, 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      // while the update is pending, create is disabled and cannot open
      const createButton = await screen.findByRole('button', {
        name: 'Yeni issue',
      })
      await waitFor(() => {
        expect(createButton).toBeDisabled()
        expect(createButton).toHaveAttribute('aria-disabled', 'true')
      })
      fireEvent.click(createButton)
      expect(createIssueMock).not.toHaveBeenCalled()
      // the active edit form is not replaced by a create form
      expect(
        screen.getByRole('button', { name: 'Güncelleniyor…' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Oluştur' }),
      ).not.toBeInTheDocument()

      resolveUpdate({ ...issue1, title: 'Renamed', version: 1 })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Düzenle' })).toHaveFocus()
      })
    })

    it('blocks opening or submitting create while an archive is pending and keeps the confirmation intact', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      let resolveArchive: (value: Issue) => void = () => {}
      archiveIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveArchive = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))
      await user.click(
        screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
      )

      await waitFor(() => {
        expect(archiveIssueMock).toHaveBeenCalledTimes(1)
      })

      // while the archive is pending, create is disabled and cannot dismiss confirmation
      const createButton = await screen.findByRole('button', {
        name: 'Yeni issue',
      })
      expect(createButton).toBeDisabled()
      expect(createButton).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(createButton)
      expect(createIssueMock).not.toHaveBeenCalled()
      // the archive confirmation is not dismissed
      expect(
        screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
      ).toBeInTheDocument()

      resolveArchive({ ...issue1, archived: true, version: 1 })
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Arşivlemeyi onayla' }),
        ).not.toBeInTheDocument()
      })
    })

    it('blocks selection, edit and archive initiation while a create is pending', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      let resolveCreate: (value: Issue) => void = () => {}
      createIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveCreate = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      // select an issue so edit/archive controls are present
      await selectIssue('MES-1')

      // open the create form (selection remains) and submit
      await user.click(await screen.findByRole('button', { name: 'Yeni issue' }))
      await user.type(screen.getByLabelText('Başlık'), 'Third task')
      await user.click(screen.getByRole('button', { name: 'Oluştur' }))

      const pendingButton = await screen.findByRole('button', {
        name: 'Oluşturuluyor…',
      })
      expect(pendingButton).toBeDisabled()

      // issue selection is locked while create is pending
      const secondButton = await screen.findByRole('button', { name: /^MES-2,/ })
      expect(secondButton).toBeDisabled()
      expect(secondButton).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(secondButton)
      await waitFor(() => {
        expect(getIssueMock).not.toHaveBeenCalledWith('MES-2')
      })

      // edit and archive initiation are blocked while create is pending
      const editButton = await screen.findByRole('button', { name: 'Düzenle' })
      expect(editButton).toBeDisabled()
      expect(editButton).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(editButton)
      const archiveButton = screen.getByRole('button', { name: 'Arşivle' })
      expect(archiveButton).toBeDisabled()
      expect(archiveButton).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(archiveButton)

      // no update or archive API call starts
      expect(updateIssueMock).not.toHaveBeenCalled()
      expect(archiveIssueMock).not.toHaveBeenCalled()

      resolveCreate(
        makeIssue({ issueKey: 'MES-3', number: 3, title: 'Third task' }),
      )
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Oluştur' }),
        ).not.toBeInTheDocument()
      })
    })
  })

  describe('keyboard and focus', () => {
    it('closes the create panel with Escape and returns focus to the create button', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      const user = userEvent.setup()
      renderWorkspace()

      const createButton = await screen.findByRole('button', {
        name: 'Yeni issue',
      })
      await user.click(createButton)
      await screen.findByLabelText('Başlık')

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Oluştur' }),
        ).not.toBeInTheDocument()
      })
      expect(createButton).toHaveFocus()
    })

    it('focuses the first field when the create panel opens', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      const user = userEvent.setup()
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'Yeni issue' }))

      await waitFor(() => {
        expect(screen.getByLabelText('Başlık')).toHaveFocus()
      })
    })
  })

  describe('XSS safety', () => {
    it('renders hostile issue title and description as inert text', async () => {
      const hostileIssue = makeIssue({
        title: '<script>window.__xss=1</script>',
        description: '<img src=x onerror="window.__xss=2">',
      })
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue({ ...pageWithIssues, items: [hostileIssue] })
      getIssueMock.mockResolvedValue(hostileIssue)
      listIssueActivityMock.mockResolvedValue(activity)
      renderWorkspace()

      await screen.findByText('<script>window.__xss=1</script>')
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /^MES-1,/ }))
      expect(
        await screen.findByText('<img src=x onerror="window.__xss=2">'),
      ).toBeInTheDocument()
      expect(document.querySelector('script')).toBeNull()
      expect(document.querySelector('img')).toBeNull()
      expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
    })
  })

  describe('query loading and error states', () => {
    it('shows a loading status while the project is fetching', async () => {
      getProjectMock.mockImplementation(
        () => new Promise<ProjectDetail>(() => {}),
      )
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(emptyPage)
      renderWorkspace()

      expect(await screen.findByText('Proje yükleniyor…')).toBeInTheDocument()
    })

    it('shows a safe error and no mutation authority when the project fails', async () => {
      getProjectMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal project secret'),
      )
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(emptyPage)
      renderWorkspace()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.',
      )
      expect(
        screen.queryByRole('button', { name: 'Yeni issue' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('İssue yönetimi')).not.toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal project secret')
    })

    it('shows a loading status while members are fetching', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockImplementation(
        () => new Promise<ProjectMember[]>(() => {}),
      )
      listIssuesMock.mockResolvedValue(emptyPage)
      renderWorkspace()

      expect(await screen.findByText('Üyeler yükleniyor…')).toBeInTheDocument()
    })

    it('shows a safe error when members fail to load', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal members secret'),
      )
      listIssuesMock.mockResolvedValue(emptyPage)
      renderWorkspace()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Üye listesi yüklenemedi. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal members secret')
    })

    it('shows a loading status for a selected issue detail', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockImplementation(
        () => new Promise<Issue>(() => {}),
      )
      listIssueActivityMock.mockResolvedValue(activity)
      renderWorkspace()

      await selectIssue('MES-1')
      expect(await screen.findByText('Issue yükleniyor…')).toBeInTheDocument()
    })

    it('shows a safe error instead of an empty detail when the selected issue fails', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal detail secret'),
      )
      listIssueActivityMock.mockResolvedValue(activity)
      renderWorkspace()

      await selectIssue('MES-1')
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Issue detayı yüklenemedi. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal detail secret')
    })

    it('shows a safe error when the selected issue activity fails', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal activity secret'),
      )
      renderWorkspace()

      await selectIssue('MES-1')
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Aktivite yüklenemedi. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal activity secret')
    })
  })

  describe('edit focus lifecycle', () => {
    it('returns focus to the edit trigger after cancelling the edit form', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      await user.click(screen.getByRole('button', { name: 'Vazgeç' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Düzenle' })).toHaveFocus()
      })
    })

    it('closes the drawer on Escape from the edit form', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('returns focus to the edit trigger after a successful update', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      updateIssueMock.mockResolvedValue({ ...issue1, title: 'Renamed', version: 1 })
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      const titleInput = screen.getByLabelText('Başlık')
      await user.clear(titleInput)
      await user.type(titleInput, 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Düzenle' })).toHaveFocus()
      })
    })
  })

  describe('archive focus lifecycle', () => {
    it('moves focus into the archive confirmation on open', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Vazgeç' })).toHaveFocus()
      })
    })

    it('returns focus to the archive trigger after cancelling the confirmation', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))
      await user.click(screen.getByRole('button', { name: 'Vazgeç' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Arşivle' })).toHaveFocus()
      })
    })

    it('returns focus to the archive trigger after Escape from the confirmation', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))
      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Arşivle' })).toHaveFocus()
      })
    })
  })

  describe('pending mutation selection race', () => {
    it('locks issue selection while an update is pending and applies the result to the right issue', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      let resolveUpdate: (value: Issue) => void = () => {}
      updateIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveUpdate = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      const titleInput = screen.getByLabelText('Başlık')
      await user.clear(titleInput)
      await user.type(titleInput, 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      const secondButton = await screen.findByRole('button', { name: /^MES-2,/ })
      expect(secondButton).toBeDisabled()
      expect(secondButton).toHaveAttribute('aria-disabled', 'true')
      await user.click(secondButton)
      expect(
        screen.getByRole('heading', { name: 'MES-1', level: 2 }),
      ).toBeInTheDocument()

      resolveUpdate({ ...issue1, title: 'Renamed', version: 1 })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Düzenle' })).toHaveFocus()
      })
      expect(
        screen.getByRole('heading', { name: 'MES-1', level: 2 }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: 'MES-2', level: 3 }),
      ).not.toBeInTheDocument()
    })

    it('locks issue selection while an archive is pending and only closes on the archived issue', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      let resolveArchive: (value: Issue) => void = () => {}
      archiveIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveArchive = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))
      await user.click(
        screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
      )

      const secondButton = await screen.findByRole('button', { name: /^MES-2,/ })
      expect(secondButton).toBeDisabled()
      await user.click(secondButton)
      expect(
        screen.getByRole('heading', { name: 'MES-1', level: 2 }),
      ).toBeInTheDocument()

      resolveArchive({ ...issue1, archived: true, version: 1 })
      await waitFor(() => {
        expect(
          screen.queryByRole('heading', { name: 'MES-1', level: 2 }),
        ).not.toBeInTheDocument()
      })
    })
  })

  describe('activity summary safety', () => {
    it('renders an ARCHIVED activity with a controlled status label', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-archived',
          type: 'ARCHIVED',
          actorId: adminMember.userId,
          summary: { statusCode: 'DONE' },
          createdAt: '2026-01-01T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      expect(
        await screen.findByText('Arşivlendi: Bitti'),
      ).toBeInTheDocument()
    })

    it('falls back entirely when UPDATED changedFields mix known, unknown and hostile entries', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-updated',
          type: 'UPDATED',
          actorId: adminMember.userId,
          summary: {
            changedFields: [
              'title',
              'description',
              'assigneeId',
              '<script>window.__xss=3</script>',
              'pwned',
            ],
            assigneeId: null,
          },
          createdAt: '2026-01-01T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      // A single unknown/hostile entry invalidates the whole field summary;
      // known labels are never silently mixed with a dropped unknown.
      expect(
        await screen.findByText(
          'Güncellendi: bilinmeyen alanlar, Atanmamış',
        ),
      ).toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('<script')
      expect(body).not.toContain('window.__xss')
      expect(body).not.toContain('changedFields')
      expect(body).not.toContain('pwned')
    })

    it('falls back when UPDATED changedFields contain prototype keys', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-updated-proto',
          type: 'UPDATED',
          actorId: adminMember.userId,
          summary: {
            changedFields: ['title', 'constructor', 'toString', '__proto__'],
            assigneeId: null,
          },
          createdAt: '2026-01-01T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      expect(
        await screen.findByText(
          'Güncellendi: bilinmeyen alanlar, Atanmamış',
        ),
      ).toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('constructor')
      expect(body).not.toContain('toString')
      expect(body).not.toContain('__proto__')
    })

    it('falls back when a UPDATED changedFields element is not a string', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-updated-nonstr',
          type: 'UPDATED',
          actorId: adminMember.userId,
          summary: {
            changedFields: ['title', 42],
            assigneeId: null,
          },
          createdAt: '2026-01-01T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      expect(
        await screen.findByText(
          'Güncellendi: bilinmeyen alanlar, Atanmamış',
        ),
      ).toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('42')
    })

    it('maps only whitelisted UPDATED changedFields to safe Turkish labels', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-updated-ok',
          type: 'UPDATED',
          actorId: adminMember.userId,
          summary: {
            changedFields: ['title', 'description', 'assigneeId'],
            assigneeId: null,
          },
          createdAt: '2026-01-01T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      expect(
        await screen.findByText(
          'Güncellendi: Başlık, Açıklama, Atanan, Atanmamış',
        ),
      ).toBeInTheDocument()
    })

    it('uses the fixed status fallback for a hostile unknown string status in CREATED', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-created-str',
          type: 'CREATED',
          actorId: adminMember.userId,
          summary: {
            type: 'TASK',
            statusCode: 'pwned-status',
            assigneeId: null,
          },
          createdAt: '2026-01-01T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      expect(
        await screen.findByText(
          'Oluşturuldu: Görev, bilinmeyen durum, Atanmamış',
        ),
      ).toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('pwned-status')
    })

    it('uses the fixed status fallback for hostile unknown string statuses in MOVED', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-moved-str',
          type: 'MOVED',
          actorId: adminMember.userId,
          summary: { fromStatusCode: 'pwned-from', toStatusCode: 'NOT_REAL' },
          createdAt: '2026-01-02T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      expect(
        await screen.findByText('Durum değişti: bilinmeyen → bilinmeyen'),
      ).toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('pwned-from')
      expect(body).not.toContain('NOT_REAL')
    })

    it('uses the fixed status fallback for a hostile unknown string status in ARCHIVED', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-archived-str',
          type: 'ARCHIVED',
          actorId: adminMember.userId,
          summary: { statusCode: 'pwned-archived' },
          createdAt: '2026-01-03T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      expect(
        await screen.findByText('Arşivlendi: bilinmeyen durum'),
      ).toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('pwned-archived')
    })

    it('produces a safe fallback when UPDATED changedFields are not an array or are unknown', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-updated-bad',
          type: 'UPDATED',
          actorId: adminMember.userId,
          summary: { changedFields: '<script>x</script>', assigneeId: null },
          createdAt: '2026-01-01T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      expect(
        await screen.findByText('Güncellendi: bilinmeyen alanlar, Atanmamış'),
      ).toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('<script')
    })

    it('uses a safe fallback for an invalid assigneeId type', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-updated-assignee',
          type: 'UPDATED',
          actorId: adminMember.userId,
          summary: { changedFields: ['title'], assigneeId: 12345 },
          createdAt: '2026-01-01T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      expect(
        await screen.findByText('Güncellendi: Başlık, Bilinmeyen atanan'),
      ).toBeInTheDocument()
    })

    it('handles hostile CREATED and MOVED summaries without leaking raw values', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue([
        {
          id: 'act-created-bad',
          type: 'CREATED',
          actorId: adminMember.userId,
          summary: { type: 'BOGUS', statusCode: 7, assigneeId: { evil: true } },
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'act-moved-bad',
          type: 'MOVED',
          actorId: adminMember.userId,
          summary: { fromStatusCode: ['x'], toStatusCode: 9 },
          createdAt: '2026-01-02T00:00:00Z',
        },
      ])
      renderWorkspace()

      await selectIssue('MES-1')
      expect(
        await screen.findByText(
          'Oluşturuldu: bilinmeyen tür, bilinmeyen durum, Bilinmeyen atanan',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Durum değişti: bilinmeyen → bilinmeyen'),
      ).toBeInTheDocument()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('BOGUS')
      expect(body).not.toContain('evil')
    })
  })

  describe('move lifecycle', () => {
    async function openMoveMenu(issueKey: string): Promise<ReturnType<typeof userEvent.setup>> {
      const user = userEvent.setup()
      const toggle = await screen.findByRole('button', {
        name: `${issueKey} için taşıma menüsü`,
      })
      await user.click(toggle)
      return user
    }

    it('optimistically moves a card across columns, then reconciles with the server', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      const movedIssue = { ...issue1, statusCode: 'IN_PROGRESS', version: 1 }
      let moved = false
      listIssuesMock.mockImplementation(() =>
        Promise.resolve(
          moved
            ? { ...pageWithIssues, items: [movedIssue, issue2] }
            : pageWithIssues,
        ),
      )
      let resolveMove: (value: Issue) => void = () => {}
      moveIssueMock.mockImplementation(() => {
        moved = true
        return new Promise<Issue>((resolve) => {
          resolveMove = resolve
        })
      })
      renderWorkspace()

      const user = await openMoveMenu('MES-1')
      await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))

      await waitFor(() => {
        expect(moveIssueMock).toHaveBeenCalledWith('MES-1', {
          targetStatusCode: 'IN_PROGRESS',
          beforeIssueKey: null,
          afterIssueKey: 'MES-2',
          expectedVersion: 0,
        })
      })

      // Optimistic state is visible before the response resolves.
      await waitFor(() => {
        expect(
          screen.getByRole('region', { name: 'Sürüyor sütunu, 2 kart' }),
        ).toBeInTheDocument()
        expect(
          screen.getByRole('region', { name: 'Yapılacak sütunu, 0 kart' }),
        ).toBeInTheDocument()
      })

      resolveMove(movedIssue)
      await waitFor(() => {
        expect(screen.getByText('MES-1 taşındı.')).toBeInTheDocument()
      })
      // focus returns to the moved card
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'MES-1, First task, Sürüyor' }),
        ).toHaveFocus()
      })
    })

    it('move pending blocks create, selection, edit, archive and another move', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      let resolveMove: (value: Issue) => void = () => {}
      moveIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveMove = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      // select MES-1 so edit/archive controls exist
      await screen.findByText('First task')
      await user.click(screen.getByRole('button', { name: /^MES-1,/ }))
      await screen.findByRole('button', { name: 'Düzenle' })

      const menuUser = await openMoveMenu('MES-1')
      await menuUser.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
      await waitFor(() => {
        expect(moveIssueMock).toHaveBeenCalledTimes(1)
      })

      const createButton = screen.getByRole('button', { name: 'Yeni issue' })
      expect(createButton).toBeDisabled()
      const secondCard = screen.getByRole('button', { name: /^MES-2,/ })
      expect(secondCard).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Düzenle' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Arşivle' })).toBeDisabled()

      // movement menus are disabled while pending
      const toggles = screen.getAllByRole('button', { name: /taşıma menüsü/ })
      for (const toggle of toggles) {
        expect(toggle).toBeDisabled()
      }

      resolveMove({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Düzenle' })).toBeInTheDocument()
      })
    })

    it('does not issue a second move request while a move is pending', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      let resolveMove: (value: Issue) => void = () => {}
      moveIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveMove = resolve
          }),
      )
      renderWorkspace()
      const user = await openMoveMenu('MES-1')
      await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
      await waitFor(() => {
        expect(moveIssueMock).toHaveBeenCalledTimes(1)
      })
      // all movement menus are disabled and cannot be reopened while pending
      const toggles = screen.getAllByRole('button', { name: /taşıma menüsü/ })
      for (const toggle of toggles) {
        await user.click(toggle)
      }
      await user.click(screen.getByRole('button', { name: /^MES-1,/ }))
      expect(moveIssueMock).toHaveBeenCalledTimes(1)

      resolveMove({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
    })

    it('create pending disables movement controls', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      let resolveCreate: (value: Issue) => void = () => {}
      createIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveCreate = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'Yeni issue' }))
      await user.type(screen.getByLabelText('Başlık'), 'Third task')
      await user.click(screen.getByRole('button', { name: 'Oluştur' }))
      await screen.findByRole('button', { name: 'Oluşturuluyor…' })

      const toggles = screen.getAllByRole('button', { name: /taşıma menüsü/ })
      for (const toggle of toggles) {
        expect(toggle).toBeDisabled()
      }
      expect(moveIssueMock).not.toHaveBeenCalled()

      resolveCreate(makeIssue({ issueKey: 'MES-3', number: 3, title: 'Third task' }))
    })

    it('update pending blocks movement', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      let resolveUpdate: (value: Issue) => void = () => {}
      updateIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveUpdate = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await screen.findByText('First task')
      await user.click(screen.getByRole('button', { name: /^MES-1,/ }))
      await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
      const title = screen.getByLabelText('Başlık')
      await user.clear(title)
      await user.type(title, 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Güncelle' }))

      await waitFor(() => {
        expect(updateIssueMock).toHaveBeenCalledTimes(1)
      })
      const toggles = screen.getAllByRole('button', { name: /taşıma menüsü/ })
      for (const toggle of toggles) {
        expect(toggle).toBeDisabled()
      }
      expect(moveIssueMock).not.toHaveBeenCalled()

      resolveUpdate({ ...issue1, title: 'Renamed', version: 1 })
    })

    it('archive pending blocks movement', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      let resolveArchive: (value: Issue) => void = () => {}
      archiveIssueMock.mockImplementation(
        () =>
          new Promise<Issue>((resolve) => {
            resolveArchive = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await screen.findByText('First task')
      await user.click(screen.getByRole('button', { name: /^MES-1,/ }))
      await user.click(await screen.findByRole('button', { name: 'Arşivle' }))
      await user.click(screen.getByRole('button', { name: 'Arşivlemeyi onayla' }))
      await waitFor(() => {
        expect(archiveIssueMock).toHaveBeenCalledTimes(1)
      })

      const toggles = screen.getAllByRole('button', { name: /taşıma menüsü/ })
      for (const toggle of toggles) {
        expect(toggle).toBeDisabled()
      }
      expect(moveIssueMock).not.toHaveBeenCalled()

      resolveArchive(makeIssue({ archived: true, version: 1 }))
    })

    it('restores cache and shows a generic safe message on an unknown move error', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      moveIssueMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'backend move secret'),
      )
      renderWorkspace()
      const user = await openMoveMenu('MES-1')
      await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('İşlem tamamlanamadı. Lütfen tekrar deneyin.')
      // rollback restores the original column
      await waitFor(() => {
        expect(
          screen.getByRole('region', { name: 'Yapılacak sütunu, 1 kart' }),
        ).toBeInTheDocument()
      })
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend move secret')
    })

    it('rolls back and refetches on VERSION_CONFLICT with a visible alert', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      moveIssueMock.mockRejectedValue(
        new ApiError(409, 'VERSION_CONFLICT', 'backend move conflict secret'),
      )
      renderWorkspace()
      const user = await openMoveMenu('MES-1')
      await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/gözden geçirip gönder/)
      // authoritative refetch of the list happens (initial + onError refetch + onSettled invalidate)
      await waitFor(() => {
        expect(listIssuesMock.mock.calls.length).toBeGreaterThanOrEqual(2)
      })
      await waitFor(() => {
        expect(
          screen.getByRole('region', { name: 'Yapılacak sütunu, 1 kart' }),
        ).toBeInTheDocument()
      })
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend move conflict secret')
    })

    it('recovers from ISSUE_ARCHIVED by restoring cache and refetching', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      moveIssueMock.mockRejectedValue(
        new ApiError(409, 'ISSUE_ARCHIVED', 'backend archived move secret'),
      )
      renderWorkspace()
      const user = await openMoveMenu('MES-1')
      await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))

      const banner = await screen.findByText(
        'Bu issue arşivlendi; güncelleme yapılamıyor.',
      )
      expect(banner).toBeInTheDocument()
      await waitFor(() => {
        expect(listIssuesMock.mock.calls.length).toBeGreaterThanOrEqual(2)
      })
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('backend archived move secret')
    })

    it('cancels and invalidates only the exact issue queries, not unrelated projects', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      moveIssueMock.mockResolvedValue({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
      const queryClient = renderWorkspace()
      const cancelSpy = vi.spyOn(queryClient, 'cancelQueries')
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const user = await openMoveMenu('MES-1')
      await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))

      await waitFor(() => {
        expect(moveIssueMock).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect(cancelSpy).toHaveBeenCalledWith({
          queryKey: ['issues', 'MES', ISSUE_FILTERS],
          exact: true,
        })
        expect(cancelSpy).toHaveBeenCalledWith({
          queryKey: ['issue', 'MES-1'],
          exact: true,
        })
      })
      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['issues', 'MES', ISSUE_FILTERS],
          exact: true,
        })
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['issue', 'MES-1'],
          exact: true,
        })
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['issue', 'MES-1', 'activity'],
          exact: true,
        })
      })
      const unrelated = invalidateSpy.mock.calls.some((call) => {
        const opts = call[0]
        if (opts === undefined || opts.queryKey === undefined) {
          return false
        }
        const qk = opts.queryKey
        return qk[0] === 'issues' && qk[1] !== 'MES'
      })
      expect(unrelated).toBe(false)
    })

    it('allows a MEMBER to move an issue', async () => {
      getProjectMock.mockResolvedValue({ ...projectDetail, currentUserRole: 'MEMBER' })
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      moveIssueMock.mockResolvedValue({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
      renderWorkspace()

      const user = await openMoveMenu('MES-1')
      await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
      await waitFor(() => {
        expect(moveIssueMock).toHaveBeenCalledWith('MES-1', expect.anything())
      })
    })

    it('renders a read-only board for a VIEWER with no movement controls', async () => {
      getProjectMock.mockResolvedValue({ ...projectDetail, currentUserRole: 'VIEWER' })
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      renderWorkspace()

      await screen.findByRole('region', { name: 'Kanban panosu' })
      expect(screen.getByText('MES-1')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /taşıma menüsü/ }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /taşı$/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Yeni issue' })).not.toBeInTheDocument()
      expect(moveIssueMock).not.toHaveBeenCalled()
    })

    describe('synchronous mutation lock', () => {
      async function openCreateFormAndMoveMenu(): Promise<void> {
        fireEvent.click(await screen.findByRole('button', { name: 'Yeni issue' }))
        fireEvent.change(screen.getByLabelText('Başlık'), {
          target: { value: 'Third task' },
        })
        fireEvent.click(
          screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }),
        )
      }

      async function openEditFormAndMoveMenu(): Promise<void> {
        await screen.findByText('First task')
        fireEvent.click(screen.getByRole('button', { name: /^MES-1,/ }))
        await screen.findByRole('button', { name: 'Düzenle' })
        fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
        fireEvent.change(screen.getByLabelText('Başlık'), {
          target: { value: 'Renamed' },
        })
        fireEvent.click(
          screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }),
        )
      }

      async function openArchiveConfirmationAndMoveMenu(): Promise<void> {
        await screen.findByText('First task')
        fireEvent.click(screen.getByRole('button', { name: /^MES-1,/ }))
        await screen.findByRole('button', { name: 'Arşivle' })
        fireEvent.click(screen.getByRole('button', { name: 'Arşivle' }))
        fireEvent.click(
          screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }),
        )
      }

      function seedWorkspace(): void {
        getProjectMock.mockResolvedValue(projectDetail)
        listProjectMembersMock.mockResolvedValue(members)
        listIssuesMock.mockResolvedValue(pageWithIssues)
        getIssueMock.mockResolvedValue(issue1)
        listIssueActivityMock.mockResolvedValue(activity)
      }

      it('blocks a move issued in the same tick as a create (exactly one API call)', async () => {
        let resolveCreate: (value: Issue) => void = () => {}
        createIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveCreate = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await openCreateFormAndMoveMenu()

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Oluştur' }))
          fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
        })
        await waitFor(() => expect(createIssueMock).toHaveBeenCalledTimes(1))
        expect(moveIssueMock).not.toHaveBeenCalled()
        // the active create form is not replaced by a blocked move
        expect(screen.getByRole('button', { name: 'Oluşturuluyor…' })).toBeInTheDocument()
        resolveCreate(makeIssue({ issueKey: 'MES-3', number: 3, title: 'Third task' }))
      })

      it('blocks create issued in the same tick as a move (exactly one API call)', async () => {
        let resolveMove: (value: Issue) => void = () => {}
        moveIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveMove = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await openCreateFormAndMoveMenu()

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
          fireEvent.click(screen.getByRole('button', { name: 'Oluştur' }))
        })

        await waitFor(() => expect(moveIssueMock).toHaveBeenCalledTimes(1))
        expect(createIssueMock).not.toHaveBeenCalled()
        resolveMove({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
      })

      it('blocks a move issued in the same tick as an update (exactly one API call)', async () => {
        let resolveUpdate: (value: Issue) => void = () => {}
        updateIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveUpdate = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await openEditFormAndMoveMenu()

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
          fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
        })

        await waitFor(() => expect(updateIssueMock).toHaveBeenCalledTimes(1))
        expect(moveIssueMock).not.toHaveBeenCalled()
        resolveUpdate({ ...issue1, title: 'Renamed', version: 1 })
      })

      it('blocks an update issued in the same tick as a move (exactly one API call)', async () => {
        let resolveMove: (value: Issue) => void = () => {}
        moveIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveMove = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await openEditFormAndMoveMenu()

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
          fireEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
        })

        await waitFor(() => expect(moveIssueMock).toHaveBeenCalledTimes(1))
        expect(updateIssueMock).not.toHaveBeenCalled()
        resolveMove({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
      })

      it('blocks a move issued in the same tick as an archive (exactly one API call)', async () => {
        let resolveArchive: (value: Issue) => void = () => {}
        archiveIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveArchive = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await openArchiveConfirmationAndMoveMenu()

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Arşivlemeyi onayla' }))
          fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
        })

        await waitFor(() => expect(archiveIssueMock).toHaveBeenCalledTimes(1))
        expect(moveIssueMock).not.toHaveBeenCalled()
        // the archive confirmation is not dismissed by a blocked move
        expect(
          screen.getByRole('button', { name: 'Arşivlemeyi onayla' }),
        ).toBeInTheDocument()
        resolveArchive(makeIssue({ archived: true, version: 1 }))
      })

      it('blocks an archive issued in the same tick as a move (exactly one API call)', async () => {
        let resolveMove: (value: Issue) => void = () => {}
        moveIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveMove = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await openArchiveConfirmationAndMoveMenu()

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
          fireEvent.click(screen.getByRole('button', { name: 'Arşivlemeyi onayla' }))
        })

        await waitFor(() => expect(moveIssueMock).toHaveBeenCalledTimes(1))
        expect(archiveIssueMock).not.toHaveBeenCalled()
        resolveMove({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
      })

      it('releases the lock after a successful mutation so a later one can start', async () => {
        seedWorkspace()
        moveIssueMock.mockResolvedValue({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
        const user = userEvent.setup()
        renderWorkspace()
        await user.click(await screen.findByRole('button', { name: 'MES-1 için taşıma menüsü' }))
        await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
        await screen.findByText('MES-1 taşındı.')

        // lock is released: a create can now proceed
        await user.click(screen.getByRole('button', { name: 'Yeni issue' }))
        await user.type(screen.getByLabelText('Başlık'), 'Third task')
        createIssueMock.mockResolvedValue(makeIssue({ issueKey: 'MES-3', number: 3 }))
        await user.click(screen.getByRole('button', { name: 'Oluştur' }))
        await waitFor(() => {
          expect(createIssueMock).toHaveBeenCalled()
        })
      })

      it('releases the lock after a rejected mutation so a later one can start', async () => {
        seedWorkspace()
        moveIssueMock.mockRejectedValue(
          new ApiError(500, 'INTERNAL', 'backend move secret'),
        )
        const user = userEvent.setup()
        renderWorkspace()
        await user.click(await screen.findByRole('button', { name: 'MES-1 için taşıma menüsü' }))
        await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
        await screen.findByRole('alert')

        await user.click(screen.getByRole('button', { name: 'Yeni issue' }))
        await user.type(screen.getByLabelText('Başlık'), 'Third task')
        createIssueMock.mockResolvedValue(makeIssue({ issueKey: 'MES-3', number: 3 }))
        await user.click(screen.getByRole('button', { name: 'Oluştur' }))
        await waitFor(() => {
          expect(createIssueMock).toHaveBeenCalled()
        })
      })

      it('releases the lock when a move onMutate rejects so no permanent lock remains', async () => {
        seedWorkspace()
        moveIssueMock.mockResolvedValue({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
        const queryClient = renderWorkspace()
        vi.spyOn(queryClient, 'cancelQueries').mockRejectedValue(new Error('boom'))
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'MES-1 için taşıma menüsü' }))
        await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
        // onMutate throws before the mutation function runs; the move never
        // reaches the API, and the lock must still be released.
        await waitFor(() => {
          expect(moveIssueMock).not.toHaveBeenCalled()
        })

        await user.click(screen.getByRole('button', { name: 'Yeni issue' }))
        await user.type(screen.getByLabelText('Başlık'), 'Third task')
        createIssueMock.mockResolvedValue(makeIssue({ issueKey: 'MES-3', number: 3 }))
        await user.click(screen.getByRole('button', { name: 'Oluştur' }))
        await waitFor(() => {
          expect(createIssueMock).toHaveBeenCalled()
        })
      })

      it('allows only one move in the same tick (move vs move), then releases for a later move', async () => {
        let resolveMove: (value: Issue) => void = () => {}
        moveIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveMove = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await screen.findByText('First task')
        // Open two cards' move menus so two independently valid move actions
        // are available in the same tick.
        fireEvent.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))
        fireEvent.click(screen.getByRole('button', { name: 'MES-2 için taşıma menüsü' }))
        const nextButtons = screen.getAllByRole('button', { name: 'Sonraki sütuna taşı' })
        expect(nextButtons.length).toBeGreaterThanOrEqual(2)

        act(() => {
          fireEvent.click(nextButtons[0])
          fireEvent.click(nextButtons[1])
        })
        await waitFor(() => expect(moveIssueMock).toHaveBeenCalledTimes(1))

        // Resolving the first move releases the lock so a later move can start.
        resolveMove({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
        await screen.findByText('MES-1 taşındı.')

        fireEvent.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))
        fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
        await waitFor(() => expect(moveIssueMock).toHaveBeenCalledTimes(2))
      })

      it('does not open the create form in the same tick as a move, then allows it after release', async () => {
        let resolveMove: (value: Issue) => void = () => {}
        moveIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveMove = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await screen.findByText('First task')
        fireEvent.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
          fireEvent.click(screen.getByRole('button', { name: 'Yeni issue' }))
        })
        await waitFor(() => expect(moveIssueMock).toHaveBeenCalledTimes(1))
        // mutationLocked is the synchronous authority: the create form must not appear.
        expect(screen.queryByRole('button', { name: 'Oluştur' })).not.toBeInTheDocument()

        resolveMove({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
        await screen.findByText('MES-1 taşındı.')
        // After release the same action becomes available.
        fireEvent.click(screen.getByRole('button', { name: 'Yeni issue' }))
        expect(screen.getByRole('button', { name: 'Oluştur' })).toBeInTheDocument()
      })

      it('does not change selection in the same tick as a create submit', async () => {
        let resolveCreate: (value: Issue) => void = () => {}
        createIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveCreate = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await screen.findByText('First task')
        fireEvent.click(screen.getByRole('button', { name: 'Yeni issue' }))
        fireEvent.change(screen.getByLabelText('Başlık'), {
          target: { value: 'Third task' },
        })
        const selectSecond = screen.getByRole('button', {
          name: 'MES-2, Second bug, Sürüyor',
        })

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Oluştur' }))
          fireEvent.click(selectSecond)
        })
        await waitFor(() => expect(createIssueMock).toHaveBeenCalledTimes(1))
        // handleSelect is gated by mutationLocked; selection stays unchanged.
        expect(
          screen.queryByRole('heading', { name: 'MES-2', level: 3 }),
        ).not.toBeInTheDocument()
        resolveCreate(makeIssue({ issueKey: 'MES-3', number: 3, title: 'Third task' }))
      })

      it('does not open the edit form in the same tick as a move', async () => {
        let resolveMove: (value: Issue) => void = () => {}
        moveIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveMove = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await screen.findByText('First task')
        fireEvent.click(screen.getByRole('button', { name: /^MES-1,/ }))
        await screen.findByRole('button', { name: 'Düzenle' })
        fireEvent.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
          fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
        })
        await waitFor(() => expect(moveIssueMock).toHaveBeenCalledTimes(1))
        expect(screen.queryByRole('button', { name: 'Güncelle' })).not.toBeInTheDocument()
        resolveMove({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
      })

      it('does not open the archive confirmation in the same tick as a move', async () => {
        let resolveMove: (value: Issue) => void = () => {}
        moveIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveMove = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await screen.findByText('First task')
        fireEvent.click(screen.getByRole('button', { name: /^MES-1,/ }))
        await screen.findByRole('button', { name: 'Arşivle' })
        fireEvent.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
          fireEvent.click(screen.getByRole('button', { name: 'Arşivle' }))
        })
        await waitFor(() => expect(moveIssueMock).toHaveBeenCalledTimes(1))
        expect(
          screen.queryByRole('button', { name: 'Arşivlemeyi onayla' }),
        ).not.toBeInTheDocument()
        resolveMove({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
      })

      it('a blocked move does not clear an open edit form and its draft', async () => {
        let resolveUpdate: (value: Issue) => void = () => {}
        updateIssueMock.mockImplementation(
          () =>
            new Promise<Issue>((resolve) => {
              resolveUpdate = resolve
            }),
        )
        seedWorkspace()
        renderWorkspace()
        await screen.findByText('First task')
        fireEvent.click(screen.getByRole('button', { name: /^MES-1,/ }))
        await screen.findByRole('button', { name: 'Düzenle' })
        fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
        fireEvent.change(screen.getByLabelText('Başlık'), {
          target: { value: 'Renamed' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))

        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
          fireEvent.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
        })
        await waitFor(() => expect(updateIssueMock).toHaveBeenCalledTimes(1))
        expect(moveIssueMock).not.toHaveBeenCalled()
        // The blocked move must not dismantle the edit form or its draft.
        expect(screen.getByLabelText('Başlık')).toHaveValue('Renamed')
        expect(
          screen.getByRole('button', { name: 'Güncelleniyor…' }),
        ).toBeInTheDocument()
        resolveUpdate({ ...issue1, title: 'Renamed', version: 1 })
      })
    })

    it('applies a completed move only to the moved issue, keeping selection stable', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      moveIssueMock.mockResolvedValue({ ...issue1, statusCode: 'IN_PROGRESS', version: 1 })
      const user = userEvent.setup()
      renderWorkspace()

      await screen.findByText('First task')
      await user.click(screen.getByRole('button', { name: /^MES-1,/ }))
      await screen.findByRole('heading', { name: 'MES-1', level: 2 })

      const menuUser = await openMoveMenu('MES-1')
      await menuUser.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))

      await waitFor(() => {
        expect(screen.getByText('MES-1 taşındı.')).toBeInTheDocument()
      })
      expect(
        screen.getByRole('heading', { name: 'MES-1', level: 2 }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: 'MES-2', level: 3 }),
      ).not.toBeInTheDocument()
    })
  })

  describe('cross-project route data isolation and drawer busy lifecycle', () => {
    it('does not fetch activity or comments when the issue belongs to another project', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(makeIssue({ projectKey: 'OTHER' }))
      renderWorkspace('/projects/MES/issues/MES-1')

      await waitFor(() => {
        expect(getIssueMock).toHaveBeenCalledWith('MES-1')
      })
      // The detail projectKey does not match the route project key, so the
      // activity API must never fire and no drawer (hence no comments API call)
      // may render or cache the wrong-project data.
      expect(listIssueActivityMock).not.toHaveBeenCalled()
      expect(listIssueCommentsMock).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('does not fetch activity until the detail matches the route project', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      listIssueActivityMock.mockResolvedValue(activity)
      // The detail stays loading (never resolves), so activity must not fire.
      getIssueMock.mockImplementation(() => new Promise(() => {}))
      renderWorkspace('/projects/MES/issues/MES-1')

      await waitFor(() => {
        expect(listIssueActivityMock).not.toHaveBeenCalled()
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('blocks Escape, close and backdrop while a comment create is pending', async () => {
      getProjectMock.mockResolvedValue(projectDetail)
      listProjectMembersMock.mockResolvedValue(members)
      listIssuesMock.mockResolvedValue(pageWithIssues)
      getIssueMock.mockResolvedValue(issue1)
      listIssueActivityMock.mockResolvedValue(activity)
      let resolveCreate: (value: unknown) => void = () => {}
      createCommentMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve
          }),
      )
      const user = userEvent.setup()
      renderWorkspace()

      await selectIssue('MES-1')
      await screen.findByRole('heading', { name: 'MES-1', level: 2 })
      await user.click(screen.getByRole('tab', { name: 'Yorumlar' }))
      await user.type(screen.getByLabelText('Yorum ekle'), 'a comment')
      await user.click(screen.getByRole('button', { name: 'Yorum yap' }))
      await waitFor(() => {
        expect(createCommentMock).toHaveBeenCalledTimes(1)
      })

      // Busy: the close button is disabled and Escape/backdrop cannot close.
      const close = screen.getByRole('button', { name: /kapat/i })
      expect(close).toBeDisabled()
      await user.keyboard('{Escape}')
      await user.click(
        document.querySelector('.issue-drawer__backdrop') as Element,
      )
      expect(
        screen.queryByRole('heading', { name: 'MES-1', level: 2 }),
      ).toBeInTheDocument()

      resolveCreate(makeCommentForWorkspace())
      await waitFor(() => {
        expect(createCommentMock).toHaveBeenCalledTimes(1)
      })
    })
  })
})

function makeCommentForWorkspace() {
  return {
    id: 'c-1',
    issueKey: 'MES-1',
    authorId: adminMember.userId,
    body: 'a comment',
    deleted: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 0,
  }
}
