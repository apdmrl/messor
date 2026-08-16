import type { CsrfTokenResponse, ProblemDetails } from '../features/auth/types'

const CSRF_URL = '/api/auth/csrf'

const GENERIC_ERROR_CODE = 'HTTP_ERROR'
const GENERIC_ERROR_DETAIL = 'İstek tamamlanamadı.'

/**
 * Module-private CSRF token cache shared by every API client (auth and
 * project mutations). Never persisted to storage or DOM.
 */
let csrfToken: CsrfTokenResponse | null = null

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

function isCsrfTokenResponse(value: unknown): value is CsrfTokenResponse {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.headerName === 'string' &&
    typeof candidate.parameterName === 'string' &&
    typeof candidate.token === 'string'
  )
}

/** Discard the cached CSRF token (e.g. after login, logout, or an invalid token). */
export function clearCsrfToken(): void {
  csrfToken = null
}

/**
 * Return the cached CSRF token, fetching a fresh one from the server when the
 * cache is empty. The token is held only in memory.
 */
export async function fetchCsrfToken(): Promise<CsrfTokenResponse> {
  if (csrfToken) {
    return csrfToken
  }

  const response = await fetch(CSRF_URL, { credentials: 'include' })
  if (!response.ok) {
    throw await parseProblem(response)
  }

  const body: unknown = await safeJson(response)
  if (!isCsrfTokenResponse(body)) {
    throw new ApiError(response.status, GENERIC_ERROR_CODE, GENERIC_ERROR_DETAIL)
  }

  csrfToken = body
  return body
}

function csrfHeaders(token: CsrfTokenResponse): Record<string, string> {
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

export interface ApiRequestOptions {
  method?: string
  body?: BodyInit | null
  headers?: Record<string, string>
  /** Send the in-memory CSRF token header (required for state-changing calls). */
  csrf?: boolean
  /**
   * When true, an INVALID_CSRF_TOKEN response clears the cached token, fetches
   * a fresh one, and retries the request exactly once. Defaults to true.
   */
  retryOnInvalidCsrf?: boolean
}

/**
 * Shared API request helper.
 *
 * - Always sends `credentials: 'include'`.
 * - For mutations (`csrf: true`) attaches the in-memory CSRF token.
 * - Converts RFC 9457 Problem Details responses into a safe typed `ApiError`.
 * - On INVALID_CSRF_TOKEN clears the token and retries once after re-fetching.
 * - Never retries more than once.
 * - Malformed/empty error bodies produce a fixed fallback that leaks no
 *   internal content.
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

  let response = await fetch(url, await buildInit())

  if (!response.ok) {
    const error = await parseProblem(response)
    if (error.code === 'INVALID_CSRF_TOKEN') {
      clearCsrfToken()
      if (csrf && retryOnInvalidCsrf) {
        response = await fetch(url, await buildInit())
        if (!response.ok) {
          throw await parseProblem(response)
        }
      } else {
        throw error
      }
    } else {
      throw error
    }
  }

  if (response.status === 204) {
    return undefined as T
  }

  const parsed: unknown = await safeJson(response)
  return parsed as T
}
