import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getCurrentUser, logout } from '../features/auth/authApi'
import type { UserSummary } from '../features/auth/types'
import { SessionContext } from './session'
import type { SessionState } from './session'

const BOOTSTRAP_ERROR_MESSAGE = 'Oturum durumu alınamadı.'
const LOGOUT_ERROR_MESSAGE = 'Çıkış yapılamadı. Lütfen tekrar deneyin.'

/**
 * Owns the session state and exposes it through SessionContext. It lives
 * inside the QueryClientProvider so it can clear the shared query cache at
 * successful principal boundaries (login and logout). This prevents one
 * user's cached server state from being rendered for another user in the
 * same tab while the new user's requests are still pending.
 */
export function SessionProvider({
  children,
}: {
  children: ReactNode
}): ReactElement {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [logoutPending, setLogoutPending] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  const bootstrap = useCallback(() => {
    let cancelled = false
    setSession({ status: 'loading' })

    getCurrentUser()
      .then((user) => {
        if (cancelled) {
          return
        }
        if (user === null) {
          setSession({ status: 'anonymous' })
        } else {
          // Accepting an authenticated principal is a boundary: drop any
          // cached server state before exposing the new user's session.
          queryClient.clear()
          setSession({ status: 'authenticated', user })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession({ status: 'error' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [queryClient])

  useEffect(() => {
    return bootstrap()
  }, [bootstrap])

  const handleAuthenticated = useCallback(
    (user: UserSummary): void => {
      // Accepting a successfully authenticated user is a principal boundary:
      // drop any cached server state before switching to the new session.
      queryClient.clear()
      setSession({ status: 'authenticated', user })
    },
    [queryClient],
  )

  const handleLogout = useCallback(async (): Promise<void> => {
    if (logoutPending) {
      return
    }
    setLogoutPending(true)
    setLogoutError(null)
    try {
      await logout()
      // Only a successful logout is a principal boundary. A failed logout
      // must retain the current authenticated session and its cache.
      queryClient.clear()
      setSession({ status: 'anonymous' })
    } catch {
      setLogoutError(LOGOUT_ERROR_MESSAGE)
    } finally {
      setLogoutPending(false)
    }
  }, [logoutPending, queryClient])

  const sessionValue = useMemo(
    () => ({
      session,
      bootstrap,
      handleAuthenticated,
      handleLogout,
      logoutPending,
      logoutError,
    }),
    [
      session,
      bootstrap,
      handleAuthenticated,
      handleLogout,
      logoutPending,
      logoutError,
    ],
  )

  if (session.status === 'loading') {
    return (
      <main className="app-status" role="status">
        <p>Oturum kontrol ediliyor…</p>
      </main>
    )
  }

  if (session.status === 'error') {
    return (
      <main className="app-status">
        <p className="app-status__message" role="alert">
          {BOOTSTRAP_ERROR_MESSAGE}
        </p>
        <button
          type="button"
          className="app-status__retry"
          onClick={bootstrap}
        >
          Tekrar dene
        </button>
      </main>
    )
  }

  return (
    <SessionContext.Provider value={sessionValue}>
      {children}
    </SessionContext.Provider>
  )
}
