import type { IssueType } from './types'

/**
 * Shared, single source of truth for user-facing issue filters that live in the
 * URL query string.
 *
 * <p>This is the one parse/normalize/serialize layer. The supported parameters
 * are {@code project}, {@code type}, {@code status}, {@code assignee},
 * {@code archive}, {@code sort}, {@code page} and {@code size}. Every value is
 * validated strictly against a fixed allowlist (mirroring the backend
 * allowlists), and any unknown or hostile value is normalized to a safe default
 * so a raw value is never forwarded to the backend. Defaults are omitted from
 * the serialized URL so the canonical URL stays clean, the parameter order is
 * deterministic, and unsupported/hostile parameters are dropped from the
 * canonical form.</p>
 *
 * <p>The two consuming contexts are separated explicitly so one serializer
 * never emits a parameter the other context does not support:
 * <ul>
 *   <li><b>Project workspace</b> ({@link PROJECT_FILTER_CONTEXT}): assignee is
 *   supported; {@code project} comes from the route so no project parameter is
 *   produced; a board-friendly default size of 100.</li>
 *   <li><b>My Work</b> ({@link MY_WORK_FILTER_CONTEXT}): project is a real
 *   filter; assignee is NOT supported (My Work is principal-scoped) so any
 *   {@code assignee} value is dropped on parse and never serialized.</li>
 * </ul></p>
 */
export type ArchiveFilter = 'active' | 'archived' | 'all'
export type SortField = 'createdAt' | 'updatedAt' | 'number' | 'title'
export type SortDirection = 'asc' | 'desc'

export interface SortSpec {
  field: SortField
  direction: SortDirection
}

export interface IssueFilterState {
  project: string | null
  type: IssueType | null
  status: string | null
  assignee: string | null
  archive: ArchiveFilter
  sort: SortSpec
  page: number
  size: number
}

export interface IssueFilterContext {
  /** When false, {@code assignee} is never parsed nor serialized. */
  includeAssignee: boolean
  /** When false, {@code project} is never parsed nor serialized (route-based). */
  includeProject: boolean
  /** The size value that is treated as the default and omitted from the URL. */
  defaultSize: number
}

const DEFAULT_SIZE = 20

export const DEFAULT_FILTERS: IssueFilterState = {
  project: null,
  type: null,
  status: null,
  assignee: null,
  archive: 'active',
  sort: { field: 'number', direction: 'asc' },
  page: 0,
  size: DEFAULT_SIZE,
}

/** Project workspace context: assignee supported, project from route, size 100. */
export const PROJECT_FILTER_CONTEXT: IssueFilterContext = {
  includeAssignee: true,
  includeProject: false,
  defaultSize: 100,
}

/** My Work context: project a real filter, assignee never supported, size 20. */
export const MY_WORK_FILTER_CONTEXT: IssueFilterContext = {
  includeAssignee: false,
  includeProject: true,
  defaultSize: DEFAULT_SIZE,
}

const ARCHIVE_VALUES: ArchiveFilter[] = ['active', 'archived', 'all']
const SORT_FIELDS: SortField[] = ['createdAt', 'updatedAt', 'number', 'title']
const SORT_DIRECTIONS: SortDirection[] = ['asc', 'desc']
const ISSUE_TYPE_VALUES: IssueType[] = ['STORY', 'TASK', 'BUG']
const MAX_PAGE = 10000
const MIN_SIZE = 1
const MAX_SIZE = 100

/** Matches only a full decimal integer (no sign, junk, decimals, whitespace). */
const INTEGER_RE = /^\d+$/

/**
 * Returns the single value of a parameter, or {@code null} when it is absent,
 * empty, or repeated. Repeated singleton parameters collapse to {@code null} so
 * a canonical default is used rather than silently picking one value.
 */
function singleParam(searchParams: URLSearchParams, name: string): string | null {
  const values = searchParams.getAll(name)
  if (values.length !== 1) {
    return null
  }
  const value = values[0]
  return value === '' ? null : value
}

function normalizeInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) {
    return fallback
  }
  if (!INTEGER_RE.test(raw)) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return fallback
  }
  return value
}

function normalizeSort(raw: string | null, fallback: SortSpec): SortSpec {
  if (raw === null) {
    return fallback
  }
  // Exactly two comma-separated segments; anything else (e.g. number,asc,evil)
  // collapses to the default.
  const parts = raw.split(',')
  if (parts.length !== 2) {
    return fallback
  }
  const field = SORT_FIELDS.find((f) => f === parts[0])
  const direction = SORT_DIRECTIONS.find((d) => d === parts[1])
  if (field === undefined || direction === undefined) {
    return fallback
  }
  return { field, direction }
}

/**
 * Parse and normalize a {@link URLSearchParams} into an exact, effective filter
 * state. Every unknown, hostile, or (for the given context) unsupported value
 * collapses to a safe default; the returned state is the canonical effective
 * filter set used for the query key.
 */
export function parseFilters(
  searchParams: URLSearchParams,
  context: IssueFilterContext,
): IssueFilterState {
  const defaultSort = { ...DEFAULT_FILTERS.sort }
  const typeRaw = singleParam(searchParams, 'type')
  const type: IssueType | null = ISSUE_TYPE_VALUES.includes(typeRaw as IssueType)
    ? (typeRaw as IssueType)
    : null
  const archiveRaw = singleParam(searchParams, 'archive')
  const archive: ArchiveFilter = ARCHIVE_VALUES.includes(archiveRaw as ArchiveFilter)
    ? (archiveRaw as ArchiveFilter)
    : DEFAULT_FILTERS.archive
  return {
    project: context.includeProject ? singleParam(searchParams, 'project') : null,
    type,
    status: singleParam(searchParams, 'status'),
    assignee: context.includeAssignee ? singleParam(searchParams, 'assignee') : null,
    archive,
    sort: normalizeSort(singleParam(searchParams, 'sort'), defaultSort),
    page: normalizeInt(singleParam(searchParams, 'page'), 0, MAX_PAGE, DEFAULT_FILTERS.page),
    size: normalizeInt(
      singleParam(searchParams, 'size'),
      MIN_SIZE,
      MAX_SIZE,
      context.defaultSize,
    ),
  }
}

/**
 * Serialize a filter state to a canonical {@link URLSearchParams}: only
 * non-default values are emitted, in a fixed deterministic order, and only for
 * parameters supported by the given context.
 */
export function serializeFilters(
  filters: IssueFilterState,
  context: IssueFilterContext,
): URLSearchParams {
  const params = new URLSearchParams()
  if (context.includeProject && filters.project !== null) {
    params.set('project', filters.project)
  }
  if (filters.type !== null) {
    params.set('type', filters.type)
  }
  if (filters.status !== null) {
    params.set('status', filters.status)
  }
  if (context.includeAssignee && filters.assignee !== null) {
    params.set('assignee', filters.assignee)
  }
  if (filters.archive !== 'active') {
    params.set('archive', filters.archive)
  }
  if (filters.sort.field !== 'number' || filters.sort.direction !== 'asc') {
    params.set('sort', `${filters.sort.field},${filters.sort.direction}`)
  }
  if (filters.page !== 0) {
    params.set('page', String(filters.page))
  }
  if (filters.size !== context.defaultSize) {
    params.set('size', String(filters.size))
  }
  return params
}

/** Canonical query string (including the leading {@code ?} when non-empty). */
export function canonicalQueryString(
  filters: IssueFilterState,
  context: IssueFilterContext,
): string {
  const query = serializeFilters(filters, context).toString()
  return query === '' ? '' : `?${query}`
}

/**
 * Serialize a filter state for an actual API request.
 *
 * <p>Unlike the clean URL serializer, this ALWAYS emits {@code page} and
 * {@code size} explicitly, so the request's size is exactly the effective size
 * for the context and never depends on the backend's fallback default. The
 * project workspace context keeps {@code size=100} explicit (its board-friendly
 * default) while still omitting {@code size} from the clean URL; the My Work
 * context sends {@code size=20} explicitly. The same context exclusions apply
 * (project omitted for the workspace, assignee omitted for My Work).</p>
 */
export function serializeApiFilters(
  filters: IssueFilterState,
  context: IssueFilterContext,
): URLSearchParams {
  const params = new URLSearchParams()
  if (context.includeProject && filters.project !== null) {
    params.set('project', filters.project)
  }
  if (filters.type !== null) {
    params.set('type', filters.type)
  }
  if (filters.status !== null) {
    params.set('status', filters.status)
  }
  if (context.includeAssignee && filters.assignee !== null) {
    params.set('assignee', filters.assignee)
  }
  if (filters.archive !== 'active') {
    params.set('archive', filters.archive)
  }
  if (filters.sort.field !== 'number' || filters.sort.direction !== 'asc') {
    params.set('sort', `${filters.sort.field},${filters.sort.direction}`)
  }
  params.set('page', String(filters.page))
  params.set('size', String(filters.size))
  return params
}

/**
 * Move-completeness invariant for the Kanban board.
 *
 * <p>Board reordering is only safe when the rendered issue set is the COMPLETE
 * active column: no archive/type/status/assignee filter, page 0, and a single
 * page ({@code totalPages <= 1}) so every issue in each active column is
 * present. Otherwise the frontend's subset index would not map to the backend's
 * full-column ordering. {@code totalPages} of 0 or >1 both disable reordering.
 * (The board always orders columns by rank regardless of the sort param, so any
 * sort is safe once the full set is present.)</p>
 */
export function canReorderBoard(
  filters: IssueFilterState,
  totalPages: number,
): boolean {
  return (
    filters.archive === 'active' &&
    filters.type === null &&
    filters.status === null &&
    filters.assignee === null &&
    filters.page === 0 &&
    totalPages === 1
  )
}
