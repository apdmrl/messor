import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const ISSUES_URL = '/api/issues'
const COMMENTS_URL = '/api/comments'
const CSRF_URL = '/api/auth/csrf'
const CSRF_HEADER = 'X-Custom-Csrf-Header'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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

async function loadModules() {
  vi.resetModules()
  const commentsApi = await import('./commentsApi')
  const apiClient = await import('../../app/apiClient')
  return { ...commentsApi, ApiError: apiClient.ApiError }
}

const comment = {
  id: 'c-1',
  issueKey: 'MES-1',
  authorId: 'u-1',
  body: 'hello',
  deleted: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  version: 0,
}

describe('commentsApi', () => {
  let fetchSpy: Mock

  beforeEach(() => {
    fetchSpy = fetchMock()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('listIssueComments GETs the exact encoded URL without CSRF', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([comment]))
    const { listIssueComments } = await loadModules()
    const result = await listIssueComments('MES-1')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${ISSUES_URL}/MES-1/comments`)
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual({})
    expect(result).toEqual([comment])
  })

  it('listIssueComments encodes the issue key path segment', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([]))
    const { listIssueComments } = await loadModules()
    await listIssueComments('A/B/C')

    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe(`${ISSUES_URL}/A%2FB%2FC/comments`)
  })

  it('createComment POSTs the exact body with CSRF on the encoded URL', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse(comment, 201))
    const { createComment } = await loadModules()
    const result = await createComment('MES-1', { body: 'hi' })

    const csrfCall = fetchSpy.mock.calls[0] as [string]
    expect(csrfCall[0]).toBe(CSRF_URL)
    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe('token-1')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    )
    expect(JSON.parse(init.body as string)).toEqual({ body: 'hi' })
    expect(result).toEqual(comment)
  })

  it('createComment preserves whitespace in the body payload', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse({ ...comment, body: '  a  ' }))
    const { createComment } = await loadModules()
    await createComment('MES-1', { body: '  a  ' })

    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ body: '  a  ' })
  })

  it('updateComment PATCHes body and expectedVersion with CSRF', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse({ ...comment, body: 'edited', version: 1 }))
    const { updateComment } = await loadModules()
    await updateComment('c-1', { body: 'edited', expectedVersion: 0 })

    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({
      body: 'edited',
      expectedVersion: 0,
    })
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe('token-1')
  })

  it('updateComment encodes the comment id', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse(comment))
    const { updateComment } = await loadModules()
    await updateComment('a/b', { body: 'x', expectedVersion: 0 })

    const [url] = fetchSpy.mock.calls[1] as [string]
    expect(url).toBe(`${COMMENTS_URL}/a%2Fb`)
  })

  it('deleteComment DELETEs with CSRF and encoded expectedVersion query param', async () => {
    fetchSpy
      .mockResolvedValueOnce(csrfResponse('token-1'))
      .mockResolvedValueOnce(jsonResponse({ ...comment, deleted: true, version: 1 }))
    const { deleteComment } = await loadModules()
    const result = await deleteComment('c-1', 3)

    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect(url).toBe(`${COMMENTS_URL}/c-1?expectedVersion=3`)
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe('token-1')
    expect(result.deleted).toBe(true)
  })
})
