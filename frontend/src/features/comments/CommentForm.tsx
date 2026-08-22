import type { ReactElement, RefObject } from 'react'

const MAX_LENGTH = 5000

interface CommentFormProps {
  value: string
  pending: boolean
  error: string | null
  disabled: boolean
  onSubmit: () => void
  onChange: (value: string) => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}

export function CommentForm({
  value,
  pending,
  error,
  disabled,
  onSubmit,
  onChange,
  textareaRef,
}: CommentFormProps): ReactElement {
  const trimmedBlank = value.trim() === ''
  const oversize = value.length > MAX_LENGTH
  const canSubmit = !trimmedBlank && !oversize && !pending && !disabled

  return (
    <form
      className="comment-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) {
          onSubmit()
        }
      }}
    >
      <label className="comment-form__label" htmlFor="comment-create-input">
        Yorum ekle
      </label>
      <textarea
        id="comment-create-input"
        ref={textareaRef}
        className="comment-form__input"
        value={value}
        maxLength={MAX_LENGTH}
        placeholder="Yorum yaz…"
        onChange={(event) => onChange(event.target.value)}
      />
      {oversize && (
        <p className="comment-form__error" role="alert">
          Yorum en fazla 5000 karakter olabilir.
        </p>
      )}
      {error !== null && (
        <p className="comment-form__error" role="alert">
          {error}
        </p>
      )}
      <div className="comment-form__footer">
        <span className="comment-form__hint">
          {value.length} / {MAX_LENGTH}
        </span>
        <button
          type="submit"
          className="comment-form__submit"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
        >
          {pending ? 'Gönderiliyor…' : 'Yorum yap'}
        </button>
      </div>
    </form>
  )
}
