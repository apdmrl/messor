export type UserRole = 'ORG_ADMIN' | 'USER'

export interface UserSummary {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
}

export interface CsrfTokenResponse {
  headerName: string
  parameterName: string
  token: string
}

export interface ProblemDetails {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  code: string
}
