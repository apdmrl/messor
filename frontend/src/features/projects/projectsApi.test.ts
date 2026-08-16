import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const PROJECTS_URL = '/api/projects'
const CSRF_URL = '/api/auth/csrf'
const CSRF_HEADER = 'X-Custom-Csrf-Header'

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
      instance: '/api/projects',
      code,
    },
    status,
  )
}

function csrfResponse(token: string): Response {
  return jsonResponse({
    headerName: CSRF_HEADER,
    parameterName: '_csrf',
    token,
  })
}

function fetchMock(): Mock {
  return vi.fn()
}

/**
 * Load projectsApi and the shared apiClient in the same module-reset cycle so
 * the ApiError class used by createProject is the same instance the test
 * asserts against.
 */
async function loadModules() {
  vi.resetModules()
  const projectsApi = await import('./projectsApi')
  const apiClient = await import('../../app/apiClient')
  return { ...projectsApi, ApiError: apiClient.ApiError }
}

describe('projectsApi', () => {
  let fetchSpy: Mock

  beforeEach(() => {
    fetchSpy = fetchMock()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('listProjects GETs with credentials include and fixed safe query params', async () => {
    const page = {
      items: [],
      page: 0,
      size: 100,
      totalItems: 0,
      totalPages: 0,
    }
    fetchSpy.mockResolvedValueOnce(jsonResponse(page))

    const { listProjects } = await loadModules()
    const result = await listProjects()

    expect(result).toEqual(page)
    expect(fetchSpy).toHaveBeenCalledWith(
      `${PROJECTS_URL}?page=0&size=100&sort=key,asc`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('createProject POSTs JSON with the in-memory CSRF token', async () => {
    const detail = {
      id: '11111111-1111-1111-1111-111111111111',
      key: 'MES',
      name: 'Messor',
      description: null,
      currentUserRole: 'PROJECT_LEAD',
      version: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      workflowStatuses: [],
    }
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse(detail, 201))

    const { createProject } = await loadModules()
    const result = await createProject({ key: 'MES', name: 'Messor' })

    expect(result).toEqual(detail)
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
    const createCall = fetchSpy.mock.calls[1]
    expect(createCall[0]).toBe(PROJECTS_URL)
    expect(createCall[1].method).toBe('POST')
    expect(createCall[1].credentials).toBe('include')
    expect(createCall[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'token-1',
    })
    expect(JSON.parse(createCall[1].body)).toEqual({
      key: 'MES',
      name: 'Messor',
    })
  })

  it('retries exactly once after INVALID_CSRF_TOKEN and succeeds', async () => {
    const detail = {
      id: '11111111-1111-1111-1111-111111111111',
      key: 'MES',
      name: 'Messor',
      description: null,
      currentUserRole: 'PROJECT_LEAD',
      version: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      workflowStatuses: [],
    }
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('stale-token'))
      .mockResolvedValueOnce(
        problemResponse(403, 'INVALID_CSRF_TOKEN', 'Invalid CSRF token'),
      )
      .mockResolvedValueOnce(csrfResponse('fresh-token'))
      .mockResolvedValueOnce(jsonResponse(detail, 201))

    const { createProject } = await loadModules()
    const result = await createProject({ key: 'MES', name: 'Messor' })

    expect(result).toEqual(detail)
    // csrf, failed create, fresh csrf, retried create
    expect(fetchSpy).toHaveBeenCalledTimes(4)
    const retriedCreate = fetchSpy.mock.calls[3]
    expect(retriedCreate[0]).toBe(PROJECTS_URL)
    expect(retriedCreate[1].headers[CSRF_HEADER]).toBe('fresh-token')
  })

  it('does not retry more than once when the retry also fails', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('stale-token'))
      .mockResolvedValueOnce(
        problemResponse(403, 'INVALID_CSRF_TOKEN', 'Invalid CSRF token'),
      )
      .mockResolvedValueOnce(csrfResponse('fresh-token'))
      .mockResolvedValueOnce(
        problemResponse(500, 'INTERNAL', 'internal server secret'),
      )

    const { createProject, ApiError } = await loadModules()
    const error = await createProject({ key: 'MES', name: 'Messor' }).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 500, code: 'INTERNAL' })
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  it('converts a Problem Details response into a typed ApiError with safe detail', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(
        problemResponse(409, 'PROJECT_KEY_ALREADY_EXISTS', 'Bu anahtar kullanımda.'),
      )

    const { createProject, ApiError } = await loadModules()
    const error = await createProject({ key: 'MES', name: 'Messor' }).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 409,
      code: 'PROJECT_KEY_ALREADY_EXISTS',
      message: 'Bu anahtar kullanımda.',
    })
  })

  it('produces a fixed fallback for a malformed error body without leaking content', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(
        new Response('<html>internal stack trace</html>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        }),
      )

    const { createProject, ApiError } = await loadModules()
    const error = await createProject({ key: 'MES', name: 'Messor' }).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 500,
      code: 'HTTP_ERROR',
      message: 'İstek tamamlanamadı.',
    })
    expect((error as { message: string }).message).not.toContain(
      'internal stack trace',
    )
  })

  it('never writes CSRF or session data to localStorage or sessionStorage', async () => {
    const storageSet = vi.spyOn(Storage.prototype, 'setItem')
    const detail = {
      id: '11111111-1111-1111-1111-111111111111',
      key: 'MES',
      name: 'Messor',
      description: null,
      currentUserRole: 'PROJECT_LEAD',
      version: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      workflowStatuses: [],
    }
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse(detail, 201))

    const { createProject } = await loadModules()
    await createProject({ key: 'MES', name: 'Messor' })

    expect(storageSet).not.toHaveBeenCalled()
  })
})

describe('projectsApi membership functions', () => {
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
    fetchSpy = fetchMock()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('getProject GETs the exact project detail URL with credentials', async () => {
    const detail = {
      id: '11111111-1111-1111-1111-111111111111',
      key: 'MES',
      name: 'Messor',
      description: null,
      currentUserRole: 'PROJECT_LEAD',
      version: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      workflowStatuses: [],
    }
    fetchSpy.mockResolvedValueOnce(jsonResponse(detail))

    const { getProject } = await loadModules()
    const result = await getProject('MES')

    expect(result).toEqual(detail)
    expect(fetchSpy).toHaveBeenCalledWith(
      `${PROJECTS_URL}/MES`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('listProjectMembers GETs the exact member-list URL with credentials', async () => {
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
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse(member, 201))

    const { addProjectMember } = await loadModules()
    const result = await addProjectMember('MES', {
      email: 'member@demo.messor.app',
      role: 'MEMBER',
    })

    expect(result).toEqual(member)
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
    const addCall = fetchSpy.mock.calls[1]
    expect(addCall[0]).toBe(`${PROJECTS_URL}/MES/members`)
    expect(addCall[1].method).toBe('POST')
    expect(addCall[1].credentials).toBe('include')
    expect(addCall[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'token-1',
    })
    expect(JSON.parse(addCall[1].body)).toEqual({
      email: 'member@demo.messor.app',
      role: 'MEMBER',
    })
  })

  it('changeProjectMemberRole PATCHes the exact path and body including expectedVersion', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse({ ...member, role: 'VIEWER', version: 4 }))

    const { changeProjectMemberRole } = await loadModules()
    const result = await changeProjectMemberRole('MES', member.userId, {
      role: 'VIEWER',
      expectedVersion: 3,
    })

    expect(result).toMatchObject({ role: 'VIEWER', version: 4 })
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
    const patchCall = fetchSpy.mock.calls[1]
    expect(patchCall[0]).toBe(`${PROJECTS_URL}/MES/members/${member.userId}`)
    expect(patchCall[1].method).toBe('PATCH')
    expect(patchCall[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'token-1',
    })
    expect(JSON.parse(patchCall[1].body)).toEqual({
      role: 'VIEWER',
      expectedVersion: 3,
    })
  })

  it('removeProjectMember DELETEs the exact path with expectedVersion query param', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { removeProjectMember } = await loadModules()
    const result = await removeProjectMember('MES', member.userId, 3)

    expect(result).toBeUndefined()
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
    const deleteCall = fetchSpy.mock.calls[1]
    expect(deleteCall[0]).toBe(
      `${PROJECTS_URL}/MES/members/${member.userId}?expectedVersion=3`,
    )
    expect(deleteCall[1].method).toBe('DELETE')
    expect(deleteCall[1].headers).toMatchObject({ [CSRF_HEADER]: 'token-1' })
  })

  it('safely encodes projectKey and userId path parameters', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([member]))

    const { listProjectMembers } = await loadModules()
    await listProjectMembers('M E/S')

    expect(fetchSpy).toHaveBeenCalledWith(
      `${PROJECTS_URL}/M%20E%2FS/members`,
      expect.anything(),
    )
  })

  it('encodes both projectKey and userId segments in a PATCH URL', async () => {
    const projectKey = 'M E/S'
    const userId = 'user id/with+reserved&chars'
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse({ ...member, role: 'VIEWER', version: 4 }))

    const { changeProjectMemberRole } = await loadModules()
    await changeProjectMemberRole(projectKey, userId, {
      role: 'VIEWER',
      expectedVersion: 3,
    })

    const encodedProjectKey = encodeURIComponent(projectKey)
    const encodedUserId = encodeURIComponent(userId)
    const patchCall = fetchSpy.mock.calls[1]
    expect(patchCall[0]).toBe(
      `${PROJECTS_URL}/${encodedProjectKey}/members/${encodedUserId}`,
    )
    expect(patchCall[0]).toContain(encodedProjectKey)
    expect(patchCall[0]).toContain(encodedUserId)
    expect(patchCall[1].method).toBe('PATCH')
    expect(patchCall[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'token-1',
    })
    expect(JSON.parse(patchCall[1].body)).toEqual({
      role: 'VIEWER',
      expectedVersion: 3,
    })
  })

  it('encodes both projectKey and userId segments in a DELETE URL', async () => {
    const projectKey = 'M E/S'
    const userId = 'user id/with+reserved&chars'
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { removeProjectMember } = await loadModules()
    await removeProjectMember(projectKey, userId, 3)

    const encodedProjectKey = encodeURIComponent(projectKey)
    const encodedUserId = encodeURIComponent(userId)
    const deleteCall = fetchSpy.mock.calls[1]
    expect(deleteCall[0]).toBe(
      `${PROJECTS_URL}/${encodedProjectKey}/members/${encodedUserId}?expectedVersion=3`,
    )
    expect(deleteCall[0]).toContain(encodedProjectKey)
    expect(deleteCall[0]).toContain(encodedUserId)
    expect(deleteCall[1].method).toBe('DELETE')
    expect(deleteCall[1].headers).toMatchObject({ [CSRF_HEADER]: 'token-1' })
  })
})
