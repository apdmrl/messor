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

async function parseProblem(response: Response): Promise<AuthApiError> {
  let problem: ProblemDetails | null = null
  try {
    const body: unknown = await response.json()
    if (isProblemDetails(body)) {
      problem = body
    }
  } catch {
    // Malformed or non-JSON body: fall through to the generic error.
  }

  if (problem) {
    return new AuthApiError(problem.status, problem.code, problem.detail)
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

  const body: unknown = await response.json()
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

  const user: unknown = await response.json()
  if (!isUserSummary(user)) {
    throw new AuthApiError(response.status, GENERIC_ERROR_CODE, GENERIC_ERROR_DETAIL)
  }

  // Discard the pre-login token and rotate a fresh one for subsequent requests.
  clearCsrfToken()
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

  const user: unknown = await response.json()
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
