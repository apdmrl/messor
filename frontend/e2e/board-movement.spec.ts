import { test, expect, type Page } from '@playwright/test'

/* ============================================================
   Messor Kanban board — Task 8 browser acceptance
   Runs against the local Vite dev server with all backend routes
   mocked at the network layer (the repo's established Playwright
   pattern). No backend/PostgreSQL required. The five configured
   viewports (320/360/390/768/1440) prove the board is responsive,
   has no horizontal page overflow, keeps >=44px targets, and that
   accessible movement controls work at every size.
   ============================================================ */

const JSON_JSON = 'application/json'

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

function makeIssue(key: string, number: number, statusCode: string, title: string) {
  return {
    id: `id-${key}`,
    issueKey: key,
    projectKey: 'MES',
    number,
    type: 'TASK',
    title,
    description: null,
    statusCode,
    reporterId: 'user-admin',
    assigneeId: null,
    rank: number * 1024,
    archived: false,
    version: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

const ACTIVITY = [
  {
    id: 'act-1',
    type: 'CREATED',
    actorId: 'user-admin',
    summary: { type: 'TASK', statusCode: 'TO_DO', assigneeId: null },
    createdAt: '2026-01-01T00:00:00Z',
  },
]

/** Authenticated bootstrap so the protected board route renders. */
async function mockAuthenticated(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(AUTH_USER) })
  })
}

interface MoveCapture {
  count: number
  body: unknown
}

/**
 * Mock the workspace read endpoints plus a stateful list and move endpoint.
 * After the first successful move the list endpoint returns the moved card in
 * its destination column, matching the authoritative refetch that follows the
 * optimistic update.
 */
async function mockWorkspace(
  page: Page,
  role: string,
  capture: MoveCapture,
): Promise<void> {
  let moved = false

  await page.route('**/api/auth/csrf', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify({
        headerName: 'X-Test-Csrf',
        parameterName: '_csrf',
        token: 'masked-board-token',
      }),
    })
  })
  await page.route('**/api/projects/MES', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(project(role)) })
  })
  await page.route('**/api/projects/MES/members', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(MEMBERS) })
  })
  await page.route('**/api/issues/*/activity', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(ACTIVITY) })
  })
  await page.route('**/api/issues/MES-1', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify(makeIssue('MES-1', 1, 'TO_DO', 'First task')),
    })
  })

  await page.route('**/api/projects/MES/issues**', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify({
        items: moved
          ? [
              makeIssue('MES-1', 1, 'IN_PROGRESS', 'First task'),
              makeIssue('MES-2', 2, 'IN_PROGRESS', 'Second bug'),
              makeIssue('MES-3', 3, 'DONE', 'Third task'),
            ]
          : [
              makeIssue('MES-1', 1, 'TO_DO', 'First task'),
              makeIssue('MES-2', 2, 'IN_PROGRESS', 'Second bug'),
              makeIssue('MES-3', 3, 'DONE', 'Third task'),
            ],
        page: 0,
        size: 100,
        totalItems: 3,
        totalPages: 1,
      }),
    })
  })

  await page.route('**/api/issues/MES-1/move', (route) => {
    const request = route.request()
    capture.count += 1
    const raw = request.postData() ?? ''
    try {
      capture.body = JSON.parse(raw)
    } catch {
      capture.body = raw
    }
    moved = true
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify(makeIssue('MES-1', 1, 'IN_PROGRESS', 'First task')),
    })
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

async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/projects/MES/board')
  await expect(page.getByRole('region', { name: 'Kanban panosu' })).toBeVisible()
}

test('PROJECT_LEAD board renders server-ordered columns and moves a card via the accessible menu', async ({
  page,
}) => {
  const capture: MoveCapture = { count: 0, body: null }
  await mockAuthenticated(page)
  await mockWorkspace(page, 'PROJECT_LEAD', capture)
  await gotoBoard(page)

  for (const col of ['Yapılacak sütunu, 1 kart', 'Sürüyor sütunu, 1 kart', 'Bitti sütunu, 1 kart']) {
    await expect(page.getByRole('region', { name: col })).toBeVisible()
  }

  // The board is a labelled scroll region; the page itself never overflows.
  await expectNoHorizontalOverflow(page)

  // Open the movement menu and move MES-1 to the next column.
  await page.getByRole('button', { name: 'MES-1 için taşıma menüsü' }).click()
  await page.getByRole('button', { name: 'Sonraki sütuna taşı' }).click()

  // The exact move payload is sent with a deterministic neighbor + version.
  await expect
    .poll(() => capture.count, { timeout: 5000 })
    .toBe(1)
  expect(capture.body).toEqual({
    targetStatusCode: 'IN_PROGRESS',
    beforeIssueKey: null,
    afterIssueKey: 'MES-2',
    expectedVersion: 0,
  })

  // Optimistic/authoritative success: the card appears in the destination column.
  await expect(page.getByRole('button', { name: 'MES-1, First task, Sürüyor' })).toBeVisible()
  await expect(page.getByText('MES-1 taşındı.')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('movement controls keep a >=44px target and work with the keyboard', async ({ page }) => {
  const capture: MoveCapture = { count: 0, body: null }
  await mockAuthenticated(page)
  await mockWorkspace(page, 'PROJECT_LEAD', capture)
  await gotoBoard(page)

  const toggle = page.getByRole('button', { name: 'MES-1 için taşıma menüsü' })
  const box = (await toggle.boundingBox())!
  expect(box.height, 'movement toggle height must be >= 44').toBeGreaterThanOrEqual(44)

  // Keyboard: focus the toggle, press Enter to open, then Enter on the action.
  await toggle.focus()
  await page.keyboard.press('Enter')
  const next = page.getByRole('button', { name: 'Sonraki sütuna taşı' })
  await expect(next).toBeVisible()
  await next.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => capture.count, { timeout: 5000 }).toBe(1)
})

test('Escape cancels an open movement menu without issuing a move', async ({ page }) => {
  const capture: MoveCapture = { count: 0, body: null }
  await mockAuthenticated(page)
  await mockWorkspace(page, 'PROJECT_LEAD', capture)
  await gotoBoard(page)

  await page.getByRole('button', { name: 'MES-1 için taşıma menüsü' }).click()
  await expect(page.getByRole('button', { name: 'Sonraki sütuna taşı' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Sonraki sütuna taşı' })).toHaveCount(0)
  expect(capture.count, 'no move request on Escape').toBe(0)
})

test('VIEWER sees the board read-only with no movement controls', async ({ page }) => {
  const capture: MoveCapture = { count: 0, body: null }
  await mockAuthenticated(page)
  await mockWorkspace(page, 'VIEWER', capture)
  await gotoBoard(page)

  await expect(page.getByRole('region', { name: 'Kanban panosu' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'MES-1, First task, Yapılacak' })).toBeVisible()
  await expect(page.getByRole('button', { name: /taşıma menüsü/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /sürükle/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Yeni issue' })).toHaveCount(0)
  expect(capture.count, 'viewer must never trigger a move').toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('reduced motion disables the card drag transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const capture: MoveCapture = { count: 0, body: null }
  await mockAuthenticated(page)
  await mockWorkspace(page, 'PROJECT_LEAD', capture)
  await gotoBoard(page)

  const card = page.locator('.kanban-card').first()
  await expect(card).toBeVisible()
  const transition = await card.evaluate((el) => getComputedStyle(el).transitionDuration)
  expect(transition, 'card transition must be disabled under reduced motion').toBe('0s')
  await expectNoHorizontalOverflow(page)
})
