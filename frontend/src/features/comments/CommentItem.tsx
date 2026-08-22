import type { ReactElement } from 'react'
import type { IssueComment } from './types'

const DELETED_LABEL = 'Bu yorum silindi.'

interface CommentItemProps {
  comment: IssueComment
  authorLabel: string
  currentUserId: string | null
  canComment: boolean
  isModerator: boolean
  isEditing: boolean
  editDraft: string
  editPending: boolean
  editError: string | null
  isConfirmingDelete: boolean
  deletePending: boolean
  actionsDisabled: boolean
  onEditChange: (value: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onStartDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}

export function CommentItem({
  comment,
  authorLabel,
  currentUserId,
  canComment,
  isModerator,
  isEditing,
  editDraft,
  editPending,
  editError,
  isConfirmingDelete,
  deletePending,
  actionsDisabled,
  onEditChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
}: CommentItemProps): ReactElement {
  const isOwnComment = comment.authorId === currentUserId
  const canEdit = canComment && isOwnComment
  const canDelete =
    !comment.deleted && (canComment && isOwnComment ? true : isModerator)

  if (comment.deleted) {
    // Tombstone: render only the fixed client label. The raw/previous body is
    // never rendered, and no mutation controls are exposed.
    return (
      <li className="comment-item comment-item--deleted">
        <span className="comment-item__deleted">{DELETED_LABEL}</span>
      </li>
    )
  }

  return (
    <li className="comment-item">
      <header className="comment-item__meta">
        <span className="comment-item__author">{authorLabel}</span>
        <time className="comment-item__time">
          {new Date(comment.createdAt).toLocaleString('tr-TR')}
        </time>
      </header>

      <p className="comment-item__body">{comment.body ?? ''}</p>

      {isEditing && canEdit ? (
        <div className="comment-item__edit">
          <label className="comment-item__edit-label" htmlFor={`comment-edit-${comment.id}`}>
            Yorumu düzenle
          </label>
          <textarea
            id={`comment-edit-${comment.id}`}
            className="comment-item__edit-input"
            value={editDraft}
            maxLength={5000}
            onChange={(event) => onEditChange(event.target.value)}
          />
          {editError !== null && (
            <p className="comment-item__error" role="alert">
              {editError}
            </p>
          )}
          <div className="comment-item__edit-actions">
            <button
              type="button"
              className="comment-item__action comment-item__action--primary"
              onClick={onSaveEdit}
              disabled={editPending || actionsDisabled}
              aria-disabled={editPending || actionsDisabled}
            >
              {editPending ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button
              type="button"
              className="comment-item__action"
              onClick={onCancelEdit}
              disabled={editPending || actionsDisabled}
              aria-disabled={editPending || actionsDisabled}
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className="comment-item__actions">
          {canEdit && (
            <button
              type="button"
              className="comment-item__action"
              onClick={onStartEdit}
              disabled={actionsDisabled}
              aria-disabled={actionsDisabled}
            >
              Düzenle
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="comment-item__action comment-item__action--danger"
              onClick={onStartDelete}
              disabled={actionsDisabled}
              aria-disabled={actionsDisabled}
            >
              Sil
            </button>
          )}
        </div>
      )}

      {isConfirmingDelete && canDelete && (
        <div className="comment-item__confirm">
          <span className="comment-item__confirm-text">
            Bu yorum silinsin mi?
          </span>
          <button
            type="button"
            className="comment-item__action comment-item__action--danger"
            onClick={onConfirmDelete}
            disabled={deletePending || actionsDisabled}
            aria-disabled={deletePending || actionsDisabled}
          >
            Silmeyi onayla
          </button>
          <button
            type="button"
            className="comment-item__action"
            onClick={onCancelDelete}
            disabled={deletePending || actionsDisabled}
            aria-disabled={deletePending || actionsDisabled}
          >
            Vazgeç
          </button>
        </div>
      )}
    </li>
  )
}
