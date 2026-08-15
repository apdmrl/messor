import type { CsrfTokenResponse, ProblemDetails, UserSummary } from './types'

const CSRF_URL = '/api/auth/csrf'
const LOGIN_URL = '/api/auth/login'
const ME_URL = '/api/auth/me'
const LOGOUT_URL = '/api/auth/logout'

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded;charset=UTF-8'

const GENERIC_ERROR_CODE = 'HTTP_ERROR'
const GENERIC_ERROR_DETAIL = 'İstek tamamlanamadı.'

/** Module-private CSRF token cache. Never persisted to storage or DOM. */
let csrfToken: CsrfTokenResponse | null = null

export class AuthApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, detail: string) {
    super(detail)
    this.name = 'AuthApiError'
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

function isUserSummary(value: unknown): value is UserSummary {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.firstName === 'string' &&
    typeof candidate.lastName === 'string' &&
    (candidate.role === 'ORG_ADMIN' || candidate.role === 'USER')
  )
}

function clearCsrfToken(): void {
  csrfToken = null
}

/**
 * Safely parse a JSON response body. Any parse failure (malformed JSON, empty
 * body, network-level body read error) yields `null` instead of leaking a raw
 * parser exception to callers. Callers are responsible for turning a `null`
 * result into a safe AuthApiError.
 */
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function parseProblem(response: Response): Promise<AuthApiError> {
  const body: unknown = await safeJson(response)
  if (isProblemDetails(body)) {
    return new AuthApiError(body.status, body.code, body.detail)
  }

  return new AuthApiError(response.status, GENERIC_ERROR_CODE, GENERIC_ERROR_DETAIL)
}

async function fetchCsrfToken(): Promise<CsrfTokenResponse> {
  if (csrfToken) {
    return csrfToken
  }

  const response = await fetch(CSRF_URL, { credentials: 'include' })
  if (!response.ok) {
    throw await parseProblem(response)
  }

  const body: unknown = await safeJson(response)
  if (!isCsrfTokenResponse(body)) {
    throw new AuthApiError(response.status, GENERIC_ERROR_CODE, GENERIC_ERROR_DETAIL)
  }

  csrfToken = body
  return body
}

function csrfHeaders(token: CsrfTokenResponse): Record<string, string> {
  return { [token.headerName]: token.token }
}

export async function login(email: string, password: string): Promise<UserSummary> {
  const token = await fetchCsrfToken()

  const body = new URLSearchParams()
  body.set('email', email)
  body.set('password', password)

  const response = await fetch(LOGIN_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': FORM_CONTENT_TYPE,
      ...csrfHeaders(token),
    },
    body,
  })

  if (!response.ok) {
    const error = await parseProblem(response)
    if (error.code === 'INVALID_CSRF_TOKEN' || error.code === 'UNAUTHENTICATED') {
      clearCsrfToken()
    }
    throw error
  }

  // A 2xx login means server-side authentication may have occurred, so the
  // pre-login CSRF token is no longer trustworthy. Discard it before parsing
  // the body so a malformed/invalid UserSummary still leaves the cache cleared.
  clearCsrfToken()

  const user: unknown = await safeJson(response)
  if (!isUserSummary(user)) {
    throw new AuthApiError(response.status, GENERIC_ERROR_CODE, GENERIC_ERROR_DETAIL)
  }

  // Rotate a fresh token for subsequent requests.
  await fetchCsrfToken()

  return user
}

export async function getCurrentUser(): Promise<UserSummary | null> {
  const response = await fetch(ME_URL, { credentials: 'include' })

  if (response.status === 401) {
    const error = await parseProblem(response)
    if (error.code === 'UNAUTHENTICATED') {
      clearCsrfToken()
      return null
    }
    throw error
  }

  if (!response.ok) {
    throw await parseProblem(response)
  }

  const user: unknown = await safeJson(response)
  if (!isUserSummary(user)) {
    throw new AuthApiError(response.status, GENERIC_ERROR_CODE, GENERIC_ERROR_DETAIL)
  }

  return user
}

export async function logout(): Promise<void> {
  const token = await fetchCsrfToken()

  const response = await fetch(LOGOUT_URL, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders(token),
  })

  if (response.status === 204) {
    clearCsrfToken()
    return
  }

  const error = await parseProblem(response)
  if (error.code === 'INVALID_CSRF_TOKEN' || error.code === 'UNAUTHENTICATED') {
    clearCsrfToken()
  }
  throw error
}
