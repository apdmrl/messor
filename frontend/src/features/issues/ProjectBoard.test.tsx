import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
const doneCard = makeIssue({
  issueKey: 'MES-4',
  number: 4,
  statusCode: 'DONE',
  rank: 1024,
  title: 'Done',
})

const statusLabel = (code: string): string =>
  STATUSES.find((s) => s.code === code)?.displayName ?? code
const assigneeLabel = (id: string | null): string => (id === null ? 'Atanmamış' : 'A')

interface RenderOpts {
  issues?: Issue[]
  canMove?: boolean
  moveDisabled?: boolean
  selectionDisabled?: boolean
  includeArchived?: boolean
  selectedIssueKey?: string | null
}

function renderBoard(opts: RenderOpts = {}) {
  const onSelect = vi.fn()
  const onMove = vi.fn()
  render(
    <ProjectBoard
      workflowStatuses={STATUSES}
      issues={opts.issues ?? [toDoA, toDoB, inProgress]}
      selectedIssueKey={opts.selectedIssueKey ?? null}
      canMove={opts.canMove ?? true}
      moveDisabled={opts.moveDisabled ?? false}
      selectionDisabled={opts.selectionDisabled ?? false}
      includeArchived={opts.includeArchived ?? false}
      statusLabel={statusLabel}
      assigneeLabel={assigneeLabel}
      onSelect={onSelect}
      onMove={onMove}
    />,
  )
  return { onSelect, onMove }
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

  it('renders an empty column as a valid labelled drop target', () => {
    renderBoard()
    expect(screen.getByText('Kart yok')).toBeInTheDocument()
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

  describe('movement controls', () => {
    it('exposes a movement menu for a movable card (PROJECT_LEAD/MEMBER)', async () => {
      const user = userEvent.setup()
      renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))
      expect(
        screen.getByRole('button', { name: 'Sonraki sütuna taşı' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Aşağı taşı' }),
      ).toBeInTheDocument()
    })

    it('hides all movement controls for a VIEWER', () => {
      renderBoard({ canMove: false })
      expect(
        screen.queryByRole('button', { name: /taşıma menüsü/ }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /taşı$/ }),
      ).not.toBeInTheDocument()
    })

    it('disables every movement control while a mutation is pending', async () => {
      const user = userEvent.setup()
      renderBoard({ moveDisabled: true })
      const toggle = screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' })
      expect(toggle).toBeDisabled()
      await user.click(toggle)
      expect(
        screen.queryByRole('button', { name: 'Sonraki sütuna taşı' }),
      ).not.toBeInTheDocument()
    })

    it('moves to the next column (append) via the movement menu', async () => {
      const user = userEvent.setup()
      const { onMove } = renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))
      await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
      expect(onMove).toHaveBeenCalledWith('MES-1', 'IN_PROGRESS', Number.MAX_SAFE_INTEGER)
    })

    it('moves to the previous column (append) via the movement menu', async () => {
      const user = userEvent.setup()
      const { onMove } = renderBoard({ issues: [inProgress] })
      await user.click(screen.getByRole('button', { name: 'MES-3 için taşıma menüsü' }))
      await user.click(screen.getByRole('button', { name: 'Önceki sütuna taşı' }))
      expect(onMove).toHaveBeenCalledWith('MES-3', 'TO_DO', Number.MAX_SAFE_INTEGER)
    })

    it('moves a card up within its column', async () => {
      const user = userEvent.setup()
      const { onMove } = renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-2 için taşıma menüsü' }))
      await user.click(screen.getByRole('button', { name: 'Yukarı taşı' }))
      expect(onMove).toHaveBeenCalledWith('MES-2', 'TO_DO', 0)
    })

    it('moves a card down within its column', async () => {
      const user = userEvent.setup()
      const { onMove } = renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))
      await user.click(screen.getByRole('button', { name: 'Aşağı taşı' }))
      expect(onMove).toHaveBeenCalledWith('MES-1', 'TO_DO', 1)
    })

    it('disables impossible moves (top of column, first column)', async () => {
      const user = userEvent.setup()
      renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))
      // first column so previous is impossible; first card so move up impossible
      expect(
        screen.getByRole('button', { name: 'Önceki sütuna taşı' }),
      ).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Yukarı taşı' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Aşağı taşı' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Sonraki sütuna taşı' })).toBeEnabled()
    })
  })

  it('uses one normalized status order for columns and movement controls', async () => {
    const unsorted: WorkflowStatus[] = [
      { code: 'DONE', displayName: 'Bitti', position: 2 },
      { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
      { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
    ]
    const user = userEvent.setup()
    const onMove = vi.fn()
    render(
      <ProjectBoard
        workflowStatuses={unsorted}
        issues={[toDoA, inProgress, doneCard]}
        selectedIssueKey={null}
        canMove
        moveDisabled={false}
        selectionDisabled={false}
        includeArchived={false}
        statusLabel={statusLabel}
        assigneeLabel={assigneeLabel}
        onSelect={() => {}}
        onMove={onMove}
      />,
    )

    // Columns render in normalized position order TO_DO → IN_PROGRESS → DONE.
    const columns = screen.getAllByRole('region', { name: /sütunu/ })
    expect(columns.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Yapılacak sütunu, 1 kart',
      'Sürüyor sütunu, 1 kart',
      'Bitti sütunu, 1 kart',
    ])

    // "Sonraki sütuna taşı" from the first positioned column (TO_DO) targets
    // IN_PROGRESS, not the raw-array neighbor.
    await user.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))
    await user.click(screen.getByRole('button', { name: 'Sonraki sütuna taşı' }))
    expect(onMove).toHaveBeenCalledWith('MES-1', 'IN_PROGRESS', Number.MAX_SAFE_INTEGER)

    // Previous is impossible on the actual first positioned column (TO_DO).
    await user.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))
    expect(screen.getByRole('button', { name: 'Önceki sütuna taşı' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sonraki sütuna taşı' })).toBeEnabled()
    await user.keyboard('{Escape}')

    // Next is impossible on the actual last positioned column (DONE), and its
    // previous targets IN_PROGRESS.
    await user.click(screen.getByRole('button', { name: 'MES-4 için taşıma menüsü' }))
    expect(screen.getByRole('button', { name: 'Sonraki sütuna taşı' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Önceki sütuna taşı' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Önceki sütuna taşı' }))
    expect(onMove).toHaveBeenCalledWith('MES-4', 'IN_PROGRESS', Number.MAX_SAFE_INTEGER)
  })

  it('selects a card via its keyboard-focusable button', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderBoard()
    const card = screen.getByRole('button', { name: 'MES-1, First, Yapılacak' })
    await user.click(card)
    expect(onSelect).toHaveBeenCalledWith('MES-1')
  })

  describe('keyboard, Escape and reduced motion', () => {
    it('activates a movement action with the keyboard', async () => {
      const user = userEvent.setup()
      const { onMove } = renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))
      const next = screen.getByRole('button', { name: 'Sonraki sütuna taşı' })
      next.focus()
      await user.keyboard('{Enter}')
      expect(onMove).toHaveBeenCalledWith('MES-1', 'IN_PROGRESS', Number.MAX_SAFE_INTEGER)
    })

    it('closes the movement menu with Escape without triggering a move', async () => {
      const user = userEvent.setup()
      const { onMove } = renderBoard()
      await user.click(screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' }))
      expect(
        screen.getByRole('button', { name: 'Sonraki sütuna taşı' }),
      ).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(
        screen.queryByRole('button', { name: 'Sonraki sütuna taşı' }),
      ).not.toBeInTheDocument()
      expect(onMove).not.toHaveBeenCalled()
    })

    it('returns focus to the menu toggle when the movement menu closes with Escape', async () => {
      const user = userEvent.setup()
      renderBoard()
      const toggle = screen.getByRole('button', { name: 'MES-1 için taşıma menüsü' })
      await user.click(toggle)
      const action = screen.getByRole('button', { name: 'Sonraki sütuna taşı' })
      action.focus()
      expect(action).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(
        screen.queryByRole('button', { name: 'Sonraki sütuna taşı' }),
      ).not.toBeInTheDocument()
      expect(toggle).toHaveFocus()
    })

    it('mounts controlled Turkish drag instructions and announcements, never raw status text', () => {
      renderBoard()
      const body = document.body.textContent ?? ''
      // controlled Turkish screen-reader instructions are present
      expect(body).toContain('Sürüklenebilir bir kartı seçmek için')
      expect(body).toContain('boşluk tuşuna basın')
      // a hostile status never leaks into the rendered instructions
      const hostile = makeIssue({
        issueKey: 'MES-9',
        number: 9,
        statusCode: '<script>pwn</script>',
      })
      renderBoard({ issues: [toDoA, hostile] })
      expect(document.body.textContent ?? '').not.toContain('pwn')
    })

    it('removes drag transition animation under prefers-reduced-motion', () => {
      const mq = {
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      } as unknown as MediaQueryList
      const matchMedia = vi.fn(() => mq)
      vi.stubGlobal('matchMedia', matchMedia)
      try {
        renderBoard()
        const card = screen.getByRole('button', { name: 'MES-1, First, Yapılacak' })
          .closest('li') as HTMLElement
        expect(card.style.transition).toBe('')
        expect(card.style.transition).not.toMatch(/transform/)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})
