import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WorkflowStatus } from '../projects/types'
import { ProjectBoard } from './ProjectBoard'
import type { Issue } from './types'

const STATUSES: WorkflowStatus[] = [
  { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
  { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
  { code: 'DONE', displayName: 'Bitti', position: 2 },
]

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: '00000000-0000-0000-0000-00000000000' + (overrides.number ?? 1),
    issueKey: 'MES-1',
    projectKey: 'MES',
    number: 1,
    type: 'TASK',
    title: 'issue',
    description: null,
    statusCode: 'TO_DO',
    reporterId: 'u1',
    assigneeId: null,
    rank: 0,
    archived: false,
    version: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const toDoA = makeIssue({ issueKey: 'MES-1', number: 1, rank: 1024, title: 'First' })
const toDoB = makeIssue({ issueKey: 'MES-2', number: 2, rank: 2048, title: 'Second' })
const inProgress = makeIssue({
  issueKey: 'MES-3',
  number: 3,
  statusCode: 'IN_PROGRESS',
  rank: 1024,
  title: 'Third',
})
const archivedCard = makeIssue({
  issueKey: 'MES-9',
  number: 9,
  statusCode: 'DONE',
  rank: 1024,
  archived: true,
  title: 'Archived',
})

const statusLabel = (code: string): string =>
  STATUSES.find((s) => s.code === code)?.displayName ?? code
const assigneeLabel = (id: string | null): string => (id === null ? 'Atanmamış' : 'A')

interface RenderOpts {
  issues?: Issue[]
  canMove?: boolean
  moveDisabled?: boolean
  movePendingKey?: string | null
  selectionDisabled?: boolean
  includeArchived?: boolean
  selectedIssueKey?: string | null
  wipLimit?: number
  onCreate?: () => void
}

function renderBoard(opts: RenderOpts = {}) {
  const onSelect = vi.fn()
  const onStatusChange = vi.fn()
  const onCreate = opts.onCreate ?? vi.fn()
  render(
    <ProjectBoard
      workflowStatuses={STATUSES}
      issues={opts.issues ?? [toDoA, toDoB, inProgress]}
      selectedIssueKey={opts.selectedIssueKey ?? null}
      canMove={opts.canMove ?? true}
      moveDisabled={opts.moveDisabled ?? false}
      movePendingKey={opts.movePendingKey ?? null}
      selectionDisabled={opts.selectionDisabled ?? false}
      includeArchived={opts.includeArchived ?? false}
      wipLimit={opts.wipLimit}
      onCreate={opts.onCreate}
      statusLabel={statusLabel}
      assigneeLabel={assigneeLabel}
      onSelect={onSelect}
      onStatusChange={onStatusChange}
    />,
  )
  return { onSelect, onStatusChange, onCreate }
}

describe('ProjectBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders columns in server workflow position order with counts', () => {
    renderBoard()
    const columns = screen.getAllByRole('region', { name: /sütunu/ })
    expect(columns.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Yapılacak sütunu, 2 kart',
      'Sürüyor sütunu, 1 kart',
      'Bitti sütunu, 0 kart',
    ])
  })

  it('renders cards with key, title, type, status and assignee', () => {
    renderBoard()
    const first = screen.getByRole('button', {
      name: 'MES-1, First, Yapılacak',
    })
    expect(within(first).getByText('MES-1')).toBeInTheDocument()
    expect(within(first).getByText('First')).toBeInTheDocument()
    expect(within(first).getByText(/Görev/)).toBeInTheDocument()
    expect(within(first).getByText('Atanmamış')).toBeInTheDocument()
  })

  it('exposes the selected state accessibly on a card', () => {
    renderBoard({ selectedIssueKey: 'MES-2' })
    const selected = screen.getByRole('button', { name: 'MES-2, Second, Yapılacak' })
    expect(selected).toHaveAttribute('aria-current', 'true')
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    const unselected = screen.getByRole('button', { name: 'MES-1, First, Yapılacak' })
    expect(unselected).not.toHaveAttribute('aria-current', 'true')
  })

  it('renders an empty column without a page-height jump', () => {
    renderBoard()
    expect(screen.getByText('Kart yok')).toBeInTheDocument()
  })
  it('offers an add action in an empty column when onCreate is provided', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const { onCreate: returnedCreate } = renderBoard({
      issues: [toDoA, toDoB, inProgress],
      onCreate,
    })
    const done = screen.getByRole('region', { name: 'Bitti sütunu, 0 kart' })
    await user.click(within(done).getByRole('button', { name: 'Kart ekle' }))
    expect(returnedCreate).toHaveBeenCalledTimes(1)
  })

  it('hides the empty-column add action when onCreate is absent', () => {
    renderBoard({ issues: [toDoA] })
    expect(
      screen.queryByRole('button', { name: 'Kart ekle' }),
    ).not.toBeInTheDocument()
  })

  describe('pointer drag movement', () => {
    it('drops a dragged card into an empty column at index 0', () => {
      const { onStatusChange } = renderBoard()
      const card = screen
        .getByRole('button', { name: 'MES-1, First, Yapılacak' })
        .closest('li') as HTMLElement
      fireEvent.dragStart(card)
      const done = screen.getByRole('region', { name: 'Bitti sütunu, 0 kart' })
      fireEvent.drop(done, { clientY: 0 })
      expect(onStatusChange).toHaveBeenCalledWith('MES-1', 'DONE', 0)
    })
  })

  describe('keyboard movement', () => {
    it('grabs a card with Space and marks it aria-grabbed', async () => {
      const user = userEvent.setup()
      renderBoard()
      const card = screen.getByRole('button', { name: 'MES-1, First, Yapılacak' })
      card.focus()
      await user.keyboard(' ')
      expect(card.closest('li')).toHaveAttribute('aria-grabbed', 'true')
    })

    it('moves a card across columns with Space/arrow/Space and a target index', async () => {
      const user = userEvent.setup()
      const { onStatusChange } = renderBoard()
      const card = screen.getByRole('button', { name: 'MES-1, First, Yapılacak' })
      card.focus()
      await user.keyboard(' ')
      await user.keyboard('{ArrowRight}')
      await user.keyboard(' ')
      expect(onStatusChange).toHaveBeenCalledWith('MES-1', 'IN_PROGRESS', 0)
    })

    it('cancels a keyboard move with Escape without moving', async () => {
      const user = userEvent.setup()
      const { onStatusChange } = renderBoard()
      const card = screen.getByRole('button', { name: 'MES-1, First, Yapılacak' })
      card.focus()
      await user.keyboard(' ')
      await user.keyboard('{ArrowRight}')
      await user.keyboard('{Escape}')
      expect(onStatusChange).not.toHaveBeenCalled()
      expect(card.closest('li')).not.toHaveAttribute('aria-grabbed')
    })
  })

  it('never renders an attacker-controlled column for an unknown status', () => {
    const hostile = makeIssue({
      issueKey: 'MES-9',
      number: 9,
      statusCode: '<script>pwn</script>',
    })
    renderBoard({ issues: [toDoA, hostile] })
    const columns = screen.getAllByRole('region', { name: /sütunu/ })
    expect(columns).toHaveLength(3)
    const body = document.body.textContent ?? ''
    expect(body).not.toContain('pwn')
  })

  describe('status-change controls', () => {
    it('opens a status disclosure listing every workflow status for a movable card', async () => {
      const user = userEvent.setup()
      renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için durumu değiştir' }))
      expect(
        screen.getByRole('button', { name: 'Yapılacak durumuna taşı' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Sürüyor durumuna taşı' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Bitti durumuna taşı' }),
      ).toBeInTheDocument()
    })

    it('lists statuses in normalized server order', async () => {
      const user = userEvent.setup()
      const { onStatusChange } = renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için durumu değiştir' }))
      const actions = screen
        .getAllByRole('button', { name: /durumuna taşı/ })
        .map((b) => b.textContent)
      expect(actions).toEqual([
        'Yapılacak durumuna taşı',
        'Sürüyor durumuna taşı',
        'Bitti durumuna taşı',
      ])
      await user.click(screen.getByRole('button', { name: 'Sürüyor durumuna taşı' }))
      expect(onStatusChange).toHaveBeenCalledWith('MES-1', 'IN_PROGRESS')
    })

    it('marks the current status option as disabled and aria-current', async () => {
      const user = userEvent.setup()
      renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için durumu değiştir' }))
      const current = screen.getByRole('button', { name: 'Yapılacak durumuna taşı' })
      expect(current).toBeDisabled()
      expect(current).toHaveAttribute('aria-current', 'true')
      const next = screen.getByRole('button', { name: 'Sürüyor durumuna taşı' })
      expect(next).toBeEnabled()
      expect(next).not.toHaveAttribute('aria-current')
    })

    it('changes status to a target and closes the disclosure', async () => {
      const user = userEvent.setup()
      const { onStatusChange } = renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için durumu değiştir' }))
      await user.click(screen.getByRole('button', { name: 'Sürüyor durumuna taşı' }))
      expect(onStatusChange).toHaveBeenCalledWith('MES-1', 'IN_PROGRESS')
      expect(
        screen.queryByRole('button', { name: 'Sürüyor durumuna taşı' }),
      ).not.toBeInTheDocument()
    })

    it('hides all status-change controls for a VIEWER but keeps the chip', () => {
      renderBoard({ canMove: false })
      expect(
        screen.queryByRole('button', { name: /durumu değiştir/ }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /durumuna taşı/ }),
      ).not.toBeInTheDocument()
    })

    it('renders archived cards as read-only with no status trigger', () => {
      renderBoard({ issues: [archivedCard], includeArchived: true })
      expect(
        screen.queryByRole('button', { name: /durumu değiştir/ }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /^MES-9,/ }),
      ).toBeInTheDocument()
    })

    it('disables every status trigger while a mutation is pending', async () => {
      const user = userEvent.setup()
      renderBoard({ moveDisabled: true })
      const trigger = screen.getByRole('button', { name: 'MES-1 için durumu değiştir' })
      expect(trigger).toBeDisabled()
      await user.click(trigger)
      expect(
        screen.queryByRole('button', { name: /durumuna taşı/ }),
      ).not.toBeInTheDocument()
    })

    it('shows pending text and aria-busy on the card being moved', () => {
      renderBoard({ movePendingKey: 'MES-1' })
      const trigger = screen.getByRole('button', { name: 'MES-1 için durumu değiştir' })
      expect(trigger).toHaveTextContent('Taşınıyor…')
      const card = trigger.closest('li') as HTMLElement
      expect(card).toHaveAttribute('aria-busy', 'true')
      const other = screen.getByRole('button', { name: 'MES-2 için durumu değiştir' })
      expect(other).toHaveTextContent('Durumu değiştir')
    })
  })

  it('opens detail on the card surface and stops on status controls', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderBoard()
    const card = screen
      .getByRole('button', { name: 'MES-1, First, Yapılacak' })
      .closest('li') as HTMLElement
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith('MES-1')
    // The status disclosure control stops propagation: clicking it never opens
    // the detail.
    await user.click(screen.getByRole('button', { name: 'MES-1 için durumu değiştir' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  describe('keyboard and Escape', () => {
    it('activates a status action with the keyboard', async () => {
      const user = userEvent.setup()
      const { onStatusChange } = renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için durumu değiştir' }))
      const next = screen.getByRole('button', { name: 'Sürüyor durumuna taşı' })
      next.focus()
      await user.keyboard('{Enter}')
      expect(onStatusChange).toHaveBeenCalledWith('MES-1', 'IN_PROGRESS')
    })

    it('closes the disclosure with Escape without changing status', async () => {
      const user = userEvent.setup()
      const { onStatusChange } = renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için durumu değiştir' }))
      expect(
        screen.getByRole('button', { name: 'Sürüyor durumuna taşı' }),
      ).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(
        screen.queryByRole('button', { name: 'Sürüyor durumuna taşı' }),
      ).not.toBeInTheDocument()
      expect(onStatusChange).not.toHaveBeenCalled()
    })

    it('returns focus to the trigger when the disclosure closes with Escape', async () => {
      const user = userEvent.setup()
      renderBoard()
      const toggle = screen.getByRole('button', { name: 'MES-1 için durumu değiştir' })
      await user.click(toggle)
      const action = screen.getByRole('button', { name: 'Sürüyor durumuna taşı' })
      action.focus()
      expect(action).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(
        screen.queryByRole('button', { name: 'Sürüyor durumuna taşı' }),
      ).not.toBeInTheDocument()
      expect(toggle).toHaveFocus()
    })
  })
})
