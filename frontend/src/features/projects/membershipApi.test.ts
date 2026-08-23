import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const PROJECTS_URL = '/api/projects'
const CSRF_COOKIE = 'XSRF-TOKEN'
const CSRF_HEADER = 'X-XSRF-TOKEN'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function problemResponse(status: number, code: string, detail: string): Response {
  return jsonResponse(
    {
      type: 'about:blank',
      title: 'Error',
      status,
      detail,
      instance: '/api/projects/MES/members',
      code,
    },
    status,
  )
}

function setCsrfCookie(token: string): void {
  document.cookie = `${CSRF_COOKIE}=${token}; Path=/`
}

function clearCsrfCookie(): void {
  document.cookie = `${CSRF_COOKIE}=; Max-Age=0; Path=/`
}

function fetchMock(): Mock {
  return vi.fn()
}

/**
 * Load membershipApi and the shared apiClient in the same module-reset cycle
 * so the ApiError class asserted against is the same instance the request
 * path throws.
 */
async function loadModules() {
  vi.resetModules()
  const membershipApi = await import('./membershipApi')
  const apiClient = await import('../../app/apiClient')
  return { ...membershipApi, ApiError: apiClient.ApiError }
}

describe('membershipApi', () => {
  let fetchSpy: Mock

  const member = {
    userId: '22222222-2222-2222-2222-222222222222',
    email: 'member@demo.messor.app',
    firstName: 'Grace',
    lastName: 'Hopper',
    role: 'MEMBER',
    version: 3,
  }

  beforeEach(() => {
    setCsrfCookie('token-1')
    fetchSpy = fetchMock()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    clearCsrfCookie()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exposes the canonical member query key', async () => {
    const { MEMBERS_QUERY_KEY } = await loadModules()
    expect(MEMBERS_QUERY_KEY('MES')).toEqual(['projects', 'MES', 'members'])
  })

  it('listProjectMembers GETs the exact URL with credentials', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([member]))

    const { listProjectMembers } = await loadModules()
    const result = await listProjectMembers('MES')

    expect(result).toEqual([member])
    expect(fetchSpy).toHaveBeenCalledWith(
      `${PROJECTS_URL}/MES/members`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('addProjectMember POSTs the exact body with the in-memory CSRF token', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(member, 201))

    const { addProjectMember } = await loadModules()
    const result = await addProjectMember('MES', {
      email: 'member@demo.messor.app',
      role: 'MEMBER',
    })

    expect(result).toEqual(member)
    const call = fetchSpy.mock.calls[0]
    expect(call[0]).toBe(`${PROJECTS_URL}/MES/members`)
    expect(call[1].method).toBe('POST')
    expect(call[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'token-1',
    })
    expect(JSON.parse(call[1].body)).toEqual({
      email: 'member@demo.messor.app',
      role: 'MEMBER',
    })
  })

  it('changeProjectMemberRole PATCHes the exact path and body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ...member, role: 'VIEWER', version: 4 }),
    )

    const { changeProjectMemberRole } = await loadModules()
    const result = await changeProjectMemberRole('MES', member.userId, {
      role: 'VIEWER',
      expectedVersion: 3,
    })

    expect(result).toMatchObject({ role: 'VIEWER', version: 4 })
    const call = fetchSpy.mock.calls[0]
    expect(call[0]).toBe(`${PROJECTS_URL}/MES/members/${member.userId}`)
    expect(call[1].method).toBe('PATCH')
    expect(JSON.parse(call[1].body)).toEqual({
      role: 'VIEWER',
      expectedVersion: 3,
    })
  })

  it('removeProjectMember DELETEs with the expectedVersion query param', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { removeProjectMember } = await loadModules()
    const result = await removeProjectMember('MES', member.userId, 3)

    expect(result).toBeUndefined()
    const call = fetchSpy.mock.calls[0]
    expect(call[0]).toBe(
      `${PROJECTS_URL}/MES/members/${member.userId}?expectedVersion=3`,
    )
    expect(call[1].method).toBe('DELETE')
    expect(call[1].headers).toMatchObject({ [CSRF_HEADER]: 'token-1' })
  })

  it('maps a validation failure to a typed 400 VALIDATION_FAILED ApiError', async () => {
    fetchSpy.mockResolvedValueOnce(
      problemResponse(400, 'VALIDATION_FAILED', 'backend validation detail'),
    )

    const { listProjectMembers, ApiError } = await loadModules()
    const error = await listProjectMembers('MES').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' })
  })

  it('maps an unauthenticated member read to a typed 401 UNAUTHENTICATED ApiError', async () => {
    fetchSpy.mockResolvedValueOnce(
      problemResponse(401, 'UNAUTHENTICATED', 'Not authenticated'),
    )

    const { listProjectMembers, ApiError } = await loadModules()
    const error = await listProjectMembers('MES').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
  })

  it('maps a forbidden mutation to a typed 403 FORBIDDEN ApiError', async () => {
    fetchSpy.mockResolvedValueOnce(
      problemResponse(403, 'FORBIDDEN', 'Bu işlem için yetkiniz yok.'),
    )

    const { changeProjectMemberRole, ApiError } = await loadModules()
    const error = await changeProjectMemberRole('MES', member.userId, {
      role: 'VIEWER',
      expectedVersion: 3,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('maps a final-lead conflict to a typed 409 LAST_PROJECT_LEAD_REQUIRED ApiError', async () => {
    fetchSpy.mockResolvedValueOnce(
      problemResponse(
        409,
        'LAST_PROJECT_LEAD_REQUIRED',
        'Projede en az bir proje lideri kalmalıdır.',
      ),
    )

    const { removeProjectMember, ApiError } = await loadModules()
    const error = await removeProjectMember('MES', member.userId, 3).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 409,
      code: 'LAST_PROJECT_LEAD_REQUIRED',
    })
  })

  it('maps a version conflict to a typed 409 VERSION_CONFLICT ApiError', async () => {
    fetchSpy.mockResolvedValueOnce(
      problemResponse(409, 'VERSION_CONFLICT', 'Kayıt başka bir işlem tarafından güncellendi.'),
    )

    const { changeProjectMemberRole, ApiError } = await loadModules()
    const error = await changeProjectMemberRole('MES', member.userId, {
      role: 'VIEWER',
      expectedVersion: 2,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
  })
})
