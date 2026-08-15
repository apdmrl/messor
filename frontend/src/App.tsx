import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { getCurrentUser, logout } from './features/auth/authApi'
import { LoginPage } from './features/auth/LoginPage'
import type { UserSummary } from './features/auth/types'
import './App.css'

type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: UserSummary }
  | { status: 'error' }

const BOOTSTRAP_ERROR_MESSAGE = 'Oturum durumu alınamadı.'
const LOGOUT_ERROR_MESSAGE = 'Çıkış yapılamadı. Lütfen tekrar deneyin.'

function roleLabel(role: UserSummary['role']): string {
  return role === 'ORG_ADMIN' ? 'Organizasyon yöneticisi' : 'Üye'
}

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

  function handleAuthenticated(user: UserSummary): void {
    setSession({ status: 'authenticated', user })
  }

  async function handleLogout(): Promise<void> {
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
  }

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

  if (session.status === 'anonymous') {
    return <LoginPage onAuthenticated={handleAuthenticated} />
  }

  const { user } = session

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__mark" aria-hidden="true" />
          <h1 className="app-header__name">Messor</h1>
        </div>
        <div className="app-header__user">
          <span className="app-header__identity">
            {user.firstName} {user.lastName}
          </span>
          <span className="app-header__email">{user.email}</span>
          <span className="app-header__role">{roleLabel(user.role)}</span>
        </div>
        <button
          type="button"
          className="app-header__logout"
          onClick={handleLogout}
          disabled={logoutPending}
        >
          {logoutPending ? 'Çıkış yapılıyor…' : 'Çıkış yap'}
        </button>
      </header>

      {logoutError !== null && (
        <p className="app-shell__error" role="alert">
          {logoutError}
        </p>
      )}

      <main className="app-content">
        <h1 className="app-content__heading">Görev alanı</h1>
        <p className="app-content__placeholder">
          Görevlerin burada görünecek. Yakında.
        </p>
      </main>
    </div>
  )
}

export default App
