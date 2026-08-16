import { NavLink, Outlet } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useSession } from './session'
import type { UserSummary } from '../features/auth/types'
import './AuthenticatedShell.css'

const LOGOUT_ERROR_MESSAGE = 'Çıkış yapılamadı. Lütfen tekrar deneyin.'

function roleLabel(role: UserSummary['role']): string {
  return role === 'ORG_ADMIN' ? 'Organizasyon yöneticisi' : 'Üye'
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive
    ? 'app-nav__link app-nav__link--active'
    : 'app-nav__link'
}

export function AuthenticatedShell(): ReactElement {
  const { session, handleLogout, logoutPending, logoutError } = useSession()

  if (session.status !== 'authenticated') {
    return <Outlet />
  }

  const { user } = session

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__mark" aria-hidden="true" />
          <h1 className="app-header__name">Messor</h1>
        </div>

        <nav className="app-nav" aria-label="Ana gezinme">
          <NavLink to="/projects" className={navLinkClass}>
            Projeler
          </NavLink>
          <NavLink to="/my-work" className={navLinkClass}>
            Görevlerim
          </NavLink>
        </nav>

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
        <Outlet />
      </main>
    </div>
  )
}

export { LOGOUT_ERROR_MESSAGE }
