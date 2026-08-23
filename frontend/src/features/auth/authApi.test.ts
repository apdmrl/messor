import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const LOGIN_URL = '/api/auth/login'
const ME_URL = '/api/auth/me'
const LOGOUT_URL = '/api/auth/logout'
const CSRF_COOKIE = 'XSRF-TOKEN'
const CSRF_HEADER = 'X-XSRF-TOKEN'

const userSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'USER',
} as const

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function problemResponse(status: number, code: string, detail: string): Response {
  return jsonResponse(
    {
      type: 'about:blank',
      title: 'Error',
      status,
      detail,
      instance: '/api/auth/login',
      code,
    },
    status,
  )
}

function malformedJsonResponse(status = 200): Response {
  return new Response('{not valid json', {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setCsrfCookie(token: string): void {
  document.cookie = `${CSRF_COOKIE}=${token}; Path=/`
}

function clearCsrfCookie(): void {
  document.cookie = `${CSRF_COOKIE}=; Max-Age=0; Path=/`
}

async function loadAuthApi() {
  vi.resetModules()
  return import('./authApi')
}

describe('authApi', () => {
  let fetchSpy: Mock

  beforeEach(() => {
    clearCsrfCookie()
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    clearCsrfCookie()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('login echoes the XSRF-TOKEN cookie and submits exact credentials', async () => {
    setCsrfCookie('pre-login-token')
    fetchSpy.mockResolvedValueOnce(jsonResponse(userSummary))

    const { login } = await loadAuthApi()
    const result = await login('user@example.com', 's3cret')

    expect(result).toEqual(userSummary)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(LOGIN_URL)
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      [CSRF_HEADER]: 'pre-login-token',
    })
    expect(init.body).toBeInstanceOf(URLSearchParams)
    expect((init.body as URLSearchParams).get('email')).toBe('user@example.com')
    expect((init.body as URLSearchParams).get('password')).toBe('s3cret')
  })

  it('bootstraps the rotated cookie after login and uses it for logout', async () => {
    setCsrfCookie('pre-login-token')
    fetchSpy
      .mockImplementationOnce(async () => {
        clearCsrfCookie()
        return jsonResponse(userSummary)
      })
      .mockImplementationOnce(async () => {
        setCsrfCookie('rotated-token')
        return jsonResponse(userSummary)
      })
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { login, logout } = await loadAuthApi()
    await login('user@example.com', 's3cret')
    await logout()

    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy.mock.calls[1]).toEqual([
      ME_URL,
      { credentials: 'include' },
    ])
    const [logoutUrl, logoutInit] = fetchSpy.mock.calls[2]
    expect(logoutUrl).toBe(LOGOUT_URL)
    expect(logoutInit.headers[CSRF_HEADER]).toBe('rotated-token')
  })

  it('logout bootstraps a missing CSRF cookie before POSTing', async () => {
    fetchSpy
      .mockImplementationOnce(async () => {
        setCsrfCookie('fresh-token')
        return jsonResponse(userSummary)
      })
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { logout } = await loadAuthApi()
    await logout()

    expect(fetchSpy.mock.calls[0]).toEqual([
      ME_URL,
      { credentials: 'include' },
    ])
    const [url, init] = fetchSpy.mock.calls[1]
    expect(url).toBe(LOGOUT_URL)
    expect(init.headers[CSRF_HEADER]).toBe('fresh-token')
  })

  it('getCurrentUser returns the exact UserSummary on 200', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(userSummary))

    const { getCurrentUser } = await loadAuthApi()
    const result = await getCurrentUser()

    expect(result).toEqual(userSummary)
    expect(fetchSpy).toHaveBeenCalledWith(
      ME_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('getCurrentUser returns null and clears the cached cookie snapshot on 401', async () => {
    setCsrfCookie('token-A')
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(problemResponse(401, 'UNAUTHENTICATED', 'Not authenticated'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { login, getCurrentUser, logout } = await loadAuthApi()
    await login('user@example.com', 's3cret')
    setCsrfCookie('token-B')

    expect(await getCurrentUser()).toBeNull()
    await logout()

    const [, logoutInit] = fetchSpy.mock.calls[2]
    expect(logoutInit.headers[CSRF_HEADER]).toBe('token-B')
  })

  it('login 401 Problem Details throws AuthApiError with safe fields', async () => {
    setCsrfCookie('token')
    fetchSpy.mockResolvedValueOnce(
      problemResponse(401, 'AUTHENTICATION_FAILED', 'Invalid email or password'),
    )

    const { login, AuthApiError } = await loadAuthApi()
    const error = await login('user@example.com', 'wrong').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(AuthApiError)
    expect(error).toMatchObject({
      status: 401,
      code: 'AUTHENTICATION_FAILED',
      message: 'Invalid email or password',
    })
  })

  it('login does not retry INVALID_CSRF_TOKEN automatically', async () => {
    setCsrfCookie('stale-token')
    fetchSpy.mockResolvedValueOnce(
      problemResponse(403, 'INVALID_CSRF_TOKEN', 'Invalid CSRF token'),
    )

    const { login } = await loadAuthApi()
    await expect(login('user@example.com', 's3cret')).rejects.toMatchObject({
      status: 403,
      code: 'INVALID_CSRF_TOKEN',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('logout on 204 resolves without parsing a body', async () => {
    setCsrfCookie('token')
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { logout } = await loadAuthApi()
    await expect(logout()).resolves.toBeUndefined()
  })

  it('malformed non-Problem error body produces a safe fallback error', async () => {
    setCsrfCookie('token')
    fetchSpy.mockResolvedValueOnce(
      new Response('<html>oops</html>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const { login, AuthApiError } = await loadAuthApi()
    const error = await login('user@example.com', 's3cret').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(AuthApiError)
    expect(error).toMatchObject({
      status: 500,
      code: 'HTTP_ERROR',
      message: 'İstek tamamlanamadı.',
    })
  })

  it('POST /login 200 with malformed JSON rejects safely', async () => {
    setCsrfCookie('token')
    fetchSpy.mockResolvedValueOnce(malformedJsonResponse())

    const { login, AuthApiError } = await loadAuthApi()
    const error = await login('user@example.com', 's3cret').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(AuthApiError)
    expect(error).toMatchObject({
      status: 200,
      code: 'HTTP_ERROR',
      message: 'İstek tamamlanamadı.',
    })
    expect(error).not.toBeInstanceOf(SyntaxError)
  })

  it('GET /me 200 with malformed JSON rejects safely', async () => {
    fetchSpy.mockResolvedValueOnce(malformedJsonResponse())

    const { getCurrentUser, AuthApiError } = await loadAuthApi()
    const error = await getCurrentUser().catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(AuthApiError)
    expect(error).toMatchObject({
      status: 200,
      code: 'HTTP_ERROR',
      message: 'İstek tamamlanamadı.',
    })
    expect(error).not.toBeInstanceOf(SyntaxError)
  })

  it('auth operations never write credentials or tokens to web storage', async () => {
    const storageSet = vi.spyOn(Storage.prototype, 'setItem')
    setCsrfCookie('token')
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { login, getCurrentUser, logout } = await loadAuthApi()
    await login('user@example.com', 's3cret')
    await getCurrentUser()
    await logout()

    expect(storageSet).not.toHaveBeenCalled()
  })
})
