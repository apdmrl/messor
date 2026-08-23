import { expect, test, type Page } from '@playwright/test'
import {
  ADMIN_EMAIL,
  MEMBER_EMAIL,
  STATUS_LABELS,
  apiAddMember,
  apiChangeMemberRole,
  apiCreateIssue,
  apiCreateProject,
  apiFetch,
  apiListMembers,
  apiLogin,
  apiLogout,
  collectUnexpectedErrors,
  demoPassword,
  expectCleanBrowserStorage,
  expectHitTargets,
  expectNoHorizontalOverflow,
  uiLogin,
  uniqueProjectKey,
} from './stack-helpers'

/* ============================================================
   Messor portfolio MVP golden path — real-stack browser
   acceptance (Phase 2).

   Runs against the running compose stack (dev compose by default,
   compose.test.yaml in CI) with real PostgreSQL, server-side
   sessions and CSRF. Every test creates its own unique project so
   parallel viewport workers never share or clobber state.

   Roles exercised: ORG_ADMIN / PROJECT_LEAD / MEMBER / VIEWER /
   nonmember, plus logout session isolation. Responsive and
   accessibility assertions (no page overflow, >=44px hit targets,
   keyboard/focus/Escape behavior) run on every viewport.
   ============================================================ */

const PASSWORD = demoPassword()

/* ---------- Small UI helpers ---------- */

async function createProjectViaUi(page: Page, key: string, name: string): Promise<void> {
  await page.getByLabel('Proje anahtarı').fill(key)
  await page.getByLabel('Proje adı').fill(name)
  await page.getByRole('button', { name: 'Proje oluştur' }).click()
  // A successful create navigates to the new project board, whose heading is
  // the project name. (An empty board has no Kanban column region yet.)
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible()
}

async function createIssueViaUi(
  page: Page,
  typeLabel: string,
  title: string,
): Promise<string> {
  await page.getByRole('button', { name: 'Yeni issue' }).click()
  const form = page.locator('.issue-form')
  await form.getByLabel('Tür').selectOption({ label: typeLabel })
  await form.getByLabel('Başlık').fill(title)
  await form.getByRole('button', { name: 'Oluştur' }).click()
  // Creation opens the route-backed drawer for the new issue.
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const keyText = await dialog.locator('.issue-drawer__heading').textContent()
  expect(keyText ?? '').toMatch(/^[A-Z][A-Z0-9]+-\d+$/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  return keyText ?? ''
}

function cardButton(page: Page, issueKey: string, title: string, status: string): ReturnType<Page['getByRole']> {
  return page.getByRole('button', {
    name: `${issueKey}, ${title}, ${status}`,
  })
}

/* ============================================================
   A. Admin golden path
   ============================================================ */

test('admin completes project, membership, issue, archive and logout flow', async ({
  page,
}) => {
  // The archived-issue security probes intentionally return 404/409.
  const errors = collectUnexpectedErrors(page, ['/api/issues/'])
  const projectKey = uniqueProjectKey('GP')
  const projectName = `Golden path ${projectKey}`

  await apiLogin(page, ADMIN_EMAIL, PASSWORD)
  await page.goto('/projects')

  // 1. Login succeeded and the protected shell is present.
  await expect(page.getByRole('heading', { name: 'Projeler', level: 2 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Çıkış yap' })).toBeVisible()

  // 2. Create a project through the UI.
  await createProjectViaUi(page, projectKey, projectName)
  await expectNoHorizontalOverflow(page)

  // 3. Open settings and add the demo member through the UI.
  await page.getByRole('link', { name: 'Proje ayarları' }).click()
  await expect(page.getByRole('heading', { name: 'Proje ayarları', level: 2 })).toBeVisible()
  const addForm = page.locator('.settings-page__add-form')
  await addForm.getByLabel('E-posta').selectOption({ label: MEMBER_EMAIL })
  await addForm.getByLabel('Rol').selectOption({ label: 'Üye' })
  await addForm.getByRole('button', { name: 'Üye ekle' }).click()
  const memberRow = page.locator('.member-card').filter({ hasText: MEMBER_EMAIL })
  await expect(memberRow).toBeVisible()
  await expect(page.getByLabel('Messor Member rolü', { exact: true })).toHaveValue('MEMBER')
  await expectNoHorizontalOverflow(page)

  // 4. Change the member role to VIEWER and back to MEMBER (lead can manage).
  //    Both the persisted backend role and the reflected UI value are asserted.
  await page.getByLabel('Messor Member rolü', { exact: true }).selectOption('VIEWER')
  await memberRow.getByRole('button', { name: 'Messor Member rolünü değiştir' }).click()
  await expect
    .poll(async () => {
      const members = await apiListMembers(page, projectKey)
      return members.find((m) => m.email === MEMBER_EMAIL)?.role
    })
    .toBe('VIEWER')
  await expect(page.getByLabel('Messor Member rolü', { exact: true })).toHaveValue('VIEWER')
  await page.getByLabel('Messor Member rolü', { exact: true }).selectOption('MEMBER')
  await memberRow.getByRole('button', { name: 'Messor Member rolünü değiştir' }).click()
  await expect
    .poll(async () => {
      const members = await apiListMembers(page, projectKey)
      return members.find((m) => m.email === MEMBER_EMAIL)?.role
    })
    .toBe('MEMBER')
  await expect(page.getByLabel('Messor Member rolü', { exact: true })).toHaveValue('MEMBER')

  // 5. Back to the board and create a Story, Task and Bug through the UI.
  await page.getByRole('link', { name: 'Board’a dön' }).click()
  await expect(page.getByText('Henüz issue yok.')).toBeVisible()
  const storyKey = await createIssueViaUi(page, 'Hikaye', 'Golden story')
  await createIssueViaUi(page, 'Görev', 'Golden task')
  const bugKey = await createIssueViaUi(page, 'Hata', 'Golden bug')
  await expect(page.getByRole('region', { name: 'Yapılacak sütunu, 3 kart' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // 6. Edit the story title through the drawer.
  await cardButton(page, storyKey, 'Golden story', STATUS_LABELS.TO_DO).click()
  const drawer = page.getByRole('dialog', { name: storyKey })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: 'Düzenle' }).click()
  await drawer.getByLabel('Başlık').fill('Golden story edited')
  await drawer.getByRole('button', { name: 'Güncelle' }).click()
  await expect(drawer.getByText('Golden story edited')).toBeVisible()

  // 7. Closing the drawer reveals the updated card on the board.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(cardButton(page, storyKey, 'Golden story edited', STATUS_LABELS.TO_DO)).toBeVisible()

  // 8. Move the bug to the next column via the accessible movement menu.
  await page.getByRole('button', { name: `${bugKey} için taşıma menüsü` }).click()
  await page.getByRole('button', { name: 'Sonraki sütuna taşı' }).click()
  await expect(page.getByText(`${bugKey} taşındı.`)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Devam Ediyor sütunu, 1 kart' })).toBeVisible()

  // 9. Drawer comments: create, edit, then tombstone delete.
  await cardButton(page, bugKey, 'Golden bug', STATUS_LABELS.IN_PROGRESS).click()
  const bugDrawer = page.getByRole('dialog', { name: bugKey })
  await bugDrawer.getByRole('tab', { name: 'Yorumlar' }).click()
  const commentsPanel = bugDrawer.locator('#issue-tabpanel-comments')
  await commentsPanel.getByLabel('Yorum ekle').fill('A golden comment')
  await commentsPanel.getByRole('button', { name: 'Yorum yap' }).click()
  await expect(commentsPanel.getByText('A golden comment')).toBeVisible()
  await commentsPanel.getByRole('button', { name: 'Düzenle' }).click()
  await commentsPanel.getByLabel('Yorumu düzenle').fill('A golden comment edited')
  await commentsPanel.getByRole('button', { name: 'Kaydet' }).click()
  await expect(commentsPanel.getByText('A golden comment edited')).toBeVisible()
  await commentsPanel.getByRole('button', { name: 'Sil' }).click()
  await commentsPanel.getByRole('button', { name: 'Silmeyi onayla' }).click()
  await expect(commentsPanel.getByText('Bu yorum silindi.')).toBeVisible()
  await expect(commentsPanel.getByText('A golden comment edited')).toHaveCount(0)

  // 9. Activity tab shows the controlled summary (issue was created).
  await bugDrawer.getByRole('tab', { name: 'Aktivite' }).click()
  await expect(bugDrawer.getByText(/Oluşturuldu: Hata/)).toBeVisible()

  // 10. Archive the story through the drawer with confirmation.
  await page.getByRole('button', { name: 'İş kapanış panelini kapat' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await cardButton(page, storyKey, 'Golden story edited', STATUS_LABELS.TO_DO).click()
  const storyDrawer = page.getByRole('dialog', { name: storyKey })
  await storyDrawer.getByRole('button', { name: 'Arşivle' }).click()
  await storyDrawer.getByRole('button', { name: 'Arşivlemeyi onayla' }).click()
  await expect(page.getByText('Issue arşivlendi.')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // 11. Archive filter surfaces the archived story as a read-only card.
  await page.getByLabel('Arşiv').selectOption('archived')
  await expect(page.getByRole('region', { name: 'Yapılacak sütunu, 1 kart' })).toBeVisible()
  const archivedCard = cardButton(page, storyKey, 'Golden story edited', STATUS_LABELS.TO_DO)
  await expect(archivedCard).toBeVisible()
  await expect(page.getByRole('button', { name: /sürükle/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /taşıma menüsü/ })).toHaveCount(0)

  // 12. Archived issue drawer exposes no issue mutation controls, and the
  //     backend closes edit/archive/move/comment mutations (API assertions are
  //     authoritative; UI hiding is UX only).
  await archivedCard.click()
  const archivedDrawer = page.getByRole('dialog', { name: storyKey })
  await expect(archivedDrawer).toBeVisible()
  await expect(archivedDrawer.getByRole('button', { name: 'Düzenle' })).toHaveCount(0)
  await expect(archivedDrawer.getByRole('button', { name: 'Arşivle' })).toHaveCount(0)
  await archivedDrawer.getByRole('tab', { name: 'Yorumlar' }).click()

  const archivedComment = await apiFetch(page, `/api/issues/${storyKey}/comments`, {
    method: 'POST',
    csrf: true,
    body: { body: 'blocked on archived' },
  })
  expect(archivedComment.status, 'comment create on archived must be 404').toBe(404)
  const archivedPatch = await apiFetch(page, `/api/issues/${storyKey}`, {
    method: 'PATCH',
    csrf: true,
    body: { title: 'x', description: null, assigneeId: null, expectedVersion: 1 },
  })
  expect(archivedPatch.status, 'issue patch on archived must be 409').toBe(409)
  expect((archivedPatch.body as Record<string, unknown>).code).toBe('ISSUE_ARCHIVED')
  const archivedMove = await apiFetch(page, `/api/issues/${storyKey}/move`, {
    method: 'PATCH',
    csrf: true,
    body: { targetStatusCode: 'IN_PROGRESS', beforeIssueKey: null, afterIssueKey: null, expectedVersion: 1 },
  })
  expect(archivedMove.status, 'issue move on archived must be 409').toBe(409)
  expect((archivedMove.body as Record<string, unknown>).code).toBe('ISSUE_ARCHIVED')

  // 13. Logout revokes access to protected routes.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Çıkış yap' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/projects')
  await expect(page).toHaveURL(/\/login$/)
  await expectCleanBrowserStorage(page)

  errors.assertClean()
})

/* ============================================================
   B. Member golden path
   ============================================================ */

test('member sees only their work, drives URL filters, and drawer navigation', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page)
  const projectKey = uniqueProjectKey('MP')
  const projectName = `Member project ${projectKey}`

  // Admin setup: project + member + assigned and unassigned issues.
  await apiLogin(page, ADMIN_EMAIL, PASSWORD)
  await apiCreateProject(page, projectKey, projectName)
  const member = await apiAddMember(page, projectKey, 'MEMBER')
  await apiCreateIssue(page, projectKey, {
    type: 'TASK',
    title: 'Assigned to me',
    description: 'desc',
    assigneeId: member.userId,
  })
  const mineArchived = await apiCreateIssue(page, projectKey, {
    type: 'BUG',
    title: 'Archived of mine',
    description: null,
    assigneeId: member.userId,
  })
  await apiCreateIssue(page, projectKey, {
    type: 'STORY',
    title: 'Not assigned to me',
    description: null,
    assigneeId: null,
  })
  await apiFetch(page, `/api/issues/${mineArchived.issueKey}/archive`, {
    method: 'POST',
    csrf: true,
    body: { expectedVersion: mineArchived.version },
  })
  await apiLogout(page)

  // 1. Member login.
  await uiLogin(page, MEMBER_EMAIL, PASSWORD)

  // 2. The project is visible to the member.
  await page.getByText(projectName).waitFor()

  // 3. My Work scoped to this project shows only the principal's active
  //    assigned issue (the unassigned issue is excluded).
  await page.goto(`/my-work?project=${projectKey}`)
  await expect(page.getByRole('heading', { name: 'Görevlerim', level: 2 })).toBeVisible()
  await expect(page.getByRole('link', { name: /Assigned to me/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Not assigned to me/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Archived of mine/ })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await expectHitTargets(page.locator('.my-work__link'))

  // 4. Archive URL filter and back/forward URL-state restoration.
  await page.getByLabel('Arşiv').selectOption('archived')
  await expect(page.getByRole('link', { name: /Archived of mine/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Assigned to me/ })).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('archive')).toBe('archived')
  await page.goBack()
  await page.waitForURL((url) => {
    const archive = new URL(url.toString()).searchParams.get('archive')
    return archive === null || archive === 'active'
  })
  await expect(page.getByRole('link', { name: /Assigned to me/ })).toBeVisible()
  await page.goForward()
  await page.waitForURL((url) => new URL(url.toString()).searchParams.get('archive') === 'archived')
  await expect(page.getByRole('link', { name: /Archived of mine/ })).toBeVisible()

  // 5. Type filter drives the real request and the board render.
  await page.goto(`/my-work?project=${projectKey}&type=BUG&archive=all`)
  await expect(page.getByRole('link', { name: /Archived of mine/ })).toBeVisible()

  // 6. Drawer opens from My Work; Escape returns and focus is restored.
  const issueLink = page.getByRole('link', { name: /Archived of mine/ })
  await issueLink.click()
  const drawer = page.getByRole('dialog', { name: mineArchived.issueKey })
  await expect(drawer).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'İş kapanış panelini kapat' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Görevlerim', level: 2 })).toBeVisible()

  // 7. A member can mutate an issue they can access (create + move + comment).
  await page.goto(`/projects/${projectKey}/board`)
  await expect(page.getByRole('region', { name: 'Kanban panosu' })).toBeVisible()
  const memberIssueKey = await createIssueViaUi(page, 'Görev', 'Member created task')
  await page.getByRole('button', { name: `${memberIssueKey} için taşıma menüsü` }).click()
  await page.getByRole('button', { name: 'Sonraki sütuna taşı' }).click()
  await expect(page.getByText(`${memberIssueKey} taşındı.`)).toBeVisible()

  // 8. My Work cannot be queried on behalf of another principal.
  const targetProbe = await apiFetch(page, `/api/my-work?assignee=00000000-0000-0000-0000-000000000001`)
  expect(targetProbe.status, 'assignee targeting must be rejected').toBe(400)
  const userIdProbe = await apiFetch(page, '/api/my-work?userId=00000000-0000-0000-0000-000000000001')
  expect(userIdProbe.status, 'userId targeting must be rejected').toBe(400)

  await expectNoHorizontalOverflow(page)
  errors.assertClean()
})

/* ============================================================
   C. Viewer read-only golden path
   ============================================================ */

test('viewer is read-only in the UI and the backend enforces it', async ({ page }) => {
  const errors = collectUnexpectedErrors(page, [
    '/api/projects/',
    '/api/issues/',
    '/api/comments/',
  ])
  const projectKey = uniqueProjectKey('VP')
  const projectName = `Viewer project ${projectKey}`

  await apiLogin(page, ADMIN_EMAIL, PASSWORD)
  await apiCreateProject(page, projectKey, projectName)
  const member = await apiAddMember(page, projectKey, 'MEMBER')
  const issue = await apiCreateIssue(page, projectKey, {
    type: 'TASK',
    title: 'Read-only target',
    description: null,
    assigneeId: member.userId,
  })
  // Demote the member to VIEWER.
  await apiChangeMemberRole(page, projectKey, member.userId, 'VIEWER', member.version)
  await apiLogout(page)

  // 1. Viewer login and project visibility.
  await uiLogin(page, MEMBER_EMAIL, PASSWORD)
  await page.getByText(projectName).waitFor()

  // 2. Read endpoints are visible.
  const projectResult = await apiFetch(page, `/api/projects/${projectKey}`)
  expect(projectResult.status, 'viewer reads project').toBe(200)
  const issuesResult = await apiFetch(page, `/api/projects/${projectKey}/issues?page=0&size=20`)
  expect(issuesResult.status, 'viewer reads issues').toBe(200)
  const activityResult = await apiFetch(page, `/api/issues/${issue.issueKey}/activity`)
  expect(activityResult.status, 'viewer reads activity').toBe(200)
  const commentsResult = await apiFetch(page, `/api/issues/${issue.issueKey}/comments`)
  expect(commentsResult.status, 'viewer reads comments').toBe(200)

  // 3. The board renders read-only: no create/move/edit/comment UI.
  await page.goto(`/projects/${projectKey}/board`)
  await expect(page.getByRole('region', { name: 'Kanban panosu' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Yeni issue' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /sürükle/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /taşıma menüsü/ })).toHaveCount(0)
  await cardButton(page, issue.issueKey, 'Read-only target', STATUS_LABELS.TO_DO).click()
  const drawer = page.getByRole('dialog', { name: issue.issueKey })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Düzenle' })).toHaveCount(0)
  await expect(drawer.getByRole('button', { name: 'Arşivle' })).toHaveCount(0)
  await drawer.getByRole('tab', { name: 'Yorumlar' }).click()
  await expect(drawer.getByLabel('Yorum ekle')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  // 4. Backend rejects every mutation with the exact 403 contract.
  const forbidden: { path: string; method: string; body?: unknown }[] = [
    {
      path: `/api/issues/${issue.issueKey}`,
      method: 'PATCH',
      body: {
        title: 'viewer cannot',
        description: null,
        assigneeId: null,
        expectedVersion: issue.version,
      },
    },
    { path: `/api/issues/${issue.issueKey}/archive`, method: 'POST', body: { expectedVersion: issue.version } },
    {
      path: `/api/issues/${issue.issueKey}/move`,
      method: 'PATCH',
      body: { targetStatusCode: 'IN_PROGRESS', beforeIssueKey: null, afterIssueKey: null, expectedVersion: issue.version },
    },
    { path: `/api/issues/${issue.issueKey}/comments`, method: 'POST', body: { body: 'viewer cannot comment' } },
    { path: `/api/projects/${projectKey}/issues`, method: 'POST', body: { type: 'TASK', title: 'x', description: null, assigneeId: null } },
    { path: `/api/projects/${projectKey}/members/${member.userId}`, method: 'PATCH', body: { role: 'MEMBER', expectedVersion: member.version } },
  ]
  for (const call of forbidden) {
    const result = await apiFetch(page, call.path, {
      method: call.method,
      csrf: true,
      body: call.body,
    })
    expect(result.status, `${call.method} ${call.path} must be 403`).toBe(403)
    const body = result.body as Record<string, unknown>
    expect(body.code, `${call.method} ${call.path} code`).toBe('FORBIDDEN')
  }
  const memberRemove = await apiFetch(
    page,
    `/api/projects/${projectKey}/members/${member.userId}?expectedVersion=${member.version}`,
    { method: 'DELETE', csrf: true },
  )
  expect(memberRemove.status, 'viewer member delete must be 403').toBe(403)

  errors.assertClean()
})

/* ============================================================
   D. Nonmember safe 404 probing
   ============================================================ */

test('nonmember probing returns safe 404 without disclosing the project', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page, [
    '/api/projects/',
    '/api/issues/',
  ])
  const projectKey = uniqueProjectKey('NP')
  const projectName = `Hidden project ${projectKey}`

  await apiLogin(page, ADMIN_EMAIL, PASSWORD)
  await apiCreateProject(page, projectKey, projectName)
  const issue = await apiCreateIssue(page, projectKey, {
    type: 'TASK',
    title: 'Hidden issue',
    description: null,
    assigneeId: null,
  })
  // The member is intentionally NOT added to this project.
  await apiLogout(page)
  await uiLogin(page, MEMBER_EMAIL, PASSWORD)

  // 1. The project never appears in the member's project list.
  await page.getByRole('heading', { name: 'Projeler', level: 2 }).waitFor()
  await expect(page.getByText(projectName)).toHaveCount(0)

  // 2. Every probe returns a safe 404 and never discloses existence.
  // Project-scoped endpoints report PROJECT_NOT_FOUND; issue-scoped endpoints
  // report ISSUE_NOT_FOUND (the issue belongs to an inaccessible project).
  const projectScoped: { path: string; expected: number }[] = [
    { path: `/api/projects/${projectKey}`, expected: 404 },
    { path: `/api/projects/${projectKey}/issues?page=0&size=20`, expected: 404 },
    { path: `/api/projects/${projectKey}/members`, expected: 404 },
  ]
  for (const probe of projectScoped) {
    const result = await apiFetch(page, probe.path)
    expect(result.status, `${probe.path} must be 404`).toBe(probe.expected)
    expect((result.body as Record<string, unknown>).code, `${probe.path} code`).toBe(
      'PROJECT_NOT_FOUND',
    )
  }
  const issueScoped: { path: string; expected: number }[] = [
    { path: `/api/issues/${issue.issueKey}`, expected: 404 },
    { path: `/api/issues/${issue.issueKey}/activity`, expected: 404 },
    { path: `/api/issues/${issue.issueKey}/comments`, expected: 404 },
  ]
  for (const probe of issueScoped) {
    const result = await apiFetch(page, probe.path)
    expect(result.status, `${probe.path} must be 404`).toBe(probe.expected)
    expect((result.body as Record<string, unknown>).code, `${probe.path} code`).toBe(
      'ISSUE_NOT_FOUND',
    )
  }

  // 3. Mutation attempts against the hidden project are also safe 404s.
  const mutation = await apiFetch(page, `/api/projects/${projectKey}/issues`, {
    method: 'POST',
    csrf: true,
    body: { type: 'TASK', title: 'probe', description: null, assigneeId: null },
  })
  expect(mutation.status, 'nonmember issue create must be 404').toBe(404)
  expect((mutation.body as Record<string, unknown>).code).toBe('PROJECT_NOT_FOUND')

  // 4. Direct navigation shows the safe error screen, never cached data.
  await page.goto(`/projects/${projectKey}/board`)
  await expect(page.getByText('Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.')).toBeVisible()

  errors.assertClean()
})

/* ============================================================
   E. Session isolation after logout
   ============================================================ */

test('logout isolates the next principal and never leaks cached data', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page, ['/api/projects/'])
  const adminKey = uniqueProjectKey('SI')
  const adminName = `Admin session project ${adminKey}`

  // 1. Admin creates a project through the UI and sees it.
  await uiLogin(page, ADMIN_EMAIL, PASSWORD)
  await createProjectViaUi(page, adminKey, adminName)
  await expect(page.getByText(adminName)).toBeVisible()

  // 2. Logout through the UI.
  await page.getByRole('button', { name: 'Çıkış yap' }).click()
  await expect(page).toHaveURL(/\/login$/)

  // 3. No auth/session/CSRF material survives in browser storage.
  await expectCleanBrowserStorage(page)

  // 4. Back navigation never restores protected content.
  await page.goBack()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Oturum aç', level: 2 })).toBeVisible()
  await expect(page.getByText(adminName)).toHaveCount(0)

  // 5. The member session cannot see the admin's project.
  await uiLogin(page, MEMBER_EMAIL, PASSWORD)
  await expect(page.getByRole('heading', { name: 'Projeler', level: 2 })).toBeVisible()
  await expect(page.getByText(adminName)).toHaveCount(0)

  // 6. Direct navigation to the admin project URL fails safely (404).
  await page.goto(`/projects/${adminKey}/board`)
  await expect(page.getByText('Proje bilgileri yüklenemedi. Lütfen tekrar deneyin.')).toBeVisible()
  await expect(page.getByText(adminName)).toHaveCount(0)

  errors.assertClean()
})

/* ============================================================
   F. Pointer drag against the real backend (desktop only;
   mobile DnD is out of MVP scope and covered by the accessible
   movement menu in the tests above).
   ============================================================ */

test('pointer drag moves a card across columns on the real backend', async ({
  page,
}, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 1440
  test.skip(width < 1024, 'pointer drag requires a wide viewport')

  const errors = collectUnexpectedErrors(page)
  const projectKey = uniqueProjectKey('PD')
  await apiLogin(page, ADMIN_EMAIL, PASSWORD)
  await apiCreateProject(page, projectKey, `Drag project ${projectKey}`)
  const first = await apiCreateIssue(page, projectKey, {
    type: 'TASK',
    title: 'Drag me',
    description: null,
    assigneeId: null,
  })
  await apiCreateIssue(page, projectKey, {
    type: 'TASK',
    title: 'Stay here',
    description: null,
    assigneeId: null,
  })

  await page.goto(`/projects/${projectKey}/board`)
  await expect(page.getByRole('region', { name: 'Kanban panosu' })).toBeVisible()

  const handle = page.getByRole('button', { name: `${first.issueKey} sürükle` })
  const target = page.getByRole('region', { name: /Devam Ediyor sütunu/ })
  const sb = (await handle.boundingBox())!
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 20, { steps: 5 })
  const tb = (await target.boundingBox())!
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 })
  await page.mouse.up()

  await expect(page.getByText(`${first.issueKey} taşındı.`)).toBeVisible()
  await expect(
    page.getByRole('button', { name: `${first.issueKey}, Drag me, ${STATUS_LABELS.IN_PROGRESS}` }),
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)

  errors.assertClean()
})
