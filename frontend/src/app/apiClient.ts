import type { ProblemDetails } from '../features/auth/types'

const CSRF_BOOTSTRAP_URL = '/api/auth/me'
const CSRF_COOKIE = 'XSRF-TOKEN'
const CSRF_HEADER = 'X-XSRF-TOKEN'

interface CsrfToken {
  headerName: string
  token: string
}
const GENERIC_ERROR_CODE = 'HTTP_ERROR'
const GENERIC_ERROR_DETAIL = 'İstek tamamlanamadı.'

/**
 * Client-owned code for a request that was aborted before receiving an HTTP
 * response because its captured authentication epoch became stale while the
 * request was being constructed or after it was issued. The detail is a fixed,
 * generic, user-safe string; it never carries backend response content.
 */
const STALE_AUTHENTICATION_CONTEXT = 'STALE_AUTHENTICATION_CONTEXT'

/**
 * Module-private snapshot of the browser-managed CSRF cookie, shared by every
 * API client. It is cleared at authentication boundaries and on invalid-token
 * responses; the next mutation re-reads the current cookie value.
 */
let csrfToken: CsrfToken | null = null

/**
 * Module-private authentication epoch. Every request captures the current epoch
 * when it starts; a response is only treated as a *current* session expiry when
 * its captured epoch still equals the current epoch. Advancing the epoch on a
 * confirmed expiry makes any other in-flight response from the expired epoch
 * stale, so a burst of simultaneous 401s notifies listeners exactly once.
 */
let authenticationEpoch = 0

/**
 * Module-private set of listeners notified when a current-session expiry is
 * confirmed. Never exposed directly; callers subscribe via
 * {@link subscribeToUnauthenticated}.
 */
const unauthorizedListeners = new Set<() => void>()

/**
 * Advance the authentication epoch. Called at successful principal boundaries
 * (accepting an authenticated bootstrap user, a successful login, or a
 * successful logout) so that any in-flight request from the previous principal
 * can no longer be mistaken for a current-session expiry.
 */
export function advanceAuthenticationEpoch(): void {
  authenticationEpoch += 1
}

/**
 * Subscribe to current-session expiry notifications. Returns an unsubscribe
 * cleanup function. The listener is invoked synchronously when a confirmed
 * current-session expiry is detected; apiClient has already advanced the epoch
 * and cleared the CSRF cache before notifying.
 */
export function subscribeToUnauthenticated(listener: () => void): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

/**
 * Typed error produced from an RFC 9457 Problem Details response. `detail` is
 * safe for user-facing rendering; `code` is used for programmatic control.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.detail === 'string' &&
    typeof candidate.status === 'number'
  )
}


/** Discard the cached CSRF token (e.g. after login, logout, or an invalid token). */
export function clearCsrfToken(): void {
  csrfToken = null
}

/**
 * A response is a confirmed current-session expiry only when all of these hold:
 * the actual HTTP status is 401, the parsed ApiError status is 401, the parsed
 * code is UNAUTHENTICATED, and the request's captured epoch still equals the
 * current authentication epoch.
 */
function isConfirmedExpiry(
  response: Response,
  error: ApiError,
  capturedEpoch: number,
): boolean {
  return (
    response.status === 401 &&
    error.status === 401 &&
    error.code === 'UNAUTHENTICATED' &&
    capturedEpoch === authenticationEpoch
  )
}

/**
 * Report a listener failure without letting it escape into the request path.
 * Uses `globalThis.reportError` when available; otherwise schedules an
 * asynchronous throw so the failure is still surfaced and never silently
 * swallowed. No credentials, tokens, backend details, or listener error
 * contents are written to a log.
 */
function reportListenerError(error: unknown): void {
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(error)
  } else {
    queueMicrotask(() => {
      throw error
    })
  }
}

/**
 * Handle a confirmed current-session expiry synchronously: clear the in-memory
 * CSRF token, advance the authentication epoch, then notify the current
 * listener snapshot. Advancing before notification guarantees a second
 * simultaneous response from the expired epoch is stale and that listener
 * notification is idempotent. Each listener is attempted independently so a
 * throwing listener cannot stop later listeners or replace the request's typed
 * ApiError.
 */
function handleConfirmedExpiry(): void {
  csrfToken = null
  authenticationEpoch += 1
  const snapshot = Array.from(unauthorizedListeners)
  for (const listener of snapshot) {
    try {
      listener()
    } catch (error) {
      reportListenerError(error)
    }
  }
}

/**
 * Centralized handling for any non-OK response. Parses the RFC 9457 body and,
 * when the response is a confirmed current-session expiry, performs the global
 * expiry side effects before returning the typed ApiError. Every non-OK path
 * (ordinary responses, INVALID_CSRF_TOKEN retries, and CSRF fetches) routes
 * through here so retry paths cannot bypass expiry handling.
 */
async function handleNonOkResponse(
  response: Response,
  capturedEpoch: number,
): Promise<ApiError> {
  const error = await parseProblem(response)
  if (isConfirmedExpiry(response, error, capturedEpoch)) {
    handleConfirmedExpiry()
  }
  return error
}

/**
 * Read the CSRF token from the non-HttpOnly cookie managed by Spring Security.
 * When the cookie is absent (initial load or a login/logout rotation), a GET to
 * `/api/auth/me` forces the CSRF filter to issue a fresh cookie. The response
 * status is intentionally ignored: anonymous 401 and authenticated 200 both
 * carry the cookie.
 *
 * The token is cached only while the captured authentication epoch remains
 * current, preventing an old principal's bootstrap from repopulating the new
 * principal's cache.
 */
function readCsrfTokenCookie(): string | null {
  if (typeof document === 'undefined') {
    return null
  }
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`))
  return entry ? entry.slice(CSRF_COOKIE.length + 1) : null
}

export async function fetchCsrfToken(): Promise<CsrfToken> {
  if (csrfToken) {
    return csrfToken
  }

  const capturedEpoch = authenticationEpoch
  let token = readCsrfTokenCookie()
  if (token === null) {
    await fetch(CSRF_BOOTSTRAP_URL, { credentials: 'include' })
    assertCurrentEpoch(capturedEpoch)
    token = readCsrfTokenCookie()
  }

  if (token === null) {
    throw new ApiError(0, GENERIC_ERROR_CODE, GENERIC_ERROR_DETAIL)
  }

  const currentToken = { headerName: CSRF_HEADER, token }
  if (capturedEpoch === authenticationEpoch) {
    csrfToken = currentToken
  }
  return currentToken
}

function csrfHeaders(token: CsrfToken): Record<string, string> {
  return { [token.headerName]: token.token }
}

/**
 * Safely parse a JSON response body. Any parse failure (malformed JSON, empty
 * body, network-level body read error) yields `null` instead of leaking a raw
 * parser exception to callers.
 */
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function parseProblem(response: Response): Promise<ApiError> {
  const body: unknown = await safeJson(response)
  if (isProblemDetails(body)) {
    return new ApiError(body.status, body.code, body.detail)
  }

  return new ApiError(response.status, GENERIC_ERROR_CODE, GENERIC_ERROR_DETAIL)
}

/**
 * A safe, fixed typed error for a request aborted because its captured
 * authentication epoch became stale before an HTTP response was received.
 */
function staleAuthenticationError(): ApiError {
  return new ApiError(0, STALE_AUTHENTICATION_CONTEXT, GENERIC_ERROR_DETAIL)
}

/**
 * Throw the stale-context error when the captured epoch no longer matches the
 * current authentication epoch. Used immediately before issuing a fetch so a
 * request constructed under an old principal is never sent with a new
 * principal's credentials.
 */
function assertCurrentEpoch(capturedEpoch: number): void {
  if (capturedEpoch !== authenticationEpoch) {
    throw staleAuthenticationError()
  }
}

export interface ApiRequestOptions {
  method?: string
  body?: BodyInit | null
  headers?: Record<string, string>
  /** Send the browser-managed CSRF cookie value as the echo header. */
  csrf?: boolean
  /**
   * When true, an INVALID_CSRF_TOKEN response clears the cached cookie snapshot,
   * re-reads the current browser cookie, and retries exactly once. Defaults to
   * true.
   */
  retryOnInvalidCsrf?: boolean
}

/**
 * Shared API request helper.
 *
 * - Always sends `credentials: 'include'`.
 * - For mutations (`csrf: true`) attaches `X-XSRF-TOKEN` from the cookie.
 * - Converts RFC 9457 Problem Details responses into a safe typed `ApiError`.
 * - On INVALID_CSRF_TOKEN clears the cached snapshot and retries once.
 * - Never retries more than once.
 * - Malformed/empty error bodies produce a fixed fallback that leaks no
 *   internal content.
 * - Captures the authentication epoch at start; a confirmed current-session
 *   expiry (401 UNAUTHENTICATED in the current epoch) clears the CSRF cache,
 *   advances the epoch, and notifies subscribers exactly once.
 * - Guards every fetch with the captured epoch: a request whose epoch became
 *   stale while its CSRF token was being constructed is aborted before sending
 *   (STALE_AUTHENTICATION_CONTEXT), a stale INVALID_CSRF_TOKEN response never
 *   clears the new principal's token or retries the old mutation, and a stale
 *   2xx response is never exposed to stale UI callbacks.
 */
export async function apiRequest<T>(
  url: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    body = null,
    headers = {},
    csrf = false,
    retryOnInvalidCsrf = true,
  } = options

  const capturedEpoch = authenticationEpoch

  const buildInit = async (): Promise<RequestInit> => {
    const init: RequestInit = {
      method,
      credentials: 'include',
      headers: { ...headers },
      body,
    }
    if (csrf) {
      const token = await fetchCsrfToken()
      init.headers = { ...(init.headers as Record<string, string>), ...csrfHeaders(token) }
    }
    return init
  }

  /**
   * Build the request init and, immediately before issuing the fetch, verify
   * the captured epoch is still current. If it became stale while the init was
   * being constructed (e.g. awaiting a CSRF token), abort without sending.
   */
  const send = async (): Promise<Response> => {
    const init = await buildInit()
    assertCurrentEpoch(capturedEpoch)
    return fetch(url, init)
  }

  let response = await send()

  if (!response.ok) {
    const error = await handleNonOkResponse(response, capturedEpoch)
    if (error.code === 'INVALID_CSRF_TOKEN') {
      // A stale INVALID_CSRF_TOKEN response must not clear the new principal's
      // token or retry the old mutation with the new principal's credentials.
      if (capturedEpoch !== authenticationEpoch) {
        throw error
      }
      clearCsrfToken()
      if (csrf && retryOnInvalidCsrf) {
        // If the epoch changes while obtaining the retry token, the pre-fetch
        // guard inside send() aborts the retry.
        response = await send()
        if (!response.ok) {
          throw await handleNonOkResponse(response, capturedEpoch)
        }
      } else {
        throw error
      }
    } else {
      throw error
    }
  }

  // A successful response from a stale epoch must not be exposed to stale UI
  // callbacks; reject before parsing/returning the success body.
  if (capturedEpoch !== authenticationEpoch) {
    throw staleAuthenticationError()
  }

  if (response.status === 204) {
    return undefined as T
  }

  const parsed: unknown = await safeJson(response)
  return parsed as T
}
