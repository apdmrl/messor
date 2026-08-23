import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { ApiError } from '../../app/apiClient'
import { useSession } from '../../app/session'
import {
  changeProjectMemberRole,
  listProjectMembers,
  MEMBERS_QUERY_KEY,
  removeProjectMember,
} from './membershipApi'
import { getProject } from './projectsApi'
import type {
  ChangeProjectMemberRoleInput,
  ProjectMember,
  ProjectRole,
} from './membershipTypes'
import './MembersPage.css'

const ROLES: ProjectRole[] = ['PROJECT_LEAD', 'MEMBER', 'VIEWER']

/**
 * Permission-aware navigation data for the members surface. Exposed for route
 * integration (Task 7) so callers build the members link from one source.
 */
export const MEMBERS_ROUTE = (projectKey: string): string =>
  `/projects/${encodeURIComponent(projectKey)}/members`

const PROJECT_ERROR_FALLBACK =
  'Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.'
const LIST_ERROR_FALLBACK = 'Üyelikler yüklenemedi. Lütfen tekrar deneyin.'
const GENERIC_ERROR = 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'

const ERROR_MESSAGES: Record<string, string> = {
  LAST_PROJECT_LEAD_REQUIRED: 'Projede en az bir proje lideri kalmalıdır.',
  VERSION_CONFLICT:
    'Üyelik başka bir işlem tarafından güncellendi. Liste yenilendi; lütfen tekrar deneyin.',
  FORBIDDEN: 'Bu işlem için yetkiniz yok.',
  UNAUTHENTICATED: 'Oturumun sona erdi. Lütfen tekrar giriş yapın.',
}

/**
 * Project-access summary for a role: a short, user-facing explanation of what
 * the role can do, used in the table's Erişim column and the access legend.
 */
export const ROLE_ACCESS_SUMMARY: Readonly<Record<ProjectRole, string>> = {
  PROJECT_LEAD: 'Projeyi ve üyelikleri yönetir; tüm sorun işlemlerini yapabilir.',
  MEMBER: 'Sorunları oluşturur, günceller, taşır ve yorum yapar.',
  VIEWER: 'Yalnızca salt okunur erişime sahiptir.',
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

export function MembersPage(): ReactElement {
  const { projectKey } = useParams<{ projectKey: string }>()
  const key = projectKey ?? ''
  const queryClient = useQueryClient()
  const { session } = useSession()

  const currentUserId =
    session.status === 'authenticated' ? session.user.id : null

  const [query, setQuery] = useState('')
  const [pendingRoleChanges, setPendingRoleChanges] = useState<
    Record<string, ProjectRole>
  >({})
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

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

  const changeRoleMutation = useMutation({
    mutationFn: (input: {
      userId: string
      body: ChangeProjectMemberRoleInput
    }) => changeProjectMemberRole(key, input.userId, input.body),
    onSuccess: async (updated) => {
      setPendingRoleChanges({})
      setMutationError(null)
      setSuccessMessage(
        `${memberName(updated)} rolü ${roleLabel(updated.role)} olarak güncellendi.`,
      )
      await refreshMembers()
    },
    onError: async (error: unknown, input) => {
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
    onSuccess: async (_result, input) => {
      const removed = membersQuery.data?.find((m) => m.userId === input.userId)
      setConfirmingRemoval(null)
      setMutationError(null)
      setSuccessMessage(
        removed ? `${memberName(removed)} projeden kaldırıldı.` : 'Üye kaldırıldı.',
      )
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

  const filteredMembers = useMemo(() => {
    if (!membersQuery.data) {
      return []
    }
    const needle = query.trim().toLocaleLowerCase('tr-TR')
    if (needle === '') {
      return membersQuery.data
    }
    return membersQuery.data.filter((member) => {
      const name = memberName(member).toLocaleLowerCase('tr-TR')
      const email = member.email.toLocaleLowerCase('tr-TR')
      return name.includes(needle) || email.includes(needle)
    })
  }, [membersQuery.data, query])

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

  const showEmpty =
    projectQuery.isSuccess && membersQuery.isSuccess && membersQuery.data.length === 0
  const showNoMatches =
    projectQuery.isSuccess &&
    membersQuery.isSuccess &&
    membersQuery.data.length > 0 &&
    filteredMembers.length === 0

  return (
    <div className="members-page">
      <nav className="members-page__nav" aria-label="Üye gezinme">
        <Link className="members-page__back" to={`/projects/${key}/board`}>
          Panoya dön
        </Link>
        <Link className="members-page__back" to={`/projects/${key}/settings`}>
          Ayarlar
        </Link>
        <Link className="members-page__back" to="/projects">
          Projelere dön
        </Link>
      </nav>

      <h2 className="members-page__heading">Üyeler ve erişim</h2>

      {projectQuery.isLoading && (
        <p className="members-page__status" role="status">
          Proje bilgileri yükleniyor…
        </p>
      )}

      {projectQuery.isError && (
        <p className="members-page__error" role="alert">
          {PROJECT_ERROR_FALLBACK}
        </p>
      )}

      {projectQuery.isSuccess && (
        <header className="members-page__identity">
          <div className="members-page__identity-main">
            <h3 className="members-page__identity-name">
              {projectQuery.data.name}
            </h3>
            <span className="members-page__identity-key">
              {projectQuery.data.key}
            </span>
          </div>
          <span className="members-page__identity-role">
            {roleLabel(projectQuery.data.currentUserRole)}
          </span>
        </header>
      )}

      {!isLead && projectQuery.isSuccess && (
        <p className="members-page__readonly-note" role="note">
          Üyelikler salt okunur. Üyeleri yalnızca proje liderleri yönetebilir.
        </p>
      )}

      {mutationError !== null && (
        <p className="members-page__error" role="alert">
          {mutationError}
        </p>
      )}

      {successMessage !== null && (
        <p className="members-page__success" role="status">
          {successMessage}
        </p>
      )}

      <section
        className="members-page__access-legend"
        aria-labelledby="access-legend-heading"
      >
        <h3
          id="access-legend-heading"
          className="members-page__access-legend-heading"
        >
          Erişim düzeyleri
        </h3>
        <ul className="members-page__access-list">
          {ROLES.map((role) => (
            <li key={role} className="members-page__access-item">
              <span className="members-page__access-role">{roleLabel(role)}</span>
              <span className="members-page__access-text">
                {ROLE_ACCESS_SUMMARY[role]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {membersQuery.isLoading ? (
        <p className="members-page__status" role="status">
          Üyelikler yükleniyor…
        </p>
      ) : null}

      {membersQuery.isError && (
        <p className="members-page__error" role="alert">
          {LIST_ERROR_FALLBACK}
        </p>
      )}

      {showEmpty && (
        <p className="members-page__empty" role="note">
          Henüz proje üyesi yok.
        </p>
      )}

      {projectQuery.isSuccess && membersQuery.isSuccess && membersQuery.data.length > 0 && (
        <>
          <div className="members-page__toolbar">
            <label className="members-page__search">
              <span className="members-page__search-label">Üye ara</span>
              <input
                type="search"
                className="members-page__search-input"
                value={query}
                placeholder="İsim veya e-posta"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>

          {showNoMatches && (
            <p className="members-page__empty" role="note">
              Aradığın ölçütle eşleşen üye yok.
            </p>
          )}

          {!showNoMatches && (
            <table className="members-page__table" aria-label="Proje üyeleri">
              <thead>
                <tr>
                  <th scope="col">Üye</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Erişim</th>
                  {isLead && <th scope="col">İşlemler</th>}
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => {
                  const isCurrentUser = member.userId === currentUserId
                  return (
                    <tr key={member.userId} className="members-page__row">
                      <td className="members-page__member">
                        <span className="members-page__name">
                          {memberName(member)}
                          {isCurrentUser && (
                            <span className="members-page__you-badge">Siz</span>
                          )}
                        </span>
                        <span className="members-page__email">{member.email}</span>
                      </td>
                      <td className="members-page__role">
                        {isLead ? (
                          <select
                            className="members-page__role-select"
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
                        ) : (
                          <span className="members-page__role-badge">
                            {roleLabel(member.role)}
                          </span>
                        )}
                      </td>
                      <td className="members-page__access">
                        {ROLE_ACCESS_SUMMARY[member.role]}
                      </td>
                      {isLead && (
                        <td className="members-page__actions">
                          <button
                            type="button"
                            className="members-page__action"
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
                            <span className="members-page__confirm">
                              <span className="members-page__confirm-text">
                                {memberName(member)} kaldırılsın mı? Üye,
                                projeye erişimini kaybeder ve iş yükü
                                atamaları kaldırılır.
                              </span>
                              <button
                                type="button"
                                className="members-page__action members-page__action--danger"
                                aria-label={`${memberName(member)} kaldırmayı onayla`}
                                onClick={() => handleConfirmRemoval(member)}
                                disabled={removeMutation.isPending}
                              >
                                Kaldırmayı onayla
                              </button>
                              <button
                                type="button"
                                className="members-page__action"
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
                              className="members-page__action members-page__action--danger"
                              aria-label={`${memberName(member)} üyeyi kaldır`}
                              onClick={() => setConfirmingRemoval(member.userId)}
                            >
                              Üyeyi kaldır
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

export { MEMBERS_QUERY_KEY }
