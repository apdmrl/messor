import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthApiError } from './features/auth/authApi'
import type { UserSummary } from './features/auth/types'
import { resolveTheme } from './app/theme'
import type { PageResponse, ProjectSummary } from './features/projects/types'

const adminUser: UserSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'admin@demo.messor.app',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'ORG_ADMIN',
}

const memberUser: UserSummary = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'member@demo.messor.app',
  firstName: 'Grace',
  lastName: 'Hopper',
  role: 'USER',
}

const emptyProjects: PageResponse<ProjectSummary> = {
  items: [],
  page: 0,
  size: 100,
  totalItems: 0,
  totalPages: 0,
}

const adminProjects: PageResponse<ProjectSummary> = {
  items: [
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      key: 'ALPHA',
      name: 'Alpha Project',
      description: 'Alpha description',
      currentUserRole: 'PROJECT_LEAD',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  page: 0,
  size: 100,
  totalItems: 1,
  totalPages: 1,
}

const memberProjects: PageResponse<ProjectSummary> = {
  items: [
    {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      key: 'BETA',
      name: 'Beta Project',
      description: 'Beta description',
      currentUserRole: 'MEMBER',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  page: 0,
  size: 100,
  totalItems: 1,
  totalPages: 1,
}

vi.mock('./features/auth/authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./features/auth/authApi')>()
  return {
    ...actual,
    login: vi.fn(),
    getCurrentUser: vi.fn(),
    logout: vi.fn(),
  }
})

vi.mock('./features/projects/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('./features/projects/projectsApi')
  >()
  return {
    ...actual,
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProject: vi.fn(),
    listProjectMembers: vi.fn(),
  }
})

vi.mock('./features/my-work/myWorkApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./features/my-work/myWorkApi')>()
  return {
    ...actual,
    listMyWork: vi.fn(),
  }
})

import { getCurrentUser, login, logout } from './features/auth/authApi'
import {
  getProject,
  listProjectMembers,
  listProjects,
} from './features/projects/projectsApi'
import { listMyWork } from './features/my-work/myWorkApi'
import App from './App'

const getCurrentUserMock = getCurrentUser as Mock
const loginMock = login as Mock
const logoutMock = logout as Mock
const listProjectsMock = listProjects as Mock
const listMyWorkMock = listMyWork as Mock
const getProjectMock = getProject as Mock
const listProjectMembersMock = listProjectMembers as Mock

function renderAt(path: string): void {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  render(<App />)
}

describe('App session state and routing', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset()
    loginMock.mockReset()
    logoutMock.mockReset()
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
    window.history.pushState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initial session loading', () => {
    it('shows an accessible status while checking the session', () => {
      getCurrentUserMock.mockImplementation(
        () => new Promise<UserSummary | null>(() => {}),
      )
      renderAt('/projects')

      expect(
        screen.getByText('Oturum kontrol ediliyor…'),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Oturum aç' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Çıkış yap' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('anonymous bootstrap', () => {
    it('shows the login page when getCurrentUser resolves null', async () => {
      getCurrentUserMock.mockResolvedValue(null)
      renderAt('/projects')

      expect(
        await screen.findByRole('heading', { name: 'Oturum aç', level: 2 }),
      ).toBeInTheDocument()
    })
  })

  describe('protected route redirect', () => {
    it('redirects an anonymous user from /projects to /login', async () => {
      getCurrentUserMock.mockResolvedValue(null)
      renderAt('/projects')

      expect(
        await screen.findByRole('heading', { name: 'Oturum aç', level: 2 }),
      ).toBeInTheDocument()
    })

    it('redirects an anonymous user from /my-work to /login', async () => {
      getCurrentUserMock.mockResolvedValue(null)
      renderAt('/my-work')

      expect(
        await screen.findByRole('heading', { name: 'Oturum aç', level: 2 }),
      ).toBeInTheDocument()
    })

    it('redirects an anonymous user from project settings to /login', async () => {
      getCurrentUserMock.mockResolvedValue(null)
      renderAt('/projects/MES/settings')

      expect(
        await screen.findByRole('heading', { name: 'Oturum aç', level: 2 }),
      ).toBeInTheDocument()
    })
  })

  describe('project settings route', () => {
    it('deep-links an authenticated user directly to settings', async () => {
      getCurrentUserMock.mockResolvedValue(adminUser)
      getProjectMock.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        key: 'MES',
        name: 'Messor',
        description: null,
        currentUserRole: 'PROJECT_LEAD',
        version: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        workflowStatuses: [],
      })
      listProjectMembersMock.mockResolvedValue([
        {
          userId: '11111111-1111-1111-1111-111111111111',
          email: 'admin@demo.messor.app',
          firstName: 'Ada',
          lastName: 'Lovelace',
          role: 'PROJECT_LEAD',
          version: 1,
        },
      ])
      renderAt('/projects/MES/settings')

      await waitFor(() => {
        expect(getProjectMock).toHaveBeenCalledWith('MES')
      })
      expect(
        await screen.findByRole('heading', { name: 'Proje ayarları', level: 2 }),
      ).toBeInTheDocument()
      const user = userEvent.setup()
      await user.click(screen.getByRole('tab', { name: 'Üyeler' }))
      const memberCard = screen.getByRole('listitem')
      expect(within(memberCard).getByText('Ada Lovelace')).toBeInTheDocument()
    })

    it('exposes a settings link from each project on the projects page', async () => {
      getCurrentUserMock.mockResolvedValue(adminUser)
      listProjectsMock.mockResolvedValue(adminProjects)
      renderAt('/projects')

      await screen.findByText('Alpha Project')

      const settingsLink = screen.getByRole('link', { name: 'Ayarlar' })
      expect(settingsLink).toHaveAttribute(
        'href',
        '/projects/ALPHA/settings',
      )
    })
  })

  describe('authenticated bootstrap', () => {
    it('shows the authenticated shell with user details and logout', async () => {
      getCurrentUserMock.mockResolvedValue(adminUser)
      renderAt('/projects')

      expect(
        await screen.findByRole('heading', { name: 'Messor', level: 1 }),
      ).toBeInTheDocument()

      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
      expect(screen.getByText('admin@demo.messor.app')).toBeInTheDocument()
      expect(screen.getByText('Organizasyon yöneticisi')).toBeInTheDocument()

      expect(
        screen.getByRole('button', { name: 'Çıkış yap' }),
      ).toBeInTheDocument()

      const body = document.body.textContent ?? ''
      expect(body).not.toContain(adminUser.id)
      expect(body).not.toContain('password')
      expect(body).not.toContain('authorities')
    })

    it('shows the Üye role label for a USER', async () => {
      getCurrentUserMock.mockResolvedValue(memberUser)
      renderAt('/projects')

      expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()
      expect(screen.getByText('Üye')).toBeInTheDocument()
    })
  })

  describe('authenticated /login redirect', () => {
    it('redirects an authenticated user from /login to /projects', async () => {
      getCurrentUserMock.mockResolvedValue(adminUser)
      renderAt('/login')

      expect(
        await screen.findByRole('heading', { name: 'Messor', level: 1 }),
      ).toBeInTheDocument()
      expect(
        await screen.findByRole('heading', { name: 'Projeler', level: 2 }),
      ).toBeInTheDocument()
    })
  })

  describe('root route redirect', () => {
    it('redirects an anonymous user from / to /login', async () => {
      getCurrentUserMock.mockResolvedValue(null)
      renderAt('/')

      expect(
        await screen.findByRole('heading', { name: 'Oturum aç', level: 2 }),
      ).toBeInTheDocument()
    })

    it('redirects an authenticated user from / to /projects', async () => {
      getCurrentUserMock.mockResolvedValue(adminUser)
      renderAt('/')

      expect(
        await screen.findByRole('heading', { name: 'Projeler', level: 2 }),
      ).toBeInTheDocument()
    })
  })

  describe('recoverable bootstrap error', () => {
    it('shows a safe message and retry, then recovers on retry', async () => {
      getCurrentUserMock
        .mockRejectedValueOnce(new Error('internal bootstrap secret'))
        .mockResolvedValueOnce(memberUser)
      const user = userEvent.setup()
      renderAt('/projects')

      expect(
        await screen.findByText('Oturum durumu alınamadı.'),
      ).toBeInTheDocument()

      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal bootstrap secret')

      const retryButton = screen.getByRole('button', { name: 'Tekrar dene' })
      await user.click(retryButton)

      expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()
      expect(getCurrentUserMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('login to shell integration', () => {
    it('transitions to the authenticated shell after a real login', async () => {
      getCurrentUserMock.mockResolvedValue(null)
      loginMock.mockResolvedValue(adminUser)
      const user = userEvent.setup()
      renderAt('/login')

      await screen.findByRole('heading', { name: 'Oturum aç', level: 2 })

      await user.type(screen.getByLabelText('E-posta'), 'admin@demo.messor.app')
      await user.type(screen.getByLabelText('Parola'), 'correct-password')
      await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

      expect(
        await screen.findByRole('heading', { name: 'Messor', level: 1 }),
      ).toBeInTheDocument()
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    })
  })

  describe('shell navigation', () => {
    it('navigates between Projects and My Work via the nav links', async () => {
      getCurrentUserMock.mockResolvedValue(adminUser)
      const user = userEvent.setup()
      renderAt('/projects')

      await screen.findByRole('heading', { name: 'Projeler', level: 2 })

      await user.click(screen.getByRole('link', { name: 'Görevlerim' }))

      expect(
        await screen.findByRole('heading', { name: 'Görevlerim', level: 2 }),
      ).toBeInTheDocument()
      expect(listMyWorkMock).toHaveBeenCalled()
      expect(
        await screen.findByText('Sana atanmış iş bulunamadı.'),
      ).toBeInTheDocument()
    })
  })

  describe('logout success', () => {
    it('disables the button while logging out and returns to login', async () => {
      getCurrentUserMock.mockResolvedValue(adminUser)
      let resolveLogout: () => void = () => {}
      logoutMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveLogout = resolve
          }),
      )
      const user = userEvent.setup()
      renderAt('/projects')

      await screen.findByRole('heading', { name: 'Messor', level: 1 })

      const logoutButton = screen.getByRole('button', { name: 'Çıkış yap' })
      await user.click(logoutButton)

      expect(
        screen.getByRole('button', { name: 'Çıkış yapılıyor…' }),
      ).toBeDisabled()

      resolveLogout()

      expect(
        await screen.findByRole('heading', { name: 'Oturum aç', level: 2 }),
      ).toBeInTheDocument()
    })
  })

  describe('logout failure', () => {
    it('stays in the shell and shows a safe alert', async () => {
      getCurrentUserMock.mockResolvedValue(adminUser)
      logoutMock.mockRejectedValue(
        new AuthApiError(500, 'INTERNAL', 'internal logout secret'),
      )
      const user = userEvent.setup()
      renderAt('/projects')

      await screen.findByRole('heading', { name: 'Messor', level: 1 })

      await user.click(screen.getByRole('button', { name: 'Çıkış yap' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Çıkış yapılamadı. Lütfen tekrar deneyin.',
      )

      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal logout secret')

      expect(
        screen.getByRole('button', { name: 'Çıkış yap' }),
      ).toBeEnabled()
      expect(
        screen.getByRole('heading', { name: 'Messor', level: 1 }),
      ).toBeInTheDocument()
    })
  })

  describe('query cache isolation across authentication boundaries', () => {
    it('never renders the previous user\'s cached projects after logout and re-login', async () => {
      // User A bootstraps and their projects are cached and rendered.
      getCurrentUserMock.mockResolvedValueOnce(adminUser)
      listProjectsMock.mockResolvedValueOnce(adminProjects)
      const user = userEvent.setup()
      renderAt('/projects')

      expect(await screen.findByText('Alpha Project')).toBeInTheDocument()
      expect(screen.getByText('Alpha description')).toBeInTheDocument()

      // User A logs out successfully.
      logoutMock.mockResolvedValueOnce(undefined)
      await user.click(screen.getByRole('button', { name: 'Çıkış yap' }))
      await screen.findByRole('heading', { name: 'Oturum aç', level: 2 })

      // User B logs in; their projects request stays pending.
      loginMock.mockResolvedValueOnce(memberUser)
      let resolveMemberProjects: (value: PageResponse<ProjectSummary>) => void =
        () => {}
      listProjectsMock.mockImplementationOnce(
        () =>
          new Promise<PageResponse<ProjectSummary>>((resolve) => {
            resolveMemberProjects = resolve
          }),
      )

      await user.type(
        screen.getByLabelText('E-posta'),
        'member@demo.messor.app',
      )
      await user.type(screen.getByLabelText('Parola'), 'correct-password')
      await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

      // User B's shell is shown while their projects request is pending.
      await screen.findByRole('heading', { name: 'Messor', level: 1 })

      // User A's cached project data must be absent throughout the pending request.
      expect(screen.queryByText('Alpha Project')).not.toBeInTheDocument()
      expect(screen.queryByText('Alpha description')).not.toBeInTheDocument()

      // User B's projects appear once the request resolves.
      resolveMemberProjects(memberProjects)

      expect(await screen.findByText('Beta Project')).toBeInTheDocument()
      expect(screen.getByText('Beta description')).toBeInTheDocument()
      expect(screen.queryByText('Alpha Project')).not.toBeInTheDocument()
      expect(screen.queryByText('Alpha description')).not.toBeInTheDocument()
    })
  })
})

describe('theme resolution', () => {
  type MediaListener = (event: { matches: boolean }) => void

  function stubMatchMedia(prefersDark: boolean): void {
    const listeners: MediaListener[] = []
    const mql = {
      matches: prefersDark,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_type: string, listener: MediaListener): void => {
        listeners.push(listener)
      },
      removeEventListener: (_type: string, listener: MediaListener): void => {
        const index = listeners.indexOf(listener)
        if (index >= 0) {
          listeners.splice(index, 1)
        }
      },
    }
    window.matchMedia = vi.fn(
      () => mql,
    ) as unknown as typeof window.matchMedia
  }

  it('resolveTheme maps modes and the system preference', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('applies the light theme to the document root when the OS is not dark', () => {
    getCurrentUserMock.mockResolvedValue(adminUser)
    renderAt('/projects')

    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('applies the dark theme to the document root when the OS prefers dark', () => {
    stubMatchMedia(true)
    getCurrentUserMock.mockResolvedValue(adminUser)
    renderAt('/projects')

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })
})
