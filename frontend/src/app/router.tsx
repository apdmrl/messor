/* oxlint-disable react/only-export-components -- router.tsx exports a non-component router alongside internal route-guard components. */
import { createBrowserRouter, Navigate } from 'react-router-dom'
import type { ReactElement } from 'react'
import type { RouteObject } from 'react-router-dom'
import { LoginPage } from '../features/auth/LoginPage'
import { IssueWorkspacePage } from '../features/issues/IssueWorkspacePage'
import { MyWorkPage } from '../features/my-work/MyWorkPage'
import { ProjectSettingsPage } from '../features/projects/ProjectSettingsPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
import { AuthenticatedShell } from './AuthenticatedShell'
import { useSession } from './session'

function RequireAuth({ children }: { children: ReactElement }): ReactElement {
  const { session } = useSession()
  if (session.status === 'loading' || session.status === 'error') {
    return <Navigate to="/login" replace />
  }
  if (session.status === 'anonymous') {
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
    path: '/login',
    element: <LoginRoute />,
  },
  {
    path: '/',
    element: <RootRedirect />,
  },
  {
    element: (
      <RequireAuth>
        <AuthenticatedShell />
      </RequireAuth>
    ),
    children: [
      {
        path: '/projects',
        element: <ProjectsPage />,
      },
      {
        path: '/projects/:projectKey/board',
        element: <IssueWorkspacePage />,
      },
      {
        path: '/projects/:projectKey/issues/:issueKey',
        element: <IssueWorkspacePage />,
      },
      {
        path: '/projects/:projectKey/settings',
        element: <ProjectSettingsPage />,
      },
      {
        path: '/my-work',
        element: <MyWorkPage />,
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
