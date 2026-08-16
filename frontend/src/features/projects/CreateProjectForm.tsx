import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { ApiError } from '../../app/apiClient'
import type { CreateProjectInput, ProjectDetail } from './types'

export interface CreateProjectFormProps {
  onSubmit: (input: CreateProjectInput) => Promise<ProjectDetail>
  pending: boolean
}

const KEY_MAX = 10
const NAME_MAX = 120
const DESCRIPTION_MAX = 2000

const NETWORK_FALLBACK = 'Bağlantı kurulamadı. Lütfen tekrar deneyin.'
const UNKNOWN_FALLBACK = 'Proje oluşturulamadı. Lütfen tekrar deneyin.'

interface FieldErrors {
  key?: string
  name?: string
  description?: string
}

function normalizeKey(value: string): string {
  return value.trim().toUpperCase()
}

function validate(
  key: string,
  name: string,
  description: string,
): FieldErrors {
  const errors: FieldErrors = {}

  const normalizedKey = normalizeKey(key)
  if (normalizedKey.length === 0) {
    errors.key = 'Proje anahtarı zorunludur.'
  } else if (normalizedKey.length > KEY_MAX) {
    errors.key = `Proje anahtarı en fazla ${KEY_MAX} karakter olabilir.`
  }

  const trimmedName = name.trim()
  if (trimmedName.length === 0) {
    errors.name = 'Proje adı zorunludur.'
  } else if (trimmedName.length > NAME_MAX) {
    errors.name = `Proje adı en fazla ${NAME_MAX} karakter olabilir.`
  }

  if (description.length > DESCRIPTION_MAX) {
    errors.description = `Açıklama en fazla ${DESCRIPTION_MAX} karakter olabilir.`
  }

  return errors
}

export function CreateProjectForm({
  onSubmit,
  pending,
}: CreateProjectFormProps): ReactElement {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending) {
      return
    }

    const errors = validate(key, name, description)
    setFieldErrors(errors)
    setSubmitError(null)

    if (Object.keys(errors).length > 0) {
      return
    }

    try {
      await onSubmit({
        key: normalizeKey(key),
        name: name.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
      })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'PROJECT_KEY_ALREADY_EXISTS') {
          setSubmitError(err.message)
        } else {
          setSubmitError(UNKNOWN_FALLBACK)
        }
      } else {
        setSubmitError(NETWORK_FALLBACK)
      }
    }
  }

  return (
    <form
      className="project-form"
      onSubmit={handleSubmit}
      aria-busy={pending}
      aria-label="Yeni proje oluşturma formu"
      noValidate
    >
      <div className="project-field">
        <label className="project-field__label" htmlFor="project-key">
          Proje anahtarı
        </label>
        <input
          id="project-key"
          className="project-field__input"
          type="text"
          name="key"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          disabled={pending}
          aria-invalid={fieldErrors.key !== undefined}
          aria-describedby={
            fieldErrors.key !== undefined ? 'project-key-error' : 'project-key-help'
          }
          required
        />
        {fieldErrors.key !== undefined ? (
          <p id="project-key-error" className="project-field__error" role="alert">
            {fieldErrors.key}
          </p>
        ) : (
          <p id="project-key-help" className="project-field__help">
            Büyük harfe çevrilir; örn. MES. En fazla {KEY_MAX} karakter.
          </p>
        )}
      </div>

      <div className="project-field">
        <label className="project-field__label" htmlFor="project-name">
          Proje adı
        </label>
        <input
          id="project-name"
          className="project-field__input"
          type="text"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          aria-invalid={fieldErrors.name !== undefined}
          aria-describedby={
            fieldErrors.name !== undefined ? 'project-name-error' : undefined
          }
          required
        />
        {fieldErrors.name !== undefined && (
          <p id="project-name-error" className="project-field__error" role="alert">
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div className="project-field">
        <label className="project-field__label" htmlFor="project-description">
          Açıklama
        </label>
        <textarea
          id="project-description"
          className="project-field__input project-field__textarea"
          name="description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={pending}
          rows={4}
          aria-invalid={fieldErrors.description !== undefined}
          aria-describedby={
            fieldErrors.description !== undefined
              ? 'project-description-error'
              : undefined
          }
        />
        {fieldErrors.description !== undefined && (
          <p
            id="project-description-error"
            className="project-field__error"
            role="alert"
          >
            {fieldErrors.description}
          </p>
        )}
      </div>

      {submitError !== null && (
        <p className="project-form__error" role="alert">
          {submitError}
        </p>
      )}

      <button
        className="project-form__submit"
        type="submit"
        disabled={pending}
      >
        {pending ? 'Oluşturuluyor…' : 'Proje oluştur'}
      </button>
    </form>
  )
}
