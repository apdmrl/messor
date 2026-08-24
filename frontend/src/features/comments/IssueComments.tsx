import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../app/apiClient'
import type { ProjectMember } from '../projects/types'
import {
  createComment,
  deleteComment,
  listIssueComments,
  updateComment,
} from './commentsApi'
import { CommentForm } from './CommentForm'
import { CommentList } from './CommentList'
import './IssueComments.css'

const GENERIC_ERROR = 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
const LIST_ERROR_FALLBACK = 'Yorumlar yüklenemedi. Lütfen tekrar deneyin.'

const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED:
    'Girilen bilgiler doğrulanamadı. Lütfen kontrol edip tekrar deneyin.',
  COMMENT_NOT_FOUND: 'Bu yorum bulunamadı.',
  ISSUE_NOT_FOUND: 'Bu iş bulunamadı.',
  PROJECT_NOT_FOUND: 'Bu proje bulunamadı.',
  FORBIDDEN: 'Bu işlem için yetkiniz yok.',
  VERSION_CONFLICT:
    'Yorum başka bir işlem tarafından güncellendi; yazdıkların korundu. Tekrar gözden geçirip gönder.',
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] ?? GENERIC_ERROR
  }
  return GENERIC_ERROR
}

type CommentMutationKind =
  | { kind: 'create' }
  | { kind: 'edit'; commentId: string }
  | { kind: 'delete'; commentId: string }

interface IssueCommentsProps {
  issueKey: string
  currentUserId: string | null
  canComment: boolean
  isModerator: boolean
  members: ProjectMember[]
  enabled: boolean
  /**
   * Reports whether a comment mutation is in flight or a delete confirmation is
   * open, so a parent drawer can keep Escape from closing mid-operation.
   */
  onBusyChange?: (busy: boolean) => void
}

export function IssueComments({
  issueKey,
  currentUserId,
  canComment,
  isModerator,
  members,
  enabled,
  onBusyChange,
}: IssueCommentsProps): ReactElement {
  const queryClient = useQueryClient()
  const [createDraft, setCreateDraft] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)

  const pendingMutationRef = useRef<CommentMutationKind | null>(null)
  const tryAcquireMutation = useCallback((kind: CommentMutationKind): boolean => {
    if (pendingMutationRef.current === null) {
      pendingMutationRef.current = kind
      return true
    }
    return false
  }, [])
  const mutationLocked = useCallback(
    (): boolean => pendingMutationRef.current !== null,
    [],
  )
  const releaseMutation = useCallback((kind: CommentMutationKind): void => {
    if (pendingMutationRef.current?.kind === kind.kind) {
      pendingMutationRef.current = null
    }
  }, [])

  const commentsQuery = useQuery({
    queryKey: ['issue', issueKey, 'comments'],
    queryFn: () => listIssueComments(issueKey),
    enabled,
  })

  const invalidateComments = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: ['issue', issueKey, 'comments'],
      exact: true,
    })
  }, [queryClient, issueKey])

  const refetchComments = useCallback(async (): Promise<void> => {
    await queryClient.refetchQueries({
      queryKey: ['issue', issueKey, 'comments'],
      exact: true,
      type: 'active',
    })
  }, [queryClient, issueKey])

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const member of members) {
      map.set(member.userId, `${member.firstName} ${member.lastName}`.trim())
    }
    return map
  }, [members])

  const createMutation = useMutation({
    mutationFn: (body: string) => createComment(issueKey, { body }),
    onMutate: () => {
      // Clear before the write lands so a repeated success transitions the
      // polite live region empty→message and is announced every time.
      setAnnouncement(null)
    },
    onSuccess: async () => {
      setCreateDraft('')
      setCreateError(null)
      setAnnouncement('Yorum gönderildi.')
      await invalidateComments()
    },
    onError: (error: unknown) => {
      setCreateError(safeErrorMessage(error))
    },
    onSettled: () => {
      releaseMutation({ kind: 'create' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (vars: {
      commentId: string
      body: string
      expectedVersion: number
    }) =>
      updateComment(vars.commentId, {
        body: vars.body,
        expectedVersion: vars.expectedVersion,
      }),
    onSuccess: async (_data, vars) => {
      setActionError(null)
      setEditingId((current) => (current === vars.commentId ? null : current))
      await invalidateComments()
    },
    onError: async (error: unknown, _vars) => {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        await refetchComments()
        setActionError(ERROR_MESSAGES.VERSION_CONFLICT)
        return
      }
      setActionError(safeErrorMessage(error))
    },
    onSettled: (_data, _error, vars) => {
      releaseMutation({ kind: 'edit', commentId: vars.commentId })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (vars: { commentId: string; expectedVersion: number }) =>
      deleteComment(vars.commentId, vars.expectedVersion),
    onSuccess: async (_data, vars) => {
      setActionError(null)
      setConfirmingDeleteId((current) =>
        current === vars.commentId ? null : current,
      )
      await invalidateComments()
    },
    onError: async (error: unknown, vars) => {
      setConfirmingDeleteId((current) =>
        current === vars.commentId ? null : current,
      )
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        await refetchComments()
        setActionError(ERROR_MESSAGES.VERSION_CONFLICT)
        return
      }
      setActionError(safeErrorMessage(error))
    },
    onSettled: (_data, _error, vars) => {
      releaseMutation({ kind: 'delete', commentId: vars.commentId })
    },
  })

  const anyCommentPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending

  const busy = anyCommentPending || confirmingDeleteId !== null

  // Report busy to a parent drawer via an effect, never during render (a render
  // phase call to the parent's setState would trigger the React "Cannot update a
  // component while rendering a different component" warning). The cleanup
  // reports false so an unmount (route/history navigation, drawer close) always
  // resets the parent's busy state.
  useEffect(() => {
    onBusyChange?.(busy)
    return () => {
      onBusyChange?.(false)
    }
  }, [busy, onBusyChange])

  const handleCreateSubmit = (): void => {
    if (mutationLocked()) {
      return
    }
    if (!tryAcquireMutation({ kind: 'create' })) {
      return
    }
    createMutation.mutate(createDraft)
  }

  const handleStartEdit = (commentId: string): void => {
    if (mutationLocked()) {
      return
    }
    const comment = commentsQuery.data?.find((c) => c.id === commentId)
    if (comment === undefined) {
      return
    }
    setConfirmingDeleteId(null)
    setActionError(null)
    setEditDraft(comment.body ?? '')
    setEditingId(commentId)
  }

  const handleEditChange = (commentId: string, value: string): void => {
    if (editingId === commentId) {
      setEditDraft(value)
    }
  }

  const handleSaveEdit = (commentId: string): void => {
    if (mutationLocked()) {
      return
    }
    const comment = commentsQuery.data?.find((c) => c.id === commentId)
    if (comment === undefined) {
      return
    }
    if (!tryAcquireMutation({ kind: 'edit', commentId })) {
      return
    }
    updateMutation.mutate({
      commentId,
      body: editDraft,
      expectedVersion: comment.version,
    })
  }

  const handleCancelEdit = (): void => {
    if (mutationLocked()) {
      return
    }
    setEditingId(null)
  }

  const handleStartDelete = (commentId: string): void => {
    if (mutationLocked()) {
      return
    }
    setEditingId(null)
    setActionError(null)
    setConfirmingDeleteId(commentId)
  }

  const handleCancelDelete = (): void => {
    if (mutationLocked()) {
      return
    }
    setConfirmingDeleteId(null)
  }

  const handleConfirmDelete = (commentId: string): void => {
    if (mutationLocked()) {
      return
    }
    const comment = commentsQuery.data?.find((c) => c.id === commentId)
    if (comment === undefined) {
      return
    }
    if (!tryAcquireMutation({ kind: 'delete', commentId })) {
      return
    }
    deleteMutation.mutate({ commentId, expectedVersion: comment.version })
  }

  const data = commentsQuery.data

  return (
    <div className="issue-comments">
      {/* Persistent polite live region announcing successful new comments. */}
      <p className="issue-comments__live" aria-live="polite">
        {announcement}
      </p>
      {!commentsQuery.isLoading && commentsQuery.isError && (
        <p className="issue-comments__error" role="alert">
          {LIST_ERROR_FALLBACK}
        </p>
      )}

      {commentsQuery.isLoading && (
        <p className="issue-comments__status" role="status">
          Yorumlar yükleniyor…
        </p>
      )}

      {actionError !== null && (
        <p className="issue-comments__error" role="alert">
          {actionError}
        </p>
      )}

      {commentsQuery.isSuccess && data !== undefined && (
        <>
          {data.length === 0 ? (
            <p className="issue-comments__empty">Henüz yorum yok.</p>
          ) : (
            <CommentList
              comments={data}
              currentUserId={currentUserId}
              canComment={canComment}
              isModerator={isModerator}
              members={memberNameMap}
              editingId={editingId}
              editDraft={editDraft}
              editPending={updateMutation.isPending}
              editError={editingId !== null ? actionError : null}
              confirmingDeleteId={confirmingDeleteId}
              deletePending={deleteMutation.isPending}
              actionsDisabled={anyCommentPending}
              onEditChange={handleEditChange}
              onStartEdit={handleStartEdit}
              onCancelEdit={handleCancelEdit}
              onSaveEdit={handleSaveEdit}
              onStartDelete={handleStartDelete}
              onCancelDelete={handleCancelDelete}
              onConfirmDelete={handleConfirmDelete}
            />
          )}
        </>
      )}

      {canComment && (
        <CommentForm
          value={createDraft}
          pending={createMutation.isPending}
          error={createError}
          disabled={mutationLocked()}
          onSubmit={handleCreateSubmit}
          onChange={(value) => {
            setCreateDraft(value)
            setCreateError(null)
          }}
        />
      )}
    </div>
  )
}
