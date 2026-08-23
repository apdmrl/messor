export type UserRole = 'ORG_ADMIN' | 'USER'

export interface UserSummary {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
}

export interface ProblemDetails {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  code: string
}
