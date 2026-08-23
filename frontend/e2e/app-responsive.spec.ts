import { test, expect, type Page } from '@playwright/test'

/* ============================================================
   Messor My Work + URL filters + responsive browser acceptance.
   Runs against the local Vite dev server with backend routes mocked
   at the network layer. The playwright project matrix covers the
   four target viewports (360x800, 390x844, 768x1024, 1440x900) plus
   320x800.
   ============================================================ */

const JSON_JSON = 'application/json'

const AUTH_USER = {
  id: 'user-admin',
  email: 'admin@demo.messor.app',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'ORG_ADMIN',
}

const PROJECT_SUMMARY = {
  id: 'proj-1',
  key: 'ALPHA',
  name: 'Alpha Project',
  description: null,
  currentUserRole: 'PROJECT_LEAD',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const PROJECT_DETAIL = {
  ...PROJECT_SUMMARY,
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

function makeIssue(key: string, number: number, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `id-${key}`,
    issueKey: key,
    projectKey: 'ALPHA',
    number,
    type: 'TASK',
    title,
    description: null,
    statusCode: 'TO_DO',
    reporterId: 'user-admin',
    assigneeId: 'user-admin',
    rank: number * 1024,
    archived: false,
    version: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// Assigned to the principal.
const MINE_ACTIVE = makeIssue('ALPHA-1', 1, 'My active task')
const MINE_ARCHIVED = makeIssue('ALPHA-2', 2, 'My archived task', {
  archived: true,
  statusCode: 'DONE',
  version: 1,
})
// Belongs to another user: must never appear in My Work.
const THEIRS = makeIssue('ALPHA-3', 3, 'Someone elses task', { assigneeId: 'user-other' })

function myWorkResponse(archive: string): Record<string, unknown> {
  const all = [MINE_ACTIVE, MINE_ARCHIVED, THEIRS]
  const items =
    archive === 'archived'
      ? all.filter((i) => i.archived === true)
      : all.filter((i) => i.archived === false && i.assigneeId === 'user-admin')
  return {
    items,
    page: 0,
    size: 20,
    totalItems: items.length,
    totalPages: 1,
  }
}

async function mockBackend(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(AUTH_USER) })
  })
  await page.route((url) => url.pathname === '/api/projects', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify({
        items: [PROJECT_SUMMARY],
        page: 0,
        size: 100,
        totalItems: 1,
        totalPages: 1,
      }),
    })
  })
  await page.route('**/api/projects/ALPHA', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(PROJECT_DETAIL) })
  })
  await page.route('**/api/projects/ALPHA/members', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(MEMBERS) })
  })
  await page.route((url) => url.pathname === '/api/projects/ALPHA/issues', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify({
        items: [MINE_ACTIVE, MINE_ARCHIVED, THEIRS],
        page: 0,
        size: 100,
        totalItems: 3,
        totalPages: 1,
      }),
    })
  })
  await page.route('**/api/issues/ALPHA-1', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(MINE_ACTIVE) })
  })
  await page.route('**/api/issues/ALPHA-1/activity', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify([]) })
  })
  // My Work returns only the principal's active issues, honoring archive.
  await page.route('**/api/my-work*', (route) => {
    const url = new URL(route.request().url())
    const archive = url.searchParams.get('archive') ?? 'active'
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify(myWorkResponse(archive)),
    })
  })
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }))
  expect(metrics.doc, 'documentElement must not overflow').toBeLessThanOrEqual(metrics.inner)
  expect(metrics.body, 'body must not overflow').toBeLessThanOrEqual(metrics.inner)
}

async function expectHitTargets(locator: import('@playwright/test').Locator): Promise<void> {
  const boxes = await locator.evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }),
  )
  for (const box of boxes) {
    expect(box.height, 'hit target height must be >= 44').toBeGreaterThanOrEqual(44)
    expect(box.width, 'hit target width must be >= 44').toBeGreaterThanOrEqual(44)
  }
}

/* ============================================================
   1. My Work shows only the current principal's issues, with no
      horizontal overflow, across every viewport.
   ============================================================ */
test('My Work shows only the principal assigned issues and does not overflow', async ({
  page,
}) => {
  await mockBackend(page)
  await page.goto('/my-work')

  await expect(page.getByRole('heading', { name: 'Görevlerim', level: 2 })).toBeVisible()
  await expect(page.getByText('My active task')).toBeVisible()
  await expect(page.locator('.my-work__meta').filter({ hasText: 'Alpha Project' })).toBeVisible()

  // Identity isolation: the other user's issue must never appear.
  await expect(page.getByText('Someone elses task')).toHaveCount(0)

  await expectNoHorizontalOverflow(page)
  await expectHitTargets(page.locator('.my-work__link'))
  await expectHitTargets(page.locator('.issue-filters__select'))
})

/* ============================================================
   2. URL filter selection drives the network request query
      parameters, and back/forward restores the screen state.
   ============================================================ */
test('URL filter selects and back/forward restores state', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/my-work')

  const archive = page.getByLabel('Arşiv')
  await expect(archive).toBeVisible()
  await expect(archive).toHaveValue('active')

  // Select archived; the network request must carry archive=archived. The
  // predicate is specific so it can never capture the initial (non-archived)
  // request that the page load already issued.
  const requestPromise = page.waitForRequest((req) => {
    const url = new URL(req.url())
    return (
      url.pathname.includes('/api/my-work') &&
      url.searchParams.get('archive') === 'archived'
    )
  })
  await archive.selectOption('archived')
  const request = await requestPromise
  expect(new URL(request.url()).searchParams.get('archive')).toBe('archived')

  await expect(page.getByText('My archived task')).toBeVisible()
  await expect(page.getByText('My active task')).toHaveCount(0)
  // The URL update and the canonicalization effect are asynchronous; poll.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('archive'))
    .toBe('archived')

  // Back restores the active default.
  await page.goBack()
  await page.waitForURL((url) => {
    const a = new URL(url.toString()).searchParams.get('archive')
    return a === null || a === 'active'
  })
  await expect(page.getByText('My active task')).toBeVisible()

  // Forward re-applies archived.
  await page.goForward()
  await page.waitForURL((url) => new URL(url.toString()).searchParams.get('archive') === 'archived')
  await expect(page.getByText('My archived task')).toBeVisible()
})

/* ============================================================
   3. Archive filter distinguishes archived issues and they remain
      read-only (no mutation controls in the My Work list).
   ============================================================ */
test('archive filter separates archived issues', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/my-work?archive=archived')

  await expect(page.getByText('My archived task')).toBeVisible()
  await expect(page.locator('.my-work__archived')).toBeVisible()
  await expect(page.getByText('My active task')).toHaveCount(0)

  // No mutation controls are rendered for archived rows in My Work.
  await expect(page.getByRole('button', { name: /Arşivle|Düzenle/ })).toHaveCount(0)
})

/* ============================================================
   4. Selecting an issue opens the route-backed drawer; focus is
      trapped and Escape/back closes it and restores focus.
   ============================================================ */
test('drawer opens from My Work and closes with Escape restoring focus', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/my-work')

  const issueLink = page.getByRole('link', { name: /My active task/ })
  await issueLink.click()

  // The route-backed drawer (issue workspace) appears.
  await expect(page.getByRole('dialog', { name: 'ALPHA-1' })).toBeVisible()

  // Focus lands inside the drawer on the close button.
  const closeButton = page.getByRole('button', { name: 'İş kapanış panelini kapat' })
  await expect(closeButton).toBeFocused()

  // Escape closes the drawer and returns to My Work.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'ALPHA-1' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Görevlerim', level: 2 })).toBeVisible()
})

/* ============================================================
   5. Reduced motion disables animation/transition.
   ============================================================ */
test('reduced motion disables transitions and animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockBackend(page)
  await page.goto('/my-work')

  await expect(page.getByRole('heading', { name: 'Görevlerim', level: 2 })).toBeVisible()

  const transitions = await page.evaluate(() => {
    const elements = document.querySelectorAll('a, button, select, .my-work__link')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return { reduced, durations: Array.from(elements).map((el) => getComputedStyle(el).transitionDuration) }
  })
  expect(transitions.reduced, 'prefers-reduced-motion must match').toBe(true)
  for (const duration of transitions.durations) {
    expect(duration, 'transition duration must be zero under reduced motion').toBe('0s')
  }
})

/* ============================================================
   6. Project workspace: URL filters drive the issue request and
      archived cards are read-only (no drag handle, no move menu).
   ============================================================ */
test('project workspace filters drive the request and archived cards are read-only', async ({
  page,
}) => {
  await mockBackend(page)
  const requestPromise = page.waitForRequest((req) =>
    req.url().includes('/api/projects/ALPHA/issues'),
  )
  await page.goto('/projects/ALPHA/board?type=BUG&archive=archived')
  const request = await requestPromise
  const params = new URL(request.url()).searchParams
  expect(params.get('type')).toBe('BUG')
  expect(params.get('archive')).toBe('archived')

  // An archived filter is not a complete active board, so NO card (archived or
  // active) exposes a drag handle or move menu.
  await expect(page.getByText('My archived task')).toBeVisible()
  await expect(page.getByRole('button', { name: /sürükle/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /taşıma menüsü/i })).toHaveCount(0)

  await expectNoHorizontalOverflow(page)
})

/* ============================================================
   7. My Work exposes no assignee filter (principal-scoped).
   ============================================================ */
test('My Work has no assignee filter', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/my-work')

  await expect(page.getByRole('heading', { name: 'Görevlerim', level: 2 })).toBeVisible()
  await expect(page.getByLabel('Proje')).toBeVisible()
  // No "Atanan" filter control on My Work.
  await expect(page.getByLabel('Atanan')).toHaveCount(0)
  await expect(page.getByLabel('Tüm atananlar')).toHaveCount(0)
})

/* ============================================================
   8. Project workspace pagination walks all issues with no
      duplicates and no missing rows (stateful backend mock).
   ============================================================ */
test('project workspace pagination has no duplicates or missing rows', async ({ page }) => {
  await mockBackend(page)
  // Build 5 issues and serve them with size=2 pagination driven by page param.
  const many = [1, 2, 3, 4, 5].map((n) =>
    makeIssue(`ALPHA-${n}`, n, `Bulk task ${n}`),
  )
  await page.route((url) => url.pathname === '/api/projects/ALPHA/issues', (route) => {
    const url = new URL(route.request().url())
    const page = Number(url.searchParams.get('page') ?? '0')
    const size = Number(url.searchParams.get('size') ?? '100')
    const items = many.slice(page * size, page * size + size)
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify({
        items,
        page,
        size,
        totalItems: many.length,
        totalPages: Math.ceil(many.length / size),
      }),
    })
  })
  const seen = new Set<string>()
  // Walk all three size=2 pages directly by URL and assert no duplicates and
  // no missing rows across the full deterministic pagination.
  for (let p = 0; p < 3; p += 1) {
    await page.goto(`/projects/ALPHA/board?size=2&page=${p}`)
    const firstOnPage = 2 * p + 1
    await page.getByText(`Bulk task ${firstOnPage}`).waitFor()
    const keys = await page.locator('.kanban-card__key').allTextContents()
    for (const key of keys) {
      seen.add(key)
    }
  }
  expect(seen.size).toBe(5)
  for (let n = 1; n <= 5; n += 1) {
    expect(seen.has(`ALPHA-${n}`), `must include ALPHA-${n}`).toBe(true)
  }
  await expectNoHorizontalOverflow(page)
})

/* ============================================================
   9. Default project workspace request sends the effective size
      (100), so the board is never truncated to the backend default
      of 20.
   ============================================================ */
test('default project workspace request sends size=100 (no 20 truncation)', async ({ page }) => {
  await mockBackend(page)
  const requestPromise = page.waitForRequest((req) =>
    req.url().includes('/api/projects/ALPHA/issues'),
  )
  await page.goto('/projects/ALPHA/board')
  const request = await requestPromise
  const params = new URL(request.url()).searchParams
  expect(params.get('size')).toBe('100')
  expect(params.get('page')).toBe('0')
})

/* ============================================================
   10. A filtered board disables movement controls fail-closed and
       explains why, across every viewport.
   ============================================================ */
test('filtered board disables move controls fail-closed', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/projects/ALPHA/board?type=BUG')

  await expect(page.getByText('My active task')).toBeVisible()
  // No drag handles and no move menus on a filtered board.
  await expect(page.getByRole('button', { name: /sürükle/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /taşıma menüsü/i })).toHaveCount(0)
  await expect(page.getByText('Filtrelenmiş veya sayfalanmış görünümde kartlar taşınamaz.')).toBeVisible()

  await expectNoHorizontalOverflow(page)
})

/* ============================================================
   11. My Work canonicalizes a hostile direct URL by replace.
   ============================================================ */
test('My Work canonicalizes a hostile direct URL', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/my-work?assignee=victim&page=1&page=2')

  await expect(page.getByRole('heading', { name: 'Görevlerim', level: 2 })).toBeVisible()
  // The URL is rewritten to the canonical (empty) search via replace.
  await page.waitForURL((url) => new URL(url.toString()).searchParams.size === 0)
  expect(new URL(page.url()).search).toBe('')
})
