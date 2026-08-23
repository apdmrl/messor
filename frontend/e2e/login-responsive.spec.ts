import { test, expect, type Page } from '@playwright/test'

/* ============================================================
   Messor responsive login — browser acceptance tests
   Runs against a local Vite dev server with all backend routes
   mocked at the network layer. No backend/PostgreSQL required.
   ============================================================ */

const PROBLEM_JSON = 'application/problem+json'
const JSON_JSON = 'application/json'

const ANONYMOUS_ME = {
  type: 'about:blank',
  title: 'Unauthorized',
  status: 401,
  detail: 'Oturum açmanız gerekiyor.',
  instance: '/api/auth/me',
  code: 'UNAUTHENTICATED',
}

const AUTH_FAILED = {
  type: 'about:blank',
  title: 'Authentication failed',
  status: 401,
  detail: 'E-posta veya parola hatalı.',
  instance: '/api/auth/login',
  code: 'AUTHENTICATION_FAILED',
}

const CSRF_HEADER = 'X-Test-Csrf'
const CSRF_PARAM = '_csrf'

interface LoginRequestCapture {
  body: URLSearchParams | null
  csrfHeader: string | null
}

/* ---------- Route mock helpers ---------- */

/** Anonymous bootstrap: /me returns 401 UNAUTHENTICATED. */
async function mockAnonymousMe(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => {
    route.fulfill({
      status: 401,
      contentType: PROBLEM_JSON,
      body: JSON.stringify(ANONYMOUS_ME),
    })
  })
}

/** Authenticated bootstrap: /me returns 200 UserSummary. */
async function mockAuthenticatedMe(page: Page, user: Record<string, unknown>): Promise<void> {
  await page.route('**/api/auth/me', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(user) })
  })
}

/**
 * CSRF endpoint. Returns `tokens[0]` on the first call and `tokens[1]` on
 * subsequent calls (rotation). Tokens are route fixtures only and must never
 * appear in DOM/storage/log assertions.
 */
async function mockCsrf(page: Page, tokens: [string, string]): Promise<void> {
  let call = 0
  await page.route('**/api/auth/csrf', (route) => {
    const token = call === 0 ? tokens[0] : tokens[1]
    call += 1
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify({
        headerName: CSRF_HEADER,
        parameterName: CSRF_PARAM,
        token,
      }),
    })
  })
}

/** Login success: captures the request, returns 200 UserSummary. */
async function mockLoginSuccess(
  page: Page,
  user: Record<string, unknown>,
  capture: LoginRequestCapture,
): Promise<void> {
  await page.route('**/api/auth/login', (route) => {
    const request = route.request()
    const postData = request.postData()
    capture.body = postData ? new URLSearchParams(postData) : null
    capture.csrfHeader = request.headers()[CSRF_HEADER.toLowerCase()] ?? null
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(user) })
  })
}

/** Login failure: returns 401 AUTHENTICATION_FAILED. */
async function mockLoginFailure(page: Page): Promise<void> {
  await page.route('**/api/auth/login', (route) => {
    route.fulfill({
      status: 401,
      contentType: PROBLEM_JSON,
      body: JSON.stringify(AUTH_FAILED),
    })
  })
}

/* ---------- Shared fixtures ---------- */

const MEMBER_USER = {
  id: 'user-1',
  email: 'member@demo.messor.app',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'USER',
}

function longEmailUser(): Record<string, unknown> {
  return {
    id: 'user-long',
    email: `${'a'.repeat(300)}@example.com`,
    firstName: 'Uzun',
    lastName: 'İsim',
    role: 'USER',
  }
}

/* ---------- Small helpers ---------- */

function viewportWidth(testInfo: import('@playwright/test').TestInfo): number {
  const viewport = testInfo.project.use.viewport
  return viewport ? viewport.width : 1280
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

async function expectVisibleFocus(locator: import('@playwright/test').Locator): Promise<void> {
  const state = await locator.evaluate((el) => {
    const active = document.activeElement === el
    const matches = el.matches(':focus-visible')
    const style = getComputedStyle(el)
    return {
      active,
      matches,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    }
  })
  expect(state.active, 'element should be focused').toBe(true)
  expect(state.matches, 'element should match :focus-visible').toBe(true)
  expect(state.outlineStyle, 'focus outline style must not be none').not.toBe('none')
  expect(state.outlineWidth, 'focus outline width must not be 0px').not.toBe('0px')
}

/* ============================================================
   1. Login layout fits every viewport
   ============================================================ */
test('login layout fits every viewport', async ({ page }) => {
  await mockAnonymousMe(page)
  await mockCsrf(page, ['masked-test-token-1', 'masked-test-token-2'])
  await page.goto('/')

  const heading = page.getByRole('heading', { name: 'Messor' })
  const email = page.getByLabel('E-posta')
  const password = page.getByLabel('Parola')
  const submit = page.getByRole('button', { name: 'Oturum aç' })

  await expect(heading).toBeVisible()
  await expect(email).toBeVisible()
  await expect(password).toBeVisible()
  await expect(submit).toBeVisible()

  await expectNoHorizontalOverflow(page)

  for (const field of [email, password, submit]) {
    const box = await field.boundingBox()
    expect(box, 'field should have a bounding box').not.toBeNull()
    expect(box!.width, 'field width must be positive').toBeGreaterThan(0)
    expect(box!.x, 'field must start within viewport').toBeGreaterThanOrEqual(0)
    expect(
      box!.x + box!.width,
      'field must end within viewport',
    ).toBeLessThanOrEqual(viewportWidth(test.info()))
  }

  // If the form extends below the fold, it must remain usable after scrolling.
  await submit.scrollIntoViewIfNeeded()
  await expect(submit).toBeVisible()
  await expect(submit).toBeEnabled()
})

/* ============================================================
   2. Layout mode (single column vs split screen)
   ============================================================ */
test('layout mode matches viewport width', async ({ page }) => {
  await mockAnonymousMe(page)
  await mockCsrf(page, ['masked-test-token-1', 'masked-test-token-2'])
  await page.goto('/')

  const brand = page.locator('.login-brand')
  const panel = page.locator('.login-panel')
  await expect(brand).toBeVisible()
  await expect(panel).toBeVisible()

  const width = viewportWidth(test.info())
  const brandBox = (await brand.boundingBox())!
  const panelBox = (await panel.boundingBox())!

  if (width < 1024) {
    // Single column: brand sits above the form panel.
    expect(brandBox.y + brandBox.height, 'brand must be above panel').toBeLessThanOrEqual(
      panelBox.y + 1,
    )
  } else {
    // Split screen: brand and panel sit side by side.
    expect(brandBox.x + brandBox.width, 'brand must be left of panel').toBeLessThanOrEqual(
      panelBox.x + 1,
    )
  }
})

/* ============================================================
   3. Touch targets and form usability
   ============================================================ */
test('touch targets and form usability', async ({ page }) => {
  await mockAnonymousMe(page)
  await mockCsrf(page, ['masked-test-token-1', 'masked-test-token-2'])
  await page.goto('/')

  const email = page.getByLabel('E-posta')
  const password = page.getByLabel('Parola')
  const submit = page.getByRole('button', { name: 'Oturum aç' })

  for (const field of [email, password, submit]) {
    const box = (await field.boundingBox())!
    expect(box.height, 'touch target height must be >= 44').toBeGreaterThanOrEqual(44)
    await expect(field).toBeEnabled()
  }

  await expect(email).toBeEditable()
  await expect(password).toBeEditable()

  const width = viewportWidth(test.info())
  if (width <= 390) {
    // On narrow mobile, password and submit must be fully visible and clickable
    // after scrolling into view.
    for (const field of [password, submit]) {
      await field.scrollIntoViewIfNeeded()
      await expect(field).toBeVisible()
      await expect(field).toBeEnabled()
      const box = (await field.boundingBox())!
      expect(box.x, 'field must start within viewport').toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, 'field must end within viewport').toBeLessThanOrEqual(width)
    }
  }
})

/* ============================================================
   4. Logical keyboard order + visible focus
   ============================================================ */
test('logical keyboard order and visible focus', async ({ page }) => {
  await mockAnonymousMe(page)
  await mockCsrf(page, ['masked-test-token-1', 'masked-test-token-2'])
  await page.goto('/')

  const email = page.getByLabel('E-posta')
  const password = page.getByLabel('Parola')
  const submit = page.getByRole('button', { name: 'Oturum aç' })

  // Wait for the login form to render before navigating with the keyboard.
  await expect(email).toBeVisible()

  await page.keyboard.press('Tab')
  await expectVisibleFocus(email)

  await page.keyboard.press('Tab')
  await expectVisibleFocus(password)

  await page.keyboard.press('Tab')
  await expectVisibleFocus(submit)
})

/* ============================================================
   5. Reduced motion
   ============================================================ */
test('reduced motion disables animations and transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockAnonymousMe(page)
  await mockCsrf(page, ['masked-test-token-1', 'masked-test-token-2'])
  await page.goto('/')

  const dot = page.locator('.login-ant-trail__dot').first()
  await expect(dot).toBeVisible()
  const animationName = await dot.evaluate((el) => getComputedStyle(el).animationName)
  expect(animationName, 'ant trail dot animation must be disabled').toBe('none')

  const email = page.getByLabel('E-posta')
  const submit = page.getByRole('button', { name: 'Oturum aç' })
  for (const field of [email, submit]) {
    const transitionDuration = await field.evaluate(
      (el) => getComputedStyle(el).transitionDuration,
    )
    expect(transitionDuration, 'transition duration must be zero').toBe('0s')
  }
})

/* ============================================================
   6. Login error is announced safely
   ============================================================ */
test('login error is announced safely', async ({ page }) => {
  await mockAnonymousMe(page)
  await mockCsrf(page, ['masked-test-token-1', 'masked-test-token-2'])
  await mockLoginFailure(page)
  await page.goto('/')

  const password = 's3cret-password'
  await page.getByLabel('E-posta').fill('member@demo.messor.app')
  await page.getByLabel('Parola').fill(password)
  await page.getByRole('button', { name: 'Oturum aç' }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible()
  await expect(alert).toHaveText('E-posta veya parola hatalı.')

  // Raw password must not leak into DOM text, URL, or storage.
  const bodyText = await page.textContent('body')
  expect(bodyText, 'password must not appear in DOM text').not.toContain(password)
  expect(page.url(), 'password must not appear in URL').not.toContain(password)
  const storage = await page.evaluate(() => ({
    local: { ...window.localStorage },
    session: { ...window.sessionStorage },
  }))
  expect(JSON.stringify(storage), 'password must not appear in storage').not.toContain(password)

  // Form is re-enabled and password input is cleared.
  const submit = page.getByRole('button', { name: 'Oturum aç' })
  await expect(submit).toBeEnabled()
  await expect(page.getByLabel('Parola')).toHaveValue('')
})

/* ============================================================
   7. Successful mocked login flow
   ============================================================ */
test('successful mocked login flow', async ({ page }) => {
  const capture: LoginRequestCapture = { body: null, csrfHeader: null }
  await mockAnonymousMe(page)
  await mockCsrf(page, ['masked-test-token-1', 'masked-test-token-2'])
  await mockLoginSuccess(page, MEMBER_USER, capture)
  await page.goto('/')

  const emailValue = 'member@demo.messor.app'
  const passwordValue = 'correct-password'
  await page.getByLabel('E-posta').fill(emailValue)
  await page.getByLabel('Parola').fill(passwordValue)
  await page.getByRole('button', { name: 'Oturum aç' }).click()

  // Request body carries exact credentials and the dynamic CSRF header.
  await expect
    .poll(() => capture.body !== null, { timeout: 5000 })
    .toBe(true)
  expect(capture.body!.get('email'), 'email must match').toBe(emailValue)
  expect(capture.body!.get('password'), 'password must match').toBe(passwordValue)
  expect(capture.csrfHeader, 'CSRF header must be present').toBe('masked-test-token-1')

  // Authenticated shell appears; login card disappears. A successful login
  // must prove the protected route contract: the router redirects from /login
  // to /projects, the authenticated shell (identity, role, logout) renders,
  // and the login screen is gone.
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: 'Projeler', level: 2 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Görevlerim' })).toBeVisible()
  await expect(page.getByText('Ada Lovelace')).toBeVisible()
  await expect(page.getByText('member@demo.messor.app')).toBeVisible()
  await expect(page.getByText('Üye')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Çıkış yap' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Oturum aç' })).toHaveCount(0)

  await expectNoHorizontalOverflow(page)
})

/* ============================================================
   8. Mobile keyboard-height resilience (mobile-360 only)
   ============================================================ */
test('mobile keyboard-height resilience', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-360', 'keyboard-height test runs on mobile-360 only')

  await mockAnonymousMe(page)
  await mockCsrf(page, ['masked-test-token-1', 'masked-test-token-2'])
  await page.goto('/')

  // Simulate on-screen keyboard shrinking the visible area.
  await page.setViewportSize({ width: 360, height: 500 })

  const password = page.getByLabel('Parola')
  const submit = page.getByRole('button', { name: 'Oturum aç' })

  for (const field of [password, submit]) {
    await field.scrollIntoViewIfNeeded()
    await expect(field).toBeVisible()
    await expect(field).toBeEnabled()
  }

  await expectNoHorizontalOverflow(page)
})

/* ============================================================
   9. Long authenticated email at 320px — reviewer regression
   ============================================================ */
test('long authenticated email does not overflow at 320px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-320', 'long-email test runs on mobile-320 only')

  await mockAuthenticatedMe(page, longEmailUser())
  await page.goto('/')

  // An authenticated principal is redirected to the protected /projects shell;
  // the long user email must render without breaking the 320px layout.
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('heading', { name: 'Projeler', level: 2 })).toBeVisible()

  await expectNoHorizontalOverflow(page)

  const email = page.locator('.app-header__email')
  await expect(email).toBeVisible()
  const emailBox = (await email.boundingBox())!
  expect(emailBox.x, 'email must start within viewport').toBeGreaterThanOrEqual(0)
  expect(emailBox.x + emailBox.width, 'email must end within viewport').toBeLessThanOrEqual(320)
})
