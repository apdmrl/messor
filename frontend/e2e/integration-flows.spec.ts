import { test, expect, type Page } from '@playwright/test'

/* ============================================================
   Messor product-flow integration — Task 7 browser acceptance
   Runs against the local Vite dev server with all backend routes
   mocked at the network layer (the repo's established Playwright
   pattern). No backend/PostgreSQL required. Covers the route tree
   integration the feature suites hand off: shell navigation,
   not-found and restricted boundaries, and theme resolution.
   ============================================================ */

const JSON_JSON = 'application/json'
const PROBLEM_JSON = 'application/problem+json'

const AUTH_USER = {
  id: 'user-admin',
  email: 'admin@demo.messor.app',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'ORG_ADMIN',
}

function project(role: string): Record<string, unknown> {
  return {
    id: 'proj-1',
    key: 'MES',
    name: 'Messor',
    description: null,
    currentUserRole: role,
    version: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    workflowStatuses: [
      { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
      { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
      { code: 'DONE', displayName: 'Bitti', position: 2 },
    ],
  }
}

const MEMBERS = [
  {
    userId: 'user-admin',
    email: 'admin@demo.messor.app',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'PROJECT_LEAD',
    version: 1,
  },
]

const EMPTY_ISSUES = {
  items: [],
  page: 0,
  size: 100,
  totalItems: 0,
  totalPages: 0,
}

const EMPTY_PROJECTS = {
  items: [],
  page: 0,
  size: 100,
  totalItems: 0,
  totalPages: 0,
}

/** Authenticated bootstrap so protected routes render the shell. */
async function mockAuthenticated(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.cookie = 'XSRF-TOKEN=masked-token; path=/'
  })
  await page.route('**/api/auth/me', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(AUTH_USER) })
  })
}

/** Mock the workspace endpoints a lead sees on project routes. */
async function mockWorkspace(page: Page, role = 'PROJECT_LEAD'): Promise<void> {
  // The list endpoint is queried with pagination params; match any query. It
  // is registered first so the more specific project routes win when matched.
  await page.route('**/api/projects**', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(EMPTY_PROJECTS) })
  })
  await page.route('**/api/projects/MES', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(project(role)) })
  })
  await page.route('**/api/projects/MES/members', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(MEMBERS) })
  })
  await page.route('**/api/projects/MES/issues**', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(EMPTY_ISSUES) })
  })
  await page.route('**/api/my-work**', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify({
        items: [],
        page: 0,
        size: 20,
        totalItems: 0,
        totalPages: 0,
      }),
    })
  })
}

/* ============================================================
   1. Shell navigation across the integrated route tree
   ============================================================ */
test('authenticated shell navigates Projects, My Work, board, and settings', async ({
  page,
}) => {
  await mockAuthenticated(page)
  await mockWorkspace(page)

  // Projects landing route.
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projeler', level: 2 })).toBeVisible()

  // Rail to My Work.
  await page.getByRole('link', { name: 'Görevlerim' }).click()
  await expect(page.getByRole('heading', { name: 'Görevlerim', level: 2 })).toBeVisible()

  // Direct project board route.
  await page.goto('/projects/MES/board')
  await expect(page.getByRole('region', { name: 'Kanban panosu' })).toBeVisible()

  // Lead-only settings is reachable from the project rail.
  await page.getByRole('link', { name: 'Ayarlar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Proje ayarları', level: 2 })).toBeVisible()
})

/* ============================================================
   2. Neutral not-found boundary for an invalid route
   ============================================================ */
test('an unknown route renders the neutral not-found boundary', async ({ page }) => {
  await mockAuthenticated(page)
  await mockWorkspace(page)

  await page.goto('/no/such/route')

  await expect(page.getByRole('heading', { name: 'Sayfa bulunamadı' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Projelere dön' })).toHaveAttribute(
    'href',
    '/projects',
  )
})

/* ============================================================
   3. Neutral restricted boundary for an inaccessible project
   ============================================================ */
test('an inaccessible project route renders the neutral restricted boundary', async ({
  page,
}) => {
  await mockAuthenticated(page)
  await page.route('**/api/projects/MES', (route) => {
    route.fulfill({
      status: 403,
      contentType: PROBLEM_JSON,
      body: JSON.stringify({ status: 403, code: 'FORBIDDEN', detail: 'denied' }),
    })
  })

  await page.goto('/projects/MES/board')

  await expect(page.getByRole('heading', { name: 'Erişim kısıtlı' })).toBeVisible()
  // Neutral: the board and any project identity are not shown.
  await expect(page.getByRole('region', { name: 'Kanban panosu' })).not.toBeVisible()
  await expect(page.getByRole('link', { name: 'Projelere dön' })).toHaveAttribute(
    'href',
    '/projects',
  )
})

/* ============================================================
   4. Theme follows the OS color-scheme preference
   ============================================================ */
test('data-theme tracks prefers-color-scheme', async ({ page }) => {
  await mockAuthenticated(page)
  await mockWorkspace(page)

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projeler', level: 2 })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Projeler', level: 2 })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

/* ============================================================
   5. Session expiry drops an authenticated user to login
   ============================================================ */
test('a confirmed session expiry redirects the shell to login', async ({ page }) => {
  await mockAuthenticated(page)
  // The projects list request returns a confirmed expiry: the shared client
  // advances the epoch, the shell drops to anonymous, and RequireAuth sends
  // the user to /login.
  await page.route('**/api/projects**', (route) => {
    route.fulfill({
      status: 401,
      contentType: PROBLEM_JSON,
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        instance: '/api/projects',
        code: 'UNAUTHENTICATED',
        detail: 'Oturumun sona erdi.',
      }),
    })
  })

  await page.goto('/projects')

  await expect(page.getByRole('heading', { name: 'Oturum aç', level: 2 })).toBeVisible()
})

/* ============================================================
   6. Anonymous users are redirected to login from protected routes
   ============================================================ */
test('an anonymous user is redirected to login from a protected route', async ({ page }) => {
  await page.route('**/api/auth/me', (route) => {
    route.fulfill({
      status: 401,
      contentType: PROBLEM_JSON,
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        instance: '/api/auth/me',
        code: 'UNAUTHENTICATED',
        detail: 'Oturum açmanız gerekiyor.',
      }),
    })
  })

  await page.goto('/my-work')

  await expect(page.getByRole('heading', { name: 'Oturum aç', level: 2 })).toBeVisible()
})
