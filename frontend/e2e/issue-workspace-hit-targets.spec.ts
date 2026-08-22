import { test, expect, type Page } from '@playwright/test'

/* ============================================================
   Messor issue workspace — navigation hit-target acceptance
   Runs against the local Vite dev server with all backend routes
   mocked at the network layer. No backend/PostgreSQL required.
   The five configured viewports (320/360/390/768/1440) prove the
   back links keep a >= 44px touch target without horizontal overflow.
   ============================================================ */

const JSON_JSON = 'application/json'

const AUTH_USER = {
  id: 'user-admin',
  email: 'admin@demo.messor.app',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'ORG_ADMIN',
}

const PROJECT = {
  id: 'proj-1',
  key: 'MES',
  name: 'Messor',
  description: null,
  currentUserRole: 'PROJECT_LEAD',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  workflowStatuses: [
    { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
    { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
    { code: 'DONE', displayName: 'Bitti', position: 2 },
  ],
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

const ISSUES = {
  items: [],
  page: 0,
  size: 100,
  totalItems: 0,
  totalPages: 0,
}

/** Authenticated bootstrap so the protected board route renders. */
async function mockAuthenticated(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(AUTH_USER) })
  })
}

/** Workspace read endpoints. */
async function mockWorkspace(page: Page): Promise<void> {
  await page.route('**/api/projects/MES', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(PROJECT) })
  })
  await page.route('**/api/projects/MES/members', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(MEMBERS) })
  })
  await page.route('**/api/projects/MES/issues**', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(ISSUES) })
  })
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement
    return {
      docScrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }
  })
  expect(metrics.docScrollWidth, 'documentElement must not overflow').toBeLessThanOrEqual(
    metrics.innerWidth,
  )
  expect(metrics.bodyScrollWidth, 'body must not overflow').toBeLessThanOrEqual(metrics.innerWidth)
}

test('issue workspace back links keep a >=44px hit target without horizontal overflow', async ({
  page,
}) => {
  await mockAuthenticated(page)
  await mockWorkspace(page)
  await page.goto('/projects/MES/board')

  const settingsLink = page.getByRole('link', { name: 'Proje ayarları' })
  const projectsLink = page.getByRole('link', { name: 'Projelere dön' })
  await expect(settingsLink).toBeVisible()
  await expect(projectsLink).toBeVisible()

  for (const link of [settingsLink, projectsLink]) {
    const box = (await link.boundingBox())!
    expect(box.height, 'back link hit target height must be >= 44').toBeGreaterThanOrEqual(44)
  }

  // Removed "Board'a dön" link must not have come back.
  await expect(page.getByRole('link', { name: /Board'a dön/ })).toHaveCount(0)

  await expectNoHorizontalOverflow(page)
})
