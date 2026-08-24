/**
 * Dedicated membership type surface for the membership feature. Types are the
 * single source of truth in `./types`; this module re-exports the membership
 * subset so membership pages import a stable, project-API-independent contract
 * without duplicating the definitions.
 */
export type {
  AddProjectMemberInput,
  ChangeProjectMemberRoleInput,
  ProjectMember,
  ProjectRole,
} from './types'
