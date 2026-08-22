import type { ReactElement, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ProjectMember } from '../projects/types'
import { issueTypeLabel, ISSUE_TYPES } from './issueLabels'
import type { IssueType } from './types'
import './IssueForm.css'

export interface IssueFormValues {
  type: IssueType
  title: string
  description: string
  assigneeId: string
}

function memberName(member: ProjectMember): string {
  return `${member.firstName} ${member.lastName}`.trim()
}

interface IssueFormProps {
  mode: 'create' | 'edit'
  initialType: IssueType
  initialTitle: string
  initialDescription: string
  initialAssigneeId: string | null
  members: ProjectMember[]
  pending: boolean
  error: string | null
  submitLabel: string
  pendingLabel: string
  onSubmit: (values: IssueFormValues) => void
  onCancel: () => void
  firstFieldRef: RefObject<HTMLInputElement | null>
}

export function IssueForm({
  mode,
  initialType,
  initialTitle,
  initialDescription,
  initialAssigneeId,
  members,
  pending,
  error,
  submitLabel,
  pendingLabel,
  onSubmit,
  onCancel,
  firstFieldRef,
}: IssueFormProps): ReactElement {
  const [type, setType] = useState<IssueType>(initialType)
  const [title, setTitle] = useState<string>(initialTitle)
  const [description, setDescription] = useState<string>(
    initialDescription ?? '',
  )
  const [assigneeId, setAssigneeId] = useState<string>(
    initialAssigneeId ?? '',
  )
  const [validationError, setValidationError] = useState<string | null>(null)

  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pending) {
        onCancel()
      }
    }
    const node = formRef.current
    node?.addEventListener('keydown', onKeyDown)
    return () => node?.removeEventListener('keydown', onKeyDown)
  }, [pending, onCancel])

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (pending) {
      return
    }
    if (title.trim() === '') {
      setValidationError('Başlık boş bırakılamaz.')
      return
    }
    setValidationError(null)
    onSubmit({
      type,
      title: title.trim(),
      description,
      assigneeId: assigneeId === '' ? '' : assigneeId,
    })
  }

  return (
    <form
      ref={formRef}
      className="issue-form"
      onSubmit={handleSubmit}
      aria-label={mode === 'create' ? 'Yeni issue oluştur' : 'Issue düzenle'}
    >
      <div className="issue-form__heading-row">
        <h3 className="issue-form__heading">
          {mode === 'create' ? 'Yeni issue' : 'Issue düzenle'}
        </h3>
        <button
          type="button"
          className="issue-form__close"
          aria-label="Paneli kapat"
          onClick={onCancel}
          disabled={pending}
        >
          Kapat
        </button>
      </div>

      {mode === 'create' && (
        <label className="issue-form__field">
          <span className="issue-form__label">Tür</span>
          <select
            className="issue-form__input"
            value={type}
            onChange={(event) => setType(event.target.value as IssueType)}
            disabled={pending}
          >
            {ISSUE_TYPES.map((option) => (
              <option key={option} value={option}>
                {issueTypeLabel(option)}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="issue-form__field">
        <span className="issue-form__label">Başlık</span>
        <input
          ref={firstFieldRef}
          className="issue-form__input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={pending}
          maxLength={200}
        />
      </label>

      <label className="issue-form__field">
        <span className="issue-form__label">Açıklama</span>
        <textarea
          className="issue-form__input issue-form__textarea"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={pending}
          maxLength={10000}
          rows={5}
        />
      </label>

      <label className="issue-form__field">
        <span className="issue-form__label">Atanan</span>
        <select
          className="issue-form__input"
          value={assigneeId}
          onChange={(event) => setAssigneeId(event.target.value)}
          disabled={pending}
        >
          <option value="">Atanmamış</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {memberName(member)}
            </option>
          ))}
        </select>
      </label>

      {(validationError ?? error) !== null && (
        <p className="issue-form__error" role="alert">
          {validationError ?? error ?? ''}
        </p>
      )}

      <div className="issue-form__actions">
        <button
          type="submit"
          className="issue-form__submit"
          disabled={pending}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        <button
          type="button"
          className="issue-form__cancel"
          onClick={onCancel}
          disabled={pending}
        >
          Vazgeç
        </button>
      </div>
    </form>
  )
}
