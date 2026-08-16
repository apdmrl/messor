import {
  ApiError,
  apiRequest,
  clearCsrfToken,
  fetchCsrfToken,
} from '../../app/apiClient'
import type { UserSummary } from './types'

export { ApiError as AuthApiError } from '../../app/apiClient'

const LOGIN_URL = '/api/auth/login'
const ME_URL = '/api/auth/me'
const LOGOUT_URL = '/api/auth/logout'

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded;charset=UTF-8'

const GENERIC_ERROR_CODE = 'HTTP_ERROR'
const GENERIC_ERROR_DETAIL = 'İstek tamamlanamadı.'

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

export async function login(email: string, password: string): Promise<UserSummary> {
  const body = new URLSearchParams()
  body.set('email', email)
  body.set('password', password)

  // Login never auto-retries on INVALID_CSRF_TOKEN: a failed login must surface
  // to the user, and the shared client clears the stale token so the next
  // state-changing call fetches a fresh one.
  const user: unknown = await apiRequest(LOGIN_URL, {
    method: 'POST',
    csrf: true,
    retryOnInvalidCsrf: false,
    headers: { 'Content-Type': FORM_CONTENT_TYPE },
    body,
  })

  // A 2xx login means server-side authentication may have occurred, so the
  // pre-login CSRF token is no longer trustworthy. Discard it before validating
  // the body so a malformed/invalid UserSummary still leaves the cache cleared.
  clearCsrfToken()

  if (!isUserSummary(user)) {
    throw new ApiError(200, GENERIC_ERROR_CODE, GENERIC_ERROR_DETAIL)
  }

  // Rotate a fresh token for subsequent requests.
  await fetchCsrfToken()

  return user
}

export async function getCurrentUser(): Promise<UserSummary | null> {
  try {
    const user: unknown = await apiRequest(ME_URL)
    if (!isUserSummary(user)) {
      throw new ApiError(200, GENERIC_ERROR_CODE, GENERIC_ERROR_DETAIL)
    }
    return user
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && err.code === 'UNAUTHENTICATED') {
      clearCsrfToken()
      return null
    }
    throw err
  }
}

export async function logout(): Promise<void> {
  await apiRequest(LOGOUT_URL, {
    method: 'POST',
    csrf: true,
    retryOnInvalidCsrf: false,
  })
  clearCsrfToken()
}
