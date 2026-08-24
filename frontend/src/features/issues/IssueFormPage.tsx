import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ReactElement, RefObject } from 'react'
import { useRef } from 'react'
import { ApiError } from '../../app/apiClient'
import { getProject, listProjectMembers } from '../projects/projectsApi'
import { createIssue, getIssue, updateIssue } from './issuesApi'
import { IssueForm } from './IssueForm'
import type { IssueFormValues } from './IssueForm'
import type { IssueType } from './types'
import { RestrictedPage } from '../../app/routeBoundaries'
import './IssueFormPage.css'

const GENERIC_ERROR = 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
const PROJECT_ERROR_FALLBACK =
  'Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.'
const ISSUE_ERROR_FALLBACK = 'İş detayı yüklenemedi. Lütfen tekrar deneyin.'
const MEMBERS_ERROR_FALLBACK =
  'Üye listesi yüklenemedi. Lütfen tekrar deneyin.'

function safeErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'INVALID_ASSIGNEE') {
    return 'Seçilen atanan bu projenin üyesi değil.'
  }
  return GENERIC_ERROR
}

interface IssueFormPageProps {
  mode: 'create' | 'edit'
}

/**
 * Dedicated create and edit surfaces for an issue, composing the existing
 * {@link IssueForm} with the existing issue/project/member APIs. This is the
 * smallest wrapper that backs the approved `/issues/new` and
 * `/issues/:issueKey/edit` routes without inventing new backend behavior.
 */
export function IssueFormPage({ mode }: IssueFormPageProps): ReactElement {
  const { projectKey, issueKey } = useParams<{
    projectKey: string
    issueKey?: string
  }>()
  const key = projectKey ?? ''
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const firstFieldRef: RefObject<HTMLInputElement | null> = useRef(null)

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

  const issueQuery = useQuery({
    queryKey: ['issue', issueKey ?? ''],
    queryFn: () => getIssue(issueKey as string),
    enabled: mode === 'edit' && issueKey !== undefined,
  })

  const issue = mode === 'edit' ? (issueQuery.data ?? null) : null
  const editReady =
    mode === 'edit'
      ? issueQuery.isSuccess &&
        issue !== undefined &&
        issue.projectKey === key
      : true

  const canMutate =
    projectQuery.data?.currentUserRole === 'PROJECT_LEAD' ||
    projectQuery.data?.currentUserRole === 'MEMBER'

  const createMutation = useMutation({
    mutationFn: (input: {
      type: IssueType
      title: string
      description: string | null
      assigneeId: string | null
    }) => createIssue(key, input),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['issues', key] })
      navigate(
        `/projects/${key}/issues/${encodeURIComponent(created.issueKey)}`,
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: (values: IssueFormValues) =>
      updateIssue(issue!.issueKey, {
        title: values.title,
        description: values.description === '' ? null : values.description,
        assigneeId: values.assigneeId === '' ? null : values.assigneeId,
        expectedVersion: issue!.version,
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['issues', key] })
      void queryClient.invalidateQueries({
        queryKey: ['issue', updated.issueKey],
      })
      navigate(
        `/projects/${key}/issues/${encodeURIComponent(updated.issueKey)}`,
      )
    },
  })

  if (projectQuery.isError) {
    return (
      <div className="issue-form-page">
        <p className="issue-form-page__error" role="alert">
          {PROJECT_ERROR_FALLBACK}
        </p>
      </div>
    )
  }

  if (mode === 'edit' && issueQuery.isError) {
    return (
      <div className="issue-form-page">
        <p className="issue-form-page__error" role="alert">
          {ISSUE_ERROR_FALLBACK}
        </p>
      </div>
    )
  }

  // Read-only users and cross-project edit URLs fail closed with the neutral
  // restricted boundary rather than exposing a mutation form.
  if (!canMutate || !editReady) {
    return <RestrictedPage />
  }

  const pending =
    mode === 'create'
      ? createMutation.isPending
      : updateMutation.isPending

  const handleSubmit = (values: IssueFormValues): void => {
    if (pending) {
      return
    }
    if (mode === 'create') {
      createMutation.mutate({
        type: values.type,
        title: values.title,
        description: values.description === '' ? null : values.description,
        assigneeId: values.assigneeId === '' ? null : values.assigneeId,
      })
      return
    }
    updateMutation.mutate(values)
  }

  return (
    <div className="issue-form-page">
      <nav className="issue-form-page__nav" aria-label="Proje gezinme">
        <Link className="issue-form-page__back" to={`/projects/${key}/board`}>
          Pano
        </Link>
        <Link className="issue-form-page__back" to={`/projects/${key}/issues`}>
          İşler
        </Link>
      </nav>
      <header className="issue-form-page__header">
        <h2 className="issue-form-page__heading">
          {projectQuery.data?.name ?? key}
        </h2>
        <p className="issue-form-page__key">{key}</p>
      </header>

      {membersQuery.isLoading && (
        <p className="issue-form-page__status" role="status">
          Üyeler yükleniyor…
        </p>
      )}
      {membersQuery.isError && (
        <p className="issue-form-page__error" role="alert">
          {MEMBERS_ERROR_FALLBACK}
        </p>
      )}

      {mode === 'create' && (
        <IssueForm
          key="create"
          mode="create"
          initialType="TASK"
          initialTitle=""
          initialDescription=""
          initialAssigneeId={null}
          members={membersQuery.data ?? []}
          pending={createMutation.isPending}
          error={safeErrorMessage(createMutation.error)}
          submitLabel="Oluştur"
          pendingLabel="Oluşturuluyor…"
          onSubmit={handleSubmit}
          onCancel={() => navigate(`/projects/${key}/issues`)}
          firstFieldRef={firstFieldRef}
        />
      )}
      {mode === 'edit' && issue !== null && (
        <IssueForm
          key={`edit-${issue.issueKey}`}
          mode="edit"
          initialType={issue.type}
          initialTitle={issue.title}
          initialDescription={issue.description ?? ''}
          initialAssigneeId={issue.assigneeId}
          members={membersQuery.data ?? []}
          pending={updateMutation.isPending}
          error={safeErrorMessage(updateMutation.error)}
          submitLabel="Güncelle"
          pendingLabel="Güncelleniyor…"
          onSubmit={handleSubmit}
          onCancel={() =>
            navigate(
              `/projects/${key}/issues/${encodeURIComponent(issue.issueKey)}`,
            )
          }
          firstFieldRef={firstFieldRef}
        />
      )}
    </div>
  )
}
