import type { ReactElement } from 'react'
import type { ArchiveFilter, IssueFilterState, SortField } from './issueFilters'
import { ISSUE_TYPES, issueTypeLabel } from './issueLabels'

export interface ProjectOption {
  key: string
  name: string
}

export interface StatusOption {
  code: string
  displayName: string
}

export interface MemberOption {
  id: string
  label: string
}

interface IssueFiltersProps {
  filters: IssueFilterState
  projects: ProjectOption[]
  statuses: StatusOption[]
  /** When provided, an assignee filter is shown; otherwise it is omitted. */
  members: MemberOption[]
  /** When true, a project selector is shown; otherwise it is omitted. */
  showProject: boolean
  onChange: (patch: Partial<IssueFilterState>) => void
}

const ARCHIVE_OPTIONS: { value: ArchiveFilter; label: string }[] = [
  { value: 'active', label: 'Aktif' },
  { value: 'archived', label: 'Arşivlenmiş' },
  { value: 'all', label: 'Tümü' },
]

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'number', label: 'Numara' },
  { value: 'createdAt', label: 'Oluşturma tarihi' },
  { value: 'updatedAt', label: 'Güncelleme tarihi' },
  { value: 'title', label: 'Başlık' },
]

/**
 * Accessible, URL-backed filter controls shared by the issue screens. Each
 * control has a visible label and meets the 44px interaction target. Changing a
 * filter emits a patch; the parent is responsible for writing it to the URL and
 * resetting the page.
 */
export function IssueFilters({
  filters,
  projects,
  statuses,
  members,
  showProject,
  onChange,
}: IssueFiltersProps): ReactElement {
  const select = (
    id: string,
    stateKey: string,
    label: string,
    value: string,
    options: { value: string; label: string }[],
    emptyLabel: string,
  ): ReactElement => (
    <div className="issue-filters__field">
      <label className="issue-filters__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="issue-filters__select"
        value={value}
        onChange={(event) =>
          onChange({ [stateKey]: event.target.value || null } as Partial<IssueFilterState>)
        }
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )

  const sortDirectionValue = `${filters.sort.field},${filters.sort.direction}`

  return (
    <div className="issue-filters">
      {showProject &&
        select(
          'filter-project',
          'project',
          'Proje',
          filters.project ?? '',
          projects.map((p) => ({ value: p.key, label: p.name })),
          'Tüm projeler',
        )}
      {select(
        'filter-type',
        'type',
        'Tür',
        filters.type ?? '',
        ISSUE_TYPES.map((t) => ({ value: t, label: issueTypeLabel(t) })),
        'Tüm türler',
      )}
      {select(
        'filter-status',
        'status',
        'Durum',
        filters.status ?? '',
        statuses.map((s) => ({ value: s.code, label: s.displayName })),
        'Tüm durumlar',
      )}
      {members.length > 0 &&
        select(
          'filter-assignee',
          'assignee',
          'Atanan',
          filters.assignee ?? '',
          members.map((m) => ({ value: m.id, label: m.label })),
          'Tüm atananlar',
        )}
      {select('filter-archive', 'archive', 'Arşiv', filters.archive, ARCHIVE_OPTIONS, 'Aktif')}
      <div className="issue-filters__field">
        <label className="issue-filters__label" htmlFor="filter-sort">
          Sırala
        </label>
        <select
          id="filter-sort"
          className="issue-filters__select"
          value={sortDirectionValue}
          onChange={(event) => {
            const [field, direction] = event.target.value.split(',')
            onChange({ sort: { field: field as SortField, direction: direction as 'asc' | 'desc' } })
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={`${option.value}-asc`} value={`${option.value},asc`}>
              {option.label} (artan)
            </option>
          ))}
          {SORT_OPTIONS.map((option) => (
            <option key={`${option.value}-desc`} value={`${option.value},desc`}>
              {option.label} (azalan)
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
