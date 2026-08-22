import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../app/apiClient'
import { getProject, listProjectMembers } from '../projects/projectsApi'
import type { ProjectMember } from '../projects/types'
import {
  archiveIssue,
  createIssue,
  getIssue,
  listIssueActivity,
  listIssues,
  updateIssue,
} from './issuesApi'
import { IssueDetailsPanel } from './IssueDetailsPanel'
import { IssueForm } from './IssueForm'
import type { IssueFormValues } from './IssueForm'
import { IssueList } from './IssueList'
import type { IssueActivity, IssueListFilters, IssueType } from './types'
import './IssueWorkspacePage.css'

const ISSUE_LIST_FILTERS: IssueListFilters = {
  page: 0,
  size: 100,
  sort: 'number,asc',
}

const GENERIC_ERROR = 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
const LIST_ERROR_FALLBACK = 'İssue’lar yüklenemedi. Lütfen tekrar deneyin.'

const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED:
    'Girilen bilgiler doğrulanamadı. Lütfen kontrol edip tekrar deneyin.',
  INVALID_ASSIGNEE: 'Seçilen atanan bu projenin üyesi değil.',
  VERSION_CONFLICT:
    'Veriler başka bir işlem tarafından güncellendi; yazdıkların korundu. Tekrar gözden geçirip gönder.',
  ISSUE_ARCHIVED: 'Bu issue arşivlendi; güncelleme yapılamıyor.',
  FORBIDDEN: 'Bu işlem için yetkiniz yok.',
  ISSUE_NOT_FOUND: 'Bu issue bulunamadı.',
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] ?? GENERIC_ERROR
  }
  return GENERIC_ERROR
}

function memberName(member: ProjectMember): string {
  return `${member.firstName} ${member.lastName}`.trim()
}

export function IssueWorkspacePage(): ReactElement {
  const { projectKey } = useParams<{ projectKey: string }>()
  const key = projectKey ?? ''
  const queryClient = useQueryClient()

  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null)
  const [activeForm, setActiveForm] = useState<'create' | 'edit' | null>(null)
  const [confirmingArchive, setConfirmingArchive] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [bannerAlert, setBannerAlert] = useState<{
    kind: 'error' | 'info'
    message: string
  } | null>(null)

  const createButtonRef = useRef<HTMLButtonElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const archiveTriggerRef = useRef<HTMLButtonElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)

  const projectQuery = useQuery({
    queryKey: ['projects', key],
    queryFn: () => getProject(key),
    enabled: key !== '',
  })

  const membersQuery = useQuery({
    queryKey: ['projects', key, 'members'],
    queryFn: () => listProjectMembers(key),
    enabled: key !== '',
  })

  const issuesQuery = useQuery({
    queryKey: ['issues', key, ISSUE_LIST_FILTERS],
    queryFn: () => listIssues(key, ISSUE_LIST_FILTERS),
    enabled: key !== '',
  })

  const issueQuery = useQuery({
    queryKey: ['issue', selectedIssueKey ?? ''],
    queryFn: () => getIssue(selectedIssueKey as string),
    enabled: selectedIssueKey !== null,
  })

  const activityQuery = useQuery({
    queryKey: ['issue', selectedIssueKey ?? '', 'activity'],
    queryFn: () => listIssueActivity(selectedIssueKey as string),
    enabled: selectedIssueKey !== null,
  })

  const canMutate =
    projectQuery.data?.currentUserRole === 'PROJECT_LEAD' ||
    projectQuery.data?.currentUserRole === 'MEMBER'

  const statusLabel = useCallback(
    (code: string): string => {
      const status = projectQuery.data?.workflowStatuses.find(
        (s) => s.code === code,
      )
      return status ? status.displayName : code
    },
    [projectQuery.data],
  )

  const assigneeLabel = useCallback(
    (id: string | null): string => {
      if (id === null) {
        return 'Atanmamış'
      }
      const member = membersQuery.data?.find((m) => m.userId === id)
      return member ? memberName(member) : 'Bilinmeyen kullanıcı'
    },
    [membersQuery.data],
  )

  const refetchIssueCaches = async (issueKey: string): Promise<void> => {
    await Promise.all([
      queryClient.refetchQueries({
        queryKey: ['issue', issueKey],
        exact: true,
        type: 'active',
      }),
      queryClient.refetchQueries({
        queryKey: ['issue', issueKey, 'activity'],
        exact: true,
        type: 'active',
      }),
      queryClient.refetchQueries({
        queryKey: ['issues', key, ISSUE_LIST_FILTERS],
        exact: true,
        type: 'active',
      }),
    ])
  }

  const createMutation = useMutation({
    mutationFn: (input: {
      type: IssueType
      title: string
      description: string | null
      assigneeId: string | null
    }) =>
      createIssue(key, {
        type: input.type,
        title: input.title,
        description: input.description,
        assigneeId: input.assigneeId,
      }),
    onSuccess: async (issue) => {
      setFormError(null)
      setBannerAlert(null)
      setActiveForm(null)
      await queryClient.invalidateQueries({
        queryKey: ['issues', key, ISSUE_LIST_FILTERS],
        exact: true,
      })
      setSelectedIssueKey(issue.issueKey)
      createButtonRef.current?.focus()
    },
    onError: (error: unknown) => {
      setFormError(safeErrorMessage(error))
    },
  })

  const updateMutation = useMutation({
    mutationFn: (values: IssueFormValues) => {
      const current = issueQuery.data
      if (current === undefined) {
        throw new Error('Seçili issue bulunamadı.')
      }
      return updateIssue(current.issueKey, {
        title: values.title,
        description: values.description === '' ? null : values.description,
        assigneeId: values.assigneeId === '' ? null : values.assigneeId,
        expectedVersion: current.version,
      })
    },
    onSuccess: async (updated) => {
      setFormError(null)
      setBannerAlert(null)
      setActiveForm(null)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['issue', updated.issueKey],
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: ['issue', updated.issueKey, 'activity'],
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: ['issues', key, ISSUE_LIST_FILTERS],
          exact: true,
        }),
      ])
      editButtonRef.current?.focus()
    },
    onError: async (error: unknown) => {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        if (selectedIssueKey !== null) {
          await refetchIssueCaches(selectedIssueKey)
        }
        setFormError(ERROR_MESSAGES.VERSION_CONFLICT)
        return
      }
      if (error instanceof ApiError && error.code === 'ISSUE_ARCHIVED') {
        if (selectedIssueKey !== null) {
          await refetchIssueCaches(selectedIssueKey)
        }
        setActiveForm(null)
        setBannerAlert({ kind: 'info', message: ERROR_MESSAGES.ISSUE_ARCHIVED })
        editButtonRef.current?.focus()
        return
      }
      setFormError(safeErrorMessage(error))
    },
  })

  const archiveMutation = useMutation({
    mutationFn: () => {
      const current = issueQuery.data
      if (current === undefined) {
        throw new Error('Seçili issue bulunamadı.')
      }
      return archiveIssue(current.issueKey, {
        expectedVersion: current.version,
      })
    },
    onSuccess: async (archived) => {
      setConfirmingArchive(false)
      setBannerAlert({ kind: 'info', message: 'Issue arşivlendi.' })
      setSelectedIssueKey(null)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['issues', key, ISSUE_LIST_FILTERS],
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: ['issue', archived.issueKey],
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: ['issue', archived.issueKey, 'activity'],
          exact: true,
        }),
      ])
      listHeadingRef.current?.focus()
    },
    onError: async (error: unknown) => {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        if (selectedIssueKey !== null) {
          await refetchIssueCaches(selectedIssueKey)
        }
        setBannerAlert({
          kind: 'error',
          message: ERROR_MESSAGES.VERSION_CONFLICT,
        })
        return
      }
      if (error instanceof ApiError && error.code === 'ISSUE_ARCHIVED') {
        if (selectedIssueKey !== null) {
          await refetchIssueCaches(selectedIssueKey)
        }
        setConfirmingArchive(false)
        setBannerAlert({
          kind: 'info',
          message: ERROR_MESSAGES.ISSUE_ARCHIVED,
        })
        return
      }
      setConfirmingArchive(false)
      setBannerAlert({ kind: 'error', message: safeErrorMessage(error) })
    },
  })

  useEffect(() => {
    if (!confirmingArchive) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !archiveMutation.isPending) {
        setConfirmingArchive(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [confirmingArchive, archiveMutation.isPending])

  const openCreate = (): void => {
    setActiveForm('create')
    setFormError(null)
    setBannerAlert(null)
    setConfirmingArchive(false)
  }

  const closeCreate = (): void => {
    if (createMutation.isPending) {
      return
    }
    setActiveForm(null)
    setFormError(null)
    createButtonRef.current?.focus()
  }

  const openEdit = (): void => {
    setFormError(null)
    setBannerAlert(null)
    setActiveForm('edit')
  }

  const closeEdit = (): void => {
    if (updateMutation.isPending) {
      return
    }
    setActiveForm(null)
    setFormError(null)
    editButtonRef.current?.focus()
  }

  const handleSelect = (issueKey: string): void => {
    setSelectedIssueKey(issueKey)
    setConfirmingArchive(false)
    if (activeForm === 'edit') {
      setActiveForm(null)
      setFormError(null)
    }
  }

  const handleCreateSubmit = (values: IssueFormValues): void => {
    if (createMutation.isPending) {
      return
    }
    createMutation.mutate({
      type: values.type,
      title: values.title,
      description: values.description === '' ? null : values.description,
      assigneeId: values.assigneeId === '' ? null : values.assigneeId,
    })
  }

  const handleUpdateSubmit = (values: IssueFormValues): void => {
    if (updateMutation.isPending) {
      return
    }
    updateMutation.mutate(values)
  }

  const handleArchive = (): void => {
    setConfirmingArchive(true)
  }

  const selectedIssue = issueQuery.data
  const activity: IssueActivity[] | undefined = activityQuery.data

  return (
    <div className="issue-workspace">
      <nav className="issue-workspace__nav" aria-label="Proje gezinme">
        <Link className="issue-workspace__back" to={`/projects/${key}/board`}>
          Board’a dön
        </Link>
        <Link className="issue-workspace__back" to={`/projects/${key}/settings`}>
          Proje ayarları
        </Link>
        <Link className="issue-workspace__back" to="/projects">
          Projelere dön
        </Link>
      </nav>

      <header className="issue-workspace__header">
        <div className="issue-workspace__heading-block">
          <h2 className="issue-workspace__heading">
            {projectQuery.data?.name ?? 'İssue yönetimi'}
          </h2>
          <p className="issue-workspace__key">{key}</p>
        </div>
        {canMutate && (
          <button
            type="button"
            ref={createButtonRef}
            className="issue-workspace__create"
            onClick={openCreate}
          >
            Yeni issue
          </button>
        )}
      </header>

      {bannerAlert !== null && (
        <p
          className="issue-workspace__banner"
          role={bannerAlert.kind === 'error' ? 'alert' : 'status'}
        >
          {bannerAlert.message}
        </p>
      )}

      {activeForm === 'create' && canMutate && (
        <IssueForm
          key="create"
          mode="create"
          initialType="TASK"
          initialTitle=""
          initialDescription=""
          initialAssigneeId={null}
          members={membersQuery.data ?? []}
          pending={createMutation.isPending}
          error={formError}
          submitLabel="Oluştur"
          pendingLabel="Oluşturuluyor…"
          onSubmit={handleCreateSubmit}
          onCancel={closeCreate}
          firstFieldRef={firstFieldRef}
        />
      )}

      {activeForm === 'edit' &&
        canMutate &&
        selectedIssue !== undefined && (
          <IssueForm
            key={`edit-${selectedIssue.issueKey}`}
            mode="edit"
            initialType={selectedIssue.type}
            initialTitle={selectedIssue.title}
            initialDescription={selectedIssue.description ?? ''}
            initialAssigneeId={selectedIssue.assigneeId}
            members={membersQuery.data ?? []}
            pending={updateMutation.isPending}
            error={formError}
            submitLabel="Güncelle"
            pendingLabel="Güncelleniyor…"
            onSubmit={handleUpdateSubmit}
            onCancel={closeEdit}
            firstFieldRef={firstFieldRef}
          />
        )}

      <section
        className="issue-workspace__body"
        aria-labelledby="issue-list-heading"
      >
        <h3
          id="issue-list-heading"
          className="issue-workspace__list-heading"
          tabIndex={-1}
          ref={listHeadingRef}
        >
          İssue’lar
        </h3>

        {issuesQuery.isLoading && (
          <p className="issue-workspace__status" role="status">
            İssue’lar yükleniyor…
          </p>
        )}

        {issuesQuery.isError && (
          <p className="issue-workspace__error" role="alert">
            {LIST_ERROR_FALLBACK}
          </p>
        )}

        {issuesQuery.isSuccess && issuesQuery.data.items.length === 0 && (
          <p className="issue-workspace__empty">Henüz issue yok.</p>
        )}

        {issuesQuery.isSuccess && issuesQuery.data.items.length > 0 && (
          <IssueList
            issues={issuesQuery.data.items}
            selectedIssueKey={selectedIssueKey}
            onSelect={handleSelect}
            statusLabel={statusLabel}
            assigneeLabel={assigneeLabel}
          />
        )}

        {selectedIssueKey !== null && selectedIssue !== undefined && (
          <IssueDetailsPanel
            issue={selectedIssue}
            activity={activity}
            activityLoading={activityQuery.isLoading}
            statusLabel={statusLabel}
            assigneeLabel={assigneeLabel}
            canMutate={canMutate}
            editing={activeForm === 'edit'}
            confirmingArchive={confirmingArchive}
            archivePending={archiveMutation.isPending}
            onEdit={openEdit}
            onArchive={handleArchive}
            onConfirmArchive={() => {
              if (archiveMutation.isPending) {
                return
              }
              archiveMutation.mutate()
            }}
            onCancelArchive={() => setConfirmingArchive(false)}
            editButtonRef={editButtonRef}
            archiveTriggerRef={archiveTriggerRef}
          />
        )}
      </section>
    </div>
  )
}

export { ISSUE_LIST_FILTERS }
