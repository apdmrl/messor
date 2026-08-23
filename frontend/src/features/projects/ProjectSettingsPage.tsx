import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useState } from 'react'
import { ApiError } from '../../app/apiClient'
import {
  addProjectMember,
  changeProjectMemberRole,
  getProject,
  listProjectMembers,
  removeProjectMember,
} from './projectsApi'
import type {
  AddProjectMemberInput,
  ChangeProjectMemberRoleInput,
  ProjectMember,
  ProjectRole,
} from './types'
import './ProjectSettingsPage.css'

const MEMBERS_QUERY_KEY = (projectKey: string): readonly string[] => [
  'projects',
  projectKey,
  'members',
]

const DEMO_EMAILS = ['admin@demo.messor.app', 'member@demo.messor.app'] as const
const ROLES: ProjectRole[] = ['PROJECT_LEAD', 'MEMBER', 'VIEWER']

type SectionId = 'overview' | 'workflow' | 'members' | 'appearance' | 'danger'

const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: 'overview', label: 'Genel Bakış' },
  { id: 'workflow', label: 'İş Akışı' },
  { id: 'members', label: 'Üyeler' },
  { id: 'appearance', label: 'Görünüm' },
  { id: 'danger', label: 'Tehlikeli Bölge' },
]

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('tr-TR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

const LIST_ERROR_FALLBACK = 'Üyelikler yüklenemedi. Lütfen tekrar deneyin.'
const GENERIC_ERROR = 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'

const ERROR_MESSAGES: Record<string, string> = {
  MEMBER_ALREADY_EXISTS: 'Bu kullanıcı zaten proje üyesi.',
  USER_NOT_FOUND: 'Bu e-posta adresiyle etkin bir kullanıcı bulunamadı.',
  LAST_PROJECT_LEAD_REQUIRED: 'Projede en az bir proje lideri kalmalıdır.',
  VERSION_CONFLICT:
    'Üyelik başka bir işlem tarafından güncellendi. Liste yenilendi; lütfen tekrar deneyin.',
}

function roleLabel(role: ProjectRole): string {
  switch (role) {
    case 'PROJECT_LEAD':
      return 'Proje lideri'
    case 'MEMBER':
      return 'Üye'
    case 'VIEWER':
      return 'İzleyici'
  }
}

function memberName(member: ProjectMember): string {
  return `${member.firstName} ${member.lastName}`.trim()
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] ?? GENERIC_ERROR
  }
  return GENERIC_ERROR
}

export function ProjectSettingsPage(): ReactElement {
  const { projectKey } = useParams<{ projectKey: string }>()
  const key = projectKey ?? ''
  const queryClient = useQueryClient()

  const [addEmail, setAddEmail] = useState<string>(DEMO_EMAILS[0])
  const [addRole, setAddRole] = useState<ProjectRole>('MEMBER')
  const [pendingRoleChanges, setPendingRoleChanges] = useState<
    Record<string, ProjectRole>
  >({})
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<SectionId>('overview')

  const projectQuery = useQuery({
    queryKey: ['projects', key],
    queryFn: () => getProject(key),
    enabled: key !== '',
  })

  const membersQuery = useQuery({
    queryKey: MEMBERS_QUERY_KEY(key),
    queryFn: () => listProjectMembers(key),
    enabled: key !== '',
  })

  const refreshMembers = (): Promise<void> =>
    queryClient.invalidateQueries({
      queryKey: MEMBERS_QUERY_KEY(key),
      exact: true,
    })

  const recoverFromVersionConflict = async (): Promise<void> => {
    await queryClient.refetchQueries({
      queryKey: MEMBERS_QUERY_KEY(key),
      exact: true,
      type: 'active',
    })
    setMutationError(ERROR_MESSAGES.VERSION_CONFLICT)
  }

  const addMutation = useMutation({
    mutationFn: (input: AddProjectMemberInput) => addProjectMember(key, input),
    onSuccess: async () => {
      setAddEmail(DEMO_EMAILS[0])
      setAddRole('MEMBER')
      setMutationError(null)
      await refreshMembers()
    },
    onError: async (error: unknown) => {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        await recoverFromVersionConflict()
        return
      }
      setMutationError(safeErrorMessage(error))
    },
  })

  const changeRoleMutation = useMutation({
    mutationFn: (input: {
      userId: string
      body: ChangeProjectMemberRoleInput
    }) => changeProjectMemberRole(key, input.userId, input.body),
    onSuccess: async () => {
      setPendingRoleChanges({})
      setMutationError(null)
      await refreshMembers()
    },
    onError: async (error: unknown) => {
      setPendingRoleChanges({})
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        await recoverFromVersionConflict()
        return
      }
      setMutationError(safeErrorMessage(error))
    },
  })

  const removeMutation = useMutation({
    mutationFn: (input: { userId: string; expectedVersion: number }) =>
      removeProjectMember(key, input.userId, input.expectedVersion),
    onSuccess: async () => {
      setConfirmingRemoval(null)
      setMutationError(null)
      await refreshMembers()
    },
    onError: async (error: unknown) => {
      setConfirmingRemoval(null)
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        await recoverFromVersionConflict()
        return
      }
      setMutationError(safeErrorMessage(error))
    },
  })

  const isLead = projectQuery.data?.currentUserRole === 'PROJECT_LEAD'

  const handleAddSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (addMutation.isPending) {
      return
    }
    addMutation.mutate({ email: addEmail, role: addRole })
  }

  const handleRoleChange = (member: ProjectMember): void => {
    const nextRole = pendingRoleChanges[member.userId]
    if (nextRole === undefined || nextRole === member.role) {
      return
    }
    changeRoleMutation.mutate({
      userId: member.userId,
      body: { role: nextRole, expectedVersion: member.version },
    })
  }

  const handleConfirmRemoval = (member: ProjectMember): void => {
    removeMutation.mutate({
      userId: member.userId,
      expectedVersion: member.version,
    })
  }

  return (
    <div className="settings-page">
      <nav className="settings-page__nav" aria-label="Proje gezinme">
        <Link className="settings-page__back" to={`/projects/${key}/board`}>
          Panoya dön
        </Link>
        <Link
          className="settings-page__back settings-page__back--current"
          to={`/projects/${key}/settings`}
          aria-current="page"
        >
          Ayarlar
        </Link>
        <Link className="settings-page__back" to="/projects">
          Projelere dön
        </Link>
      </nav>

      <h2 className="settings-page__heading">Proje ayarları</h2>

      {projectQuery.isSuccess && (
        <header className="settings-page__identity">
          <div className="settings-page__identity-main">
            <h3 className="settings-page__identity-name">
              {projectQuery.data.name}
            </h3>
            <span className="settings-page__identity-key">
              {projectQuery.data.key}
            </span>
          </div>
          <span className="settings-page__identity-role">
            {roleLabel(projectQuery.data.currentUserRole)}
          </span>
          {projectQuery.data.description !== null && (
            <p className="settings-page__identity-description">
              {projectQuery.data.description}
            </p>
          )}
        </header>
      )}

      <nav
        className="settings-page__sections"
        aria-label="Ayarlar bölümleri"
        role="tablist"
      >
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            className={`settings-page__section-tab${
              activeSection === section.id
                ? ' settings-page__section-tab--active'
                : ''
            }`}
            aria-selected={activeSection === section.id}
            onClick={() => setActiveSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      {activeSection === 'overview' && projectQuery.isSuccess && (
        <section
          className="settings-page__section"
          role="tabpanel"
          aria-labelledby="overview-heading"
        >
          <h3 id="overview-heading" className="settings-page__section-heading">
            Proje bilgileri
          </h3>
          <dl className="settings-page__meta">
            <div className="settings-page__meta-row">
              <dt>Anahtar</dt>
              <dd>{projectQuery.data.key}</dd>
            </div>
            <div className="settings-page__meta-row">
              <dt>Açıklama</dt>
              <dd>{projectQuery.data.description ?? 'Açıklama yok.'}</dd>
            </div>
            <div className="settings-page__meta-row">
              <dt>Oluşturulma</dt>
              <dd>{formatDate(projectQuery.data.createdAt)}</dd>
            </div>
            <div className="settings-page__meta-row">
              <dt>Güncellenme</dt>
              <dd>{formatDate(projectQuery.data.updatedAt)}</dd>
            </div>
          </dl>
        </section>
      )}

      {activeSection === 'workflow' && projectQuery.isSuccess && (
        <section
          className="settings-page__section"
          role="tabpanel"
          aria-labelledby="workflow-heading"
        >
          <h3 id="workflow-heading" className="settings-page__section-heading">
            İş akışı durumları
          </h3>
          {projectQuery.data.workflowStatuses.length === 0 ? (
            <p className="settings-page__empty">
              Henüz iş akışı durumu tanımlanmadı.
            </p>
          ) : (
            <ol
              className="settings-page__workflow"
              aria-label="İş akışı durumları"
            >
              {projectQuery.data.workflowStatuses
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((status) => (
                  <li
                    key={status.code}
                    className="settings-page__workflow-item"
                  >
                    <span className="settings-page__workflow-position">
                      {status.position + 1}
                    </span>
                    <span className="settings-page__workflow-name">
                      {status.displayName}
                    </span>
                    <code className="settings-page__workflow-code">
                      {status.code}
                    </code>
                  </li>
                ))}
            </ol>
          )}
        </section>
      )}

      {activeSection === 'members' && (
        <section
          className="settings-page__section"
          role="tabpanel"
          aria-labelledby="members-heading"
        >
          <div className="settings-page__section-title-row">
            <h3 id="members-heading" className="settings-page__section-heading">
              Üyeler ve erişim
            </h3>
          </div>

          {!isLead && (
            <p className="settings-page__readonly-note" role="note">
              Üyelikler salt okunur. Üyeleri yalnızca proje liderleri
              yönetebilir.
            </p>
          )}

          {projectQuery.isLoading || membersQuery.isLoading ? (
            <p className="settings-page__status" role="status">
              Üyelikler yükleniyor…
            </p>
          ) : null}

          {(projectQuery.isError || membersQuery.isError) && (
            <p className="settings-page__error" role="alert">
              {LIST_ERROR_FALLBACK}
            </p>
          )}

          {mutationError !== null && (
            <p className="settings-page__error" role="alert">
              {mutationError}
            </p>
          )}

          {projectQuery.isSuccess &&
            membersQuery.isSuccess &&
            membersQuery.data.length === 0 && (
              <p className="settings-page__empty">Henüz proje üyesi yok.</p>
            )}

          {projectQuery.isSuccess &&
            membersQuery.isSuccess &&
            membersQuery.data.length > 0 && (
              <ul className="settings-page__members" aria-label="Proje üyeleri">
                {membersQuery.data.map((member) => (
                  <li key={member.userId} className="member-card">
                    <div className="member-card__identity">
                      <span className="member-card__name">
                        {memberName(member)}
                      </span>
                      <span className="member-card__email">{member.email}</span>
                    </div>

                    {isLead ? (
                      <div className="member-card__controls">
                        <label className="member-card__role-label">
                          <span className="member-card__role-text">
                            {memberName(member)} rolü
                          </span>
                          <select
                            className="member-card__role-select"
                            aria-label={`${memberName(member)} rolü`}
                            value={
                              pendingRoleChanges[member.userId] ?? member.role
                            }
                            onChange={(event) =>
                              setPendingRoleChanges((prev) => ({
                                ...prev,
                                [member.userId]: event.target
                                  .value as ProjectRole,
                              }))
                            }
                          >
                            {ROLES.map((role) => (
                              <option key={role} value={role}>
                                {roleLabel(role)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="member-card__action"
                          aria-label={`${memberName(member)} rolünü değiştir`}
                          onClick={() => handleRoleChange(member)}
                          disabled={
                            changeRoleMutation.isPending ||
                            (pendingRoleChanges[member.userId] ??
                              member.role) === member.role
                          }
                        >
                          Rolü değiştir
                        </button>

                        {confirmingRemoval === member.userId ? (
                          <span className="member-card__confirm">
                            <span className="member-card__confirm-text">
                              {memberName(member)} kaldırılsın mı?
                            </span>
                            <button
                              type="button"
                              className="member-card__action member-card__action--danger"
                              aria-label={`${memberName(member)} kaldırmayı onayla`}
                              onClick={() => handleConfirmRemoval(member)}
                              disabled={removeMutation.isPending}
                            >
                              Kaldırmayı onayla
                            </button>
                            <button
                              type="button"
                              className="member-card__action"
                              aria-label={`${memberName(member)} kaldırmadan vazgeç`}
                              onClick={() => setConfirmingRemoval(null)}
                              disabled={removeMutation.isPending}
                            >
                              Vazgeç
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="member-card__action member-card__action--danger"
                            aria-label={`${memberName(member)} üyeyi kaldır`}
                            onClick={() => setConfirmingRemoval(member.userId)}
                          >
                            Üyeyi kaldır
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="member-card__role-badge">
                        {roleLabel(member.role)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

          {isLead && (
            <section
              className="settings-page__add"
              aria-labelledby="add-member-heading"
            >
              <h3
                id="add-member-heading"
                className="settings-page__add-heading"
              >
                Üye ekle
              </h3>
              <form
                className="settings-page__add-form"
                onSubmit={handleAddSubmit}
              >
                <label className="settings-page__field">
                  <span className="settings-page__field-label">E-posta</span>
                  <select
                    className="settings-page__input"
                    value={addEmail}
                    onChange={(event) => setAddEmail(event.target.value)}
                    disabled={addMutation.isPending}
                  >
                    {DEMO_EMAILS.map((email) => (
                      <option key={email} value={email}>
                        {email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-page__field">
                  <span className="settings-page__field-label">Rol</span>
                  <select
                    className="settings-page__input"
                    value={addRole}
                    onChange={(event) =>
                      setAddRole(event.target.value as ProjectRole)
                    }
                    disabled={addMutation.isPending}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="settings-page__submit"
                  disabled={addMutation.isPending}
                >
                  {addMutation.isPending ? 'Ekleniyor…' : 'Üye ekle'}
                </button>
              </form>
            </section>
          )}
        </section>
      )}
      {activeSection === 'appearance' && (
        <section
          className="settings-page__section"
          role="tabpanel"
          aria-labelledby="appearance-heading"
        >
          <h3 id="appearance-heading" className="settings-page__section-heading">
            Görünüm
          </h3>
          <p className="settings-page__appearance-note" role="note">
            Bu çalışma alanının görünümü sistem temanızı izler ve anlamsal
            renk belirteçlerine eşlenir. Proje başına görünüm geçersiz kılma
            şu anda sunulmuyor.
          </p>
        </section>
      )}

      {activeSection === 'danger' && (
        <section
          className="settings-page__section"
          role="tabpanel"
          aria-labelledby="danger-heading"
        >
          <h3 id="danger-heading" className="settings-page__section-heading">
            Tehlikeli Bölge
          </h3>
          <div className="settings-page__danger" role="note">
            <p className="settings-page__danger-title">Projeyi silme</p>
            <p className="settings-page__danger-text">
              Proje silme şu anda bu çalışma alanında desteklenmiyor. Yıkıcı
              işlemler, kullanıma sunulduğunda ayrı bir onay akışı gerektirir.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}

export { MEMBERS_QUERY_KEY }
