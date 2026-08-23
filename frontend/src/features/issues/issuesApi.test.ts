import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const PROJECTS_URL = '/api/projects'
const ISSUES_URL = '/api/issues'
const CSRF_COOKIE = 'XSRF-TOKEN'
const CSRF_HEADER = 'X-XSRF-TOKEN'

const filters = {
  project: null,
  type: 'BUG' as const,
  status: 'IN_PROGRESS',
  assignee: 'user-1',
  archive: 'archived' as const,
  sort: { field: 'title' as const, direction: 'desc' as const },
  page: 2,
  size: 50,
}

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
      instance: '/api/issues',
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
 * Load issuesApi and the shared apiClient in the same module-reset cycle so the
 * ApiError class used by mutations is the same instance the test asserts.
 */
async function loadModules() {
  vi.resetModules()
  const issuesApi = await import('./issuesApi')
  const apiClient = await import('../../app/apiClient')
  return { ...issuesApi, ApiError: apiClient.ApiError }
}

describe('issuesApi', () => {
  let fetchSpy: Mock

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

  it('listIssues GETs the exact encoded URL with fixed safe query params', async () => {
    const page = {
      items: [],
      page: 0,
      size: 100,
      totalItems: 0,
      totalPages: 0,
    }
    fetchSpy.mockResolvedValueOnce(jsonResponse(page))

    const { listIssues } = await loadModules()
    const result = await listIssues('MES', filters)

    expect(result).toEqual(page)
    expect(fetchSpy).toHaveBeenCalledWith(
      `${PROJECTS_URL}/MES/issues?type=BUG&status=IN_PROGRESS&assignee=user-1&archive=archived&sort=title%2Cdesc&page=2&size=50`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('default project workspace request sends the effective size (100) explicitly', async () => {
    // With no URL params the effective project size is 100; the API request must
    // send size=100 so the backend never falls back to its default of 20.
    const defaultState = {
      project: null,
      type: null,
      status: null,
      assignee: null,
      archive: 'active' as const,
      sort: { field: 'number' as const, direction: 'asc' as const },
      page: 0,
      size: 100,
    }
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [], page: 0, size: 100, totalItems: 0, totalPages: 0 }))

    const { listIssues } = await loadModules()
    await listIssues('MES', defaultState)

    const url = (fetchSpy.mock.calls[0][0] as string)
    expect(url).toContain('/api/projects/MES/issues?')
    expect(url).toContain('size=100')
  })

  it('listIssues encodes the project key path segment', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        items: [],
        page: 0,
        size: 100,
        totalItems: 0,
        totalPages: 0,
      }),
    )

    const { listIssues } = await loadModules()
    await listIssues('M E/S', filters)

    expect(fetchSpy).toHaveBeenCalledWith(
      `${PROJECTS_URL}/M%20E%2FS/issues?type=BUG&status=IN_PROGRESS&assignee=user-1&archive=archived&sort=title%2Cdesc&page=2&size=50`,
      expect.anything(),
    )
  })

  it('getIssue GETs the exact encoded detail URL', async () => {
    const issue = {
      id: '11111111-1111-1111-1111-111111111111',
      issueKey: 'MES-1',
      projectKey: 'MES',
      number: 1,
      type: 'TASK',
      title: 'First task',
      description: null,
      statusCode: 'TO_DO',
      reporterId: '22222222-2222-2222-2222-222222222222',
      assigneeId: null,
      rank: 0,
      archived: false,
      version: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    fetchSpy.mockResolvedValueOnce(jsonResponse(issue))

    const { getIssue } = await loadModules()
    const result = await getIssue('MES-1')

    expect(result).toEqual(issue)
    expect(fetchSpy).toHaveBeenCalledWith(
      `${ISSUES_URL}/MES-1`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('getIssue encodes the issue key path segment', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        id: '11111111-1111-1111-1111-111111111111',
        issueKey: 'MES-1',
        projectKey: 'MES',
        number: 1,
        type: 'TASK',
        title: 't',
        description: null,
        statusCode: 'TO_DO',
        reporterId: '22222222-2222-2222-2222-222222222222',
        assigneeId: null,
        rank: 0,
        archived: false,
        version: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }),
    )

    const { getIssue } = await loadModules()
    await getIssue('M E-1')

    expect(fetchSpy).toHaveBeenCalledWith(
      `${ISSUES_URL}/M%20E-1`,
      expect.anything(),
    )
  })

  it('createIssue POSTs the exact body with the in-memory CSRF token', async () => {
    const issue = {
      id: '11111111-1111-1111-1111-111111111111',
      issueKey: 'MES-1',
      projectKey: 'MES',
      number: 1,
      type: 'TASK',
      title: 'First task',
      description: null,
      statusCode: 'TO_DO',
      reporterId: '22222222-2222-2222-2222-222222222222',
      assigneeId: null,
      rank: 0,
      archived: false,
      version: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    fetchSpy.mockResolvedValueOnce(jsonResponse(issue, 201))

    const { createIssue } = await loadModules()
    const result = await createIssue('MES', {
      type: 'TASK',
      title: 'First task',
      description: null,
      assigneeId: null,
    })

    expect(result).toEqual(issue)
    const createCall = fetchSpy.mock.calls[0]
    expect(createCall[0]).toBe(`${PROJECTS_URL}/MES/issues`)
    expect(createCall[1].method).toBe('POST')
    expect(createCall[1].credentials).toBe('include')
    expect(createCall[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'token-1',
    })
    expect(JSON.parse(createCall[1].body)).toEqual({
      type: 'TASK',
      title: 'First task',
      description: null,
      assigneeId: null,
    })
  })

  it('createIssue encodes the project key segment', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {
          id: '11111111-1111-1111-1111-111111111111',
          issueKey: 'M E-1',
          projectKey: 'M E',
          number: 1,
          type: 'TASK',
          title: 't',
          description: null,
          statusCode: 'TO_DO',
          reporterId: '22222222-2222-2222-2222-222222222222',
          assigneeId: null,
          rank: 0,
          archived: false,
          version: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        201,
      ),
    )

    const { createIssue } = await loadModules()
    await createIssue('M E', { type: 'TASK', title: 't', description: null, assigneeId: null })

    const createCall = fetchSpy.mock.calls[0]
    expect(createCall[0]).toBe(`${PROJECTS_URL}/M%20E/issues`)
  })

  it('updateIssue PATCHes the exact body including expectedVersion', async () => {
    const updated = {
      id: '11111111-1111-1111-1111-111111111111',
      issueKey: 'MES-1',
      projectKey: 'MES',
      number: 1,
      type: 'TASK',
      title: 'Updated title',
      description: 'desc',
      statusCode: 'TO_DO',
      reporterId: '22222222-2222-2222-2222-222222222222',
      assigneeId: '33333333-3333-3333-3333-333333333333',
      rank: 0,
      archived: false,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    }
    fetchSpy.mockResolvedValueOnce(jsonResponse(updated))

    const { updateIssue } = await loadModules()
    const result = await updateIssue('MES-1', {
      title: 'Updated title',
      description: 'desc',
      assigneeId: '33333333-3333-3333-3333-333333333333',
      expectedVersion: 0,
    })

    expect(result).toEqual(updated)
    const patchCall = fetchSpy.mock.calls[0]
    expect(patchCall[0]).toBe(`${ISSUES_URL}/MES-1`)
    expect(patchCall[1].method).toBe('PATCH')
    expect(patchCall[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'token-1',
    })
    expect(JSON.parse(patchCall[1].body)).toEqual({
      title: 'Updated title',
      description: 'desc',
      assigneeId: '33333333-3333-3333-3333-333333333333',
      expectedVersion: 0,
    })
  })

  it('updateIssue encodes the issue key segment', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}))
    const { updateIssue } = await loadModules()
    await updateIssue('M E-1', {
      title: 't',
      description: null,
      assigneeId: null,
      expectedVersion: 0,
    })
    const patchCall = fetchSpy.mock.calls[0]
    expect(patchCall[0]).toBe(`${ISSUES_URL}/M%20E-1`)
  })

  it('archiveIssue POSTs the archive path with expectedVersion and CSRF', async () => {
    const archived = {
      id: '11111111-1111-1111-1111-111111111111',
      issueKey: 'MES-1',
      projectKey: 'MES',
      number: 1,
      type: 'TASK',
      title: 'First task',
      description: null,
      statusCode: 'TO_DO',
      reporterId: '22222222-2222-2222-2222-222222222222',
      assigneeId: null,
      rank: 0,
      archived: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-03T00:00:00Z',
    }
    fetchSpy.mockResolvedValueOnce(jsonResponse(archived))

    const { archiveIssue } = await loadModules()
    const result = await archiveIssue('MES-1', { expectedVersion: 0 })

    expect(result).toEqual(archived)
    const archiveCall = fetchSpy.mock.calls[0]
    expect(archiveCall[0]).toBe(`${ISSUES_URL}/MES-1/archive`)
    expect(archiveCall[1].method).toBe('POST')
    expect(archiveCall[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'token-1',
    })
    expect(JSON.parse(archiveCall[1].body)).toEqual({ expectedVersion: 0 })
  })

  it('listIssueActivity GETs the exact encoded activity URL', async () => {
    const activity = [
      {
        id: '44444444-4444-4444-4444-444444444444',
        type: 'CREATED',
        actorId: '22222222-2222-2222-2222-222222222222',
        summary: { type: 'TASK', statusCode: 'TO_DO', assigneeId: null },
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]
    fetchSpy.mockResolvedValueOnce(jsonResponse(activity))

    const { listIssueActivity } = await loadModules()
    const result = await listIssueActivity('MES-1')

    expect(result).toEqual(activity)
    expect(fetchSpy).toHaveBeenCalledWith(
      `${ISSUES_URL}/MES-1/activity`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('converts a Problem Details mutation response into a typed ApiError', async () => {
    fetchSpy.mockResolvedValueOnce(
      problemResponse(409, 'VERSION_CONFLICT', 'backend conflict detail'),
    )

    const { updateIssue, ApiError } = await loadModules()
    const error = await updateIssue('MES-1', {
      title: 't',
      description: null,
      assigneeId: null,
      expectedVersion: 0,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      message: 'backend conflict detail',
    })
  })

  it('never writes CSRF or session data to localStorage or sessionStorage', async () => {
    const storageSet = vi.spyOn(Storage.prototype, 'setItem')
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {
          id: '11111111-1111-1111-1111-111111111111',
          issueKey: 'MES-1',
          projectKey: 'MES',
          number: 1,
          type: 'TASK',
          title: 't',
          description: null,
          statusCode: 'TO_DO',
          reporterId: '22222222-2222-2222-2222-222222222222',
          assigneeId: null,
          rank: 0,
          archived: false,
          version: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        201,
      ),
    )

    const { createIssue } = await loadModules()
    await createIssue('MES', { type: 'TASK', title: 't', description: null, assigneeId: null })

    expect(storageSet).not.toHaveBeenCalled()
  })

  it('moveIssue PATCHes the exact move path with body, CSRF and JSON content type', async () => {
    const moved = {
      id: '11111111-1111-1111-1111-111111111111',
      issueKey: 'MES-1',
      projectKey: 'MES',
      number: 1,
      type: 'TASK',
      title: 'First task',
      description: null,
      statusCode: 'IN_PROGRESS',
      reporterId: '22222222-2222-2222-2222-222222222222',
      assigneeId: null,
      rank: 1024,
      archived: false,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    }
    fetchSpy.mockResolvedValueOnce(jsonResponse(moved))

    const { moveIssue } = await loadModules()
    const result = await moveIssue('MES-1', {
      targetStatusCode: 'IN_PROGRESS',
      beforeIssueKey: null,
      afterIssueKey: 'MES-9',
      expectedVersion: 0,
    })

    expect(result).toEqual(moved)
    const moveCall = fetchSpy.mock.calls[0]
    expect(moveCall[0]).toBe(`${ISSUES_URL}/MES-1/move`)
    expect(moveCall[1].method).toBe('PATCH')
    expect(moveCall[1].credentials).toBe('include')
    expect(moveCall[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'token-1',
    })
    expect(JSON.parse(moveCall[1].body)).toEqual({
      targetStatusCode: 'IN_PROGRESS',
      beforeIssueKey: null,
      afterIssueKey: 'MES-9',
      expectedVersion: 0,
    })
  })

  it('moveIssue encodes the issue key path segment', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}))
    const { moveIssue } = await loadModules()
    await moveIssue('M E-1', {
      targetStatusCode: 'DONE',
      beforeIssueKey: null,
      afterIssueKey: null,
      expectedVersion: 0,
    })
    const moveCall = fetchSpy.mock.calls[0]
    expect(moveCall[0]).toBe(`${ISSUES_URL}/M%20E-1/move`)
  })
})
