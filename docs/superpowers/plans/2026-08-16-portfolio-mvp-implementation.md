# Messor Portfolio MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The selected worker is Roo Code with DeepSeek-fast; if those skills are unavailable there, follow these TDD and review gates manually.

**Goal:** Deliver a credible local-first project and issue tracker that starts with one command and supports the approved administrator/member/viewer golden path.

**Architecture:** Extend the Spring Boot and React modular monolith by feature boundary. PostgreSQL owns durable state, Spring services own transactions and object authorization, and React uses route-backed screens with TanStack Query server state. Keep production configuration intact and add a separate local-demo path.

**Tech Stack:** Java 25, Spring Boot 4.1, Spring Security sessions and CSRF, JPA, Flyway, PostgreSQL 17, Maven, React 19, TypeScript 6, Vite 8, TanStack Query, React Router, dnd-kit, Vitest, Playwright, Docker Compose, Nginx.

## Global Constraints

- Read `AGENTS.md` and both approved design documents before each task.
- Use strict red-green-refactor TDD and preserve RED and GREEN command output.
- Controllers return DTOs, never JPA entities.
- Every project-owned operation performs backend object-level authorization.
- Preserve session authentication, CSRF, RFC 9457 Problem Details, and safe logging.
- Never persist auth, session, cookie, or CSRF data in browser storage.
- Use Flyway and PostgreSQL Testcontainers; keep `ddl-auto: validate`; never use H2.
- Keep each change inside the current task; do not add deferred scope.
- Roo Code uses one WSL VS Code workspace and DeepSeek-fast. Do not use parallel developers.
- Each result report includes changed files, RED/GREEN evidence, full checks, commit hash, and risks.
- Codex independently reads the diff and reruns relevant checks before issuing the next prompt.
- Progress increases only when every task in a delivery package passes review.

## Delivery Map

| Package | Tasks | Added | Total |
| --- | --- | ---: | ---: |
| 1. One-command local demo | 1 | 6% | 28% |
| 2. App shell and project CRUD | 2-3 | 14% | 42% |
| 3. Membership and authorization | 4-5 | 12% | 54% |
| Product-owner acceptance checkpoint | after Task 5 | 0% | 54% |
| 4. Issues, workflow, numbering, activity | 6-7 | 18% | 72% |
| 5. Kanban | 8 | 10% | 82% |
| 6. Issue drawer and comments | 9 | 7% | 89% |
| 7. My Work, filters, responsive polish | 10 | 6% | 95% |
| 8. Final E2E, CI, docs, hygiene | 11 | 5% | 100% |

The first complete package boundary at or above 50% is 54%. Stop after Task 5 for the product owner's local acceptance test before issue development.

---

### Task 1: One-command local demo (Package 1)

**Files:**
- Modify: `compose.dev.yaml`, `.env.example`, `README.md`
- Modify only if needed: `backend/Dockerfile`, `frontend/Dockerfile`, `backend/src/main/resources/application-demo.yaml`
- Create: `frontend/nginx.dev.conf`, `scripts/verify-dev-compose.sh`

**Interfaces:**
- Produces `docker compose --env-file .env -f compose.dev.yaml up --build`.
- Browser URL is `http://localhost:8088`; services are `postgres`, `backend`, `frontend`.

- [ ] **Step 1: RED - write the compose contract**

Create executable `scripts/verify-dev-compose.sh`:
```sh
#!/usr/bin/env sh
set -eu
test -f .env
production_hash="$(git hash-object compose.yaml)"
services="$(docker compose --env-file .env -f compose.dev.yaml config --services)"
printf '%s\n' "$services" | grep -Fx postgres
printf '%s\n' "$services" | grep -Fx backend
printf '%s\n' "$services" | grep -Fx frontend
docker compose --env-file .env -f compose.dev.yaml config |
  grep -F 'SPRING_PROFILES_ACTIVE: demo'
docker compose --env-file .env -f compose.dev.yaml config |
  grep -F 'published: "8088"'
test "$production_hash" = "$(git hash-object compose.yaml)"
```
Run: `sh scripts/verify-dev-compose.sh`
Expected: FAIL because only PostgreSQL exists.

- [ ] **Step 2: GREEN - add backend and frontend**

Backend uses `jdbc:postgresql://postgres:5432/`, profile `demo`, `MESSOR_COOKIE_SECURE=false`, demo password from `.env`, healthy PostgreSQL dependency, and actuator healthcheck. Frontend waits for backend, proxies `/api/` to `backend:8080`, supports SPA fallback, and binds `127.0.0.1:8088:80`. Do not change `compose.yaml`.

- [ ] **Step 3: GREEN - document the demo**

Add `MESSOR_DEV_PORT=8088` to `.env.example`. README must show copy/edit/start, browser URL, demo emails, health/status, stop, and volume reset. The password remains only in untracked `.env`.

- [ ] **Step 4: Verify and commit**

```bash
sh scripts/verify-dev-compose.sh
docker compose --env-file .env -f compose.dev.yaml up --build -d
docker compose --env-file .env -f compose.dev.yaml ps
curl -fsS http://localhost:8088/actuator/health
curl -fsS http://localhost:8088/
docker compose --env-file .env -f compose.dev.yaml down
git diff --check
git status --short
git add compose.dev.yaml .env.example README.md backend/Dockerfile frontend/Dockerfile frontend/nginx.dev.conf backend/src/main/resources/application-demo.yaml scripts/verify-dev-compose.sh
git commit -m "feat: add one-command local demo"
```

### Task 2: Project domain, default workflow, and API (Package 2)

**Files:**
- Create: `backend/src/main/resources/db/migration/V3__create_projects_and_workflow.sql`
- Create focused entity, enum, repository, DTO, service, and controller files in `backend/src/main/java/io/github/apdmrl/messor/project/`
- Create: `backend/src/main/java/io/github/apdmrl/messor/common/api/ApiProblemException.java`
- Create: `backend/src/main/java/io/github/apdmrl/messor/common/api/ApiExceptionHandler.java`
- Test: `backend/src/test/java/io/github/apdmrl/messor/project/ProjectMigrationIT.java`
- Test: `backend/src/test/java/io/github/apdmrl/messor/project/ProjectApiIT.java`

**Interfaces:**
```java
record CreateProjectRequest(
    @NotBlank @Size(max=10) String key,
    @NotBlank @Size(max=120) String name,
    @Size(max=2000) String description) {}
record UpdateProjectRequest(
    @NotBlank @Size(max=120) String name,
    @Size(max=2000) String description,
    @NotNull Long expectedVersion) {}
record ProjectSummary(
    UUID id, String key, String name, String description,
    ProjectRole currentUserRole, long version) {}
```
Produces approved GET/POST/PATCH project endpoints.

- [ ] **Step 1: RED - schema and transaction**

Test project key uniqueness, one project/user membership, status code/position uniqueness, foreign keys, constraints, and versions. API creation must normalize `MES`, create caller as `PROJECT_LEAD`, create `TO_DO`, `IN_PROGRESS`, `DONE` at 0/1/2, and roll back atomically.

Run: `cd backend && ./mvnw -Dtest=ProjectMigrationIT,ProjectApiIT test`
Expected: FAIL because V3 and the API do not exist.

- [ ] **Step 2: GREEN - migration and aggregate**

Use UUIDs, UTC timestamps, bigint versions, and immutable uppercase key constraint `^[A-Z][A-Z0-9]{1,9}$`. Derive creator from `MessorUserPrincipal`. ORG_ADMIN lists all projects; a user lists memberships only.

- [ ] **Step 3: RED/GREEN - error and update contracts**

Test anonymous 401, missing CSRF 403, invalid request 400 `VALIDATION_FAILED`, inaccessible 404, stale version 409 `VERSION_CONFLICT`, and safe DTO fields. Implement only the mappings required by these contracts.

- [ ] **Step 4: Verify and commit**

Run `./mvnw -Dtest=ProjectMigrationIT,ProjectApiIT test && ./mvnw verify`.
Commit: `feat: add project domain and API`.

### Task 3: Shell, routing, project list, and creation (Package 2)

**Files:**
- Modify: `frontend/package.json`, lockfile, `src/main.tsx`, `src/App.tsx`, `src/App.css`
- Create: `frontend/src/app/AppProviders.tsx`, `AuthenticatedShell.tsx`, `router.tsx`
- Create focused types, API, page, styles, and tests under `frontend/src/features/projects/`

**Interfaces:**
- Protected routes: `/projects`, `/projects/:projectKey/board`, `/my-work`.
- Shared `apiRequest<T>()` sends credentials, uses in-memory CSRF for mutations, parses Problem Details, and retries once after invalid CSRF.

- [ ] **Step 1: RED**

Test anonymous login, authenticated redirect to `/projects`, navigation/user/logout shell, project loading/error/empty/list states, validation, and duplicate-submit prevention.

- [ ] **Step 2: GREEN**

Install only `react-router-dom` and `@tanstack/react-query`. Use one browser router and one QueryClient. Keep auth state in memory and preserve all auth tests.

- [ ] **Step 3: GREEN**

Use query key `['projects']`. Successful create invalidates it and navigates to `/projects/{key}/board`. Render backend text as text, never HTML. Board/My Work render explicit named future-package screens.

- [ ] **Step 4: Verify and commit**

Run `npm test && npm run lint && npm run build`.
Commit: `feat: add project shell and creation UI`.

Package 2 gate: Codex runs backend verify, frontend checks, and compose project-create smoke. Progress becomes 42%.

### Task 4: Membership API and authorization (Package 3)

**Files:**
- Create: `ProjectAuthorizationService.java`, member service/controller/DTO files
- Test: `ProjectAuthorizationServiceTest.java`, `ProjectMembershipApiIT.java`
- Modify project services so every project operation uses the authorization service

**Interfaces:**
```java
enum ProjectPermission { READ, MANAGE_PROJECT, MANAGE_MEMBERS, MUTATE_ISSUES, COMMENT }
ProjectAccess requireProject(
    String projectKey, MessorUserPrincipal principal, ProjectPermission permission);
record AddProjectMemberRequest(
    @Email @NotBlank @Size(max=254) String email, @NotNull ProjectRole role) {}
record ChangeProjectMemberRoleRequest(
    @NotNull ProjectRole role, @NotNull Long expectedVersion) {}
```
Produces approved membership mutations plus project-scoped `GET /api/projects/{projectKey}/members`.

- [ ] **Step 1: RED - matrix**

Parameterize ORG_ADMIN, PROJECT_LEAD, MEMBER, VIEWER, nonmember, and each permission. Assert hidden objects return 404 and known-project insufficient-role mutations return 403.

- [ ] **Step 2: GREEN - focused service**

Implement one fail-closed authorization service. Controllers call application services; services authorize before project-owned loads or changes.

- [ ] **Step 3: RED/GREEN - invariants**

Test normalized email lookup, duplicate 409 `MEMBER_ALREADY_EXISTS`, unknown email safe 404, lead/admin-only changes, last-lead protection, stale version 409, and CSRF. Server accepts only lookup email and role, never client ownership.

- [ ] **Step 4: Verify and commit**

Run `./mvnw -Dtest=ProjectAuthorizationServiceTest,ProjectMembershipApiIT,ProjectApiIT test && ./mvnw verify`.
Commit: `feat: enforce project membership authorization`.

### Task 5: Membership UI and acceptance gate (Package 3)

**Files:**
- Modify project API/types/router
- Create: `ProjectSettingsPage.tsx`, CSS, and test
- Modify: `README.md`

**Interfaces:** Route `/projects/:projectKey/settings`; lead/admin controls; member/viewer read-only list.

- [ ] **Step 1: RED**

Test role-aware controls, member list states, add/change/remove, confirmation, safe errors, and version-conflict refetch.

- [ ] **Step 2: GREEN**

Use key `['projects', projectKey, 'members']`. Offer documented demo emails as selections. Frontend roles are UX only; backend remains authoritative.

- [ ] **Step 3: Verify and commit**

Run frontend test/lint/build and backend verify, then compose smoke for admin, member, viewer, and nonmember.
Commit: `feat: add project membership management UI`.

After Codex review, progress becomes 54%. Stop for the product owner's clean local test of startup, login, project creation, membership, responsive navigation, logout, and restart persistence.

### Task 6: Issue workflow, numbering, archive, and activity API (Package 4)

**Files:**
- Create: `V4__create_issues_and_activity.sql`
- Create focused entity/enum/repository/DTO/service/controller files under backend `issue/`
- Test: `IssueMigrationIT.java`, `IssueApiIT.java`, `IssueConcurrencyIT.java`

**Interfaces:**
```java
record CreateIssueRequest(
    @NotNull IssueType type,
    @NotBlank @Size(max=200) String title,
    @Size(max=10000) String description,
    UUID assigneeId) {}
```
Update includes expectedVersion. Move includes targetStatusCode, beforeIssueKey, afterIssueKey, expectedVersion. Lists bound page 0..10000 and size 1..100; allow sort `createdAt,updatedAt,number,title`.

- [ ] **Step 1: RED - persistence/concurrency**

Test foreign keys, project number uniqueness, immutable human key, activity shape, archive/version/rank/indexes, and concurrent monotonic allocation.

- [ ] **Step 2: GREEN - create**

Lock a project counter inside the transaction. Derive key, reporter, actor, status, and rank. Human key is project key plus number.

- [ ] **Step 3: RED/GREEN - CRUD and activity**

Test atomic create/update/archive activity, role negatives, inaccessible 404, archived mutation rejection, and stale version 409.

- [ ] **Step 4: RED/GREEN - movement**

Lock destination active issues, validate neighbor ownership/status, insert by before/after, rewrite ranks 1024 apart, and append activity atomically.

- [ ] **Step 5: RED/GREEN - lists**

Reject bad page/size/sort with `VALIDATION_FAILED`. Return items/page/size/totalItems/totalPages DTO only.

- [ ] **Step 6: Verify and commit**

Run focused tests and `./mvnw verify`.
Commit: `feat: add authorized issue workflow API`.

### Task 7: Issue management UI (Package 4)

**Files:** Create focused types/API/list/form/activity files, styles, and tests under frontend `features/issues/`; modify router.

- [ ] **Step 1: RED**

Test list states, labels, create/edit/archive permissions, validation, duplicate-submit blocking, and 409 refetch while preserving unsaved text.

- [ ] **Step 2: GREEN**

Use keys `['issues', projectKey, filters]`, `['issue', issueKey]`, and `['issue', issueKey, 'activity']`. Bound URL parameters and render structured activity safely.

- [ ] **Step 3: GREEN**

Implement accessible create/edit/archive panels with labels, focus return, escape behavior, alerts, and exact invalidation.

- [ ] **Step 4: Verify and commit**

Run frontend test/lint/build. Commit: `feat: add issue management workspace`.

Package 4 gate checks auth negatives, numbering concurrency, activity atomicity, list bounds, conflict UX, and compose. Progress becomes 72%.

### Task 8: Kanban with rollback (Package 5)

**Files:** Add dnd-kit dependencies; create `ProjectBoard.tsx`, `KanbanColumn.tsx`, `IssueCard.tsx`, `boardOrder.ts`, styles/tests; modify router.

- [ ] **Step 1: RED**

Test same/cross-column order, empty destination, neighbor payload, no-op drop, and expectedVersion.

- [ ] **Step 2: GREEN**

Install `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`. Render server-ordered statuses and accessible cards.

- [ ] **Step 3: RED/GREEN**

In onMutate cancel/snapshot/move. In onError restore; on `VERSION_CONFLICT` announce and refetch. In onSettled invalidate.

- [ ] **Step 4: Verify and commit**

Test keyboard move, mobile move menu, reduced motion, focus, and 320px page overflow. Run test/lint/build and Chromium E2E.
Commit: `feat: add optimistic Kanban board`. Progress after review: 82%.

### Task 9: Route-backed drawer and comments (Package 6)

**Files:**
- Create `V5__create_issue_comments.sql`; focused backend comment files and `CommentApiIT.java`
- Create frontend comment files and `IssueDrawer.tsx` with tests/styles; modify router

- [ ] **Step 1: RED/GREEN - backend**

Test list/create/edit/delete, author ownership, lead/admin moderation, member negatives, viewer read-only, nonmember 404, body bounds, CSRF, and version conflict. Deletion retains safe tombstone ordering.

- [ ] **Step 2: RED - drawer**

Test direct load, close/back navigation, states, focus trap/return, Escape, and activity/comment tabs.

- [ ] **Step 3: GREEN**

Route is `/projects/:projectKey/issues/:issueKey`; closing returns to board. Use `['issue', issueKey, 'comments']`. Render text without HTML and refetch conflicts.

- [ ] **Step 4: Verify and commit**

Run backend focused/full tests and frontend test/lint/build.
Commit: `feat: add issue drawer and comments`. Progress after review: 89%.

### Task 10: My Work, filters, responsive polish (Package 7)

**Files:** Extend backend issue query/tests; create `MyWorkPage.tsx`, `IssueFilters.tsx`, tests/styles; polish existing styles; create `app-responsive.spec.ts`.

- [ ] **Step 1: RED/GREEN - My Work API**

Return only active issues assigned to the principal across visible projects. Test cross-project cases, nonmember exclusion, archived default, pagination/sort bounds, and inability to request another user.

- [ ] **Step 2: RED/GREEN - URL filters**

Project/type/status/assignee/archive/sort/page/size live in URL query parameters. Test parse/serialize, back/forward, states, and query keys.

- [ ] **Step 3: RED/GREEN - responsive**

Verify 360x800, 390x844, 768x1024, 1440x900: no page overflow, practical 44px targets, focus, labels, drawer, board alternatives, reduced motion.

- [ ] **Step 4: Verify and commit**

Run backend verify and all frontend checks including E2E.
Commit: `feat: add My Work and responsive filters`. Progress after review: 95%.

### Task 11: Golden path, security regressions, CI, docs, hygiene (Package 8)

**Files:** Create two E2E specs and `.github/workflows/ci.yaml`; update README; change helpers only for proven duplication.

- [ ] **Step 1: RED - golden path**

Admin creates project/adds member/creates issue; member updates/moves/comments/finds My Work; viewer mutation UI and API reject; logout removes protected access.

- [ ] **Step 2: RED - security**

Cover missing/invalid CSRF, nonmember lookup, viewer mutations, stale versions, bad sort, literal XSS-like text, and no auth/session/CSRF data in response or browser storage.

- [ ] **Step 3: GREEN - CI/docs**

Use unique keys, idempotent demo users, health waits, and failed trace artifacts. CI runs backend verify, frontend test/lint/build, compose config, and Playwright. README covers prerequisites, start, demo, tests, architecture, scope, reset, troubleshooting.

- [ ] **Step 4: Full verification**

```bash
cd backend && ./mvnw verify
cd ../frontend && npm ci && npm test && npm run lint && npm run build && npm run test:e2e
cd .. && sh scripts/verify-dev-compose.sh
docker compose --env-file .env -f compose.dev.yaml config
docker compose --env-file .env -f compose.yaml config
git diff --check
git status --short
```

- [ ] **Step 5: Commit**

Commit: `test: complete portfolio MVP verification`. After Codex review and product-owner acceptance, progress becomes 100%.

## Review Protocol

1. Product owner pastes Roo Code report and commit hash.
2. Codex treats it as a claim and checks status, diff, and commit.
3. Codex reads every relevant production and test change.
4. Codex runs focused tests, then package regression checks.
5. Codex checks security, transactions, concurrency, accessibility, and scope.
6. Defects produce one coherent DeepSeek-fast correction prompt.
7. Only a passing gate updates progress and unlocks the next task.

## Final Feature Boundaries

```text
backend/.../messor/
  auth/ identity/ common/api/ project/ issue/ comment/
frontend/src/
  app/
  features/auth/ projects/ issues/ board/ comments/ my-work/
```

## Risks and Controls

- Numbering and movement races: PostgreSQL locks plus integration tests.
- Stale UI: expectedVersion, rollback, refetch, visible conflict.
- Authorization drift: one focused service plus negative API tests.
- Demo/production confusion: separate compose/profile cookie configuration.
- Fast-model overreach: one scoped task, mandatory report, independent review.
- Mobile drag limits: accessible move controls; no pixel-perfect mobile drag.

