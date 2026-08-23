import { test, expect, type Page } from '@playwright/test'

/* ============================================================
   Messor Kanban — genuine pointer + KeyboardSensor drag acceptance
   Runs against the local Vite dev server with backend routes mocked
   at the network layer. These tests drive real dnd-kit drags (pointer
   events and keyboard Sensor), never the alternative movement menu.
   ============================================================ */

const JSON_JSON = 'application/json'

const AUTH_USER = {
  id: 'user-admin',
  email: 'admin@demo.messor.app',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'ORG_ADMIN',
}

const PROJECT = {
  id: 'proj-1',
  key: 'MES',
  name: 'Messor',
  description: null,
  currentUserRole: 'PROJECT_LEAD',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  workflowStatuses: [
    { code: 'TO_DO', displayName: 'Yapılacak', position: 0 },
    { code: 'IN_PROGRESS', displayName: 'Sürüyor', position: 1 },
    { code: 'DONE', displayName: 'Bitti', position: 2 },
  ],
}

const MEMBERS = [
  {
    userId: 'user-admin',
    email: 'admin@demo.messor.app',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'PROJECT_LEAD',
    version: 1,
  },
]

const ACTIVITY = [
  {
    id: 'act-1',
    type: 'CREATED',
    actorId: 'user-admin',
    summary: { type: 'TASK', statusCode: 'TO_DO', assigneeId: null },
    createdAt: '2026-01-01T00:00:00Z',
  },
]

function makeIssue(key: string, number: number, statusCode: string, title: string) {
  return {
    id: `id-${key}`,
    issueKey: key,
    projectKey: 'MES',
    number,
    type: 'TASK',
    title,
    description: null,
    statusCode,
    reporterId: 'user-admin',
    assigneeId: null,
    rank: number * 1024,
    archived: false,
    version: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

interface MoveCapture {
  count: number
  bodies: Record<string, unknown>[]
}

interface WorkspaceMocks {
  getItems: () => unknown[]
}

function interleaveRank(prevRank: number, nextRank: number): number {
  if (Number.isFinite(prevRank) && Number.isFinite(nextRank)) {
    return Math.floor((prevRank + nextRank) / 2)
  }
  if (Number.isFinite(nextRank)) {
    return nextRank - 1
  }
  if (Number.isFinite(prevRank)) {
    return prevRank + 1
  }
  return 0
}

async function mockAuthenticated(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(AUTH_USER) })
  })
}

/**
 * Stateful workspace mock. The issue list mutates as the server would for each
 * neighbor-based move, so the authoritative refetch after a successful drag
 * returns the exact new visual order.
 */
async function mockWorkspace(
  page: Page,
  capture: MoveCapture,
): Promise<WorkspaceMocks> {
  let items: ReturnType<typeof makeIssue>[] = [
    makeIssue('MES-1', 1, 'TO_DO', 'First task'),
    makeIssue('MES-2', 2, 'TO_DO', 'Second task'),
    makeIssue('MES-3', 3, 'IN_PROGRESS', 'Third task'),
  ]

  await page.addInitScript(() => {
    document.cookie = 'XSRF-TOKEN=masked-board-token; path=/'
  })
  await page.route('**/api/projects/MES', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(PROJECT) })
  })
  await page.route('**/api/projects/MES/members', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(MEMBERS) })
  })
  await page.route('**/api/issues/*/activity', (route) => {
    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(ACTIVITY) })
  })
  await page.route('**/api/projects/MES/issues**', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify({
        items,
        page: 0,
        size: 100,
        totalItems: items.length,
        totalPages: 1,
      }),
    })
  })

  await page.route('**/api/issues/*/move', (route) => {
    const request = route.request()
    const raw = request.postData() ?? ''
    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw) as Record<string, unknown>
    } catch {
      body = { raw }
    }
    capture.count += 1
    capture.bodies.push(body)

    const movedKey = decodeURIComponent(
      request.url().match(/issues\/([^/]+)\/move/)?.[1] ?? '',
    )
    const targetStatusCode = String(body.targetStatusCode)
    const idx = items.findIndex((i) => i.issueKey === movedKey)
    if (idx === -1) {
      route.fulfill({ status: 404 })
      return
    }
    const card = { ...items[idx], statusCode: targetStatusCode, version: 1 }
    items = items.filter((i) => i.issueKey !== movedKey)

    const before = body.beforeIssueKey as string | null
    const after = body.afterIssueKey as string | null
    let insertIndex: number
    if (before) {
      const pos = items.findIndex((i) => i.issueKey === before)
      insertIndex = pos === -1 ? items.length : pos
    } else if (after) {
      const pos = items.findIndex((i) => i.issueKey === after)
      insertIndex = pos === -1 ? items.length : pos + 1
    } else {
      insertIndex = items.length
    }
    // The server derives a new interleaved rank so the card lands at its new
    // neighbor; columnIssues re-orders by rank, so the mock must mirror this.
    const prevRank = insertIndex > 0 ? items[insertIndex - 1].rank : -Infinity
    const nextRank = insertIndex < items.length ? items[insertIndex].rank : Infinity
    card.rank = interleaveRank(prevRank, nextRank)
    items.splice(insertIndex, 0, card)

    route.fulfill({ status: 200, contentType: JSON_JSON, body: JSON.stringify(card) })
  })

  await page.route('**/api/issues/MES-1', (route) => {
    route.fulfill({
      status: 200,
      contentType: JSON_JSON,
      body: JSON.stringify(makeIssue('MES-1', 1, 'TO_DO', 'First task')),
    })
  })

  return {
    getItems: () => items,
  }
}

async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/projects/MES/board')
  await expect(page.getByRole('region', { name: 'Kanban panosu' })).toBeVisible()
}

function cardOrder(): Promise<string[]> {
  return new Promise((resolve) => {
    const cards = document.querySelectorAll('.kanban-card')
    resolve(
      Array.from(cards).map((el) => el.querySelector('.kanban-card__key')?.textContent ?? ''),
    )
  })
}

/** The issue key of a drag handle whose aria-label is `${issueKey} sürükle`. */
async function dragId(handle: import('@playwright/test').Locator): Promise<string> {
  const label = await handle.getAttribute('aria-label')
  const id = label?.replace(/\s+sürükle$/, '')
  expect(id, 'drag handle must carry a "… sürükle" aria-label').toBeTruthy()
  return id ?? ''
}

/**
 * Pick up the focused drag handle with the KeyboardSensor. Instead of a blind
 * sleep, wait for the sensor's settled drag-over announcement naming the active
 * card over itself ("Kart MES-1 üzerinde: MES-1."). This is the deterministic
 * pre-move state, so the first ArrowDown is never swallowed during sensor
 * initialization, regardless of machine load.
 */
async function keyboardPickUp(
  page: Page,
  handle: import('@playwright/test').Locator,
): Promise<void> {
  await handle.focus()
  await page.keyboard.down('Space')
  await page.keyboard.up('Space')
  const id = await dragId(handle)
  await expect(dndLiveRegion(page)).toContainText(
    `Kart ${id} üzerinde: ${id}`,
    { timeout: 5000 },
  )
}

/** Drop an active keyboard drag and wait for the resolved end announcement. */
async function keyboardDrop(page: Page): Promise<void> {
  await page.keyboard.down('Space')
  await page.keyboard.up('Space')
  await expect(dndLiveRegion(page)).toContainText(/taşındı|değişmedi|iptal/, {
    timeout: 5000,
  })
}

/**
 * Genuine KeyboardSensor drag: pick up the focused handle with Space, move with
 * arrow keys, drop with Space. Every step waits on the sensor's live-region
 * announcements rather than a blind sleep. The drop is only issued once the
 * announcement proves the active card is over the expected destination, so a
 * slow event loop can neither swallow a keypress nor drop on the source card.
 */
async function keyboardDrag(
  page: Page,
  handle: import('@playwright/test').Locator,
  keys: string[],
  expectedOverId: string,
): Promise<void> {
  await keyboardPickUp(page, handle)
  const id = await dragId(handle)
  for (const key of keys) {
    await page.keyboard.press(key)
  }
  await expect(dndLiveRegion(page)).toContainText(
    `Kart ${id} üzerinde: ${expectedOverId}`,
    { timeout: 5000 },
  )
  await keyboardDrop(page)
}

/**
 * Genuine pointer drag from one locator's center to another's center using
 * mouse events, driving dnd-kit's PointerSensor.
 */
async function pointerDrag(page: Page, handle: import('@playwright/test').Locator, target: import('@playwright/test').Locator): Promise<void> {
  const sb = (await handle.boundingBox())!
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await page.mouse.down()
  // Move past the PointerSensor activation distance (6px) to activate.
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 20, { steps: 5 })
  const tb = (await target.boundingBox())!
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 })
  await page.mouse.up()
}

async function pointerDropIntoColumn(page: Page, handle: import('@playwright/test').Locator, columnName: string): Promise<void> {
  const sb = (await handle.boundingBox())!
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 20, { steps: 5 })
  const column = page.getByRole('region', { name: new RegExp(`^${columnName} sütunu`) })
  const cb = (await column.boundingBox())!
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 12 })
  await page.mouse.up()
}

async function expectOrder(page: Page, expected: string[]): Promise<void> {
  await expect
    .poll(async () => page.evaluate(cardOrder))
    .toEqual(expected)
}

/** Genuine mouse/keyboard drags need a wide viewport; the responsive contract
 *  (overflow + >=44px targets on 320/360/390/768/1440) is covered separately by
 *  board-movement.spec.ts. */
function skipNarrowViewport(testInfo: import('@playwright/test').TestInfo): void {
  test.skip(
    (testInfo.project.use.viewport?.width ?? 1440) < 1024,
    'pointer/keyboard drags require a wide viewport',
  )
}

/** The dnd-kit screen-reader live region, independent of the move banner which
 *  also uses role="status". */
function dndLiveRegion(page: Page): import('@playwright/test').Locator {
  return page.locator('[id^="DndLiveRegion"]')
}

test('pointer same-column downward drag moves the first card below the second', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)

  await pointerDrag(
    page,
    page.getByRole('button', { name: 'MES-1 sürükle' }),
    page.getByRole('button', { name: 'MES-2, Second task, Yapılacak' }),
  )

  await expect.poll(() => capture.count, { timeout: 5000 }).toBe(1)
  expect(capture.bodies[0]).toEqual({
    targetStatusCode: 'TO_DO',
    beforeIssueKey: null,
    afterIssueKey: 'MES-2',
    expectedVersion: 0,
  })
  await expectOrder(page, ['MES-2', 'MES-1', 'MES-3'])
})

test('pointer same-column upward drag moves the second card above the first', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)

  await pointerDrag(
    page,
    page.getByRole('button', { name: 'MES-2 sürükle' }),
    page.getByRole('button', { name: 'MES-1, First task, Yapılacak' }),
  )

  await expect.poll(() => capture.count, { timeout: 5000 }).toBe(1)
  expect(capture.bodies[0]).toEqual({
    targetStatusCode: 'TO_DO',
    beforeIssueKey: 'MES-1',
    afterIssueKey: null,
    expectedVersion: 0,
  })
  await expectOrder(page, ['MES-2', 'MES-1', 'MES-3'])
})

test('keyboard self-drop issues zero moves and announces the card position did not change', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)

  const live = dndLiveRegion(page)
  const handle = page.getByRole('button', { name: 'MES-1 sürükle' })
  await keyboardPickUp(page, handle)
  // Pick up and drop without moving: a genuine self-drop.
  await keyboardDrop(page)

  await expect.poll(() => capture.count).toBe(0)
  await expect(live).toContainText('Kartın konumu değişmedi.')
  await expect(live).not.toContainText('taşındı')
  await expectOrder(page, ['MES-1', 'MES-2', 'MES-3'])
})

test('pointer self-drop issues zero moves and no success announcement', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)

  const live = dndLiveRegion(page)
  await pointerDrag(
    page,
    page.getByRole('button', { name: 'MES-1 sürükle' }),
    page.getByRole('button', { name: 'MES-1, First task, Yapılacak' }),
  )

  await expect.poll(() => capture.count).toBe(0)
  await expect(live).not.toContainText('taşındı')
  await expectOrder(page, ['MES-1', 'MES-2', 'MES-3'])
})

test('valid drop announces success only after the real move is accepted', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)

  const live = dndLiveRegion(page)
  const handle = page.getByRole('button', { name: 'MES-1 sürükle' })
  await keyboardPickUp(page, handle)
  await page.keyboard.press('ArrowDown')
  await expect(live).toContainText('Kart MES-1 üzerinde: MES-2', { timeout: 5000 })
  await keyboardDrop(page)

  await expect.poll(() => capture.count, { timeout: 5000 }).toBe(1)
  await expect(live).toContainText('yeni konumuna taşındı')
  await expectOrder(page, ['MES-2', 'MES-1', 'MES-3'])
})

test('live-region announcements never leak raw issue title or status text', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)

  const live = dndLiveRegion(page)
  await pointerDrag(
    page,
    page.getByRole('button', { name: 'MES-1 sürükle' }),
    page.getByRole('button', { name: 'MES-3, Third task, Sürüyor' }),
  )
  await expect.poll(() => capture.count, { timeout: 5000 }).toBe(1)

  // The announcement interpolates only the safe issue key, never the title or
  // the raw workflow status label.
  const text = await live.textContent()
  expect(text ?? '').toContain('MES-1')
  expect(text ?? '').not.toContain('First task')
  expect(text ?? '').not.toContain('Yapılacak')
  expect(text ?? '').not.toContain('Sürüyor')
})

test('pointer cross-column drag moves the card into the destination column', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)

  await pointerDrag(
    page,
    page.getByRole('button', { name: 'MES-1 sürükle' }),
    page.getByRole('button', { name: 'MES-3, Third task, Sürüyor' }),
  )

  await expect.poll(() => capture.count, { timeout: 5000 }).toBe(1)
  expect(capture.bodies[0]).toEqual({
    targetStatusCode: 'IN_PROGRESS',
    beforeIssueKey: 'MES-3',
    afterIssueKey: null,
    expectedVersion: 0,
  })
  await expect(page.getByRole('region', { name: 'Sürüyor sütunu, 2 kart' })).toBeVisible()
})

test('pointer drop into an empty column appends with both neighbors null', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)
  await expect(page.getByRole('region', { name: 'Bitti sütunu, 0 kart' })).toBeVisible()

  await pointerDropIntoColumn(page, page.getByRole('button', { name: 'MES-1 sürükle' }), 'Bitti')

  await expect.poll(() => capture.count, { timeout: 5000 }).toBe(1)
  expect(capture.bodies[0]).toEqual({
    targetStatusCode: 'DONE',
    beforeIssueKey: null,
    afterIssueKey: null,
    expectedVersion: 0,
  })
  await expect(page.getByRole('region', { name: 'Bitti sütunu, 1 kart' })).toBeVisible()
})

test('keyboard handle pickup/move/drop through KeyboardSensor', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)

  await keyboardDrag(
    page,
    page.getByRole('button', { name: 'MES-1 sürükle' }),
    ['ArrowDown'],
    'MES-2',
  )

  await expect.poll(() => capture.count, { timeout: 5000 }).toBe(1)
  expect(capture.bodies[0]).toEqual({
    targetStatusCode: 'TO_DO',
    beforeIssueKey: null,
    afterIssueKey: 'MES-2',
    expectedVersion: 0,
  })
  await expectOrder(page, ['MES-2', 'MES-1', 'MES-3'])
})

test('Escape during an active keyboard drag cancels with zero move requests', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)

  const handle = page.getByRole('button', { name: 'MES-1 sürükle' })
  await keyboardPickUp(page, handle)
  await page.keyboard.press('ArrowDown')
  await expect(dndLiveRegion(page)).toContainText('Kart MES-1 üzerinde: MES-2', {
    timeout: 5000,
  })
  await page.keyboard.press('Escape') // cancel

  await expect.poll(() => capture.count).toBe(0)
  await expect(dndLiveRegion(page)).toContainText('iptal', { timeout: 5000 })
  await expectOrder(page, ['MES-1', 'MES-2', 'MES-3'])
})

test('screen reader announcements are controlled Turkish text during a keyboard drag', async ({ page }, testInfo) => {
  skipNarrowViewport(testInfo)
  const capture: MoveCapture = { count: 0, bodies: [] }
  await mockAuthenticated(page)
  await mockWorkspace(page, capture)
  await gotoBoard(page)

  const live = dndLiveRegion(page)
  const handle = page.getByRole('button', { name: 'MES-1 sürükle' })
  await keyboardPickUp(page, handle)
  await page.keyboard.press('ArrowDown')
  await expect(live).toContainText('Kart MES-1 üzerinde: MES-2', { timeout: 5000 })

  // Controlled Turkish announcement text is announced; no raw/hostile content.
  await expect(live).toContainText('Kart MES-1')
  await expect(live).toContainText('üzerinde')

  await keyboardDrop(page)
  await expect.poll(() => capture.count, { timeout: 5000 }).toBe(1)
})
