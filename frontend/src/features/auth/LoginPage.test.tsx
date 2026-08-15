import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthApiError } from './authApi'
import type { UserSummary } from './types'

const adminEmail = 'admin@demo.messor.app'
const memberEmail = 'member@demo.messor.app'

const adminUser: UserSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  email: adminEmail,
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'ORG_ADMIN',
}

const memberUser: UserSummary = {
  id: '22222222-2222-2222-2222-222222222222',
  email: memberEmail,
  firstName: 'Grace',
  lastName: 'Hopper',
  role: 'USER',
}

vi.mock('./authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./authApi')>()
  return {
    ...actual,
    login: vi.fn(),
  }
})

import { login } from './authApi'
import { LoginPage } from './LoginPage'

const loginMock = login as Mock

function renderLoginPage(onAuthenticated: (user: UserSummary) => void = vi.fn()) {
  return render(<LoginPage onAuthenticated={onAuthenticated} />)
}

describe('LoginPage', () => {
  beforeEach(() => {
    loginMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('semantic and accessibility', () => {
    it('shows the Messor brand heading', () => {
      renderLoginPage()
      expect(
        screen.getByRole('heading', { name: 'Messor', level: 1 }),
      ).toBeInTheDocument()
    })

    it('shows the "Oturum aç" form heading', () => {
      renderLoginPage()
      expect(
        screen.getByRole('heading', { name: 'Oturum aç', level: 2 }),
      ).toBeInTheDocument()
    })

    it('binds the E-posta label to the email input', () => {
      renderLoginPage()
      const input = screen.getByLabelText('E-posta')
      expect(input).toHaveAttribute('type', 'email')
      expect(input).toHaveAttribute('name', 'email')
      expect(input).toHaveAttribute('autocomplete', 'username')
    })

    it('binds the Parola label to the password input', () => {
      renderLoginPage()
      const input = screen.getByLabelText('Parola')
      expect(input).toHaveAttribute('type', 'password')
      expect(input).toHaveAttribute('name', 'password')
      expect(input).toHaveAttribute('autocomplete', 'current-password')
    })

    it('exposes the submit button with accessible name "Oturum aç"', () => {
      renderLoginPage()
      expect(
        screen.getByRole('button', { name: 'Oturum aç' }),
      ).toBeInTheDocument()
    })

    it('supports normal keyboard form submission', async () => {
      const user = userEvent.setup()
      loginMock.mockResolvedValue(memberUser)
      renderLoginPage()

      await user.type(screen.getByLabelText('E-posta'), memberEmail)
      await user.type(screen.getByLabelText('Parola'), 'correct-password')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(loginMock).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('demo account note', () => {
    it('shows both demo emails as plain text', () => {
      renderLoginPage()
      expect(screen.getByText(adminEmail)).toBeInTheDocument()
      expect(screen.getByText(memberEmail)).toBeInTheDocument()
    })

    it('does not render demo emails as links', () => {
      renderLoginPage()
      expect(screen.queryByRole('link', { name: adminEmail })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: memberEmail })).not.toBeInTheDocument()
    })

    it('does not leak any demo password into the DOM', () => {
      renderLoginPage()
      const body = document.body.textContent ?? ''
      expect(body).not.toContain('MESSOR_DEMO_PASSWORD')
      expect(body).not.toContain('test-only-demo-password')
      expect(body).not.toContain('replace-with-a-local-demo-password')
    })
  })

  describe('successful login', () => {
    it('calls login once with exact values and forwards the resolved user', async () => {
      const user = userEvent.setup()
      const onAuthenticated = vi.fn()
      loginMock.mockResolvedValue(adminUser)
      renderLoginPage(onAuthenticated)

      await user.type(screen.getByLabelText('E-posta'), adminEmail)
      await user.type(screen.getByLabelText('Parola'), 'correct-password')
      await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

      await waitFor(() => {
        expect(loginMock).toHaveBeenCalledTimes(1)
      })
      expect(loginMock).toHaveBeenCalledWith(adminEmail, 'correct-password')
      await waitFor(() => {
        expect(onAuthenticated).toHaveBeenCalledWith(adminUser)
      })
    })

    it('does not write the password to URL or storage', async () => {
      const user = userEvent.setup()
      loginMock.mockResolvedValue(memberUser)
      renderLoginPage()

      await user.type(screen.getByLabelText('E-posta'), memberEmail)
      await user.type(screen.getByLabelText('Parola'), 'correct-password')
      await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

      await waitFor(() => {
        expect(loginMock).toHaveBeenCalledTimes(1)
      })

      expect(window.location.href).not.toContain('correct-password')
      expect(window.localStorage.length).toBe(0)
      expect(window.sessionStorage.length).toBe(0)
    })
  })

  describe('loading state', () => {
    it('disables the button and inputs and reports busy while pending', async () => {
      const user = userEvent.setup()
      let resolveLogin: (user: UserSummary) => void = () => {}
      loginMock.mockImplementation(
        () =>
          new Promise<UserSummary>((resolve) => {
            resolveLogin = resolve
          }),
      )
      renderLoginPage()

      await user.type(screen.getByLabelText('E-posta'), memberEmail)
      await user.type(screen.getByLabelText('Parola'), 'correct-password')
      await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

      const submitButton = screen.getByRole('button', { name: 'Giriş yapılıyor…' })
      expect(submitButton).toBeDisabled()
      expect(screen.getByLabelText('E-posta')).toBeDisabled()
      expect(screen.getByLabelText('Parola')).toBeDisabled()

      const form = screen.getByRole('form')
      expect(form).toHaveAttribute('aria-busy', 'true')

      resolveLogin(memberUser)
      await waitFor(() => {
        expect(loginMock).toHaveBeenCalledTimes(1)
      })
    })

    it('does not allow duplicate submits while pending', async () => {
      const user = userEvent.setup()
      let resolveLogin: (user: UserSummary) => void = () => {}
      loginMock.mockImplementation(
        () =>
          new Promise<UserSummary>((resolve) => {
            resolveLogin = resolve
          }),
      )
      renderLoginPage()

      await user.type(screen.getByLabelText('E-posta'), memberEmail)
      await user.type(screen.getByLabelText('Parola'), 'correct-password')
      await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

      await user.keyboard('{Enter}')

      resolveLogin(memberUser)
      await waitFor(() => {
        expect(loginMock).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('AuthApiError', () => {
    it('shows the safe detail in a live region and clears the password', async () => {
      const user = userEvent.setup()
      loginMock.mockRejectedValue(
        new AuthApiError(401, 'AUTHENTICATION_FAILED', 'E-posta veya parola hatalı.'),
      )
      renderLoginPage()

      await user.type(screen.getByLabelText('E-posta'), adminEmail)
      await user.type(screen.getByLabelText('Parola'), 'wrong-password')
      await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('E-posta veya parola hatalı.')

      expect(screen.getByLabelText('Parola')).toHaveValue('')
      expect(screen.getByLabelText('E-posta')).toHaveValue(adminEmail)

      const submitButton = screen.getByRole('button', { name: 'Oturum aç' })
      expect(submitButton).toBeEnabled()
    })
  })

  describe('unknown or network error', () => {
    it('shows a fixed safe fallback and never leaks the internal message', async () => {
      const user = userEvent.setup()
      loginMock.mockRejectedValue(new Error('internal network secret'))
      renderLoginPage()

      await user.type(screen.getByLabelText('E-posta'), adminEmail)
      await user.type(screen.getByLabelText('Parola'), 'correct-password')
      await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Bağlantı kurulamadı. Lütfen tekrar deneyin.')

      const body = document.body.textContent ?? ''
      expect(body).not.toContain('internal network secret')
    })
  })

  describe('stable layout and accessibility markers', () => {
    it('provides a main login layout with distinct brand and form regions', () => {
      renderLoginPage()
      expect(screen.getByRole('main')).toBeInTheDocument()
      expect(screen.getByLabelText('Messor markası')).toBeInTheDocument()
      expect(screen.getByLabelText('Oturum açma formu')).toBeInTheDocument()
    })

    it('marks the decorative ant trail as aria-hidden', () => {
      renderLoginPage()
      const trail = document.querySelector('[data-testid="ant-trail"]')
      expect(trail).not.toBeNull()
      expect(trail).toHaveAttribute('aria-hidden', 'true')
    })
  })
})
