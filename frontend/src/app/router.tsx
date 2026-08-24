/* oxlint-disable react/only-export-components -- router.tsx exports a non-component router alongside internal route-guard components. */
import { createBrowserRouter, Navigate } from 'react-router-dom'
import type { ReactElement } from 'react'
import type { RouteObject } from 'react-router-dom'
import { LoginPage } from '../features/auth/LoginPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { IssueFormPage } from '../features/issues/IssueFormPage'
import { IssueWorkspacePage } from '../features/issues/IssueWorkspacePage'
import { MyWorkPage } from '../features/my-work/MyWorkPage'
import { MembersPage } from '../features/projects/MembersPage'
import { ProjectOverviewPage } from '../features/projects/ProjectOverviewPage'
import { ProjectSettingsPage } from '../features/projects/ProjectSettingsPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
import { AuthenticatedShell } from './AuthenticatedShell'
import { useSession } from './session'
import {
  NotFoundPage,
  RouteErrorFallback,
  RouteLoading,
  SessionExpiredPage,
} from './routeBoundaries'

function RequireAuth({ children }: { children: ReactElement }): ReactElement {
  const { session } = useSession()
  // While the session is still being resolved, show the neutral loading
  // boundary instead of bouncing to /login before the bootstrap settles.
  if (session.status === 'loading') {
    return <RouteLoading />
  }
  // Anonymous and failed sessions are redirected to login. Confirmed session
  // expiry drops the session to 'anonymous', so this also handles expiry.
  if (session.status === 'anonymous' || session.status === 'error') {
    return <Navigate to="/login" replace />
  }
  return children
}

function RedirectIfAuthenticated({
  children,
}: {
  children: ReactElement
}): ReactElement {
  const { session } = useSession()
  if (session.status === 'authenticated') {
    return <Navigate to="/projects" replace />
  }
  return children
}

function LoginRoute(): ReactElement {
  const { handleAuthenticated } = useSession()
  return (
    <RedirectIfAuthenticated>
      <LoginPage onAuthenticated={handleAuthenticated} />
    </RedirectIfAuthenticated>
  )
}
function RootRedirect(): ReactElement {
  const { session } = useSession()
  if (session.status === 'authenticated') {
    return <Navigate to="/projects" replace />
  }
  return <Navigate to="/login" replace />
}

export const routes: RouteObject[] = [
  {
    // Root layout route: hosts the shared route-level error boundary and a
    // neutral not-found catch-all. Pathless so child routes keep their URLs.
    errorElement: <RouteErrorFallback />,
    children: [
      {
        path: '/login',
        element: <LoginRoute />,
      },
      {
        path: '/',
        element: <RootRedirect />,
      },
      {
        path: '/auth/session-expired',
        element: <SessionExpiredPage />,
      },
      {
        element: (
          <RequireAuth>
            <AuthenticatedShell />
          </RequireAuth>
        ),
        children: [
          {
            path: '/overview',
            element: <DashboardPage />,
          },
          {
            path: '/projects',
            element: <ProjectsPage />,
          },
          {
            path: '/projects/:projectKey/overview',
            element: <ProjectOverviewPage />,
          },
          {
            path: '/projects/:projectKey/board',
            element: <IssueWorkspacePage />,
          },
          {
            path: '/projects/:projectKey/issues',
            element: <IssueWorkspacePage view="list" />,
          },
          {
            path: '/projects/:projectKey/issues/new',
            element: <IssueFormPage mode="create" />,
          },
          {
            path: '/projects/:projectKey/issues/:issueKey',
            element: <IssueWorkspacePage />,
          },
          {
            path: '/projects/:projectKey/issues/:issueKey/edit',
            element: <IssueFormPage mode="edit" />,
          },
          {
            path: '/projects/:projectKey/settings',
            element: <ProjectSettingsPage />,
          },
          {
            path: '/projects/:projectKey/members',
            element: <MembersPage />,
          },
          {
            path: '/my-work',
            element: <MyWorkPage />,
          },
        ],
      },
      // Catch-all: neutral not-found for any unmatched route. Lives outside
      // RequireAuth so it resolves before authorization is relevant.
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
