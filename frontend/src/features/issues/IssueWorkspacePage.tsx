import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../app/apiClient'
import { useSession } from '../../app/session'
import { getProject, listProjectMembers } from '../projects/projectsApi'
import type { ProjectMember } from '../projects/types'
import {
  archiveIssue,
  createIssue,
  getIssue,
  listIssueActivity,
  listIssues,
  moveIssue,
  updateIssue,
} from './issuesApi'
import { applyOptimisticMove, computeMove } from './boardOrder'
import { IssueDrawer } from './IssueDrawer'
import { IssueForm } from './IssueForm'
import type { IssueFormValues } from './IssueForm'
import { ProjectBoard } from './ProjectBoard'
import type {
  IssueActivity,
  Issue,
  IssueListFilters,
  IssuePage,
  IssueType,
} from './types'
import './IssueWorkspacePage.css'
import './ProjectBoard.css'

const ISSUE_LIST_FILTERS: IssueListFilters = {
  page: 0,
  size: 100,
  sort: 'number,asc',
}

const GENERIC_ERROR = 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
const LIST_ERROR_FALLBACK = 'İssue’lar yüklenemedi. Lütfen tekrar deneyin.'
const PROJECT_ERROR_FALLBACK =
  'Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.'
const MEMBERS_ERROR_FALLBACK = 'Üye listesi yüklenemedi. Lütfen tekrar deneyin.'
const DETAIL_ERROR_FALLBACK = 'Issue detayı yüklenemedi. Lütfen tekrar deneyin.'

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
  const { projectKey, issueKey } = useParams<{
    projectKey: string
    issueKey?: string
  }>()
  const key = projectKey ?? ''
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = useSession()

  // The issueKey route parameter is the authoritative selected issue. There is
  // no competing local selection state.
  const routeIssueKey = issueKey ?? null

  const [activeForm, setActiveForm] = useState<'create' | 'edit' | null>(null)
  const [confirmingArchive, setConfirmingArchive] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [bannerAlert, setBannerAlert] = useState<{
    kind: 'error' | 'info'
    message: string
  } | null>(null)
  const [focusIntent, setFocusIntent] = useState<
    'edit' | 'archive' | 'archive-cancel' | 'list-heading' | null
  >(null)
  const [focusIssueKey, setFocusIssueKey] = useState<string | null>(null)
  const [commentsBusy, setCommentsBusy] = useState(false)

  // True when the drawer was opened by navigating from within the app (a board
  // card click), as opposed to a direct URL load.
  const openedFromBoardRef = useRef(false)
  const focusReturnIssueKeyRef = useRef<string | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const currentUserId =
    session.status === 'authenticated' ? session.user.id : null

  const handleDrawerClose = useCallback((): void => {
    if (openedFromBoardRef.current) {
      const returnKey = focusReturnIssueKeyRef.current
      openedFromBoardRef.current = false
      focusReturnIssueKeyRef.current = null
      if (returnKey !== null) {
        setFocusIssueKey(returnKey)
      }
      navigate(-1)
    } else {
      openedFromBoardRef.current = false
      focusReturnIssueKeyRef.current = null
      setFocusIntent('list-heading')
      navigate(`/projects/${key}/board`, { replace: true })
    }
  }, [key, navigate])

  /**
   * Synchronous ownership lock for every issue mutation. Updated immediately at
   * the moment a mutation starts (never only via a post-render effect) so stale
   * closures and same-tick synthetic events fail closed. The lock is the single
   * authority deciding which mutation may be in flight; TanStack isPending only
   * drives the disabled UI state.
   */
  type MutationKind = 'create' | 'update' | 'archive' | 'move'
  const activeMutationRef = useRef<MutationKind | null>(null)

  const tryAcquireMutation = useCallback((kind: MutationKind): boolean => {
    // Every acquisition succeeds only when the lock is free. There is no
    // same-kind re-entry: a move's onMutate asserts ownership directly against
    // the ref rather than re-acquiring.
    if (activeMutationRef.current === null) {
      activeMutationRef.current = kind
      return true
    }
    return false
  }, [])

  /** Synchronous authority: true while any mutation owns the lock. */
  const mutationLocked = useCallback(
    (): boolean => activeMutationRef.current !== null,
    [],
  )

  const releaseMutation = useCallback((kind: MutationKind): void => {
    // Only the owning mutation may release; a stale completion never clears a
    // different (newer) owner.
    if (activeMutationRef.current === kind) {
      activeMutationRef.current = null
    }
  }, [])

  useEffect(() => {
    if (focusIssueKey !== null) {
      document.getElementById(`kanban-card-${focusIssueKey}`)?.focus()
      setFocusIssueKey(null)
    }
  }, [focusIssueKey])

  const createButtonRef = useRef<HTMLButtonElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const archiveTriggerRef = useRef<HTMLButtonElement>(null)
  const archiveConfirmRef = useRef<HTMLButtonElement>(null)
  const archiveCancelRef = useRef<HTMLButtonElement>(null)
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
    queryKey: ['issue', routeIssueKey ?? ''],
    queryFn: () => getIssue(routeIssueKey as string),
    enabled: routeIssueKey !== null,
  })

  const activityQuery = useQuery({
    queryKey: ['issue', routeIssueKey ?? '', 'activity'],
    queryFn: () => listIssueActivity(routeIssueKey as string),
    enabled: routeIssueKey !== null,
  })

  const canMutate =
    projectQuery.data?.currentUserRole === 'PROJECT_LEAD' ||
    projectQuery.data?.currentUserRole === 'MEMBER'

  const statusCodes = useMemo(
    () =>
      new Set<string>(
        (projectQuery.data?.workflowStatuses ?? []).map((s) => s.code),
      ),
    [projectQuery.data],
  )

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
      openedFromBoardRef.current = true
      focusReturnIssueKeyRef.current = issue.issueKey
      navigate(`/projects/${key}/issues/${encodeURIComponent(issue.issueKey)}`)
    },
    onError: (error: unknown) => {
      setFormError(safeErrorMessage(error))
    },
    onSettled: () => {
      releaseMutation('create')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (vars: {
      values: IssueFormValues
      issueKey: string
      version: number
    }) =>
      updateIssue(vars.issueKey, {
        title: vars.values.title,
        description:
          vars.values.description === '' ? null : vars.values.description,
        assigneeId: vars.values.assigneeId === '' ? null : vars.values.assigneeId,
        expectedVersion: vars.version,
      }),
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
      setFocusIntent('edit')
    },
    onError: async (error: unknown, vars) => {
      if (error instanceof ApiError) {
        if (error.code === 'VERSION_CONFLICT') {
          await refetchIssueCaches(vars.issueKey)
          setFormError(ERROR_MESSAGES.VERSION_CONFLICT)
          return
        }
        if (error.code === 'ISSUE_ARCHIVED') {
          await refetchIssueCaches(vars.issueKey)
          setActiveForm(null)
          setBannerAlert({ kind: 'info', message: ERROR_MESSAGES.ISSUE_ARCHIVED })
          setFocusIntent('list-heading')
          return
        }
      }
      setFormError(safeErrorMessage(error))
    },
    onSettled: () => {
      releaseMutation('update')
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (vars: { issueKey: string; version: number }) =>
      archiveIssue(vars.issueKey, {
        expectedVersion: vars.version,
      }),
    onSuccess: async (archived) => {
      setConfirmingArchive(false)
      setBannerAlert({ kind: 'info', message: 'Issue arşivlendi.' })
      if (routeIssueKey === archived.issueKey) {
        openedFromBoardRef.current = false
        focusReturnIssueKeyRef.current = null
        navigate(`/projects/${key}/board`, { replace: true })
      }
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
    },
    onError: async (error: unknown, vars) => {
      if (error instanceof ApiError) {
        if (error.code === 'VERSION_CONFLICT') {
          await refetchIssueCaches(vars.issueKey)
          setBannerAlert({
            kind: 'error',
            message: ERROR_MESSAGES.VERSION_CONFLICT,
          })
          return
        }
        if (error.code === 'ISSUE_ARCHIVED') {
          await refetchIssueCaches(vars.issueKey)
          setConfirmingArchive(false)
          setBannerAlert({
            kind: 'info',
            message: ERROR_MESSAGES.ISSUE_ARCHIVED,
          })
          setFocusIntent('list-heading')
          return
        }
      }
      setConfirmingArchive(false)
      setBannerAlert({ kind: 'error', message: safeErrorMessage(error) })
      setFocusIntent('archive')
    },
    onSettled: () => {
      releaseMutation('archive')
    },
  })

  const moveMutation = useMutation({
    mutationFn: (vars: {
      issueKey: string
      targetStatusCode: string
      beforeIssueKey: string | null
      afterIssueKey: string | null
      expectedVersion: number
      targetIndex: number
    }) =>
      moveIssue(vars.issueKey, {
        targetStatusCode: vars.targetStatusCode,
        beforeIssueKey: vars.beforeIssueKey,
        afterIssueKey: vars.afterIssueKey,
        expectedVersion: vars.expectedVersion,
      }),
    onMutate: async (vars) => {
      // Defensive ownership assertion: handleMove acquires the synchronous lock
      // before mutate; onMutate only confirms that the already-acquired owner is
      // a move and never re-acquires. Anything else fails closed.
      if (activeMutationRef.current !== 'move') {
        throw new Error('blocked')
      }
      const listKey = ['issues', key, ISSUE_LIST_FILTERS]
      const detailKey = ['issue', vars.issueKey]
      const activityKey = ['issue', vars.issueKey, 'activity']

      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey, exact: true }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ])

      const listSnapshot = queryClient.getQueryData<IssuePage>(listKey)
      const detailSnapshot = queryClient.getQueryData<Issue>(detailKey)

      if (listSnapshot !== undefined) {
        queryClient.setQueryData(listKey, {
          ...listSnapshot,
          items: applyOptimisticMove(listSnapshot.items, {
            draggedKey: vars.issueKey,
            targetStatusCode: vars.targetStatusCode,
            targetIndex: vars.targetIndex,
          }),
        })
      }
      if (detailSnapshot !== undefined && detailSnapshot.issueKey === vars.issueKey) {
        queryClient.setQueryData(detailKey, {
          ...detailSnapshot,
          statusCode: vars.targetStatusCode,
        })
      }

      return { listSnapshot, detailSnapshot, listKey, detailKey, activityKey }
    },
    onSuccess: (moved: Issue, _vars) => {
      setBannerAlert({ kind: 'info', message: `${moved.issueKey} taşındı.` })
      // Reconcile the moved issue with the authoritative server response. The
      // pending-move invariant locks selection, so the moved issue is still the
      // selected issue; guard the comparison to be safe against any drift.
      const listKey = ['issues', key, ISSUE_LIST_FILTERS]
      const list = queryClient.getQueryData<IssuePage>(listKey)
      if (list !== undefined) {
        queryClient.setQueryData(listKey, {
          ...list,
          items: list.items.map((item) =>
            item.issueKey === moved.issueKey ? moved : item,
          ),
        })
      }
      if (routeIssueKey === moved.issueKey) {
        queryClient.setQueryData(['issue', moved.issueKey], moved)
      }
      setFocusIssueKey(moved.issueKey)
    },
    onError: async (error: unknown, vars, context) => {
      // Restore every changed cache entry exactly.
      if (context?.listSnapshot !== undefined) {
        queryClient.setQueryData(context.listKey, context.listSnapshot)
      }
      if (context?.detailSnapshot !== undefined) {
        queryClient.setQueryData(context.detailKey, context.detailSnapshot)
      }

      if (error instanceof ApiError) {
        if (error.code === 'VERSION_CONFLICT') {
          setBannerAlert({
            kind: 'error',
            message: ERROR_MESSAGES.VERSION_CONFLICT,
          })
          await refetchIssueCaches(vars.issueKey)
          return
        }
        if (error.code === 'ISSUE_ARCHIVED') {
          setBannerAlert({ kind: 'info', message: ERROR_MESSAGES.ISSUE_ARCHIVED })
          await refetchIssueCaches(vars.issueKey)
          setFocusIntent('list-heading')
          return
        }
      }
      setBannerAlert({ kind: 'error', message: GENERIC_ERROR })
      setFocusIssueKey(vars.issueKey)
    },
    onSettled: (_data, _error, vars) => {
      releaseMutation('move')
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['issues', key, ISSUE_LIST_FILTERS],
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: ['issue', vars.issueKey],
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: ['issue', vars.issueKey, 'activity'],
          exact: true,
        }),
      ])
    },
  })

  const anyMutationPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    archiveMutation.isPending ||
    moveMutation.isPending

  useEffect(() => {
    if (focusIntent === null) {
      return
    }
    switch (focusIntent) {
      case 'edit':
        editButtonRef.current?.focus()
        break
      case 'archive':
        archiveTriggerRef.current?.focus()
        break
      case 'archive-cancel':
        archiveCancelRef.current?.focus()
        break
      case 'list-heading':
        listHeadingRef.current?.focus()
        break
    }
    setFocusIntent(null)
  }, [focusIntent])

  useEffect(() => {
    if (!confirmingArchive) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !archiveMutation.isPending) {
        setConfirmingArchive(false)
        setFocusIntent('archive')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [confirmingArchive, archiveMutation.isPending])

  const openCreate = (): void => {
    if (anyMutationPending || mutationLocked()) {
      return
    }
    setActiveForm('create')
    setFormError(null)
    setBannerAlert(null)
    setConfirmingArchive(false)
  }

  const closeCreate = (): void => {
    if (createMutation.isPending || mutationLocked()) {
      return
    }
    setActiveForm(null)
    setFormError(null)
    createButtonRef.current?.focus()
  }

  const openEdit = (): void => {
    if (anyMutationPending || mutationLocked()) {
      return
    }
    setFormError(null)
    setBannerAlert(null)
    setConfirmingArchive(false)
    setActiveForm('edit')
  }

  const closeEdit = (): void => {
    if (updateMutation.isPending || mutationLocked()) {
      return
    }
    setActiveForm(null)
    setFormError(null)
    setFocusIntent('edit')
  }

  const handleSelect = (issueKey: string): void => {
    if (anyMutationPending || mutationLocked()) {
      return
    }
    setConfirmingArchive(false)
    if (activeForm === 'edit') {
      setActiveForm(null)
      setFormError(null)
    }
    openedFromBoardRef.current = true
    focusReturnIssueKeyRef.current = issueKey
    navigate(`/projects/${key}/issues/${encodeURIComponent(issueKey)}`)
  }

  const handleCreateSubmit = (values: IssueFormValues): void => {
    if (anyMutationPending) {
      return
    }
    if (!tryAcquireMutation('create')) {
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
    if (anyMutationPending) {
      return
    }
    const current = issueQuery.data
    if (current === undefined) {
      return
    }
    if (!tryAcquireMutation('update')) {
      return
    }
    updateMutation.mutate({
      values,
      issueKey: current.issueKey,
      version: current.version,
    })
  }

  const handleArchive = (): void => {
    if (anyMutationPending || mutationLocked()) {
      return
    }
    setConfirmingArchive(true)
    setFocusIntent('archive-cancel')
  }

  const handleArchiveConfirm = (): void => {
    if (anyMutationPending) {
      return
    }
    const current = issueQuery.data
    if (current === undefined) {
      return
    }
    if (!tryAcquireMutation('archive')) {
      return
    }
    archiveMutation.mutate({
      issueKey: current.issueKey,
      version: current.version,
    })
  }

  const handleCancelArchive = (): void => {
    if (archiveMutation.isPending || mutationLocked()) {
      return
    }
    setConfirmingArchive(false)
    setFocusIntent('archive')
  }

  const handleMove = (
    issueKey: string,
    targetStatusCode: string,
    targetIndex: number,
  ): boolean => {
    if (anyMutationPending || mutationLocked()) {
      return false
    }
    const issues = issuesQuery.data?.items
    const statuses = projectQuery.data?.workflowStatuses ?? []
    if (issues === undefined || statuses.length === 0) {
      return false
    }
    const result = computeMove({
      workflowStatuses: statuses,
      issues,
      draggedKey: issueKey,
      targetStatusCode,
      targetIndex,
    })
    // A no-op or invalid/unknown target never reaches the API and never
    // announces a successful move.
    if (result.kind !== 'move') {
      return false
    }
    if (!tryAcquireMutation('move')) {
      return false
    }
    moveMutation.mutate({
      issueKey,
      targetStatusCode,
      beforeIssueKey: result.payload.beforeIssueKey,
      afterIssueKey: result.payload.afterIssueKey,
      expectedVersion: result.expectedVersion,
      targetIndex: result.targetIndex,
    })
    return true
  }

  const selectedIssue = issueQuery.data
  const activity: IssueActivity[] | undefined = activityQuery.data

  const drawerIssue =
    routeIssueKey !== null &&
    selectedIssue !== undefined &&
    selectedIssue.projectKey === key
      ? selectedIssue
      : null
  const drawerOpen = drawerIssue !== null

  return (
    <div className="issue-workspace">
      <div
        className="issue-workspace__content"
        inert={drawerOpen ? true : undefined}
      >
        <nav className="issue-workspace__nav" aria-label="Proje gezinme">
          <Link className="issue-workspace__back" to={`/projects/${key}/settings`}>
            Proje ayarları
          </Link>
          <Link className="issue-workspace__back" to="/projects">
            Projelere dön
          </Link>
        </nav>

        <header className="issue-workspace__header">
          <div className="issue-workspace__heading-block">
            {projectQuery.isError ? (
              <h2 className="issue-workspace__heading">Proje yüklenemedi</h2>
            ) : (
              <h2 className="issue-workspace__heading">
                {projectQuery.data?.name ?? 'İssue yönetimi'}
              </h2>
            )}
            <p className="issue-workspace__key">{key}</p>
          </div>
          {canMutate && (
            <button
              type="button"
              ref={createButtonRef}
              className="issue-workspace__create"
              onClick={openCreate}
              disabled={anyMutationPending}
              aria-disabled={anyMutationPending}
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

        {projectQuery.isLoading && (
          <p className="issue-workspace__status" role="status">
            Proje yükleniyor…
          </p>
        )}
        {projectQuery.isError && (
          <p className="issue-workspace__error" role="alert">
            {PROJECT_ERROR_FALLBACK}
          </p>
        )}
        {membersQuery.isLoading && (
          <p className="issue-workspace__status" role="status">
            Üyeler yükleniyor…
          </p>
        )}
        {membersQuery.isError && (
          <p className="issue-workspace__error" role="alert">
            {MEMBERS_ERROR_FALLBACK}
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
            <ProjectBoard
              workflowStatuses={projectQuery.data?.workflowStatuses ?? []}
              issues={issuesQuery.data.items}
              selectedIssueKey={routeIssueKey}
              canMove={canMutate}
              moveDisabled={anyMutationPending}
              selectionDisabled={anyMutationPending}
              onSelect={handleSelect}
              onMove={handleMove}
              statusLabel={statusLabel}
              assigneeLabel={assigneeLabel}
            />
          )}

          {routeIssueKey !== null && issueQuery.isLoading && (
            <p className="issue-workspace__status" role="status">
              Issue yükleniyor…
            </p>
          )}

          {routeIssueKey !== null && issueQuery.isError && (
            <p className="issue-workspace__error" role="alert">
              {DETAIL_ERROR_FALLBACK}
            </p>
          )}

          {routeIssueKey !== null &&
            selectedIssue !== undefined &&
            selectedIssue.projectKey !== key && (
              <p className="issue-workspace__error" role="alert">
                Bu issue bu projede bulunamadı.
              </p>
            )}
        </section>
      </div>

      {drawerIssue !== null && (
        <IssueDrawer
          issue={drawerIssue}
          currentUserId={currentUserId}
          currentUserRole={projectQuery.data?.currentUserRole ?? 'VIEWER'}
          members={membersQuery.data ?? []}
          activity={activity}
          activityLoading={activityQuery.isLoading}
          activityError={activityQuery.isError}
          statusLabel={statusLabel}
          statusCodes={statusCodes}
          assigneeLabel={assigneeLabel}
          escapeBlocked={commentsBusy || confirmingArchive}
          onBusyChange={setCommentsBusy}
          onClose={handleDrawerClose}
          closeButtonRef={closeButtonRef}
        >
          {canMutate && !drawerIssue.archived && (
            <div className="issue-drawer-actions">
              {!confirmingArchive && activeForm !== 'edit' && (
                <>
                  <button
                    type="button"
                    ref={editButtonRef}
                    className="issue-drawer-actions__btn"
                    onClick={openEdit}
                    disabled={anyMutationPending}
                    aria-disabled={anyMutationPending}
                  >
                    Düzenle
                  </button>
                  <button
                    type="button"
                    ref={archiveTriggerRef}
                    className="issue-drawer-actions__btn issue-drawer-actions__btn--danger"
                    onClick={handleArchive}
                    disabled={anyMutationPending}
                    aria-disabled={anyMutationPending}
                  >
                    Arşivle
                  </button>
                </>
              )}
              {confirmingArchive && (
                <span className="issue-drawer-actions__confirm">
                  <span className="issue-drawer-actions__confirm-text">
                    Bu issue arşivlensin mi?
                  </span>
                  <button
                    type="button"
                    ref={archiveConfirmRef}
                    className="issue-drawer-actions__btn issue-drawer-actions__btn--danger"
                    onClick={handleArchiveConfirm}
                    disabled={archiveMutation.isPending || anyMutationPending}
                    aria-disabled={
                      archiveMutation.isPending || anyMutationPending
                    }
                  >
                    Arşivlemeyi onayla
                  </button>
                  <button
                    type="button"
                    ref={archiveCancelRef}
                    className="issue-drawer-actions__btn"
                    onClick={handleCancelArchive}
                    disabled={archiveMutation.isPending || anyMutationPending}
                    aria-disabled={
                      archiveMutation.isPending || anyMutationPending
                    }
                  >
                    Vazgeç
                  </button>
                </span>
              )}
            </div>
          )}
          {activeForm === 'edit' && canMutate && (
            <IssueForm
              key={`edit-${drawerIssue.issueKey}`}
              mode="edit"
              initialType={drawerIssue.type}
              initialTitle={drawerIssue.title}
              initialDescription={drawerIssue.description ?? ''}
              initialAssigneeId={drawerIssue.assigneeId}
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
        </IssueDrawer>
      )}
    </div>
  )
}

export { ISSUE_LIST_FILTERS }
