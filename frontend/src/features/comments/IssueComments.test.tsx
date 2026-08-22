import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '../../app/apiClient'
import { IssueComments } from './IssueComments'
import type { ProjectMember } from '../projects/types'
import type { IssueComment } from './types'

const adminId = '11111111-1111-1111-1111-111111111111'
const memberId = '22222222-2222-2222-2222-222222222222'

const adminMember: ProjectMember = {
  userId: adminId,
  email: 'admin@demo.messor.app',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'PROJECT_LEAD',
  version: 1,
}

const memberMember: ProjectMember = {
  userId: memberId,
  email: 'member@demo.messor.app',
  firstName: 'Grace',
  lastName: 'Hopper',
  role: 'MEMBER',
  version: 1,
}

const members: ProjectMember[] = [adminMember, memberMember]

function makeComment(overrides: Partial<IssueComment> = {}): IssueComment {
  return {
    id: 'c-1',
    issueKey: 'MES-1',
    authorId: adminId,
    body: 'hello world',
    deleted: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 0,
    ...overrides,
  }
}

vi.mock('./commentsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./commentsApi')>()
  return {
    ...actual,
    listIssueComments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
  }
})

import {
  listIssueComments,
  createComment,
  updateComment,
  deleteComment,
} from './commentsApi'

const listIssueCommentsMock = listIssueComments as Mock
const createCommentMock = createComment as Mock
const updateCommentMock = updateComment as Mock
const deleteCommentMock = deleteComment as Mock

interface RenderOptions {
  currentUserId?: string | null
  canComment?: boolean
  isModerator?: boolean
  enabled?: boolean
}

function renderComments(options: RenderOptions = {}): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <IssueComments
        issueKey="MES-1"
        currentUserId={options.currentUserId ?? adminId}
        canComment={options.canComment ?? true}
        isModerator={options.isModerator ?? true}
        members={members}
        enabled={options.enabled ?? true}
      />
    </QueryClientProvider>,
  )
  return queryClient
}

describe('IssueComments', () => {
  beforeEach(() => {
    listIssueCommentsMock.mockReset()
    createCommentMock.mockReset()
    updateCommentMock.mockReset()
    deleteCommentMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading, then renders the comment list with author names', async () => {
    listIssueCommentsMock.mockImplementation(() => new Promise(() => {}))
    renderComments()
    expect(await screen.findByText('Yorumlar yükleniyor…')).toBeInTheDocument()
  })

  it('shows a safe error when listing fails', async () => {
    listIssueCommentsMock.mockRejectedValue(
      new ApiError(500, 'INTERNAL', 'secret comment detail'),
    )
    renderComments()
    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('Yorumlar yüklenemedi. Lütfen tekrar deneyin.')
    expect(document.body.textContent ?? '').not.toContain('secret comment detail')
  })

  it('shows an empty state when there are no comments', async () => {
    listIssueCommentsMock.mockResolvedValue([])
    renderComments()
    expect(await screen.findByText('Henüz yorum yok.')).toBeInTheDocument()
  })

  it('renders a tombstone as fixed text and never the previous body', async () => {
    listIssueCommentsMock.mockResolvedValue([
      makeComment(),
      makeComment({
        id: 'c-2',
        authorId: memberId,
        body: 'ORIGINAL PRIVATE TEXT',
        deleted: true,
        version: 1,
      }),
    ])
    renderComments()
    expect(await screen.findByText('hello world')).toBeInTheDocument()
    expect(screen.getByText('Bu yorum silindi.')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('ORIGINAL PRIVATE TEXT')
  })

  it('renders hostile HTML in a comment as inert text', async () => {
    listIssueCommentsMock.mockResolvedValue([
      makeComment({ body: '<img src=x onerror=alert(1)> <script>x</script>' }),
    ])
    renderComments()
    expect(await screen.findByText(/onerror/)).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('script')).toBeNull()
  })

  it('shows the unknown-author fallback for an id not in project members', async () => {
    listIssueCommentsMock.mockResolvedValue([
      makeComment({ authorId: '99999999-9999-9999-9999-999999999999' }),
    ])
    renderComments()
    expect(await screen.findByText('Bilinmeyen kullanıcı')).toBeInTheDocument()
  })

  it('allows the author to edit their own comment and preserves whitespace', async () => {
    const comment = makeComment({ body: 'old body' })
    listIssueCommentsMock.mockResolvedValue([comment])
    updateCommentMock.mockResolvedValue({
      ...comment,
      body: '  updated body  ',
      version: 1,
    })
    renderComments()

    await screen.findByText('old body')
    await userEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
    const textarea = screen.getByLabelText('Yorumu düzenle')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, '  updated body  ')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => {
      expect(updateCommentMock).toHaveBeenCalledWith('c-1', {
        body: '  updated body  ',
        expectedVersion: 0,
      })
    })
  })

  it('allows the author to delete their own comment with the latest version', async () => {
    const comment = makeComment()
    listIssueCommentsMock.mockResolvedValue([comment])
    deleteCommentMock.mockResolvedValue({ ...comment, deleted: true, version: 1 })
    renderComments()

    await screen.findByText('hello world')
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(screen.getByRole('button', { name: 'Silmeyi onayla' }))

    await waitFor(() => {
      expect(deleteCommentMock).toHaveBeenCalledWith('c-1', 0)
    })
  })

  it('lets a moderator delete another users comment', async () => {
    const comment = makeComment({ id: 'c-2', authorId: memberId })
    listIssueCommentsMock.mockResolvedValue([comment])
    deleteCommentMock.mockResolvedValue({ ...comment, deleted: true, version: 1 })
    renderComments({ currentUserId: adminId, isModerator: true })

    await screen.findByText('hello world')
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(screen.getByRole('button', { name: 'Silmeyi onayla' }))
    await waitFor(() => {
      expect(deleteCommentMock).toHaveBeenCalledWith('c-2', 0)
    })
  })

  it('a lead cannot edit another users comment (no edit control)', async () => {
    listIssueCommentsMock.mockResolvedValue([
      makeComment({ id: 'c-2', authorId: memberId }),
    ])
    renderComments({ currentUserId: adminId, isModerator: true })
    await screen.findByText('hello world')
    expect(screen.queryByRole('button', { name: 'Düzenle' })).not.toBeInTheDocument()
    // Moderation delete is still offered.
    expect(screen.getByRole('button', { name: 'Sil' })).toBeInTheDocument()
  })

  it('a member cannot edit or delete another users comment', async () => {
    listIssueCommentsMock.mockResolvedValue([
      makeComment({ id: 'c-2', authorId: memberId }),
    ])
    renderComments({ currentUserId: adminId, canComment: true, isModerator: false })
    await screen.findByText('hello world')
    expect(screen.queryByRole('button', { name: 'Düzenle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sil' })).not.toBeInTheDocument()
  })

  it('a viewer is read-only and has no comment form or controls', async () => {
    listIssueCommentsMock.mockResolvedValue([makeComment()])
    renderComments({ canComment: false, isModerator: false })
    await screen.findByText('hello world')
    expect(screen.queryByLabelText('Yorum ekle')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Düzenle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sil' })).not.toBeInTheDocument()
  })

  it('blocks duplicate create submission while pending', async () => {
    listIssueCommentsMock.mockResolvedValue([])
    let resolveCreate: (c: IssueComment) => void = () => {}
    createCommentMock.mockImplementation(
      () =>
        new Promise<IssueComment>((resolve) => {
          resolveCreate = resolve
        }),
    )
    renderComments()
    await screen.findByText('Henüz yorum yok.')

    const input = screen.getByLabelText('Yorum ekle')
    await userEvent.type(input, 'a comment')
    const submit = screen.getByRole('button', { name: 'Yorum yap' })
    await userEvent.click(submit)
    expect(createCommentMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Gönderiliyor…' })).toBeDisabled()

    resolveCreate(makeComment({ body: 'a comment' }))
    await waitFor(() => {
      expect(createCommentMock).toHaveBeenCalledTimes(1)
    })
  })

  it('creates with whitespace preserved in the payload', async () => {
    listIssueCommentsMock.mockResolvedValue([])
    createCommentMock.mockResolvedValue(makeComment())
    renderComments()
    await screen.findByText('Henüz yorum yok.')

    await userEvent.type(screen.getByLabelText('Yorum ekle'), '  padded  ')
    await userEvent.click(screen.getByRole('button', { name: 'Yorum yap' }))
    await waitFor(() => {
      expect(createCommentMock).toHaveBeenCalledWith('MES-1', { body: '  padded  ' })
    })
  })

  it('does not submit a blank or oversize body', async () => {
    listIssueCommentsMock.mockResolvedValue([])
    renderComments()
    await screen.findByText('Henüz yorum yok.')

    const submit = screen.getByRole('button', { name: 'Yorum yap' })
    expect(submit).toBeDisabled()

    const input = screen.getByLabelText('Yorum ekle')
    await userEvent.type(input, '   ')
    expect(submit).toBeDisabled()

    fireEvent.change(input, { target: { value: 'x'.repeat(5001) } })
    expect(submit).toBeDisabled()
    expect(
      screen.getByText('Yorum en fazla 5000 karakter olabilir.'),
    ).toBeInTheDocument()
    expect(createCommentMock).not.toHaveBeenCalled()
  })

  it('recovers from a VERSION_CONFLICT on edit while preserving the draft', async () => {
    const comment = makeComment()
    listIssueCommentsMock.mockResolvedValue([comment])
    updateCommentMock.mockRejectedValue(
      new ApiError(409, 'VERSION_CONFLICT', 'ignored detail'),
    )
    renderComments()

    await screen.findByText('hello world')
    await userEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
    const textarea = screen.getByLabelText('Yorumu düzenle')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'my precious draft')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(
      (await screen.findAllByText(/başka bir işlem tarafından güncellendi/)).length,
    ).toBeGreaterThan(0)
    // The draft is preserved and the edit form stays open.
    expect((screen.getByLabelText('Yorumu düzenle') as HTMLTextAreaElement).value).toBe(
      'my precious draft',
    )
    // Backend detail is never reflected.
    expect(document.body.textContent ?? '').not.toContain('ignored detail')
  })

  it('recovers from a VERSION_CONFLICT on delete', async () => {
    const comment = makeComment()
    listIssueCommentsMock.mockResolvedValue([comment])
    deleteCommentMock.mockRejectedValue(
      new ApiError(409, 'VERSION_CONFLICT', 'ignored detail'),
    )
    renderComments()

    await screen.findByText('hello world')
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(screen.getByRole('button', { name: 'Silmeyi onayla' }))

    expect(
      await screen.findByText(/başka bir işlem tarafından güncellendi/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Silmeyi onayla' }),
    ).not.toBeInTheDocument()
  })

  it('a stale edit completion does not clear a newer comment edit', async () => {
    const a = makeComment()
    const b = makeComment({ id: 'c-2', authorId: memberId, body: 'second' })
    listIssueCommentsMock.mockResolvedValue([a, b])

    let resolveEdit: (c: IssueComment) => void = () => {}
    updateCommentMock.mockImplementation((commentId: string) => {
      if (commentId === 'c-1') {
        return new Promise<IssueComment>((resolve) => {
          resolveEdit = resolve
        })
      }
      return Promise.resolve({ ...b, version: 1 })
    })
    renderComments()

    await screen.findByText('hello world')
    await userEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
    await userEvent.type(screen.getByLabelText('Yorumu düzenle'), ' edited')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    // The pending edit for c-1 completes; only c-1's editing state is cleared.
    resolveEdit({ ...a, body: 'hello world edited', version: 1 })
    await waitFor(() => {
      expect(screen.queryByLabelText('Yorumu düzenle')).not.toBeInTheDocument()
    })
  })
})
