import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { RouterProvider } from 'react-router-dom'
import { getCurrentUser, logout } from './features/auth/authApi'
import type { UserSummary } from './features/auth/types'
import { AppProviders } from './app/AppProviders'
import { router } from './app/router'
import { SessionContext } from './app/session'
import type { SessionState } from './app/session'
import './App.css'

const BOOTSTRAP_ERROR_MESSAGE = 'Oturum durumu alınamadı.'
const LOGOUT_ERROR_MESSAGE = 'Çıkış yapılamadı. Lütfen tekrar deneyin.'

function App(): ReactElement {
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
  }, [])

  useEffect(() => {
    return bootstrap()
  }, [bootstrap])

  const handleAuthenticated = useCallback((user: UserSummary): void => {
    setSession({ status: 'authenticated', user })
  }, [])

  const handleLogout = useCallback(async (): Promise<void> => {
    if (logoutPending) {
      return
    }
    setLogoutPending(true)
    setLogoutError(null)
    try {
      await logout()
      setSession({ status: 'anonymous' })
    } catch {
      setLogoutError(LOGOUT_ERROR_MESSAGE)
    } finally {
      setLogoutPending(false)
    }
  }, [logoutPending])

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
    <AppProviders>
      <SessionContext.Provider value={sessionValue}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </AppProviders>
  )
}

export default App
