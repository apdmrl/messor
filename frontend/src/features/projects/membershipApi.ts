/**
 * Dedicated membership API surface. The request functions live in
 * `./projectsApi` (their existing home, owned by earlier tasks); this module
 * re-exports them so membership pages depend on a stable membership contract
 * instead of the project API module. Contracts are unchanged.
 */

export {
  addProjectMember,
  changeProjectMemberRole,
  listProjectMembers,
  removeProjectMember,
} from './projectsApi'

/**
 * Canonical member-list query key shared by every membership surface so cache
 * invalidation and refetching stay consistent across pages.
 */
export const MEMBERS_QUERY_KEY = (projectKey: string): readonly string[] => [
  'projects',
  projectKey,
  'members',
]
