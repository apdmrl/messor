import { useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
} from 'react'
import { useSession } from './session'
import type { UserSummary } from '../features/auth/types'
import { getProject } from '../features/projects/projectsApi'
import './AuthenticatedShell.css'
import { ApiError } from './apiClient'
import { RestrictedPage } from './routeBoundaries'

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

function IconBoard(): ReactElement {
  return (
    <svg className="bi-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="3" width="4.5" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="3" width="4.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function IconSettings(): ReactElement {
  return (
    <svg className="bi-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M12.2 3.8l-1.4 1.4M5.2 10.8l-1.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ProjectNavLink({
  to,
  label,
  icon,
}: {
  to: string
  label: string
  icon: ReactElement
}): ReactElement {
  return (
    <NavLink to={to} className={navLinkClass} aria-label={label}>
      {icon}
      <span className="bi-rail__label">{label}</span>
    </NavLink>
  )
}

export function AuthenticatedShell(): ReactElement {
  const { session, handleLogout, logoutPending, logoutError } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
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
  // A project-scoped route for a project the user cannot read (forbidden or
  // missing) renders a neutral restricted boundary instead of page content.
  // The backend stays authoritative; this is presentation-only and fails
  // closed. Other project errors (e.g. transient network/5xx) fall through to
  // the page's own error handling.
  const projectError = projectQuery.error
  const isProjectRestricted =
    projectKey !== null &&
    projectQuery.isError &&
    projectError instanceof ApiError &&
    (projectError.status === 403 || projectError.status === 404)

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

  // Global create: when a project is in context, open that project's issue
  // creation surface; otherwise go to the projects list where project creation
  // is offered to authorized users. This is a real navigation, never a no-op.
  function handleCreate(): void {
    if (projectKey !== null) {
      navigate(`/projects/${encodeURIComponent(projectKey)}/issues/new`)
      return
    }
    navigate('/projects')
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
            title="Arama henüz kullanılamıyor"
            disabled
            aria-disabled="true"
          >
            <IconSearch />
          </button>
          <button
            type="button"
            className="bi-topbar__action"
            aria-label="Oluştur"
            title="Oluştur"
            onClick={handleCreate}
          >
            <IconCreate />
          </button>
          <button
            type="button"
            className="bi-topbar__action"
            aria-label="Sinyaller"
            title="Sinyaller henüz kullanılamıyor"
            disabled
            aria-disabled="true"
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

          <NavLink to="/overview" end className={navLinkClass} aria-label="Genel Bakış">
            <IconSignal />
            <span className="bi-rail__label">Genel Bakış</span>
          </NavLink>
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

          {projectKey !== null && projectQuery.isSuccess && (
            <div className="bi-rail__group">
              <span className="bi-rail__group-label">
                {projectQuery.data.name}
              </span>
              <ProjectNavLink
                to={`/projects/${projectKey}/board`}
                label="Pano"
                icon={<IconBoard />}
              />
              {canManageProject && (
                <ProjectNavLink
                  to={`/projects/${projectKey}/settings`}
                  label="Ayarlar"
                  icon={<IconSettings />}
                />
              )}
            </div>
          )}
        </nav>

        <main className="bi-content">
          {isProjectRestricted ? <RestrictedPage /> : <Outlet />}
        </main>
      </div>
    </div>
  )
}

export { LOGOUT_ERROR_MESSAGE }
