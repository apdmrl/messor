import { useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
} from 'react'
import { useSession } from './session'
import type { UserSummary } from '../features/auth/types'
import { getProject } from '../features/projects/projectsApi'
import './AuthenticatedShell.css'

const LOGOUT_ERROR_MESSAGE = 'Çıkış yapılamadı. Lütfen tekrar deneyin.'

function roleLabel(role: UserSummary['role']): string {
  return role === 'ORG_ADMIN' ? 'Organizasyon yöneticisi' : 'Üye'
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'bi-rail__link bi-rail__link--active' : 'bi-rail__link'
}

function IconSearch(): ReactElement {
  return (
    <svg className="bi-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconCreate(): ReactElement {
  return (
    <svg className="bi-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconSignal(): ReactElement {
  return (
    <svg className="bi-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5a4.5 4.5 0 0 0-4.5 4.5v2.2L2.5 11v.5h11V11l-1-1.8V7a4.5 4.5 0 0 0-4.5-4.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconWork(): ReactElement {
  return (
    <svg className="bi-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 6.5h3.5M5 9h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconProjects(): ReactElement {
  return (
    <svg className="bi-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.2l1.2 1.5h5.6A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function IconChevron(): ReactElement {
  return (
    <svg className="bi-icon bi-rail__chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m10 3-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ProjectNavLink({
  to,
  label,
}: {
  to: string
  label: string
}): ReactElement {
  return (
    <NavLink to={to} className={navLinkClass} aria-label={label}>
      <span className="bi-rail__project-mark" aria-hidden="true" />
      <span className="bi-rail__label">{label}</span>
    </NavLink>
  )
}

export function AuthenticatedShell(): ReactElement {
  const { session, handleLogout, logoutPending, logoutError } = useSession()
  const location = useLocation()
  const [railCollapsed, setRailCollapsed] = useState(false)
  const accountRef = useRef<HTMLDetailsElement>(null)
  const accountSummaryRef = useRef<HTMLElement>(null)

  const projectKey = /^\/projects\/([^/]+)/.exec(location.pathname)?.[1] ?? null

  const projectQuery = useQuery({
    queryKey: ['projects', projectKey],
    queryFn: () => getProject(projectKey as string),
    enabled: projectKey !== null,
  })

  // Frontend authorization is presentation-only: project settings and members
  // are hidden unless the current user holds a managing role; the backend
  // remains authoritative. Fails closed while the project is unknown.
  const canManageProject =
    projectQuery.data?.currentUserRole === 'PROJECT_LEAD'

  if (session.status !== 'authenticated') {
    return <Outlet />
  }

  const { user } = session
  const railExpanded = !railCollapsed
  const railToggleLabel = railExpanded
    ? 'Proje çubuğunu daralt'
    : 'Proje çubuğunu genişlet'

  function handleAccountKeyDown(event: ReactKeyboardEvent): void {
    if (event.key === 'Escape' && accountRef.current?.open) {
      event.preventDefault()
      accountRef.current.open = false
      accountSummaryRef.current?.focus()
    }
  }

  return (
    <div className="bi-shell">
      <header className="bi-topbar">
        <div className="bi-topbar__brand">
          <span className="bi-topbar__mark" aria-hidden="true" />
          <div className="bi-topbar__context">
            <p className="bi-topbar__eyebrow">Çalışma alanı</p>
            <h1 className="bi-topbar__name">Messor</h1>
          </div>
        </div>

        <div className="bi-topbar__actions">
          <button
            type="button"
            className="bi-topbar__action"
            aria-label="Ara"
            title="Ara (/)"
          >
            <IconSearch />
          </button>
          <button
            type="button"
            className="bi-topbar__action"
            aria-label="Oluştur"
            title="Oluştur"
          >
            <IconCreate />
          </button>
          <button
            type="button"
            className="bi-topbar__action"
            aria-label="Sinyaller"
            title="Sinyaller"
          >
            <IconSignal />
          </button>
        </div>

        <details
          className="bi-account"
          ref={accountRef}
          onKeyDown={handleAccountKeyDown}
        >
          <summary className="bi-account__summary" ref={accountSummaryRef}>
            <span className="bi-account__avatar" aria-hidden="true">
              {user.firstName.charAt(0)}
            </span>
            <span className="bi-account__summary-text">
              <strong>{user.firstName} {user.lastName}</strong>
            </span>
          </summary>
          <div className="bi-account__panel">
            <p className="bi-account__role">{roleLabel(user.role)}</p>
            <p className="bi-account__email">{user.email}</p>
            <button
              type="button"
              className="bi-account__logout"
              onClick={handleLogout}
              disabled={logoutPending}
            >
              {logoutPending ? 'Çıkış yapılıyor…' : 'Çıkış yap'}
            </button>
          </div>
        </details>
      </header>

      {logoutError !== null && (
        <p className="bi-shell__error" role="alert">
          {logoutError}
        </p>
      )}

      <div className="bi-shell__body">
        <nav
          id="project-rail"
          className={railCollapsed ? 'bi-rail bi-rail--collapsed' : 'bi-rail'}
          aria-label="Ana gezinme"
        >
          <button
            type="button"
            className="bi-rail__toggle"
            onClick={() => setRailCollapsed((collapsed) => !collapsed)}
            aria-expanded={railExpanded}
            aria-controls="project-rail"
            aria-label={railToggleLabel}
            title={railToggleLabel}
          >
            <IconChevron />
          </button>

          <NavLink to="/my-work" className={navLinkClass} aria-label="Görevlerim">
            <IconWork />
            <span className="bi-rail__label">Görevlerim</span>
          </NavLink>
          <NavLink
            to="/projects"
            end
            className={navLinkClass}
            aria-label="Projeler"
          >
            <IconProjects />
            <span className="bi-rail__label">Projeler</span>
          </NavLink>

          {projectKey !== null && (
            <div className="bi-rail__group">
              <span className="bi-rail__group-label">
                {projectQuery.data?.name ?? 'Proje'}
              </span>
              <ProjectNavLink
                to={`/projects/${projectKey}/board`}
                label="Pano"
              />
              <ProjectNavLink
                to={`/projects/${projectKey}/issues`}
                label="İşler"
              />
              <ProjectNavLink
                to={`/projects/${projectKey}/activity`}
                label="Aktivite"
              />
              {canManageProject && (
                <ProjectNavLink
                  to={`/projects/${projectKey}/members`}
                  label="Üyeler"
                />
              )}
              {canManageProject && (
                <ProjectNavLink
                  to={`/projects/${projectKey}/settings`}
                  label="Ayarlar"
                />
              )}
            </div>
          )}
        </nav>

        <main className="bi-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export { LOGOUT_ERROR_MESSAGE }
