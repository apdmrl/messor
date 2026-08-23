import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '../../app/apiClient'
import { SessionContext } from '../../app/session'
import type { UserSummary } from '../auth/types'
import { ProjectsPage } from './ProjectsPage'
import type { PageResponse, ProjectDetail, ProjectSummary } from './types'

const projectOne: ProjectSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  key: 'MES',
  name: 'Messor',
  description: 'A tracker',
  currentUserRole: 'PROJECT_LEAD',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const projectTwo: ProjectSummary = {
  id: '22222222-2222-2222-2222-222222222222',
  key: 'ALPHA',
  name: 'Alpha',
  description: null,
  currentUserRole: 'MEMBER',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const emptyPage: PageResponse<ProjectSummary> = {
  items: [],
  page: 0,
  size: 100,
  totalItems: 0,
  totalPages: 0,
}

const populatedPage: PageResponse<ProjectSummary> = {
  items: [projectOne, projectTwo],
  page: 0,
  size: 100,
  totalItems: 2,
  totalPages: 1,
}

const createdDetail: ProjectDetail = {
  ...projectOne,
  workflowStatuses: [],
}

vi.mock('./projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./projectsApi')>()
  return {
    ...actual,
    listProjects: vi.fn(),
    createProject: vi.fn(),
  }
})

import { createProject, listProjects } from './projectsApi'

const listProjectsMock = listProjects as Mock
const createProjectMock = createProject as Mock

function renderProjectsPage(role: 'ORG_ADMIN' | 'USER' = 'ORG_ADMIN'): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const sessionValue = {
    session: {
      status: 'authenticated' as const,
      user: {
        id: role === 'ORG_ADMIN' ? 'admin-user-id' : 'member-user-id',
        email:
          role === 'ORG_ADMIN'
            ? 'admin@demo.messor.app'
            : 'member@demo.messor.app',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: role as UserSummary['role'],
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
        <MemoryRouter initialEntries={['/projects']}>
          <Routes>
            <Route path="/projects" element={<ProjectsPage />} />
            <Route
              path="/projects/:projectKey/board"
              element={<div>BOARD</div>}
            />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
}

describe('ProjectsPage', () => {
  beforeEach(() => {
    listProjectsMock.mockReset()
    createProjectMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('project list states', () => {
    it('shows an accessible loading status while fetching', () => {
      listProjectsMock.mockImplementation(
        () => new Promise<PageResponse<ProjectSummary>>(() => {}),
      )
      renderProjectsPage()

      expect(screen.getByRole('status', { name: '' })).toBeInTheDocument()
      expect(screen.getByText('Projeler yükleniyor…')).toBeInTheDocument()
    })

    it('shows a safe error message when the list fails', async () => {
      listProjectsMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal list secret'),
      )
      renderProjectsPage()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Projeler yüklenemedi. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal list secret')
    })

    it('shows an empty state when there are no projects', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      renderProjectsPage()

      expect(
        await screen.findByText('Henüz proje yok. İlk projeni oluştur.'),
      ).toBeInTheDocument()
    })

    it('renders project cards with safe DTO fields', async () => {
      listProjectsMock.mockResolvedValue(populatedPage)
      renderProjectsPage()

      expect(await screen.findByText('Messor')).toBeInTheDocument()
      expect(screen.getByText('MES')).toBeInTheDocument()
      expect(screen.getByText('A tracker')).toBeInTheDocument()
      expect(screen.getByText('Proje lideri')).toBeInTheDocument()
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Üye')).toBeInTheDocument()
    })

    it('renders backend text as literal text, never as HTML', async () => {
      const xssProject: ProjectSummary = {
        ...projectOne,
        name: '<img src=x onerror="window.__xss=1">Messor',
        description: '<script>window.__xss=2</script>',
      }
      listProjectsMock.mockResolvedValue({
        ...populatedPage,
        items: [xssProject],
      })
      renderProjectsPage()

      await screen.findByText('<img src=x onerror="window.__xss=1">Messor')
      expect(
        screen.getByText('<script>window.__xss=2</script>'),
      ).toBeInTheDocument()
      expect(document.querySelector('img')).toBeNull()
      expect(document.querySelector('script')).toBeNull()
      expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
    })
  })

  describe('overview summary action links', () => {
    it('routes each project card to its board and settings surfaces', async () => {
      listProjectsMock.mockResolvedValue(populatedPage)
      renderProjectsPage()

      await screen.findByText('Messor')

      const cards = screen.getAllByRole('listitem')
      const assertCardLinks = (
        card: HTMLElement,
        key: string,
        name: string,
      ): void => {
        // The summary card itself opens the board; settings is a secondary link.
        expect(
          within(card).getByRole('link', { name: new RegExp(name) }),
        ).toHaveAttribute('href', `/projects/${key}/board`)
        expect(
          within(card).getByRole('link', { name: 'Ayarlar' }),
        ).toHaveAttribute('href', `/projects/${key}/settings`)
      }

      const messorCard = cards.find((card) => within(card).queryByText('MES'))
      expect(messorCard).toBeDefined()
      if (messorCard) {
        assertCardLinks(messorCard, 'MES', 'Messor')
      }

      const alphaCard = cards.find((card) => within(card).queryByText('ALPHA'))
      expect(alphaCard).toBeDefined()
      if (alphaCard) {
        assertCardLinks(alphaCard, 'ALPHA', 'Alpha')
      }
    })
  })

  describe('create authorization gating', () => {
    it('shows the create form only to an ORG_ADMIN', async () => {
      listProjectsMock.mockResolvedValue(populatedPage)
      renderProjectsPage('ORG_ADMIN')

      await screen.findByText('Messor')
      expect(
        screen.getByRole('heading', { name: 'Yeni proje' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Proje oluştur' }),
      ).toBeInTheDocument()
    })

    it('hides the create form from a non-admin user', async () => {
      listProjectsMock.mockResolvedValue(populatedPage)
      renderProjectsPage('USER')

      await screen.findByText('Messor')
      expect(
        screen.queryByRole('heading', { name: 'Yeni proje' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Proje oluştur' }),
      ).not.toBeInTheDocument()
      // Existing project cards still render for non-admins.
      expect(screen.getByText('MES')).toBeInTheDocument()
      expect(screen.getByText('Üye')).toBeInTheDocument()
    })

    it('shows the admin create-first empty state to an ORG_ADMIN', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      renderProjectsPage('ORG_ADMIN')

      expect(
        await screen.findByText('Henüz proje yok. İlk projeni oluştur.'),
      ).toBeInTheDocument()
    })

    it('shows a tailored empty state to a non-admin with no projects', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      renderProjectsPage('USER')

      expect(await screen.findByText('Henüz proje yok')).toBeInTheDocument()
      expect(
        screen.getByText(
          'Sana atanmış bir proje bulunmuyor. Yeni projeler yalnızca ' +
            'organizasyon yöneticileri tarafından oluşturulur.',
        ),
      ).toBeInTheDocument()
      // The admin-oriented create prompt must not reach a non-admin.
      expect(
        screen.queryByText('Henüz proje yok. İlk projeni oluştur.'),
      ).not.toBeInTheDocument()
    })
  })

  describe('create form validation', () => {
    it('shows field errors for missing key and name', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      const user = userEvent.setup()
      renderProjectsPage()

      await screen.findByText('Henüz proje yok. İlk projeni oluştur.')

      await user.click(screen.getByRole('button', { name: 'Proje oluştur' }))

      expect(
        await screen.findByText('Proje anahtarı zorunludur.'),
      ).toBeInTheDocument()
      expect(screen.getByText('Proje adı zorunludur.')).toBeInTheDocument()
      expect(createProjectMock).not.toHaveBeenCalled()
    })

    it('shows a key length error and a name length error', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      const user = userEvent.setup()
      renderProjectsPage()

      await screen.findByText('Henüz proje yok. İlk projeni oluştur.')

      await user.type(screen.getByLabelText('Proje anahtarı'), 'ABCDEFGHIJK')
      await user.type(screen.getByLabelText('Proje adı'), 'x'.repeat(121))
      await user.click(screen.getByRole('button', { name: 'Proje oluştur' }))

      expect(
        await screen.findByText(
          'Proje anahtarı en fazla 10 karakter olabilir.',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Proje adı en fazla 120 karakter olabilir.'),
      ).toBeInTheDocument()
      expect(createProjectMock).not.toHaveBeenCalled()
    })

    it('shows a description length error', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      const user = userEvent.setup()
      renderProjectsPage()

      await screen.findByText('Henüz proje yok. İlk projeni oluştur.')

      await user.type(screen.getByLabelText('Proje anahtarı'), 'MES')
      await user.type(screen.getByLabelText('Proje adı'), 'Messor')
      fireEvent.change(screen.getByLabelText('Açıklama'), {
        target: { value: 'x'.repeat(2001) },
      })
      await user.click(screen.getByRole('button', { name: 'Proje oluştur' }))

      expect(
        await screen.findByText('Açıklama en fazla 2000 karakter olabilir.'),
      ).toBeInTheDocument()
      expect(createProjectMock).not.toHaveBeenCalled()
    })
  })

  describe('create submission', () => {
    it('disables fields and submit while pending and prevents duplicate submit', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      let resolveCreate: (value: ProjectDetail) => void = () => {}
      createProjectMock.mockImplementation(
        () =>
          new Promise<ProjectDetail>((resolve) => {
            resolveCreate = resolve
          }),
      )
      const user = userEvent.setup()
      renderProjectsPage()

      await screen.findByText('Henüz proje yok. İlk projeni oluştur.')

      await user.type(screen.getByLabelText('Proje anahtarı'), 'mes')
      await user.type(screen.getByLabelText('Proje adı'), 'Messor')
      await user.click(screen.getByRole('button', { name: 'Proje oluştur' }))

      const pendingButton = await screen.findByRole('button', {
        name: 'Oluşturuluyor…',
      })
      expect(pendingButton).toBeDisabled()
      expect(screen.getByLabelText('Proje anahtarı')).toBeDisabled()
      expect(screen.getByLabelText('Proje adı')).toBeDisabled()

      // Attempt a duplicate submit while pending.
      await user.click(pendingButton)
      expect(createProjectMock).toHaveBeenCalledTimes(1)

      resolveCreate(createdDetail)
      await waitFor(() => {
        expect(screen.getByText('BOARD')).toBeInTheDocument()
      })
    })

    it('normalizes the key to uppercase before submitting', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      createProjectMock.mockResolvedValue(createdDetail)
      const user = userEvent.setup()
      renderProjectsPage()

      await screen.findByText('Henüz proje yok. İlk projeni oluştur.')

      await user.type(screen.getByLabelText('Proje anahtarı'), '  mes  ')
      await user.type(screen.getByLabelText('Proje adı'), '  Messor  ')
      await user.click(screen.getByRole('button', { name: 'Proje oluştur' }))

      await waitFor(() => {
        expect(createProjectMock).toHaveBeenCalledWith(
          {
            key: 'MES',
            name: 'Messor',
            description: undefined,
          },
          expect.anything(),
        )
      })
    })

    it('invalidates the projects query and navigates to the board on success', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      createProjectMock.mockResolvedValue(createdDetail)
      const user = userEvent.setup()
      renderProjectsPage()

      await screen.findByText('Henüz proje yok. İlk projeni oluştur.')

      await user.type(screen.getByLabelText('Proje anahtarı'), 'MES')
      await user.type(screen.getByLabelText('Proje adı'), 'Messor')
      await user.click(screen.getByRole('button', { name: 'Proje oluştur' }))

      await waitFor(() => {
        expect(screen.getByText('BOARD')).toBeInTheDocument()
      })
      // The list query is refetched after invalidation.
      await waitFor(() => {
        expect(listProjectsMock).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('create errors', () => {
    it('shows the safe detail for PROJECT_KEY_ALREADY_EXISTS', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      createProjectMock.mockRejectedValue(
        new ApiError(
          409,
          'PROJECT_KEY_ALREADY_EXISTS',
          'Bu anahtar zaten kullanımda.',
        ),
      )
      const user = userEvent.setup()
      renderProjectsPage()

      await screen.findByText('Henüz proje yok. İlk projeni oluştur.')

      await user.type(screen.getByLabelText('Proje anahtarı'), 'MES')
      await user.type(screen.getByLabelText('Proje adı'), 'Messor')
      await user.click(screen.getByRole('button', { name: 'Proje oluştur' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Bu anahtar zaten kullanımda.')
    })

    it('does not leak an unknown/internal error message into the DOM', async () => {
      listProjectsMock.mockResolvedValue(emptyPage)
      createProjectMock.mockRejectedValue(
        new ApiError(500, 'INTERNAL', 'internal create secret'),
      )
      const user = userEvent.setup()
      renderProjectsPage()

      await screen.findByText('Henüz proje yok. İlk projeni oluştur.')

      await user.type(screen.getByLabelText('Proje anahtarı'), 'MES')
      await user.type(screen.getByLabelText('Proje adı'), 'Messor')
      await user.click(screen.getByRole('button', { name: 'Proje oluştur' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Proje oluşturulamadı. Lütfen tekrar deneyin.',
      )
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal create secret')
    })
  })
})
