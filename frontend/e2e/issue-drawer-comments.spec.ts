import { test, expect, type Page } from '@playwright/test'

/* ============================================================
   Messor route-backed issue drawer + comments acceptance.
   Runs against the local Vite dev server with backend routes mocked
   at the network layer. The playwright project matrix covers the
   responsive contract (320/360/390/768/1440).
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

const ACTIVITY = [
  {
    id: 'act-1',
    type: 'CREATED',
    actorId: 'user-admin',
    summary: { type: 'TASK', statusCode: 'TO_DO', assigneeId: null },
    createdAt: '2026-01-01T00:00:00Z',
  },
]

function makeIssue(key: string, number: number, title: string) {
  return {
    id: `id-${key}`,
    issueKey: key,
    projectKey: 'MES',
    number,
    type: 'TASK',
    title,
    description: 'A description',
    statusCode: 'TO_DO',
    reporterId: 'user-admin',
    assigneeId: null,
    rank: number * 1024,
    archived: false,
    version: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

interface CommentState {
  comments: Record<string, unknown>[]
  nextId: number
}

function initialState(): CommentState {
  return {
    comments: [
      {
        id: 'c-1',
        issueKey: 'MES-1',
        authorId: 'user-admin',
        body: 'An existing comment',
        deleted: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        version: 0,
      },
    ],
    nextId: 2,
  }
}

async function mockAuthenticated(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(AUTH_USER) })
  })
}

async function mockWorkspace(
  page: Page,
  state: CommentState,
): Promise<void> {
  const issues = [
    makeIssue('MES-1', 1, 'First task'),
    makeIssue('MES-2', 2, 'Second task'),
  ]

  await page.route('**/api/auth/csrf', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify({
        headerName: 'X-Test-Csrf',
        parameterName: '_csrf',
        token: 'masked-token',
      }),
    })
  })
  await page.route('**/api/projects/MES', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(PROJECT) })
  })
  await page.route('**/api/projects/MES/members', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(MEMBERS) })
  })
  await page.route('**/api/projects/MES/issues**', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify({
        items: issues,
        page: 0,
        size: 100,
        totalItems: issues.length,
        totalPages: 1,
      }),
    })
  })
  await page.route('**/api/issues/MES-1', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify(makeIssue('MES-1', 1, 'First task')),
    })
  })
  await page.route('**/api/issues/*/activity', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(ACTIVITY) })
  })

  // Comments: GET list, POST create, PATCH edit, DELETE tombstone.
  await page.route('**/api/issues/MES-1/comments', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as { body: string }
      const comment = {
        id: `c-${state.nextId}`,
        issueKey: 'MES-1',
        authorId: 'user-admin',
        body: body.body,
        deleted: false,
        createdAt: '2026-01-02T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        version: 0,
      }
      state.comments.push(comment)
      state.nextId += 1
      route.fulfill({ status: 201, contentType: JSON_JSON, body: JSON.stringify(comment) })
      return
    }
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(state.comments) })
  })
  await page.route('**/api/comments/c-1*', async (route) => {
    const request = route.request()
    const method = request.method()
    if (method === 'PATCH') {
      const body = JSON.parse(request.postData() ?? '{}') as {
        body: string
        expectedVersion: number
      }
      const comment = state.comments.find((c) => c.id === 'c-1')
      if (comment && body.expectedVersion === comment.version) {
        comment.body = body.body
        comment.version = (comment.version as number) + 1
        route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(comment) })
        return
      }
      route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          status: 409,
          title: 'Conflict',
          code: 'VERSION_CONFLICT',
          detail: 'conflict',
        }),
      })
      return
    }
    if (method === 'DELETE') {
      const url = new URL(request.url())
      const expectedVersion = Number(url.searchParams.get('expectedVersion'))
      const comment = state.comments.find((c) => c.id === 'c-1')
      if (comment && expectedVersion === comment.version) {
        comment.body = null
        comment.deleted = true
        comment.version = (comment.version as number) + 1
        route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(comment) })
        return
      }
      route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify({ status: 409, code: 'VERSION_CONFLICT' }) })
    }
  })
}

async function openDrawer(page: Page): Promise<void> {
  await page.goto('/projects/MES/issues/MES-1')
  await expect(page.getByRole('dialog', { name: 'MES-1' })).toBeVisible()
}

test('direct drawer URL load renders the route-backed issue drawer', async ({ page }) => {
  const state = initialState()
  await mockAuthenticated(page)
  await mockWorkspace(page, state)
  await openDrawer(page)

  await expect(page.getByRole('heading', { name: 'MES-1', level: 2 })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('First task')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Aktivite' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Yorumlar' })).toBeVisible()
})

test('comments tab lists comments and a lead can create one', async ({ page }) => {
  const state = initialState()
  await mockAuthenticated(page)
  await mockWorkspace(page, state)
  await openDrawer(page)

  await page.getByRole('tab', { name: 'Yorumlar' }).click()
  await expect(page.getByText('An existing comment')).toBeVisible()

  await page.getByLabel('Yorum ekle').fill('A brand new comment')
  await page.getByRole('button', { name: 'Yorum yap' }).click()
  await expect(page.getByText('A brand new comment')).toBeVisible()
})

test('a lead can edit and delete their own comment', async ({ page }) => {
  const state = initialState()
  await mockAuthenticated(page)
  await mockWorkspace(page, state)
  await openDrawer(page)

  await page.getByRole('tab', { name: 'Yorumlar' }).click()
  const comments = page.locator('#issue-tabpanel-comments')
  await expect(comments.getByText('An existing comment')).toBeVisible()

  await comments.getByRole('button', { name: 'Düzenle' }).click()
  const textarea = comments.getByLabel('Yorumu düzenle')
  await textarea.fill('Edited comment body')
  await comments.getByRole('button', { name: 'Kaydet' }).click()
  await expect(comments.getByText('Edited comment body')).toBeVisible()

  await comments.getByRole('button', { name: 'Sil' }).click()
  await comments.getByRole('button', { name: 'Silmeyi onayla' }).click()
  await expect(page.getByText('Bu yorum silindi.')).toBeVisible()
  await expect(page.getByText('Edited comment body')).not.toBeVisible()
})

test('Escape and the close button return to the project board', async ({ page }) => {
  const state = initialState()
  await mockAuthenticated(page)
  await mockWorkspace(page, state)
  await openDrawer(page)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('region', { name: 'Kanban panosu' })).toBeVisible()

  await page.goto('/projects/MES/issues/MES-1')
  await expect(page.getByRole('dialog', { name: 'MES-1' })).toBeVisible()
  await page.getByRole('button', { name: /kapat/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('region', { name: 'Kanban panosu' })).toBeVisible()
})

test('card click opens the route-backed drawer', async ({ page }) => {
  const state = initialState()
  await mockAuthenticated(page)
  await mockWorkspace(page, state)
  await page.goto('/projects/MES/board')
  await expect(page.getByRole('region', { name: 'Kanban panosu' })).toBeVisible()

  await page.getByRole('button', { name: /^MES-1,/ }).click()
  await expect(page.getByRole('dialog', { name: 'MES-1' })).toBeVisible()
})

test('hostile comment HTML is rendered inert as text', async ({ page }) => {
  const state = initialState()
  state.comments[0].body = '<img src=x onerror=alert(1)><script>x</script>'
  await mockAuthenticated(page)
  await mockWorkspace(page, state)
  await openDrawer(page)

  await page.getByRole('tab', { name: 'Yorumlar' }).click()
  const comments = page.locator('#issue-tabpanel-comments')
  await expect(comments.getByText(/onerror/)).toBeVisible()
  // The hostile markup is escaped as inert text, never a live <img>.
  await expect(comments.locator('img')).toHaveCount(0)
})
