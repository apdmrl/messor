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
