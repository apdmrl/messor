import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const CSRF_COOKIE = 'XSRF-TOKEN'
const CSRF_HEADER = 'X-XSRF-TOKEN'

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
      instance: '/api/projects',
      code,
    },
    status,
  )
}

function fetchMock(): Mock {
  return vi.fn()
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setCsrfCookie(token: string): void {
  document.cookie = `${CSRF_COOKIE}=${token}; Path=/`
}

function clearCsrfCookie(): void {
  document.cookie = `${CSRF_COOKIE}=; Max-Age=0; Path=/`
}

/**
 * Load apiClient in a fresh module-reset cycle so the module-private epoch,
 * listener set, and CSRF cache start clean for every test.
 */
async function loadModules() {
  vi.resetModules()
  return import('./apiClient')
}

describe('apiClient session-expiry lifecycle', () => {
  let fetchSpy: Mock

  beforeEach(() => {
    clearCsrfCookie()
    fetchSpy = fetchMock()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearCsrfCookie()
    const { clearCsrfToken } = await import('./apiClient')
    clearCsrfToken()
  })

  it('A: simultaneous current-epoch expiries notify the listener exactly once', async () => {
    const { apiRequest, subscribeToUnauthenticated, ApiError } = await loadModules()

    const listener = vi.fn()
    const unsubscribe = subscribeToUnauthenticated(listener)

    const first = deferred<Response>()
    const second = deferred<Response>()
    fetchSpy.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    // Both requests start in the same authentication epoch.
    const call1 = apiRequest('/api/projects')
    const call2 = apiRequest('/api/projects')

    // Resolve both with HTTP 401 + code UNAUTHENTICATED.
    first.resolve(problemResponse(401, 'UNAUTHENTICATED', 'session expired'))
    second.resolve(problemResponse(401, 'UNAUTHENTICATED', 'session expired'))

    const err1 = await call1.catch((e: unknown) => e)
    const err2 = await call2.catch((e: unknown) => e)

    // Both calls reject with a typed ApiError.
    expect(err1).toBeInstanceOf(ApiError)
    expect(err2).toBeInstanceOf(ApiError)
    expect(err1).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(err2).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })

    // The listener fires exactly once: the second response is stale.
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('B: a stale 401 from a previous epoch does not clear CSRF or notify listeners', async () => {
    const {
      apiRequest,
      fetchCsrfToken,
      subscribeToUnauthenticated,
      advanceAuthenticationEpoch,
      ApiError,
    } = await loadModules()

    const listener = vi.fn()
    const unsubscribe = subscribeToUnauthenticated(listener)

    const staleRequest = deferred<Response>()
    fetchSpy.mockReturnValueOnce(staleRequest.promise)
    const staleCall = apiRequest('/api/projects')
    await Promise.resolve()

    advanceAuthenticationEpoch()
    setCsrfCookie('token-B')
    const tokenB = await fetchCsrfToken()
    expect(tokenB.token).toBe('token-B')

    staleRequest.resolve(problemResponse(401, 'UNAUTHENTICATED', 'session expired'))
    const err = await staleCall.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(listener).not.toHaveBeenCalled()

    setCsrfCookie('token-C')
    const tokenAgain = await fetchCsrfToken()
    expect(tokenAgain.token).toBe('token-B')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('C: AUTHENTICATION_FAILED is not treated as session expiry', async () => {
    const { apiRequest, fetchCsrfToken, subscribeToUnauthenticated, ApiError } =
      await loadModules()

    const listener = vi.fn()
    const unsubscribe = subscribeToUnauthenticated(listener)

    setCsrfCookie('token-A')
    await fetchCsrfToken()

    fetchSpy.mockResolvedValueOnce(
      problemResponse(401, 'AUTHENTICATION_FAILED', 'Invalid email or password'),
    )
    const err = await apiRequest('/api/auth/login', {
      method: 'POST',
      csrf: true,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, code: 'AUTHENTICATION_FAILED' })
    expect(listener).not.toHaveBeenCalled()

    setCsrfCookie('token-B')
    const token = await fetchCsrfToken()
    expect(token.token).toBe('token-A')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('D: unsubscribing prevents a current-epoch expiry from notifying the listener', async () => {
    const { apiRequest, subscribeToUnauthenticated, ApiError } = await loadModules()

    const listener = vi.fn()
    const unsubscribe = subscribeToUnauthenticated(listener)
    unsubscribe()

    fetchSpy.mockResolvedValueOnce(
      problemResponse(401, 'UNAUTHENTICATED', 'session expired'),
    )
    const err = await apiRequest('/api/projects').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })

    expect(listener).not.toHaveBeenCalled()
  })
  it('bootstraps a missing CSRF cookie through /api/auth/me', async () => {
    const { fetchCsrfToken } = await loadModules()

    fetchSpy.mockImplementationOnce(async () => {
      setCsrfCookie('bootstrapped-token')
      return problemResponse(401, 'UNAUTHENTICATED', 'Not authenticated')
    })

    const token = await fetchCsrfToken()
    expect(token).toEqual({
      headerName: CSRF_HEADER,
      token: 'bootstrapped-token',
    })
    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/me', { credentials: 'include' })
  })

  it('A: a stale INVALID_CSRF_TOKEN response must not retry with the new principal', async () => {
    const {
      apiRequest,
      fetchCsrfToken,
      clearCsrfToken,
      advanceAuthenticationEpoch,
      ApiError,
    } = await loadModules()

    setCsrfCookie('token-A')
    const mutation = deferred<Response>()
    fetchSpy.mockReturnValueOnce(mutation.promise)

    const mutationCall = apiRequest('/api/projects', {
      method: 'POST',
      csrf: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'MES', name: 'Messor' }),
    })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))

    advanceAuthenticationEpoch()
    clearCsrfToken()
    setCsrfCookie('token-B')
    const tokenB = await fetchCsrfToken()
    expect(tokenB.token).toBe('token-B')

    mutation.resolve(
      problemResponse(403, 'INVALID_CSRF_TOKEN', 'Invalid CSRF token'),
    )
    const err = await mutationCall.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 403, code: 'INVALID_CSRF_TOKEN' })

    setCsrfCookie('token-C')
    const tokenAgain = await fetchCsrfToken()
    expect(tokenAgain.token).toBe('token-B')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const mutationCalls = fetchSpy.mock.calls.filter(
      (call) => call[0] === '/api/projects',
    )
    expect(mutationCalls).toHaveLength(1)
    expect(mutationCalls[0][1].headers[CSRF_HEADER]).toBe('token-A')
  })

  it('B: a boundary during CSRF construction must prevent the send', async () => {
    const {
      apiRequest,
      fetchCsrfToken,
      advanceAuthenticationEpoch,
      ApiError,
    } = await loadModules()

    const csrfDeferred = deferred<Response>()
    fetchSpy.mockReturnValueOnce(csrfDeferred.promise)

    const mutationCall = apiRequest('/api/projects', {
      method: 'POST',
      csrf: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'MES', name: 'Messor' }),
    })
    await Promise.resolve()

    advanceAuthenticationEpoch()
    setCsrfCookie('token-A')
    csrfDeferred.resolve(jsonResponse({}))

    const err = await mutationCall.catch((e: unknown) => e)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/auth/me')

    setCsrfCookie('token-B')
    const tokenB = await fetchCsrfToken()
    expect(tokenB.token).toBe('token-B')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, code: 'STALE_AUTHENTICATION_CONTEXT' })
  })

  it('E: a throwing listener does not stop later listeners or replace the typed ApiError', async () => {
    const { apiRequest, subscribeToUnauthenticated, ApiError } = await loadModules()

    const reportError = vi.fn()
    vi.stubGlobal('reportError', reportError)

    const listener1 = vi.fn(() => {
      throw new Error('listener boom')
    })
    const listener2 = vi.fn()
    const unsub1 = subscribeToUnauthenticated(listener1)
    const unsub2 = subscribeToUnauthenticated(listener2)

    fetchSpy.mockResolvedValueOnce(
      problemResponse(401, 'UNAUTHENTICATED', 'session expired'),
    )
    const err = await apiRequest('/api/projects').catch((e: unknown) => e)

    // Listener 2 still runs despite listener 1 throwing.
    expect(listener2).toHaveBeenCalledTimes(1)
    // The request rejects with the original typed UNAUTHENTICATED ApiError.
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    // The listener failure is reported.
    expect(reportError).toHaveBeenCalledTimes(1)

    unsub1()
    unsub2()
  })

  it('F: subscription mutation uses snapshot semantics', async () => {
    const { apiRequest, subscribeToUnauthenticated } = await loadModules()

    let unsub2: (() => void) | undefined
    let unsub3: (() => void) | undefined
    const listener3 = vi.fn()
    const listener1 = vi.fn(() => {
      // During notification, listener1 unsubscribes listener2 and subscribes listener3.
      unsub2?.()
      unsub3 = subscribeToUnauthenticated(listener3)
    })
    const listener2 = vi.fn()
    const unsub1 = subscribeToUnauthenticated(listener1)
    unsub2 = subscribeToUnauthenticated(listener2)

    // First expiry: current notification uses the original snapshot (1 and 2).
    fetchSpy.mockResolvedValueOnce(
      problemResponse(401, 'UNAUTHENTICATED', 'session expired'),
    )
    await apiRequest('/api/projects').catch(() => {})
    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
    expect(listener3).not.toHaveBeenCalled()

    // Second expiry: uses the updated listener set (1 and 3, not 2).
    fetchSpy.mockResolvedValueOnce(
      problemResponse(401, 'UNAUTHENTICATED', 'session expired'),
    )
    await apiRequest('/api/projects').catch(() => {})
    expect(listener1).toHaveBeenCalledTimes(2)
    expect(listener2).toHaveBeenCalledTimes(1)
    expect(listener3).toHaveBeenCalledTimes(1)

    unsub1()
    unsub2?.()
    unsub3?.()
  })
})
