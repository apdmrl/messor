import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '../../app/apiClient'
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

function renderProjectsPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectKey/board" element={<div>BOARD</div>} />
        </Routes>
      </MemoryRouter>
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

      expect(
        screen.getByRole('status', { name: '' }),
      ).toBeInTheDocument()
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

      await screen.findByText(
        '<img src=x onerror="window.__xss=1">Messor',
      )
      expect(
        screen.getByText('<script>window.__xss=2</script>'),
      ).toBeInTheDocument()
      expect(document.querySelector('img')).toBeNull()
      expect(document.querySelector('script')).toBeNull()
      expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
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
      await user.type(
        screen.getByLabelText('Proje adı'),
        'x'.repeat(121),
      )
      await user.click(screen.getByRole('button', { name: 'Proje oluştur' }))

      expect(
        await screen.findByText('Proje anahtarı en fazla 10 karakter olabilir.'),
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
