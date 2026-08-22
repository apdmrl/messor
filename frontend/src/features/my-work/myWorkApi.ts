import { apiRequest } from '../../app/apiClient'
import type { IssuePage } from '../issues/types'
import { serializeFilters } from '../issues/issueFilters'
import type { IssueFilterState } from '../issues/issueFilters'

/**
 * Fetch the authenticated principal's assigned work.
 *
 * <p>The endpoint is always scoped to the current session principal; the client
 * never supplies a target user or assignee identifier, so the request never
 * queries on behalf of another user. The filter state is serialized through the
 * shared canonical layer so only allowlisted, non-default values are sent.</p>
 */
export async function listMyWork(filters: IssueFilterState): Promise<IssuePage> {
  const query = serializeFilters(filters).toString()
  return apiRequest<IssuePage>(`/api/my-work${query ? `?${query}` : ''}`)
}
