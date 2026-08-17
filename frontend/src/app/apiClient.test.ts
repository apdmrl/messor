import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const CSRF_HEADER = 'X-Custom-Csrf-Header'

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
    fetchSpy = fetchMock()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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

    // Start a deferred request in epoch A.
    const staleRequest = deferred<Response>()
    fetchSpy.mockReturnValueOnce(staleRequest.promise)
    const staleCall = apiRequest('/api/projects')
    // Yield to the microtask queue so apiRequest's async buildInit completes and
    // the actual fetch (the stale request) is issued before we proceed.
    await Promise.resolve()

    // Advance the authentication epoch to represent switching to principal B.
    advanceAuthenticationEpoch()

    // Fetch/cache a CSRF token for epoch B.
    fetchSpy.mockResolvedValueOnce(csrfResponse('token-B'))
    const tokenB = await fetchCsrfToken()
    expect(tokenB.token).toBe('token-B')

    // Resolve the old epoch-A request with 401 UNAUTHENTICATED.
    staleRequest.resolve(problemResponse(401, 'UNAUTHENTICATED', 'session expired'))
    const err = await staleCall.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })

    // The unauthorized listener must not fire for a stale response.
    expect(listener).not.toHaveBeenCalled()

    // fetchCsrfToken again must reuse B's cached token; the stale response must
    // not have cleared it, so no new network fetch occurs.
    fetchSpy.mockResolvedValueOnce(csrfResponse('token-C'))
    const tokenAgain = await fetchCsrfToken()
    expect(tokenAgain.token).toBe('token-B')
    // Calls so far: stale request + one CSRF fetch for B. No further fetch.
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    unsubscribe()
  })

  it('C: AUTHENTICATION_FAILED is not treated as session expiry', async () => {
    const { apiRequest, fetchCsrfToken, subscribeToUnauthenticated, ApiError } =
      await loadModules()

    const listener = vi.fn()
    const unsubscribe = subscribeToUnauthenticated(listener)

    // Cache a CSRF token.
    fetchSpy.mockResolvedValueOnce(csrfResponse('token-A'))
    await fetchCsrfToken()

    // Return HTTP 401 + code AUTHENTICATION_FAILED from a request.
    fetchSpy.mockResolvedValueOnce(
      problemResponse(401, 'AUTHENTICATION_FAILED', 'Invalid email or password'),
    )
    const err = await apiRequest('/api/auth/login', {
      method: 'POST',
      csrf: true,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, code: 'AUTHENTICATION_FAILED' })

    // The unauthorized listener must not fire.
    expect(listener).not.toHaveBeenCalled()

    // The cached CSRF token must remain reusable (no new fetch).
    fetchSpy.mockResolvedValueOnce(csrfResponse('token-B'))
    const token = await fetchCsrfToken()
    expect(token.token).toBe('token-A')
    // Calls so far: one CSRF fetch (cache) + one login request. No further fetch.
    expect(fetchSpy).toHaveBeenCalledTimes(2)

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

  it('A: a stale INVALID_CSRF_TOKEN response must not retry with the new principal', async () => {
    const {
      apiRequest,
      fetchCsrfToken,
      clearCsrfToken,
      advanceAuthenticationEpoch,
      ApiError,
    } = await loadModules()

    // 1. Epoch A mutation obtains token A.
    fetchSpy.mockResolvedValueOnce(csrfResponse('token-A'))
    // 2. Its mutation request is sent and its response is deferred.
    const mutation = deferred<Response>()
    fetchSpy.mockReturnValueOnce(mutation.promise)

    const mutationCall = apiRequest('/api/projects', {
      method: 'POST',
      csrf: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'MES', name: 'Messor' }),
    })
    // Wait until the mutation fetch (call 2) is actually issued so the epoch-A
    // request is in flight before we advance to principal B.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))

    // 3. Advance authentication epoch to principal B.
    advanceAuthenticationEpoch()
    // 4. Clear the old cache and obtain/cache token B (login rotation boundary).
    clearCsrfToken()
    fetchSpy.mockResolvedValueOnce(csrfResponse('token-B'))
    const tokenB = await fetchCsrfToken()
    expect(tokenB.token).toBe('token-B')

    // 5. Resolve A's deferred response with INVALID_CSRF_TOKEN.
    mutation.resolve(
      problemResponse(403, 'INVALID_CSRF_TOKEN', 'Invalid CSRF token'),
    )
    const err = await mutationCall.catch((e: unknown) => e)

    // A's request rejects with its typed INVALID_CSRF_TOKEN ApiError.
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 403, code: 'INVALID_CSRF_TOKEN' })

    // Token B remains cached: no new CSRF fetch occurs.
    fetchSpy.mockResolvedValueOnce(csrfResponse('token-C'))
    const tokenAgain = await fetchCsrfToken()
    expect(tokenAgain.token).toBe('token-B')

    // Calls so far: csrf-A, mutation, csrf-B. No retry, no extra CSRF fetch.
    expect(fetchSpy).toHaveBeenCalledTimes(3)

    // A's mutation URL/body is not retried and no request uses token B for it.
    const mutationCalls = fetchSpy.mock.calls.filter(
      (call) => call[0] === '/api/projects',
    )
    expect(mutationCalls).toHaveLength(1)
    expect(mutationCalls[0][1].headers['X-Custom-Csrf-Header']).toBe('token-A')
  })

  it('B: a boundary during CSRF construction must prevent the send', async () => {
    const {
      apiRequest,
      fetchCsrfToken,
      advanceAuthenticationEpoch,
      ApiError,
    } = await loadModules()

    // 1-2. Start epoch-A mutation with an empty CSRF cache; defer its CSRF fetch.
    const csrfDeferred = deferred<Response>()
    fetchSpy.mockReturnValueOnce(csrfDeferred.promise)

    const mutationCall = apiRequest('/api/projects', {
      method: 'POST',
      csrf: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'MES', name: 'Messor' }),
    })
    // Yield so buildInit starts awaiting the CSRF token.
    await Promise.resolve()

    // 3. Advance to epoch B while buildInit is awaiting the token.
    advanceAuthenticationEpoch()

    // 4. Resolve the old token response.
    csrfDeferred.resolve(csrfResponse('token-A'))

    const err = await mutationCall.catch((e: unknown) => e)

    // The mutation endpoint is never called (only the CSRF fetch happened).
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/auth/csrf')

    // The stale token is not cached; a later B token request still goes to CSRF.
    fetchSpy.mockResolvedValueOnce(csrfResponse('token-B'))
    const tokenB = await fetchCsrfToken()
    expect(tokenB.token).toBe('token-B')
    expect(fetchSpy.mock.calls[1][0]).toBe('/api/auth/csrf')

    // The stale operation rejects with a safe typed client error.
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
