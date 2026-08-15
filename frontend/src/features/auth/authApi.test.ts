import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const CSRF_URL = '/api/auth/csrf'
const LOGIN_URL = '/api/auth/login'
const ME_URL = '/api/auth/me'
const LOGOUT_URL = '/api/auth/logout'

const CSRF_HEADER = 'X-Custom-Csrf-Header'

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

function csrfResponse(token: string): Response {
  return jsonResponse({
    headerName: CSRF_HEADER,
    parameterName: '_csrf',
    token,
  })
}

function fetchMock(): Mock {
  return vi.fn()
}

async function loadAuthApi() {
  vi.resetModules()
  return import('./authApi')
}

describe('authApi', () => {
  let fetchSpy: Mock

  beforeEach(() => {
    fetchSpy = fetchMock()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('login fetches CSRF first, then POSTs login with credentials include', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('pre-login-token'))
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(csrfResponse('rotated-token'))

    const { login } = await loadAuthApi()
    const result = await login('user@example.com', 's3cret')

    expect(result).toEqual(userSummary)

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )

    const loginCall = fetchSpy.mock.calls[1]
    expect(loginCall[0]).toBe(LOGIN_URL)
    const loginInit = loginCall[1]
    expect(loginInit.credentials).toBe('include')
    expect(loginInit.method).toBe('POST')
    expect(loginInit.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      [CSRF_HEADER]: 'pre-login-token',
    })
    expect(loginInit.body).toBeInstanceOf(URLSearchParams)
    const params = loginInit.body as URLSearchParams
    expect(params.get('email')).toBe('user@example.com')
    expect(params.get('password')).toBe('s3cret')
  })

  it('uses the dynamic CSRF headerName from the response, not a hardcoded one', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('pre-login-token'))
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(csrfResponse('rotated-token'))

    const { login } = await loadAuthApi()
    await login('user@example.com', 's3cret')

    const loginInit = fetchSpy.mock.calls[1][1]
    expect(loginInit.headers).not.toHaveProperty('X-CSRF-TOKEN')
    expect(loginInit.headers[CSRF_HEADER]).toBe('pre-login-token')
  })

  it('discards the pre-login token and rotates a new one after successful login', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('pre-login-token'))
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(csrfResponse('rotated-token'))

    const { login } = await loadAuthApi()
    await login('user@example.com', 's3cret')

    // Third call is the CSRF rotation fetch.
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('logout after login uses the rotated token without a third CSRF fetch', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('pre-login-token'))
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(csrfResponse('rotated-token'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { login, logout } = await loadAuthApi()
    await login('user@example.com', 's3cret')
    await logout()

    // Calls: csrf, login, csrf-rotate, logout. No extra CSRF fetch.
    expect(fetchSpy).toHaveBeenCalledTimes(4)
    const logoutCall = fetchSpy.mock.calls[3]
    expect(logoutCall[0]).toBe(LOGOUT_URL)
    expect(logoutCall[1].method).toBe('POST')
    expect(logoutCall[1].headers[CSRF_HEADER]).toBe('rotated-token')
  })

  it('logout with empty cache fetches CSRF first, then POSTs', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('fresh-token'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { logout } = await loadAuthApi()
    await logout()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
    const logoutCall = fetchSpy.mock.calls[1]
    expect(logoutCall[0]).toBe(LOGOUT_URL)
    expect(logoutCall[1].headers[CSRF_HEADER]).toBe('fresh-token')
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

  it('getCurrentUser returns null and clears the token cache on 401 UNAUTHENTICATED', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('cached-token'))
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(csrfResponse('rotated-token'))
      .mockResolvedValueOnce(problemResponse(401, 'UNAUTHENTICATED', 'Not authenticated'))

    const { login, getCurrentUser } = await loadAuthApi()
    await login('user@example.com', 's3cret')

    const result = await getCurrentUser()
    expect(result).toBeNull()

    // After cache clear, a subsequent state-changing call must fetch a new token.
    fetchSpy.mockResolvedValueOnce(csrfResponse('new-token'))
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const { logout } = await loadAuthApi()
    await logout()
    expect(fetchSpy).toHaveBeenCalledWith(
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('login 401 Problem Details throws AuthApiError with status, code and safe detail', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('pre-login-token'))
      .mockResolvedValueOnce(
        problemResponse(401, 'AUTHENTICATION_FAILED', 'Invalid email or password'),
      )

    const { login, AuthApiError } = await loadAuthApi()
    const error = await login('user@example.com', 'wrong').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AuthApiError)
    expect(error).toMatchObject({
      status: 401,
      code: 'AUTHENTICATION_FAILED',
      message: 'Invalid email or password',
    })
  })

  it('clears the cached token on INVALID_CSRF_TOKEN and fetches a new one next time', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('pre-login-token'))
      .mockResolvedValueOnce(problemResponse(403, 'INVALID_CSRF_TOKEN', 'Invalid CSRF token'))

    const { login } = await loadAuthApi()
    await expect(login('user@example.com', 's3cret')).rejects.toMatchObject({
      code: 'INVALID_CSRF_TOKEN',
    })

    // Next state-changing call must fetch a fresh CSRF token.
    fetchSpy.mockResolvedValueOnce(csrfResponse('fresh-token'))
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const { logout } = await loadAuthApi()
    await logout()
    expect(fetchSpy).toHaveBeenCalledWith(
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('logout on 204 does not parse a body, resolves void and clears the token', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('cached-token'))
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(csrfResponse('rotated-token'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { login, logout } = await loadAuthApi()
    await login('user@example.com', 's3cret')
    await expect(logout()).resolves.toBeUndefined()

    // After logout the cache is cleared; next call fetches a new token.
    fetchSpy.mockResolvedValueOnce(csrfResponse('new-token'))
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const { logout: logoutAgain } = await loadAuthApi()
    await logoutAgain()
    expect(fetchSpy).toHaveBeenCalledWith(
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('malformed non-Problem error body produces a safe fallback AuthApiError', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('pre-login-token'))
      .mockResolvedValueOnce(
        new Response('<html>oops</html>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        }),
      )

    const { login, AuthApiError } = await loadAuthApi()
    const error = await login('user@example.com', 's3cret').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AuthApiError)
    expect(error).toMatchObject({
      status: 500,
      code: 'HTTP_ERROR',
      message: 'İstek tamamlanamadı.',
    })
  })

  it('login/getCurrentUser/logout never call localStorage or sessionStorage setItem', async () => {
    const localStorageSet = vi.spyOn(Storage.prototype, 'setItem')
    const sessionStorageSet = vi.spyOn(Storage.prototype, 'setItem')

    fetchSpy
      .mockResolvedValueOnce(csrfResponse('pre-login-token'))
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(csrfResponse('rotated-token'))
      .mockResolvedValueOnce(jsonResponse(userSummary))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { login, getCurrentUser, logout } = await loadAuthApi()
    await login('user@example.com', 's3cret')
    await getCurrentUser()
    await logout()

    expect(localStorageSet).not.toHaveBeenCalled()
    expect(sessionStorageSet).not.toHaveBeenCalled()
  })
})
