# Messor Burrow Instrument Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Burrow Instrument design across Messor’s authenticated React product surfaces, including board workflows, issue collaboration, My Work, administration, membership, themes, and shared states.

**Architecture:** Extend the existing React Router/TanStack Query feature organization instead of introducing a new design-system package or global state library. Add a small semantic token layer in the existing global CSS, evolve the authenticated shell into the approved workspace/project navigation, and keep feature behavior in the existing `features/*` folders. Backend APIs remain authoritative for authorization; frontend gates are presentation only.

**Tech Stack:** React 19, TypeScript 6, React Router 7, TanStack Query 5, Vite 8, Vitest, Testing Library, Playwright, existing CSS conventions.

**Spec:** `docs/superpowers/specs/2026-08-23-messor-burrow-instrument-design.md`

## Global Constraints

- JavaScript/TypeScript only; no new dependency unless a concrete existing use case is documented.
- Use semantic CSS variables; components MUST NOT reference raw Tailwind color classes or hard-coded palette colors.
- Dark-first with a complete light-theme mapping; default theme is dark unless existing product behavior dictates otherwise.
- Use the existing feature folders and React Router routes; do not introduce global state libraries.
- TanStack Query owns server state; local React state owns view-only state.
- Authentication remains server-side session based; never store credentials, tokens, CSRF tokens, or session identifiers in web storage.
- Frontend permission checks are UX only; protected operations remain backend-authorized and fail closed.
- Every new/changed endpoint contract requires success, validation, and authorization coverage; do not weaken existing tests.
- Each worker adds focused tests but MUST NOT run formatters, linters, builds, or project-wide tests during parallel work.

## File ownership and contracts

The current frontend already contains `AuthenticatedShell`, `router`, project pages/settings, issue board/list/drawer/form components, My Work, comments, and auth. Workers must modify only their assigned files plus tests and any explicitly shared contract files. The integration owner handles `router.tsx`, cross-feature route composition, and final shared CSS conflicts.

Shared contracts:

```ts
type ThemeMode = 'dark' | 'light' | 'system'

type AppTheme = 'dark' | 'light'

function resolveTheme(mode: ThemeMode, prefersDark: boolean): AppTheme
```

Semantic CSS variables use space-separated RGB channels, for example:

```css
background: rgb(var(--messor-surface-1));
color: rgb(var(--messor-text-primary));
```

Shared shell components expose ordinary React props and render semantic landmarks; feature workers should consume shell/page primitives without introducing parallel navigation or color systems.

### Task 1: Build semantic tokens and Burrow Instrument shell

**Files:**
- Create: `frontend/src/app/theme.ts`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/app/AuthenticatedShell.tsx`
- Modify: `frontend/src/app/AuthenticatedShell.css`
- Modify: `frontend/src/app/router.tsx` only for shell-level not-found/session routes if required by the existing route shape
- Test: `frontend/src/app/router.test.tsx`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: existing `useSession`, `NavLink`, `Outlet`, `UserSummary`.
- Produces: semantic theme variables, `resolveTheme(mode, prefersDark)`, `data-theme` application behavior, stable top bar/project rail landmarks, accessible active navigation, and shell layout classes consumed by feature pages.


- [ ] **Step 1: Add the semantic CSS token layer**

  Add dark and light variables from the approved spec to `index.css`; add typography, spacing, focus-ring, surface, border, and reduced-motion rules. Keep existing reset behavior intact.

- [ ] **Step 2: Add theme resolution behavior**

  Implement `resolveTheme(mode, prefersDark)` in `frontend/src/app/theme.ts`. Read only a non-sensitive theme preference if needed; do not touch session storage or auth data. Apply the resolved value as `data-theme` on the document root.

- [ ] **Step 3: Refactor the authenticated shell structure**

  Replace the current horizontal-only navigation with the approved 40px top bar, collapsible 240px/56px project rail, workspace context, global search trigger, create trigger, signal trigger, and account menu. Preserve existing logout behavior and session error handling.

- [ ] **Step 4: Add accessible shell tests**

  Cover authenticated rendering, active navigation/`aria-current`, logout pending/error behavior, theme attribute application, keyboard-accessible collapse behavior, and the anonymous redirect contract.

- [ ] **Step 5: Add focused CSS tests or assertions only where existing conventions support them**

  Keep behavioral assertions in Testing Library; do not assert incidental class names except the semantic theme contract.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/index.css frontend/src/App.css frontend/src/app/AuthenticatedShell.tsx frontend/src/app/AuthenticatedShell.css frontend/src/app/router.test.tsx frontend/src/App.test.tsx
  git commit -m "feat: add Burrow Instrument shell and theme tokens"
  ```

### Task 2: Implement project list, overview, and project settings surfaces

**Files:**
- Modify: `frontend/src/features/projects/ProjectsPage.tsx`
- Modify: `frontend/src/features/projects/ProjectsPage.css`
- Modify: `frontend/src/features/projects/ProjectSettingsPage.tsx`
- Modify: `frontend/src/features/projects/ProjectSettingsPage.css`
- Modify: `frontend/src/features/projects/CreateProjectForm.tsx`
- Modify: `frontend/src/features/projects/types.ts`
- Modify: `frontend/src/app/router.tsx` only if route additions are strictly project-surface routes; otherwise hand off route changes to Task 7
- Test: `frontend/src/features/projects/ProjectsPage.test.tsx`
- Test: `frontend/src/features/projects/ProjectSettingsPage.test.tsx`

**Interfaces:**
- Consumes: existing projects API/types and shell semantic variables.
- Produces: project list, project overview summary, create flow, project settings frame, loading/error/empty states, and links to board/issues/settings.

- [ ] **Step 1: Write focused tests for project empty/loading/error and overview actions**

  Cover no projects, project list success, create validation, overview summary action links, and unauthorized/read-only settings presentation using existing test fixtures.

- [ ] **Step 2: Implement the shared page header and project overview composition**

  Keep project data fetching in existing API/query patterns. Make summary cards actionable and route project actions with the existing `projectKey` convention.

- [ ] **Step 3: Implement settings navigation and form states**

  Add General, workflow/settings entry points, appearance entry point, and danger-zone presentation without inventing unsupported backend mutations. Preserve server validation and pending/error behavior.

- [ ] **Step 4: Style with semantic surfaces and 8px spacing**

  Avoid raw colors. Ensure project empty/error/restricted states use the shared page-state contract.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/features/projects
  git commit -m "feat: apply Burrow Instrument project surfaces"
  ```

### Task 3: Implement board, issue list, filters, drag states, and bottleneck states

**Files:**
- Modify: `frontend/src/features/issues/ProjectBoard.tsx`
- Modify: `frontend/src/features/issues/ProjectBoard.css`
- Modify: `frontend/src/features/issues/KanbanColumn.tsx`
- Modify: `frontend/src/features/issues/IssueCard.tsx`
- Modify: `frontend/src/features/issues/IssueWorkspacePage.tsx`
- Modify: `frontend/src/features/issues/IssueWorkspacePage.css`
- Modify: `frontend/src/features/issues/IssueList.tsx`
- Modify: `frontend/src/features/issues/IssueFilters.tsx`
- Modify: `frontend/src/features/issues/IssueFilters.css`
- Modify: `frontend/src/features/issues/boardOrder.ts`
- Test: `frontend/src/features/issues/ProjectBoard.test.tsx`
- Test: `frontend/src/features/issues/IssueWorkspacePage.test.tsx`
- Test: `frontend/src/features/issues/issueFilters.test.ts`
- Test: `frontend/src/features/issues/boardOrder.test.ts`

**Interfaces:**
- Consumes: existing issue query/mutation APIs, `IssueCard`, `KanbanColumn`, board ordering helpers.
- Produces: three-column responsive board, semantic task-card hierarchy, pointer/keyboard move states, empty columns, WIP warning state, issue filters, and board detail-rail integration points.

- [ ] **Step 1: Add failing behavior tests**

  Cover card hierarchy labels, empty column action, WIP count warning, filter chips/URL state, keyboard move lifecycle, optimistic move rollback, and restricted move behavior.

- [ ] **Step 2: Implement board layout and column state model**

  Keep state labels driven by existing issue/status data. Add explicit `empty`, `overburdened`, `dragging`, `pending`, and `move-error` rendering states.

- [ ] **Step 3: Implement card semantics and accessible movement**

  Ensure the whole card opens detail while nested controls stop propagation. Add Space/arrow/Space movement or the closest existing drag contract without a new dependency.

- [ ] **Step 4: Implement filter toolbar and query persistence**

  Use existing issue filter helpers; expose removable chips, clear-all, and no-results distinction. Preserve project key route convention.

- [ ] **Step 5: Style board surfaces**

  Use CSS Grid with `repeat(3, minmax(280px, 1fr))`, 16px gap, 24px padding, horizontal overflow at narrow widths, semantic token variables, and reduced-motion drag fallback.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/features/issues/ProjectBoard.tsx frontend/src/features/issues/ProjectBoard.css frontend/src/features/issues/KanbanColumn.tsx frontend/src/features/issues/IssueCard.tsx frontend/src/features/issues/IssueWorkspacePage.tsx frontend/src/features/issues/IssueWorkspacePage.css frontend/src/features/issues/IssueList.tsx frontend/src/features/issues/IssueFilters.tsx frontend/src/features/issues/IssueFilters.css frontend/src/features/issues/boardOrder.ts frontend/src/features/issues/*.test.ts
  git commit -m "feat: implement Burrow Instrument board workflow"
  ```

### Task 4: Implement issue detail, forms, drawer, comments, and activity

**Files:**
- Modify: `frontend/src/features/issues/IssueDetailsPanel.tsx`
- Modify: `frontend/src/features/issues/IssueDrawer.tsx`
- Modify: `frontend/src/features/issues/IssueDrawer.css`
- Modify: `frontend/src/features/issues/IssueForm.tsx`
- Modify: `frontend/src/features/issues/IssueForm.css`
- Modify: `frontend/src/features/issues/IssueActivityList.tsx`
- Modify: `frontend/src/features/comments/IssueComments.tsx`
- Modify: `frontend/src/features/comments/CommentItem.tsx`
- Modify: `frontend/src/features/comments/CommentList.tsx`
- Modify: `frontend/src/features/comments/CommentForm.tsx`
- Modify: `frontend/src/features/comments/IssueComments.css`
- Test: `frontend/src/features/issues/IssueDrawer.test.tsx`
- Test: `frontend/src/features/comments/IssueComments.test.tsx`
- Test: `frontend/src/features/comments/commentsApi.test.ts`

**Interfaces:**
- Consumes: existing issue/comments API contracts, board detail-rail integration points, semantic page-state rules.
- Produces: issue detail route/drawer presentation, validation-preserving forms, safe plain-text comments, activity event presentation, offline/concurrent/permission-loss states.

- [ ] **Step 1: Add behavior tests**

  Cover issue required-field validation, failed mutation preservation, state/priority/assignee editing, comment success/error/edit/delete permissions, empty activity/comments, and restricted/deleted issue states.

- [ ] **Step 2: Implement issue detail hierarchy**

  Separate main content and sticky context panel. Preserve existing data APIs and project-scoped route keys.

- [ ] **Step 3: Implement create/edit form state machine**

  Add explicit pending/success/error/dirty states; do not clear user input on server errors. Keep board-column preselection visible where the caller supplies it.

- [ ] **Step 4: Implement comments and activity semantics**

  Render plain text safely, use live-region announcements for new comments, distinguish comments from activity, and keep authorized actions conditional.

- [ ] **Step 5: Style detail drawer and collaboration states**

  Use semantic signals and responsive full-screen drawer behavior without unsafe HTML or token leakage.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/features/issues/IssueDetailsPanel.tsx frontend/src/features/issues/IssueDrawer.tsx frontend/src/features/issues/IssueDrawer.css frontend/src/features/issues/IssueForm.tsx frontend/src/features/issues/IssueForm.css frontend/src/features/issues/IssueActivityList.tsx frontend/src/features/comments
  git commit -m "feat: implement issue collaboration surfaces"
  ```

### Task 5: Implement My Work and workload surfaces

**Files:**
- Modify: `frontend/src/features/my-work/MyWorkPage.tsx`
- Modify: `frontend/src/features/my-work/MyWorkPage.css`
- Modify: `frontend/src/features/my-work/myWorkApi.ts`
- Test: `frontend/src/features/my-work/MyWorkPage.test.tsx`

**Interfaces:**
- Consumes: existing My Work API/types and issue filter conventions.
- Produces: grouped attention queue, summary filter links, URL-persistent filters, workload rail, empty/no-results/overload states.

- [ ] **Step 1: Add failing tests**

  Cover grouped blocked/in-progress/queue/completed sections, summary filter behavior, filter chips/clear-all, empty assignments, no-results, pending/error, and authorized team workload rendering.

- [ ] **Step 2: Implement summary strip and grouped list**

  Preserve existing paging/filter query behavior. Use issue drawer/detail links that retain list position and query state.

- [ ] **Step 3: Implement filters and workload rail**

  Reuse issue filter semantics where possible. Use numeric horizontal bars, not charts. Do not introduce saved-search persistence.

- [ ] **Step 4: Style responsive My Work**

  Use semantic tokens, 48px rows, 8px spacing, and a collapsible 280px desktop rail.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/features/my-work
  git commit -m "feat: implement Burrow Instrument My Work"
  ```

### Task 6: Implement workspace/project membership and authorization presentation

**Files:**
- Create or modify: `frontend/src/features/projects/MembersPage.tsx`
- Create or modify: `frontend/src/features/projects/MembersPage.css`
- Create or modify: `frontend/src/features/projects/membershipApi.ts`
- Create or modify: `frontend/src/features/projects/membershipTypes.ts`
- Modify: `frontend/src/features/projects/ProjectSettingsPage.tsx`
- Modify: `frontend/src/features/projects/ProjectSettingsPage.css`
- Test: `frontend/src/features/projects/MembersPage.test.tsx`
- Test: `frontend/src/features/projects/ProjectSettingsPage.test.tsx`

**Interfaces:**
- Consumes: existing backend membership endpoints if present; otherwise use established API error/query patterns and do not invent unsupported server behavior.
- Produces: member table, role/access presentation, project member drawer, read-only/restricted states, safe confirmation flows, and permission-aware navigation data for integration.

- [ ] **Step 1: Inspect existing membership API contracts and write contract tests**

  Tests must cover success, validation, unauthorized access, and forbidden mutation using the actual client error shape. Do not replace backend behavior with frontend-only gates.

- [ ] **Step 2: Implement member table and access explanations**

  Include current-user marker, search/filter presentation, role text, project-access summary, and authorized overflow actions.

- [ ] **Step 3: Implement restricted/read-only/mixed-access states**

  Hide known-inaccessible navigation, omit inaccessible resources from lists, and use neutral restricted content for direct routes.

- [ ] **Step 4: Implement safe role/removal confirmation**

  Show consequence scope and actor/audit confirmation after success. Keep destructive actions separated from routine controls.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/features/projects/MembersPage.tsx frontend/src/features/projects/MembersPage.css frontend/src/features/projects/membershipApi.ts frontend/src/features/projects/membershipTypes.ts frontend/src/features/projects/ProjectSettingsPage.tsx frontend/src/features/projects/ProjectSettingsPage.css frontend/src/features/projects/*Members*.test.tsx frontend/src/features/projects/ProjectSettingsPage.test.tsx
  git commit -m "feat: add membership and authorization surfaces"
  ```

### Task 7: Integrate routes, shared states, and end-to-end product flow

**Files:**
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/app/AuthenticatedShell.tsx` only for integration wiring
- Modify: `frontend/src/app/AuthenticatedShell.css` only for integration wiring
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`
- Modify: `frontend/src/test/setup.ts` only if required by stable test providers
- Test: `frontend/src/app/router.test.tsx`
- Test: `frontend/src/test/smoke.test.tsx`
- Create/modify: `frontend/e2e/*.spec.ts` for critical flows

**Interfaces:**
- Consumes: outputs from Tasks 1–6; route keys remain `/projects/:projectKey/...` unless backend and existing tests require an explicit migration.
- Produces: complete route tree, not-found/session-expired states, shell-to-feature navigation, and executable critical user flows.

- [ ] **Step 1: Wire all approved routes**

  Add overview, issues list, activity, members, workspace settings, and project settings routes using existing project-key conventions. Keep auth redirects and session expiry behavior intact.

- [ ] **Step 2: Add shared route boundaries**

  Implement neutral not-found, restricted, loading, and error boundaries without exposing authorization details.

- [ ] **Step 3: Add focused router/smoke tests**

  Cover authenticated navigation, direct project routes, restricted route behavior, anonymous redirects, session expiry, and invalid routes.

- [ ] **Step 4: Add Playwright critical flows**

  Exercise login/session, project navigation, board empty/overburdened states, issue create/edit/comment, My Work filters, theme switching, and membership authorization failures with stable selectors.

- [ ] **Step 5: Verify accessibility scenarios**

  Exercise keyboard focus order, board keyboard movement, Escape drawer close, visible focus, reduced motion preference, and 200% zoom where the existing e2e harness supports it.

- [ ] **Step 6: Commit integration**

  ```bash
  git add frontend/src/app frontend/src/App.tsx frontend/src/App.css frontend/src/test frontend/e2e
  git commit -m "feat: integrate Burrow Instrument product flows"
  ```

## Final verification (integration owner only)

Run after all parallel tasks are merged:

```bash
cd frontend
npm test -- --run
npm run build
npm run lint
npm run test:e2e
```

Then launch the actual frontend stack and smoke-test authenticated navigation, board drag/keyboard movement, issue collaboration, My Work filters, theme mapping, settings, membership restrictions, session expiry, and responsive board behavior. Review the final diff for raw color usage, unsafe HTML, auth data storage, missing authorization negative coverage, and out-of-scope features.
