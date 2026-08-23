import { expect, type Locator, type Page } from '@playwright/test'

/* ============================================================
   Shared helpers for the real-stack acceptance suites
   (compose-backed dev/test stack, real backend + session + CSRF).

   Rules:
   - No global mutable singleton state. Every helper is a pure
     function or a per-test page-scoped collector.
   - Every project key is unique per test run and per worker, so
     parallel viewport workers never collide in the shared DB.
   - The demo password is never hard-coded and never logged; it is
     read only from the MESSOR_DEMO_PASSWORD environment variable.
   - The real project role/status labels come from the backend
     (ProjectService seeds Yapılacak / Devam Ediyor / Tamamlandı).
   ============================================================ */

export const ADMIN_EMAIL = 'admin@demo.messor.app'
export const MEMBER_EMAIL = 'member@demo.messor.app'

export const STATUS_LABELS: Record<string, string> = {
  TO_DO: 'Yapılacak',
  IN_PROGRESS: 'Devam Ediyor',
  DONE: 'Tamamlandı',
}

export interface ApiResult {
  status: number
  body: unknown
}

/** The shared demo password. Required, never logged. */
export function demoPassword(): string {
  const value = process.env.MESSOR_DEMO_PASSWORD
  if (!value || value.trim() === '') {
    throw new Error(
      'MESSOR_DEMO_PASSWORD must be set to run the real-stack acceptance suite.',
    )
  }
  return value
}

/**
 * A unique, deterministic project key (max 10 chars, `^[A-Z][A-Z0-9]{1,9}$`).
 * Uses fast-changing low-order timestamp digits plus random entropy so parallel
 * workers and repeated runs never collide. (High-order base36 timestamp digits
 * stay constant for hours and must not be used.)
 */
export function uniqueProjectKey(prefix: string): string {
  const lowTime = (Date.now() % 100000000)
    .toString(36)
    .toUpperCase()
    .padStart(6, '0')
  const random = Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '0')
    .padEnd(6, '0')
  const suffix = `${lowTime}${random}`.slice(0, 9 - prefix.length)
  return `${prefix}${suffix}`
}

/**
 * Perform a same-origin API request through the page's APIRequestContext.
 * `page.request` resolves relative URLs against the configured baseURL and
 * shares the browser context's cookies, so the real server-side session and
 * CSRF state flow through the test network stack. It can be called before any
 * navigation (the page may still be on about:blank).
 *
 * `csrf: true` first fetches a fresh token and attaches it with the header
 * name returned by the server. JSON bodies are stringified; string bodies are
 * sent as-is (used by the form-encoded login).
 */
export async function apiFetch(
  page: Page,
  path: string,
  options: { method?: string; body?: unknown; csrf?: boolean } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {}
  let body: string | undefined
  if (options.body !== undefined) {
    if (typeof options.body === 'string') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
      body = options.body
    } else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
  }
  if (options.csrf === true) {
    const csrfResponse = await page.request.get('/api/auth/csrf')
    const csrf = (await csrfResponse.json()) as { headerName: string; token: string }
    headers[csrf.headerName] = csrf.token
  }
  const response = await page.request.fetch(path, {
    method: options.method ?? 'GET',
    headers,
    data: body,
  })
  const text = await response.text()
  let parsed: unknown = null
  if (text !== '') {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }
  return { status: response.status(), body: parsed }
}

/** Login through the real UI form and wait for the protected /projects route. */
export async function uiLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('E-posta').fill(email)
  await page.getByLabel('Parola').fill(password)
  await page.getByRole('button', { name: 'Oturum aç' }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: 'Projeler', level: 2 })).toBeVisible()
}

/** Login through the real API (setup path; exercises session + CSRF). */
export async function apiLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const body = new URLSearchParams({ email, password }).toString()
  const result = await apiFetch(page, '/api/auth/login', {
    method: 'POST',
    csrf: true,
    body,
  })
  expect(result.status, `login as ${email} must succeed`).toBe(200)
}

/** Logout through the real API. */
export async function apiLogout(page: Page): Promise<void> {
  await apiFetch(page, '/api/auth/logout', { method: 'POST', csrf: true })
}

export interface CreatedProject {
  key: string
  id: string
  version: number
}

/** Admin creates a project via the real API and returns its identity. */
export async function apiCreateProject(
  page: Page,
  key: string,
  name: string,
  description: string | null = null,
): Promise<CreatedProject> {
  const result = await apiFetch(page, '/api/projects', {
    method: 'POST',
    csrf: true,
    body: { key, name, description },
  })
  expect(result.status, `project ${key} must be created`).toBe(201)
  const body = result.body as Record<string, unknown>
  return {
    key: body.key as string,
    id: body.id as string,
    version: body.version as number,
  }
}

export interface ProjectMemberRecord {
  userId: string
  email: string
  role: string
  version: number
}

/** Add the demo member to a project via the real API. */
export async function apiAddMember(
  page: Page,
  projectKey: string,
  role = 'MEMBER',
): Promise<ProjectMemberRecord> {
  const result = await apiFetch(page, `/api/projects/${projectKey}/members`, {
    method: 'POST',
    csrf: true,
    body: { email: MEMBER_EMAIL, role },
  })
  expect(result.status, `add member to ${projectKey} must succeed`).toBe(201)
  const body = result.body as Record<string, unknown>
  return {
    userId: body.userId as string,
    email: body.email as string,
    role: body.role as string,
    version: body.version as number,
  }
}

/** Change a member's role via the real API. */
export async function apiChangeMemberRole(
  page: Page,
  projectKey: string,
  userId: string,
  role: string,
  expectedVersion: number,
): Promise<void> {
  const result = await apiFetch(page, `/api/projects/${projectKey}/members/${userId}`, {
    method: 'PATCH',
    csrf: true,
    body: { role, expectedVersion },
  })
  expect(result.status, `change role of ${userId} must succeed`).toBe(200)
}

export interface CreatedIssue {
  issueKey: string
  version: number
}

/** Create an issue via the real API. */
export async function apiCreateIssue(
  page: Page,
  projectKey: string,
  input: { type: string; title: string; description: string | null; assigneeId: string | null },
): Promise<CreatedIssue> {
  const result = await apiFetch(page, `/api/projects/${projectKey}/issues`, {
    method: 'POST',
    csrf: true,
    body: input,
  })
  expect(result.status, `issue in ${projectKey} must be created`).toBe(201)
  const body = result.body as Record<string, unknown>
  return { issueKey: body.issueKey as string, version: body.version as number }
}

/** Fetch the current project member list via the real API. */
export async function apiListMembers(
  page: Page,
  projectKey: string,
): Promise<ProjectMemberRecord[]> {
  const result = await apiFetch(page, `/api/projects/${projectKey}/members`)
  expect(result.status, `members of ${projectKey} must be readable`).toBe(200)
  return (result.body as Record<string, unknown>[]).map((m) => ({
    userId: m.userId as string,
    email: m.email as string,
    role: m.role as string,
    version: m.version as number,
  }))
}

/** Assert the page has no horizontal overflow. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }))
  expect(metrics.doc, 'documentElement must not overflow').toBeLessThanOrEqual(metrics.inner)
  expect(metrics.body, 'body must not overflow').toBeLessThanOrEqual(metrics.inner)
}

/** Assert every matched element keeps a practical 44x44 hit target. */
export async function expectHitTargets(locator: Locator): Promise<void> {
  const boxes = await locator.evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }),
  )
  expect(boxes.length, 'hit-target locator must match at least one element').toBeGreaterThan(0)
  for (const box of boxes) {
    expect(box.height, 'hit target height must be >= 44').toBeGreaterThanOrEqual(44)
    expect(box.width, 'hit target width must be >= 44').toBeGreaterThanOrEqual(44)
  }
}

/**
 * Collect uncaught page errors and non-allowed console errors for one test.
 *
 * The anonymous `/api/auth/me` bootstrap 401 is the application's documented
 * session-check contract and is always allowed. `expectedSecurityUrls`
 * additionally allow-lists the intentional 4xx security probes (nonmember
 * 404 / viewer 403) which surface as console network errors. All other
 * console `error` messages and every uncaught page error fail the test.
 */
export interface ErrorCollector {
  assertClean: () => void
}

export function collectUnexpectedErrors(
  page: Page,
  expectedSecurityUrls: string[] = [],
): ErrorCollector {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => {
    pageErrors.push(String(error))
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return
    }
    const text = message.text()
    // Chrome reports failed HTTP responses as "Failed to load resource: ...".
    // Allow only the anonymous bootstrap check and the explicitly expected
    // security probes.
    const isNetworkFailure = text.includes('Failed to load resource')
    const allowlisted = ['/api/auth/me', ...expectedSecurityUrls]
    const isExpected =
      isNetworkFailure &&
      allowlisted.some((url) => message.location().url.includes(url))
    if (!isExpected) {
      consoleErrors.push(`${message.location().url} :: ${text}`)
    }
  })

  return {
    assertClean: () => {
      expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([])
      expect(
        consoleErrors,
        `unexpected console errors: ${consoleErrors.join(' | ')}`,
      ).toEqual([])
    },
  }
}

/** Assert that browser storage carries no session/CSRF/auth material. */
export async function expectCleanBrowserStorage(page: Page): Promise<void> {
  // about:blank denies storage access; move to the app origin first so the
  // check is meaningful (the session is already established/expired at that
  // point, so this navigation does not change the assertion target).
  if (!page.url().startsWith('http')) {
    await page.goto('/login')
  }
  const storage = await page.evaluate(() => ({
    local: { ...window.localStorage },
    session: { ...window.sessionStorage },
  }))
  const json = JSON.stringify(storage)
  expect(json).not.toContain('SESSION')
  expect(json).not.toContain('csrf')
  expect(json).not.toContain('X-CSRF')
  expect(json).not.toContain('token')
  expect(json).not.toContain('password')
}
