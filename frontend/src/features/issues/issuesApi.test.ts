import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const PROJECTS_URL = '/api/projects'
const ISSUES_URL = '/api/issues'
const CSRF_URL = '/api/auth/csrf'
const CSRF_HEADER = 'X-Custom-Csrf-Header'

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
    fetchSpy = fetchMock()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
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
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse(issue, 201))

    const { createIssue } = await loadModules()
    const result = await createIssue('MES', {
      type: 'TASK',
      title: 'First task',
      description: null,
      assigneeId: null,
    })

    expect(result).toEqual(issue)
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
    const createCall = fetchSpy.mock.calls[1]
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
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(
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

    const createCall = fetchSpy.mock.calls[1]
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
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse(updated))

    const { updateIssue } = await loadModules()
    const result = await updateIssue('MES-1', {
      title: 'Updated title',
      description: 'desc',
      assigneeId: '33333333-3333-3333-3333-333333333333',
      expectedVersion: 0,
    })

    expect(result).toEqual(updated)
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
    const patchCall = fetchSpy.mock.calls[1]
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
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse({}))
    const { updateIssue } = await loadModules()
    await updateIssue('M E-1', {
      title: 't',
      description: null,
      assigneeId: null,
      expectedVersion: 0,
    })
    const patchCall = fetchSpy.mock.calls[1]
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
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse(archived))

    const { archiveIssue } = await loadModules()
    const result = await archiveIssue('MES-1', { expectedVersion: 0 })

    expect(result).toEqual(archived)
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
    const archiveCall = fetchSpy.mock.calls[1]
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
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(
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
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(
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
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse(moved))

    const { moveIssue } = await loadModules()
    const result = await moveIssue('MES-1', {
      targetStatusCode: 'IN_PROGRESS',
      beforeIssueKey: null,
      afterIssueKey: 'MES-9',
      expectedVersion: 0,
    })

    expect(result).toEqual(moved)
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      CSRF_URL,
      expect.objectContaining({ credentials: 'include' }),
    )
    const moveCall = fetchSpy.mock.calls[1]
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
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse({}))
    const { moveIssue } = await loadModules()
    await moveIssue('M E-1', {
      targetStatusCode: 'DONE',
      beforeIssueKey: null,
      afterIssueKey: null,
      expectedVersion: 0,
    })
    const moveCall = fetchSpy.mock.calls[1]
    expect(moveCall[0]).toBe(`${ISSUES_URL}/M%20E-1/move`)
  })
})
