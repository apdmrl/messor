export type ProjectRole = 'PROJECT_LEAD' | 'MEMBER' | 'VIEWER'

export interface ProjectSummary {
  id: string
  key: string
  name: string
  description: string | null
  currentUserRole: ProjectRole
  version: number
  createdAt: string
  updatedAt: string
}

export interface WorkflowStatus {
  code: string
  displayName: string
  position: number
}

export interface ProjectDetail extends ProjectSummary {
  workflowStatuses: WorkflowStatus[]
}

export interface PageResponse<T> {
  items: T[]
  page: number
  size: number
  totalItems: number
  totalPages: number
}

export interface CreateProjectInput {
  key: string
  name: string
  description?: string
}

export interface ProjectMember {
  userId: string
  email: string
  firstName: string
  lastName: string
  role: ProjectRole
  version: number
}

export interface AddProjectMemberInput {
  email: string
  role: ProjectRole
}

export interface ChangeProjectMemberRoleInput {
  role: ProjectRole
  expectedVersion: number
}
