import { expect, test } from '@playwright/test'
import {
  ADMIN_EMAIL,
  MEMBER_EMAIL,
  apiAddMember,
  apiCreateIssue,
  apiCreateProject,
  apiFetch,
  apiLogin,
  apiLogout,
  csrfProof,
  collectUnexpectedErrors,
  demoPassword,
  expectCleanBrowserStorage,
  uniqueProjectKey,
} from './stack-helpers'

/* ============================================================
   Messor security regression suite — real-stack browser tests
   (Phase 3 browser layer; the backend matrix is covered by the
   MockMvc ITs, this file proves the contracts through the real
   browser network stack, storage and cookies).
   ============================================================ */

const PASSWORD = demoPassword()

interface SessionCookie {
  name: string
  value: string
  httpOnly: boolean
  sameSite: 'Lax' | 'Strict' | 'None'
  secure: boolean
}

function sessionCookie(cookies: { name: string; value: string; httpOnly: boolean; sameSite: 'Lax' | 'Strict' | 'None' | null; secure: boolean }[]): SessionCookie | undefined {
  const cookie = cookies.find((c) => c.name === 'SESSION')
  if (cookie === undefined) {
    return undefined
  }
  return {
    name: cookie.name,
    value: cookie.value,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite ?? 'Lax',
    secure: cookie.secure,
  }
}

test('anonymous protected API is rejected and no auth material is stored', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Oturum aç', level: 2 })).toBeVisible()

  const me = await apiFetch(page, '/api/auth/me')
  expect(me.status, 'anonymous /me must be 401').toBe(401)
  const body = me.body as Record<string, unknown>
  expect(body.code, 'anonymous /me code').toBe('UNAUTHENTICATED')

  const projects = await apiFetch(page, '/api/projects?page=0&size=20')
  expect(projects.status, 'anonymous project list must be 401').toBe(401)

  await expectCleanBrowserStorage(page)
})

test('login requires CSRF and rotates the session cookie with safe flags', async ({
  page,
}) => {
  const context = page.context()
  const preLoginCookies = await context.cookies()

  // 1. Login without a CSRF token is rejected despite login being public.
  const noCsrf = await apiFetch(page, '/api/auth/login', {
    method: 'POST',
    body: new URLSearchParams({ email: ADMIN_EMAIL, password: PASSWORD }).toString(),
  })
  expect(noCsrf.status, 'login without CSRF must be 403').toBe(403)
  expect((noCsrf.body as Record<string, unknown>).code).toBe('INVALID_CSRF_TOKEN')

  // 2. A valid login succeeds.
  await apiLogin(page, ADMIN_EMAIL, PASSWORD)
  const postLoginCookies = await context.cookies()

  const before = sessionCookie(preLoginCookies)
  const after = sessionCookie(postLoginCookies)
  expect(after, 'login must set a SESSION cookie').toBeDefined()
  expect(after!.httpOnly, 'session cookie must be HttpOnly').toBe(true)
  expect(after!.sameSite, 'session cookie SameSite must be Lax').toBe('Lax')
  expect(after!.secure, 'dev session cookie must not be Secure over HTTP').toBe(false)
  expect(after!.name, 'dev cookie must not use the production __Host- name').not.toContain('__Host-')
  if (before !== undefined) {
    expect(after!.value, 'login must rotate the session cookie').not.toBe(before.value)
  }

  // 3. The raw session value never leaks into a response body or storage.
  const me = await apiFetch(page, '/api/auth/me')
  expect(JSON.stringify(me.body)).not.toContain(after!.value)
  const projects = await apiFetch(page, '/api/projects?page=0&size=20')
  expect(JSON.stringify(projects.body)).not.toContain(after!.value)

  await expectCleanBrowserStorage(page)
})

test('mutations require a valid session-scoped CSRF token', async ({
  page,
  browser,
}) => {
  const errors = collectUnexpectedErrors(page)
  const projectKey = uniqueProjectKey('CS')

  await apiLogin(page, ADMIN_EMAIL, PASSWORD)
  const sessionToken = await csrfProof(page)

  // 1. Missing token on a state-changing request -> 403.
  const missing = await apiFetch(page, '/api/projects', {
    method: 'POST',
    body: { key: `${projectKey}M`, name: 'No token' },
  })
  expect(missing.status, 'mutation without CSRF must be 403').toBe(403)
  expect((missing.body as Record<string, unknown>).code).toBe('INVALID_CSRF_TOKEN')

  // 2. Invalid (bogus) token -> 403.
  const invalid = await page.request.fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [sessionToken.headerName]: 'not-a-real-token' },
    data: JSON.stringify({ key: `${projectKey}I`, name: 'Bogus token' }),
  })
  const invalidText = await invalid.text()
  expect(invalid.status(), 'bogus CSRF must be 403').toBe(403)
  expect(JSON.parse(invalidText).code).toBe('INVALID_CSRF_TOKEN')

  // 3. A token from another session must not be accepted.
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:8088' })
  const otherPage = await otherContext.newPage()
  await apiLogin(otherPage, MEMBER_EMAIL, PASSWORD)
  const crossSession = await otherPage.request.fetch('/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [sessionToken.headerName]: sessionToken.token,
    },
    data: JSON.stringify({ key: `${projectKey}X`, name: 'Cross session token' }),
  })
  const crossSessionText = await crossSession.text()
  expect(crossSession.status(), 'another session token must be 403').toBe(403)
  expect(JSON.parse(crossSessionText).code).toBe('INVALID_CSRF_TOKEN')
  await otherContext.close()

  // 4. Valid session + token reaches the business contract (201).
  const valid = await apiFetch(page, '/api/projects', {
    method: 'POST',
    csrf: true,
    body: { key: projectKey, name: `Valid token ${projectKey}` },
  })
  expect(valid.status, 'valid CSRF must create the project').toBe(201)

  errors.assertClean()
})

test('logout invalidates the server-side session', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8088' })
  const page = await context.newPage()
  await apiLogin(page, ADMIN_EMAIL, PASSWORD)
  const beforeLogout = (await context.cookies()).find((c) => c.name === 'SESSION')
  expect(beforeLogout, 'session cookie must exist after login').toBeDefined()

  await apiLogout(page)
  const afterLogoutCookies = await context.cookies()
  expect(
    afterLogoutCookies.find((c) => c.name === 'SESSION'),
    'logout must delete the session cookie',
  ).toBeUndefined()

  // The old session cookie value must now be invalid server-side.
  const staleContext = await browser.newContext({ baseURL: 'http://127.0.0.1:8088' })
  await staleContext.addCookies([
    { name: 'SESSION', value: beforeLogout!.value, domain: '127.0.0.1', path: '/' },
  ])
  const stalePage = await staleContext.newPage()
  const probe = await stalePage.request.get('/api/projects?page=0&size=20')
  expect(probe.status(), 'stale session cookie must be rejected').toBe(401)
  await staleContext.close()
  await context.close()
})

test('hostile text is rendered inert across project, issue and comments', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page)
  const projectKey = uniqueProjectKey('XSS')
  const hostileName = `<img src=x onerror="window.__xss=1">Evil ${projectKey}`
  const hostileTitle = `<script>window.__xss=2</script>Evil issue ${projectKey}`
  const hostileDescription = '<svg onload="window.__xss=3"></svg>description'
  const hostileComment = '<img src=x onerror="window.__xss=4">comment body'

  await apiLogin(page, ADMIN_EMAIL, PASSWORD)
  await apiCreateProject(page, projectKey, hostileName, hostileDescription)
  const issue = await apiCreateIssue(page, projectKey, {
    type: 'TASK',
    title: hostileTitle,
    description: hostileDescription,
    assigneeId: null,
  })
  await apiFetch(page, `/api/issues/${issue.issueKey}/comments`, {
    method: 'POST',
    csrf: true,
    body: { body: hostileComment },
  })

  // The project board heading renders the hostile project name as literal text
  // (never injected HTML). Direct navigation avoids the paginated projects list,
  // which accumulates demo projects across runs.
  await page.goto(`/projects/${projectKey}/board`)
  await expect(page.getByRole('heading', { name: hostileName, level: 2 })).toBeVisible()

  // Board + drawer: hostile title/description render as text, never HTML.
  const card = page.getByRole('button', { name: new RegExp(hostileTitle) })
  await expect(card).toBeVisible()
  await card.click()
  const drawer = page.getByRole('dialog', { name: issue.issueKey })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText(hostileTitle, { exact: true })).toBeVisible()
  await expect(drawer.getByText(hostileDescription, { exact: true })).toBeVisible()

  // Comments: hostile body renders inert.
  await drawer.getByRole('tab', { name: 'Yorumlar' }).click()
  await expect(drawer.getByText(hostileComment, { exact: true })).toBeVisible()

  // No raw HTML element was injected and no script ever executed. The app
  // legitimately owns a module <script>; only hostile/injected scripts count.
  const dom = await page.evaluate(() => ({
    images: document.querySelectorAll('img').length,
    hostileScripts: Array.from(document.querySelectorAll('script')).filter(
      (s) => (s.textContent ?? '').includes('__xss') || (s.getAttribute('src') ?? '').includes('__xss'),
    ).length,
    xss: (window as unknown as { __xss?: number }).__xss,
  }))
  expect(dom.images, 'no <img> may be injected').toBe(0)
  expect(dom.hostileScripts, 'no hostile <script> may be injected').toBe(0)
  expect(dom.xss, 'no hostile script may execute').toBeUndefined()

  errors.assertClean()
})

test('validation and query-safety reject hostile inputs', async ({ page }) => {
  const errors = collectUnexpectedErrors(page, ['/api/projects/'])
  const projectKey = uniqueProjectKey('VL')
  await apiLogin(page, ADMIN_EMAIL, PASSWORD)
  await apiCreateProject(page, projectKey, `Validation ${projectKey}`)
  await apiAddMember(page, projectKey, 'MEMBER')
  const issue = await apiCreateIssue(page, projectKey, {
    type: 'TASK',
    title: 'Validation target',
    description: null,
    assigneeId: null,
  })

  const mustReject = async (
    path: string,
    expected = 400,
    options: { method?: string; body?: unknown; csrf?: boolean } = {},
  ): Promise<void> => {
    const result = await apiFetch(page, path, options)
    expect(result.status, `${path} must be ${expected}`).toBe(expected)
    if (expected === 400) {
      expect((result.body as Record<string, unknown>).code, `${path} code`).toBe(
        'VALIDATION_FAILED',
      )
    }
  }

  // Pagination bounds on every list endpoint. (The project list endpoint bounds
  // page by @Min(0) only; issue/My Work list endpoints also cap page at 10000.)
  await mustReject('/api/projects?page=-1')
  await mustReject('/api/projects?size=0')
  await mustReject('/api/projects?size=101')
  await mustReject(`/api/projects/${projectKey}/issues?page=-1`)
  await mustReject(`/api/projects/${projectKey}/issues?page=10001`)
  await mustReject(`/api/projects/${projectKey}/issues?size=200`)

  // Hostile/unknown/repeated sort and extra sort segments.
  await mustReject(`/api/projects/${projectKey}/issues?sort=passwordHash,asc`)
  await mustReject(`/api/projects/${projectKey}/issues?sort=number,up`)
  await mustReject(`/api/projects/${projectKey}/issues?sort=number,asc,evil`)
  await mustReject(`/api/projects/${projectKey}/issues?sort=number,asc&sort=title,desc`)
  await mustReject(`/api/projects/${projectKey}/issues?sort=-number`)

  // Invalid archive/type/status and malformed assignee UUID.
  await mustReject(`/api/projects/${projectKey}/issues?archive=everything`)
  await mustReject(`/api/projects/${projectKey}/issues?type=EPIC`)
  await mustReject(`/api/projects/${projectKey}/issues?assignee=not-a-uuid`)

  // Missing/negative expectedVersion on mutation DTOs.
  await mustReject(`/api/issues/${issue.issueKey}`, 400, {
    method: 'PATCH',
    csrf: true,
    body: { title: 'x', description: null, assigneeId: null },
  })
  await mustReject(`/api/issues/${issue.issueKey}`, 400, {
    method: 'PATCH',
    csrf: true,
    body: { title: 'x', description: null, assigneeId: null, expectedVersion: -1 },
  })
  await mustReject(`/api/issues/${issue.issueKey}/archive`, 400, {
    method: 'POST',
    csrf: true,
    body: { expectedVersion: -1 },
  })

  // My Work must never accept another principal target.
  await mustReject('/api/my-work?assignee=00000000-0000-0000-0000-000000000001')

  errors.assertClean()
})
