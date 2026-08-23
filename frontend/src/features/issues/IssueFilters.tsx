import { useEffect, useRef, useState } from 'react'
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
  /** Disables every control (e.g. while a mutation is pending). */
  disabled?: boolean
  onChange: (patch: Partial<IssueFilterState>) => void
}

const ARCHIVE_OPTIONS: { value: ArchiveFilter; label: string }[] = [
  { value: 'active', label: 'Aktif' },
  { value: 'archived', label: 'Arşivlenmiş' },
  { value: 'all', label: 'Tümü' },
]

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'number', label: 'Numara' },
  { value: 'createdAt', label: 'Oluşturma' },
  { value: 'updatedAt', label: 'Güncelleme' },
  { value: 'title', label: 'Başlık' },
]

const SORT_DIRECTION_SUFFIX: Record<'asc' | 'desc', string> = {
  asc: ' (artan)',
  desc: ' (azalan)',
}

interface ActiveChip {
  /** Stable identity used as the React key. */
  key: string
  /** User-facing label rendered inside the chip. */
  label: string
  /** Patch that clears this single filter; the parent resets the page. */
  patch: Partial<IssueFilterState>
}

/**
 * Accessible, URL-backed filter controls shared by the issue screens. The
 * always-expanded field row is replaced by a compact toolbar: a `Filtreler`
 * disclosure (with an active-filter-count badge), removable active-filter
 * chips, a compact sort select, and a `Temizle` reset button. The full native
 * labelled controls are revealed only when the disclosure is opened. All
 * filter/sort values remain solely in {@link IssueFilterState} (URL-backed);
 * the open/closed disclosure is ephemeral local UI state. Each change emits a
 * patch; the parent is responsible for writing it to the URL and resetting the
 * page.
 */
export function IssueFilters({
  filters,
  projects,
  statuses,
  members,
  showProject,
  disabled = false,
  onChange,
}: IssueFiltersProps): ReactElement {
  const [open, setOpen] = useState(false)
  const disclosureRef = useRef<HTMLButtonElement>(null)

  // Standard disclosure behavior: Escape collapses and returns focus to the
  // trigger. The panel itself holds no persistent state to restore.
  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        disclosureRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Active chips in a deterministic order: Project, Type, Status, Assignee,
  // Archive. Only non-default values produce a chip.
  const chips: ActiveChip[] = []
  if (showProject && filters.project !== null) {
    const name = projects.find((p) => p.key === filters.project)?.name
    chips.push({
      key: 'project',
      label: name ?? filters.project,
      patch: { project: null },
    })
  }
  if (filters.type !== null) {
    chips.push({
      key: 'type',
      label: issueTypeLabel(filters.type),
      patch: { type: null },
    })
  }
  if (filters.status !== null) {
    const displayName = statuses.find((s) => s.code === filters.status)?.displayName
    chips.push({
      key: 'status',
      label: displayName ?? filters.status,
      patch: { status: null },
    })
  }
  // The assignee chip is shown whenever an assignee filter is active; the raw
  // ID is used as a label fallback when member metadata is unavailable.
  if (filters.assignee !== null) {
    const label = members.find((m) => m.id === filters.assignee)?.label
    chips.push({
      key: 'assignee',
      label: label ?? filters.assignee,
      patch: { assignee: null },
    })
  }
  if (filters.archive !== 'active') {
    const label = ARCHIVE_OPTIONS.find((o) => o.value === filters.archive)?.label
    chips.push({
      key: 'archive',
      label: label ?? filters.archive,
      patch: { archive: 'active' },
    })
  }

  // The badge counts only user filters (never pagination/page size). A
  // non-default sort makes `Temizle` visible but does not inflate the badge.
  const activeFilterCount = chips.length
  const hasNonDefaultSort =
    filters.sort.field !== 'number' || filters.sort.direction !== 'asc'
  const showClear = activeFilterCount > 0 || hasNonDefaultSort

  const clearAll = (): void => {
    // Restore context defaults while preserving the context's default size;
    // the parent keeps `size` untouched and resets the page to 0.
    onChange({
      project: null,
      type: null,
      status: null,
      assignee: null,
      archive: 'active',
      sort: { field: 'number', direction: 'asc' },
    })
  }

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
        disabled={disabled}
        aria-disabled={disabled}
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
    <div className="issue-filters" aria-busy={disabled || undefined}>
      <div className="issue-filters__toolbar">
        <button
          ref={disclosureRef}
          type="button"
          className="issue-filters__disclosure"
          aria-expanded={open}
          aria-controls="issue-filters-panel"
          onClick={() => setOpen((value) => !value)}
          disabled={disabled}
        >
          <span>Filtreler</span>
          {activeFilterCount > 0 && (
            <span className="issue-filters__badge">{activeFilterCount}</span>
          )}
        </button>

        <div className="issue-filters__chips">
          {chips.map((chip) => (
            <span key={chip.key} className="issue-filters__chip">
              <span className="issue-filters__chip-label">{chip.label}</span>
              <button
                type="button"
                className="issue-filters__chip-remove"
                aria-label={`${chip.label} filtresini kaldır`}
                onClick={() => onChange(chip.patch)}
                disabled={disabled}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        <div className="issue-filters__tools">
          <label className="issue-filters__sr-only" htmlFor="filter-sort">
            Sırala
          </label>
          <select
            id="filter-sort"
            className="issue-filters__sort"
            value={sortDirectionValue}
            disabled={disabled}
            aria-disabled={disabled}
            onChange={(event) => {
              const [field, direction] = event.target.value.split(',')
              onChange({
                sort: {
                  field: field as SortField,
                  direction: direction as 'asc' | 'desc',
                },
              })
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={`${option.value}-asc`} value={`${option.value},asc`}>
                {option.label}
                {SORT_DIRECTION_SUFFIX.asc}
              </option>
            ))}
            {SORT_OPTIONS.map((option) => (
              <option key={`${option.value}-desc`} value={`${option.value},desc`}>
                {option.label}
                {SORT_DIRECTION_SUFFIX.desc}
              </option>
            ))}
          </select>

          {showClear && (
            <button
              type="button"
              className="issue-filters__clear"
              onClick={clearAll}
              disabled={disabled}
            >
              Temizle
            </button>
          )}
        </div>
      </div>

      {open && (
        <div id="issue-filters-panel" className="issue-filters__panel">
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
        </div>
      )}
    </div>
  )
}
