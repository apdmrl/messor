import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import App from '../App'
import { apiRequest } from './apiClient'
import type { UserSummary } from '../features/auth/types'

const PROJECTS_URL = '/api/projects'

const adminUser: UserSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'admin@demo.messor.app',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'ORG_ADMIN',
}

/**
 * Hostile/internal detail string that must never reach the DOM. It simulates a
 * backend that leaks an internal message inside an RFC 9457 problem body.
 */
const HOSTILE_DETAIL = 'internal session secret: session-store-42'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function problemResponse(status: number, code: string, detail: string): Response {
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title: 'Error',
      status,
      detail,
      instance: PROJECTS_URL,
      code,
    }),
    {
      status,
      headers: { 'Content-Type': 'application/problem+json' },
    },
  )
}

function fetchMock(): Mock {
  return vi.fn()
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderAt(path: string): void {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

describe('session expiry regression', () => {
  let fetchSpy: Mock
  let clearSpy: Mock

  beforeEach(() => {
    fetchSpy = fetchMock()
    vi.stubGlobal('fetch', fetchSpy)
    // Spy on the shared QueryClient.clear with call-through so the real cache
    // clearing still happens while we can assert how many times it runs.
    clearSpy = vi.spyOn(QueryClient.prototype, 'clear')
    window.history.pushState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the login screen when a protected request returns UNAUTHENTICATED under StrictMode', async () => {
    // StrictMode runs the bootstrap effect setup-cleanup-setup. The first
    // bootstrap's /api/auth/me response is deferred so the canceled first
    // bootstrap cannot establish session state; only the second (active)
    // bootstrap resolves with the authenticated user.
    const firstBootstrap = deferred<Response>()
    fetchSpy
      .mockReturnValueOnce(firstBootstrap.promise)
      .mockResolvedValueOnce(jsonResponse(adminUser))
      // The project-list request returns 401 UNAUTHENTICATED with a hostile detail.
      .mockResolvedValueOnce(
        problemResponse(401, 'UNAUTHENTICATED', HOSTILE_DETAIL),
      )

    renderAt('/projects')

    // The application must eventually render the login screen.
    expect(
      await screen.findByRole('heading', { name: 'Oturum aç', level: 2 }),
    ).toBeInTheDocument()

    // Protected UI must disappear.
    expect(screen.queryByText('Yeni proje')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Çıkış yap' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ayarlar' })).not.toBeInTheDocument()

    // The hostile/internal detail must never reach the DOM.
    const body = document.body.textContent ?? ''
    expect(body).not.toContain(HOSTILE_DETAIL)

    // The router must have navigated to /login.
    expect(window.location.pathname).toBe('/login')

    // The shared QueryClient cache is cleared exactly twice: once when the
    // active authenticated bootstrap is accepted, and once when the
    // current-session expiry notification arrives. This proves the expiry
    // clears protected cached server state in addition to redirecting.
    expect(clearSpy).toHaveBeenCalledTimes(2)
  })

  it('does not clear the QueryClient again after the SessionProvider unmounts', async () => {
    window.history.pushState({}, '', '/projects')
    window.dispatchEvent(new PopStateEvent('popstate'))

    // First bootstrap is deferred (canceled by StrictMode); second resolves the
    // authenticated user; the project-list request is deferred so it cannot
    // resolve before we unmount.
    const firstBootstrap = deferred<Response>()
    const projectsResponse = deferred<Response>()
    fetchSpy
      .mockReturnValueOnce(firstBootstrap.promise)
      .mockResolvedValueOnce(jsonResponse(adminUser))
      .mockReturnValueOnce(projectsResponse.promise)

    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    // Wait for the authenticated shell to appear (bootstrap accepted).
    expect(
      await screen.findByRole('button', { name: 'Çıkış yap' }),
    ).toBeInTheDocument()
    // Bootstrap accept cleared the cache exactly once.
    expect(clearSpy).toHaveBeenCalledTimes(1)

    // Unmount the SessionProvider; its expiry subscription is cleaned up.
    unmount()

    // Trigger a controlled UNAUTHENTICATED apiRequest after unmount.
    fetchSpy.mockResolvedValueOnce(
      problemResponse(401, 'UNAUTHENTICATED', 'session expired'),
    )
    await apiRequest(PROJECTS_URL).catch(() => {})

    // The unmounted SessionProvider subscription must not clear the cache again.
    expect(clearSpy).toHaveBeenCalledTimes(1)
  })
})
