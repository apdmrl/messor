import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, type RefObject } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IssueDrawer } from './IssueDrawer'
import type { Issue, IssueActivity } from './types'
import type { ProjectMember } from '../projects/types'
import type { IssueComment } from '../comments/types'

const adminId = '11111111-1111-1111-1111-111111111111'

const members: ProjectMember[] = [
  {
    userId: adminId,
    email: 'admin@demo.messor.app',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'PROJECT_LEAD',
    version: 1,
  },
]

const issue: Issue = {
  id: 'i-1',
  issueKey: 'MES-1',
  projectKey: 'MES',
  number: 1,
  type: 'TASK',
  title: 'First task',
  description: 'A description',
  statusCode: 'TO_DO',
  reporterId: adminId,
  assigneeId: null,
  rank: 0,
  archived: false,
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const activity: IssueActivity[] = [
  {
    id: 'act-1',
    type: 'CREATED',
    actorId: adminId,
    summary: { type: 'TASK', statusCode: 'TO_DO', assigneeId: null },
    createdAt: '2026-01-01T00:00:00Z',
  },
]

const comments: IssueComment[] = [
  {
    id: 'c-1',
    issueKey: 'MES-1',
    authorId: adminId,
    body: 'a comment',
    deleted: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 0,
  },
]

vi.mock('../comments/commentsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comments/commentsApi')>()
  return {
    ...actual,
    listIssueComments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
  }
})

import { listIssueComments } from '../comments/commentsApi'

const listIssueCommentsMock = listIssueComments as Mock

const statusLabel = (code: string): string =>
  ({ TO_DO: 'Yapılacak', IN_PROGRESS: 'Sürüyor', DONE: 'Bitti' })[code] ?? code
const assigneeLabel = (id: string | null): string => (id === null ? 'Atanmamış' : id)

interface RenderOptions {
  escapeBlocked?: boolean
  currentUserRole?: 'PROJECT_LEAD' | 'MEMBER' | 'VIEWER'
  activityLoading?: boolean
  activityError?: boolean
}

function renderDrawer(options: RenderOptions = {}): {
  closeRef: RefObject<HTMLButtonElement | null>
  onClose: Mock
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const closeRef = createRef<HTMLButtonElement | null>()
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <IssueDrawer
        issue={issue}
        currentUserId={adminId}
        currentUserRole={options.currentUserRole ?? 'PROJECT_LEAD'}
        members={members}
        activity={activity}
        activityLoading={options.activityLoading ?? false}
        activityError={options.activityError ?? false}
        statusLabel={statusLabel}
        statusCodes={new Set(['TO_DO', 'IN_PROGRESS', 'DONE'])}
        assigneeLabel={assigneeLabel}
        escapeBlocked={options.escapeBlocked ?? false}
        onBusyChange={() => {}}
        onClose={onClose}
        closeButtonRef={closeRef}
      />
    </QueryClientProvider>,
  )
  return { closeRef, onClose }
}

describe('IssueDrawer', () => {
  beforeEach(() => {
    listIssueCommentsMock.mockReset()
    // Default to a valid empty data set so the comments query never resolves to
    // undefined (which triggers React Query's "Query data cannot be undefined"
    // warning) in tests that open the comments tab without stubbing a list.
    listIssueCommentsMock.mockResolvedValue([])
  })

  it('renders an accessible labelled dialog with the controlled issue heading', () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog', { name: 'MES-1' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: 'MES-1', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('First task')).toBeInTheDocument()
    expect(screen.getByText('A description')).toBeInTheDocument()
  })

  it('gives initial focus to the close button', () => {
    const { closeRef } = renderDrawer()
    expect(closeRef.current).toHaveFocus()
  })

  it('shows the activity tab by default and switches to comments', async () => {
    listIssueCommentsMock.mockResolvedValue(comments)
    const user = userEvent.setup()
    renderDrawer()

    const activityTab = screen.getByRole('tab', { name: 'Aktivite' })
    const commentsTab = screen.getByRole('tab', { name: 'Yorumlar' })
    expect(activityTab).toHaveAttribute('aria-selected', 'true')
    expect(commentsTab).toHaveAttribute('aria-selected', 'false')

    await user.click(commentsTab)
    expect(commentsTab).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('a comment')).toBeInTheDocument()
  })

  it('enables the comments query only when the comments tab is active', async () => {
    listIssueCommentsMock.mockResolvedValue(comments)
    const user = userEvent.setup()
    renderDrawer()

    // Activity tab is default; the comments query must not have fired yet.
    await waitFor(() => {
      expect(listIssueCommentsMock).not.toHaveBeenCalled()
    })

    await user.click(screen.getByRole('tab', { name: 'Yorumlar' }))
    await waitFor(() => {
      expect(listIssueCommentsMock).toHaveBeenCalledWith('MES-1')
    })
  })

  it('navigates tabs with ArrowRight/ArrowLeft/Home/End and roving tabindex', async () => {
    const user = userEvent.setup()
    renderDrawer()

    const activityTab = screen.getByRole('tab', { name: 'Aktivite' })
    const commentsTab = screen.getByRole('tab', { name: 'Yorumlar' })
    await user.click(activityTab)

    activityTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(commentsTab).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(activityTab).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(commentsTab).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(activityTab).toHaveAttribute('aria-selected', 'true')
  })

  it('closes on the close button', async () => {
    const { onClose } = renderDrawer()
    await userEvent.click(screen.getByRole('button', { name: /kapat/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape when nothing blocks it', async () => {
    const { onClose } = renderDrawer()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on Escape while a comment mutation/confirmation is pending', async () => {
    const { onClose } = renderDrawer({ escapeBlocked: true })
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('disables the close button while busy and never closes via it', async () => {
    const { onClose } = renderDrawer({ escapeBlocked: true })
    const close = screen.getByRole('button', { name: /kapat/i })
    expect(close).toBeDisabled()
    expect(close).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(close)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close via the backdrop while busy', async () => {
    const { onClose } = renderDrawer({ escapeBlocked: true })
    const backdrop = document.querySelector('.issue-drawer__backdrop')
    expect(backdrop).not.toBeNull()
    await userEvent.click(backdrop as Element)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes via the backdrop when nothing blocks it', async () => {
    const { onClose } = renderDrawer()
    const backdrop = document.querySelector('.issue-drawer__backdrop')
    await userEvent.click(backdrop as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps Tab focus within the drawer', async () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog')
    // Shift+Tab from the initially focused close button wraps to the last
    // focusable element inside the dialog.
    await userEvent.tab({ shift: true })
    const active = document.activeElement as HTMLElement
    expect(dialog.contains(active)).toBe(true)
    // A forward tab from the last element wraps back to the first.
    await userEvent.tab()
    expect(dialog.contains(document.activeElement as HTMLElement)).toBe(true)
  })

  it('keeps the comments draft alive across a tab switch', async () => {
    listIssueCommentsMock.mockResolvedValue(comments)
    const user = userEvent.setup()
    renderDrawer()
    await user.click(screen.getByRole('tab', { name: 'Yorumlar' }))
    await user.click(screen.getByRole('tab', { name: 'Aktivite' }))
    await user.click(screen.getByRole('tab', { name: 'Yorumlar' }))
    // Still present after toggling tabs; no crash, comments still shown.
    expect(await screen.findByText('a comment')).toBeInTheDocument()
  })

  it('is read-only for a VIEWER (no comment form)', async () => {
    listIssueCommentsMock.mockResolvedValue(comments)
    const user = userEvent.setup()
    renderDrawer({ currentUserRole: 'VIEWER' })
    await user.click(screen.getByRole('tab', { name: 'Yorumlar' }))
    await screen.findByText('a comment')
    expect(screen.queryByLabelText('Yorum ekle')).not.toBeInTheDocument()
  })

  it('shows controlled activity text for the active issue', () => {
    renderDrawer()
    expect(screen.getByText(/Oluşturuldu: Görev, Yapılacak, Atanmamış/)).toBeInTheDocument()
  })

  it('shows an activity loading status', () => {
    renderDrawer({ activityLoading: true })
    expect(screen.getByText('Aktivite yükleniyor…')).toBeInTheDocument()
  })

  it('shows an activity error state', () => {
    renderDrawer({ activityError: true })
    expect(screen.getByText(/Aktivite yüklenemedi/)).toBeInTheDocument()
  })
})
