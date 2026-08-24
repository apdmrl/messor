# Figma Messor Redesign Implementation Plan

**Goal:** Translate the supplied Messor Figma showcase frames into responsive, route-backed React UI while preserving the existing session security, API contracts, authorization, and interaction behavior.

**Architecture:** Keep the current React Router + TanStack Query application and modular feature folders. Evolve the existing authenticated shell, semantic token CSS, ProjectsPage, IssueWorkspacePage, IssueDrawer, ProjectBoard, and My Work data contracts instead of creating a static showcase or duplicating domain models. Add only the route/data composition required for the dashboard; derive metrics from existing project and principal-scoped issue queries and show explicit unavailable/empty states where the backend has no global feed.

**Tech Stack:** React 19, TypeScript 6, Vite 8, React Router 7, TanStack Query 5, Vitest/Testing Library, Playwright, native HTML5 drag/drop plus existing keyboard movement, CSS Grid/Flexbox, Inter/system fallback.

**Design source:** Supplied screenshots corresponding to Figma nodes `1:215` (technical reference), `1:187` (responsive Projects), `1:153` (issue detail), `1:87` (Kanban), `1:55` (Projects), and `1:3` (Dashboard), interpreted as application content only. Showcase title, outer rounded canvas, device bezels, and architecture arrows/cards are excluded from runtime UI.

## Global Constraints

- Preserve server-side session authentication, CSRF handling, auth-epoch query isolation, and backend-authoritative object authorization.
- Do not add Tailwind, a global state library, a new drag-and-drop dependency, or a microservice.
- Do not fabricate project, issue, activity, priority, due-date, or team data absent from API contracts.
- Keep the current public route contracts; add a dashboard route only where required to represent the supplied runtime screen.
- Use semantic CSS variables; raw palette values remain in token definitions.
- Keep long text usable, maintain visible focus, honor reduced motion, and avoid horizontal page overflow below 400px.
- Preserve all unrelated user changes in the original checkout; implementation occurs on `feat/figma-messor-redesign` worktree.

## Node-to-route mapping and presentation decisions

| Source | Runtime route | Decision |
| --- | --- | --- |
| `1:3` Dashboard | `/overview` | New authenticated dashboard composition using real project/My Work data. No showcase heading/canvas. |
| `1:55` Projects | `/projects` | Refine existing project list/create flow; use real summaries and permission-aware create action. |
| `1:87` Kanban | `/projects/:projectKey/board` | Refine existing board and native drag/keyboard movement; render actual issue statuses only. |
| `1:153` Issue Detail | `/projects/:projectKey/issues/:issueKey` | Refine existing route-backed drawer/detail tabs, comments, activity, and metadata from current contracts. |
| `1:187` Responsive | all authenticated screens, especially `/projects` | Use desktop rail, compact drawer/rail behavior, stacked project cards, and horizontally scrollable board. No phone bezel. |
| `1:215` Technical reference | none | Documentation-only reference; no runtime route. |

## File ownership and task dependencies

### Task 1 — Branch and plan integration

**Owner:** lead

**Files:** `docs/plans/figma-messor-redesign.md`, `frontend/src/app/router.tsx`, `frontend/src/app/AuthenticatedShell.tsx` (only after Task 2 review).

**Dependencies:** supplied screenshots and repository audit.

**Acceptance:** dedicated branch exists; plan is committed; route mapping and visual exclusions are explicit.

**Verification:** `git status --short --branch`; `git show --stat --oneline HEAD`.

### Task 2 — Shared visual foundation and shell

**Owner:** Sonic/integration owner

**Files:** `frontend/src/index.css`, `frontend/src/App.css`, `frontend/src/app/AuthenticatedShell.tsx`, `frontend/src/app/AuthenticatedShell.css`, existing icon/helpers only where needed; tests in `frontend/src/app/*.test.tsx`.

**Dependencies:** Task 1.

**Change:** Reconcile the screenshot foundation with existing tokens: Inter/system typography, navy `#091326`, blue `#1F52DB`, canvas `#F6F8FB`, soft surface `#EDF2FC`, white cards, secondary `#6B788F`, 14–18px surfaces, 10px nav items, and status colors for backlog/in-progress/review/done. Keep existing theme behavior and auth-aware navigation. Add `/overview` nav entry and mobile drawer/collapsed behavior without exposing inaccessible project administration.

**Acceptance:** semantic `header`/`nav`/`main` landmarks; `aria-current`; visible keyboard focus; active navigation matches screenshot; shell works at 320/360/390/768/1440; logout/session behavior unchanged.

**Focused verification:** shell/router tests and `npm test -- src/app`.

### Task 3 — Dashboard

**Owner:** Task

**Files:** create `frontend/src/features/dashboard/DashboardPage.tsx`, `frontend/src/features/dashboard/DashboardPage.css`, tests `frontend/src/features/dashboard/DashboardPage.test.tsx`; modify `frontend/src/app/router.tsx` and dashboard query composition only.

**Dependencies:** Task 2.

**Change:** Implement greeting and four summary cards, assigned-work list, recent-activity surface, and project-role surface. Use `listProjects()` and `listMyWork()` through TanStack Query. Metrics must be calculated from returned records; unsupported global activity must render a truthful empty/unavailable state rather than sample values. Link cards to existing project/issue routes. Include loading skeletons, RFC9457 error presentation, empty state, permission-safe content, and narrow layout stacking.

**Acceptance:** no hardcoded showcase counts; query/cache keys remain principal-safe; links preserve project context; content remains usable at 320px.

**Focused verification:** dashboard loading/error/empty/data/link tests.

### Task 4 — Projects screen

**Owner:** Task

**Files:** `frontend/src/features/projects/ProjectsPage.tsx`, `frontend/src/features/projects/ProjectsPage.css`, `frontend/src/features/projects/ProjectsPage.test.tsx`.

**Dependencies:** Task 2.

**Change:** Match the screenshot hierarchy: page header, permission-aware `+ Yeni Proje`, full-width white project rows on desktop, stacked cards on mobile, description, issue count, and progress. Preserve current create mutation, validation, navigation, loading/error/empty behavior, and actual project summaries. Use responsive CSS Grid/Flexbox, not fixed showcase dimensions.

**Acceptance:** create action hidden/disabled according to existing permission contract; long names/descriptions wrap; 320–390px cards stack without overflow; list data is never replaced by screenshot samples.

**Focused verification:** existing ProjectsPage tests plus mobile class/behavior assertions.

### Task 5 — Kanban integration

**Owner:** Task with Sonic review

**Files:** `frontend/src/features/issues/ProjectBoard.tsx`, `KanbanColumn.tsx`, `IssueCard.tsx`, `ProjectBoard.css`, board tests.

**Dependencies:** Tasks 2 and existing board contracts.

**Change:** Align the board with four visual status columns (Backlog, In Progress, Review, Done) using server-provided workflow statuses where available. Keep actual issues in actual statuses; do not duplicate sample cards. Preserve optimistic move/rollback, version conflict handling, WIP warning, native pointer drag, and Space/arrows/Escape keyboard movement. Add compact horizontal overflow at narrow widths and clear status text/color pairing.

**Acceptance:** movement remains keyboard accessible; failed moves restore order and announce failure; empty columns remain valid drop targets; board does not create page-level horizontal overflow; inaccessible mutation controls remain hidden/read-only.

**Focused verification:** existing `ProjectBoard`, `boardOrder`, and issue workspace tests; targeted board test command before package suite.

### Task 6 — Issue detail and collaboration

**Owner:** Task

**Files:** `frontend/src/features/issues/IssueWorkspacePage.tsx`, `IssueDrawer.tsx`, `IssueDetailsPanel.tsx`, `IssueActivityList.tsx`, `frontend/src/features/comments/IssueComments.tsx`, related CSS/tests.

**Dependencies:** Task 2.

**Change:** Match supplied detail composition: identifier/title, status, assignee, priority/type/labels only when present in the actual issue contract, description/comments/activity tabs, comment composer, chronological comments, and activity. Preserve route-backed deep links, focus trap, Escape/backdrop close, expectedVersion mutations, tombstones, live announcements, permission gates, loading/error/restricted states, and plain-text rendering.

**Acceptance:** direct issue links and refresh work; tabs are keyboard-operable with correct selected state; comment submit preserves input on failure and disables controls while pending; unauthorized users cannot mutate.

**Focused verification:** existing IssueWorkspace and IssueComments tests plus new tab/comment edge tests only where contract coverage is absent.

### Task 7 — Responsive and accessibility pass

**Owner:** Task

**Files:** affected feature CSS and tests; no new design system.

**Dependencies:** Tasks 3–6.

**Change:** Verify screenshots’ desktop/tablet/mobile intent at 320, 360, 390, 768, and 1440px. At compact widths use a drawer/compact rail, stacked summary/list cards, full-screen issue drawer, and board horizontal scroll. Check 200% zoom, landmarks, accessible names, focus visibility, reduced motion, form errors, live regions, and no essential action hidden behind overflow.

**Acceptance:** no horizontal page overflow at required widths; keyboard-only navigation reaches every action; focus is visible; color is paired with text/position; loading/error/empty/restricted states remain legible.

**Focused verification:** Playwright viewport smoke checks where supported and targeted Testing Library accessibility assertions.

### Task 8 — Regression and visual QA

**Owner:** reviewer/integration owner

**Files:** tests only for uncovered observable behavior; no backend changes unless an existing endpoint is proven insufficient.

**Dependencies:** Tasks 3–7.

**Change:** Run authenticated local app screenshots for `/overview`, `/projects`, board, and issue detail at 1440px plus Projects at required responsive widths. Classify mismatches as material defect, intentional runtime adaptation, real-data difference, or missing state. Fix material defects only. Run focused tests, frontend suite, lint, build, backend verify, and available Playwright tests.

**Acceptance:** no console/network errors caused by redesign; existing security/authorization tests remain green; material mismatches resolved; no unrelated files changed.

**Focused verification:** `npm test`, `npm run lint`, `npm run build`, `./mvnw verify`, and local browser smoke test.

## Rollback and delivery

No staging deployment is configured and local verification was selected. Delivery is limited to the dedicated branch and local smoke checks. Rollback is `git switch chore/finish-mvp-and-csrf`; the original checkout remains untouched, including its uncommitted changes. Do not deploy production.

## Assumptions and risks

- The supplied screenshots are the authoritative visual reference; Turkish labels are presentation copy and route/API names remain English/internal.
- The current backend has no global dashboard activity endpoint; the dashboard must not invent activity records. If an existing project-scoped activity endpoint cannot support a truthful aggregate, show an explicit empty/unavailable panel.
- Existing issue contracts determine which metadata fields can be rendered; screenshot-only fields are omitted or represented by existing equivalents.
- The native board interaction is intentional and should not be replaced with `dnd-kit`.
- Existing unrelated work is outside this branch and must never be reset, stashed, or overwritten.
