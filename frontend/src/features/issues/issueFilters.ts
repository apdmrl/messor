import type { IssueType } from './types'

/**
 * Shared, single source of truth for user-facing issue filters that live in the
 * URL query string.
 *
 * <p>This is the one parse/normalize/serialize layer. The supported parameters
 * are {@code project}, {@code type}, {@code status}, {@code assignee},
 * {@code archive}, {@code sort}, {@code page} and {@code size}. Every value is
 * validated against a fixed allowlist (mirroring the backend allowlists), and
 * any unknown or hostile value is normalized to a safe default so a raw value is
 * never forwarded to the backend sort/filter API. Defaults are omitted from the
 * serialized URL so the canonical URL stays clean, and the parameter order is
 * deterministic so equal states always produce the same URL.</p>
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

export const DEFAULT_FILTERS: IssueFilterState = {
  project: null,
  type: null,
  status: null,
  assignee: null,
  archive: 'active',
  sort: { field: 'number', direction: 'asc' },
  page: 0,
  size: 20,
}

const ARCHIVE_VALUES: ArchiveFilter[] = ['active', 'archived', 'all']
const SORT_FIELDS: SortField[] = ['createdAt', 'updatedAt', 'number', 'title']
const SORT_DIRECTIONS: SortDirection[] = ['asc', 'desc']
const ISSUE_TYPE_VALUES: IssueType[] = ['STORY', 'TASK', 'BUG']
const MAX_PAGE = 10000
const MIN_SIZE = 1
const MAX_SIZE = 100

function normalizeInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) {
    return fallback
  }
  const value = Number.parseInt(raw, 10)
  if (Number.isNaN(value) || value < min || value > max) {
    return fallback
  }
  return value
}

function normalizeSort(raw: string | null): SortSpec {
  if (raw === null) {
    return { ...DEFAULT_FILTERS.sort }
  }
  const [fieldPart, directionPart] = raw.split(',')
  const field = SORT_FIELDS.find((f) => f === fieldPart)
  const direction = SORT_DIRECTIONS.find((d) => d === directionPart)
  if (field === undefined || direction === undefined) {
    return { ...DEFAULT_FILTERS.sort }
  }
  return { field, direction }
}

/**
 * Parse and normalize a {@link URLSearchParams} into an exact, effective filter
 * state. Every unknown or hostile value collapses to a safe default; the
 * returned state is the canonical effective filter set used for the query key.
 */
export function parseFilters(searchParams: URLSearchParams): IssueFilterState {
  const project = searchParams.get('project')
  const typeRaw = searchParams.get('type')
  const type: IssueType | null = ISSUE_TYPE_VALUES.includes(typeRaw as IssueType)
    ? (typeRaw as IssueType)
    : null
  const status = searchParams.get('status')
  const assignee = searchParams.get('assignee')
  const archiveRaw = searchParams.get('archive')
  const archive: ArchiveFilter = ARCHIVE_VALUES.includes(archiveRaw as ArchiveFilter)
    ? (archiveRaw as ArchiveFilter)
    : DEFAULT_FILTERS.archive
  const sort = normalizeSort(searchParams.get('sort'))
  const page = normalizeInt(searchParams.get('page'), 0, MAX_PAGE, DEFAULT_FILTERS.page)
  const size = normalizeInt(searchParams.get('size'), MIN_SIZE, MAX_SIZE, DEFAULT_FILTERS.size)
  return { project, type, status, assignee, archive, sort, page, size }
}

/**
 * Serialize a filter state to a canonical {@link URLSearchParams}: only
 * non-default values are emitted, in a fixed deterministic order.
 */
export function serializeFilters(filters: IssueFilterState): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.project !== null) {
    params.set('project', filters.project)
  }
  if (filters.type !== null) {
    params.set('type', filters.type)
  }
  if (filters.status !== null) {
    params.set('status', filters.status)
  }
  if (filters.assignee !== null) {
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
  if (filters.size !== 20) {
    params.set('size', String(filters.size))
  }
  return params
}

/** Canonical query string (including the leading {@code ?} when non-empty). */
export function canonicalQueryString(filters: IssueFilterState): string {
  const query = serializeFilters(filters).toString()
  return query === '' ? '' : `?${query}`
}
