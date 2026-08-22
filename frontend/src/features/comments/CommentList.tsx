import type { ReactElement } from 'react'
import type { IssueComment } from './types'
import { CommentItem } from './CommentItem'

interface CommentListProps {
  comments: IssueComment[]
  currentUserId: string | null
  canComment: boolean
  isModerator: boolean
  members: Map<string, string>
  editingId: string | null
  editDraft: string
  editPending: boolean
  editError: string | null
  confirmingDeleteId: string | null
  deletePending: boolean
  actionsDisabled: boolean
  onEditChange: (commentId: string, value: string) => void
  onStartEdit: (commentId: string) => void
  onCancelEdit: () => void
  onSaveEdit: (commentId: string) => void
  onStartDelete: (commentId: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (commentId: string) => void
}

function authorLabel(authorId: string, members: Map<string, string>): string {
  return members.get(authorId) ?? 'Bilinmeyen kullanıcı'
}

export function CommentList({
  comments,
  currentUserId,
  canComment,
  isModerator,
  members,
  editingId,
  editDraft,
  editPending,
  editError,
  confirmingDeleteId,
  deletePending,
  actionsDisabled,
  onEditChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
}: CommentListProps): ReactElement {
  return (
    <ul className="comment-list" aria-label="Yorumlar">
      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          authorLabel={authorLabel(comment.authorId, members)}
          currentUserId={currentUserId}
          canComment={canComment}
          isModerator={isModerator}
          isEditing={editingId === comment.id}
          editDraft={editingId === comment.id ? editDraft : ''}
          editPending={editPending}
          editError={editingId === comment.id ? editError : null}
          isConfirmingDelete={confirmingDeleteId === comment.id}
          deletePending={deletePending}
          actionsDisabled={actionsDisabled}
          onEditChange={(value) => onEditChange(comment.id, value)}
          onStartEdit={() => onStartEdit(comment.id)}
          onCancelEdit={onCancelEdit}
          onSaveEdit={() => onSaveEdit(comment.id)}
          onStartDelete={() => onStartDelete(comment.id)}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={() => onConfirmDelete(comment.id)}
        />
      ))}
    </ul>
  )
}
