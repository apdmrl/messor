import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthApiError } from './features/auth/authApi'
import type { UserSummary } from './features/auth/types'

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

vi.mock('./features/auth/authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./features/auth/authApi')>()
  return {
    ...actual,
    login: vi.fn(),
    getCurrentUser: vi.fn(),
    logout: vi.fn(),
  }
})

import { getCurrentUser, login, logout } from './features/auth/authApi'
import App from './App'

const getCurrentUserMock = getCurrentUser as Mock
const loginMock = login as Mock
const logoutMock = logout as Mock

describe('App session state', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset()
    loginMock.mockReset()
    logoutMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initial session loading', () => {
    it('shows an accessible status while checking the session', () => {
      getCurrentUserMock.mockImplementation(
        () => new Promise<UserSummary | null>(() => {}),
      )
      render(<App />)

      expect(
        screen.getByText('Oturum kontrol ediliyor…'),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Oturum aç' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Çıkış yap' })).not.toBeInTheDocument()
    })
  })

  describe('anonymous bootstrap', () => {
    it('shows the login page when getCurrentUser resolves null', async () => {
      getCurrentUserMock.mockResolvedValue(null)
      render(<App />)

      expect(
        await screen.findByRole('heading', { name: 'Oturum aç', level: 2 }),
      ).toBeInTheDocument()
    })
  })

  describe('authenticated bootstrap', () => {
    it('shows the authenticated shell with user details and logout', async () => {
      getCurrentUserMock.mockResolvedValue(adminUser)
      render(<App />)

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
      render(<App />)

      expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()
      expect(screen.getByText('Üye')).toBeInTheDocument()
    })
  })

  describe('recoverable bootstrap error', () => {
    it('shows a safe message and retry, then recovers on retry', async () => {
      getCurrentUserMock
        .mockRejectedValueOnce(new Error('internal bootstrap secret'))
        .mockResolvedValueOnce(memberUser)
      const user = userEvent.setup()
      render(<App />)

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
      render(<App />)

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
      render(<App />)

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
      render(<App />)

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
})
