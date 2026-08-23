# Messor

> Small tasks. Shared progress.

Messor is a portfolio-oriented project and issue tracking application inspired by
modern Kanban tools. It focuses on a small, polished, and secure feature set with
server-side session authentication and project-scoped authorization.

## 1. Product summary and completed MVP features

The MVP is a complete local-first workflow: a user logs in, creates a project,
becomes its project lead, adds an existing demo member, manages issues on a Kanban
board, collaborates through comments and activity history, finds their assigned
work, and verifies that read-only roles and nonmembers cannot mutate data.

Completed MVP features:

- Secure login and logout with server-side sessions and CSRF protection.
- Demo administrator and member accounts (seeded by the `demo` profile).
- Project list, project creation, and a project application shell.
- Project memberships and roles (`PROJECT_LEAD`, `MEMBER`, `VIEWER`).
- Story, task and bug management with generated human issue keys (`MES-1`).
- Issue creation, reading, updating, archiving, numbering, ranking, and activity history.
- Kanban board with pointer and keyboard drag and drop plus an accessible movement menu.
- Optimistic board moves with conflict handling and rollback.
- Deep-linked route-backed issue drawer with activity and comments.
- Comment create/edit with tombstones on delete.
- My Work (the authenticated principal's assigned issues) and URL-backed filters.
- Responsive layouts for 320/360/390/768/1440px with accessible controls.
- Docker Compose local demo, automated tests, CI, and documentation.

## 2. Technology stack

### Backend

- Java 25
- Spring Boot 4.1
- Spring Security (server-side sessions, CSRF, form login)
- Spring Session JDBC
- Spring Data JPA, Hibernate (`ddl-auto: validate`)
- Flyway migrations
- PostgreSQL 17
- Maven (wrapper `./mvnw`)

### Frontend

- React 19, TypeScript, Vite
- TanStack Query (server state and cache)
- React Router (route-backed screens and the issue drawer)
- dnd-kit (Kanban pointer/keyboard drag and drop)
- Vitest + React Testing Library (unit/component tests)
- Playwright (browser acceptance)
- Oxlint

### Testing and infrastructure

- JUnit, MockMvc, Testcontainers (PostgreSQL integration)
- Docker Compose (dev, test, and production stacks)
- Nginx (SPA gateway and API reverse proxy)
- GitHub Actions CI

## 3. Architecture

```text
Browser
   |
   v
Nginx gateway (serves the React frontend and proxies /api/ and /actuator/health)
   |
   +-- React + TypeScript (static build served by Nginx)
   |
   +-- Spring Boot API (internal network)
          |
          +-- PostgreSQL (internal network)
```

The browser talks to a single origin. Nginx serves the built React frontend at
`/` and reverse proxies `/api/` to the Spring Boot backend. PostgreSQL and the
backend are reachable only on the internal Docker network; the only public port
is the frontend gateway. The backend is a modular monolith organized by feature
boundary (`identity`, `project`, `issue`, `comment`).

### Server session and CSRF

- Authentication uses server-side sessions stored in PostgreSQL (`spring_session`).
  The session cookie is `HttpOnly`, `SameSite=Lax`, and never exposed to
  JavaScript. The frontend keeps auth state in memory only; nothing is persisted
  to `localStorage` or `sessionStorage`.
- CSRF is enforced by Spring Security for every state-changing request. The SPA
  fetches the token from `GET /api/auth/csrf`, holds it in memory, and sends it
  with the `X-CSRF-TOKEN` header on mutations. Missing, invalid, or cross-session
  tokens are rejected with `403 INVALID_CSRF_TOKEN`.
- Development uses `Secure=false` so plain-HTTP `localhost` works. The production
  profile keeps the `__Host-MESSOR_SESSION` cookie `Secure`; it is never used in
  development and the two contracts never mix.

### Authorization boundaries

- Object-level authorization is enforced by a focused
  `ProjectAuthorizationService` on every project-owned operation. The backend is
  authoritative; frontend permission checks are UX only.
- Roles: `ORG_ADMIN` (organization-wide), `PROJECT_LEAD` (manage project metadata
  and membership, all issue actions), `MEMBER` (create/update/move/archive issues
  and comment), `VIEWER` (read-only), nonmember (no access).
- Inaccessible projects normally return `404` to reduce identifier disclosure; a
  known project with an insufficient operation role returns `403 FORBIDDEN`.
  Client-supplied reporter, actor, owner, number, and rank are never trusted.
- Errors use RFC 9457 Problem Details with a safe `code` and never leak internal
  exception, class, SQL, or stack details. Audit logs contain stable UUIDs and
  event names only, never emails, bodies, credentials, session IDs, or tokens.

### Optimistic concurrency and versioning

- Mutable resources carry an `expectedVersion`. Stale updates return
  `409 VERSION_CONFLICT`; the frontend restores optimistic state, announces the
  conflict, and refetches.
- Issue numbering and rank movement use PostgreSQL locks inside the transaction
  for deterministic serialization. Issue movement locks workflow-status rows in
  deterministic order, then the moving issue row, then destination rows; archive
  and update lock only the issue row, so no reverse lock cycle is possible.
- Comments are locked on the comment row (and the issue row for creation) with
  the same fail-closed version and tombstone rechecking.

### Query/cache and the route-backed drawer

- TanStack Query owns server state. Project, issue, activity, comment, and My
  Work queries are keyed precisely; mutations invalidate or refetch exactly the
  affected keys. Logout and login clear the shared query cache so one principal's
  cached data is never rendered for another.
- The issue drawer is route-backed (`/projects/:projectKey/issues/:issueKey`), so
  refresh and direct links preserve context. It traps focus, closes on Escape or
  the close button (returning focus), and renders activity and comments tabs.

## 4. Prerequisites and supported versions

- Docker with Compose v2 (Docker Desktop or Engine + Compose plugin). This is the
  only requirement for the one-command local demo.
- Optional, only when running tests natively instead of through Docker:
  - JDK 25 (Temurin) and Maven for `backend/./mvnw verify`.
  - Node.js 22 (the version used by the frontend Docker build stage) and npm for
    the frontend toolchain.
- Playwright browsers: run `npx playwright install chromium` in `frontend/` when
  running browser tests natively.

## 5. Setup with `.env`

```bash
cp .env.example .env
```

Edit `.env` and replace the placeholder values:

- `MESSOR_DB_PASSWORD` — the PostgreSQL password.
- `MESSOR_DEMO_PASSWORD` — the shared password for the demo accounts.
- `MESSOR_DEV_PORT` — the host port for the frontend gateway (default `8088`).

Never commit `.env`; it is git-ignored. `.env.example` contains only placeholders.
The demo password is read by the backend only from the environment
(`MESSOR_DEMO_PASSWORD`) and is never embedded in frontend source or build output.

## 6. One-command development start

```bash
docker compose --env-file .env -f compose.dev.yaml up --build
```

Open the application in your browser at:

```text
http://localhost:8088
```

The stack starts PostgreSQL, the Spring Boot backend, and the Nginx-served
frontend, waits on real health checks, and seeds the demo accounts idempotently.

## 7. Health, status, and stop

```bash
docker compose --env-file .env -f compose.dev.yaml ps
curl -fsS http://localhost:8088/actuator/health
docker compose --env-file .env -f compose.dev.yaml down
```

The health endpoint is proxied through the frontend gateway, so a single origin
serves both the UI and the health check.

## 8. Demo accounts

The `demo` profile seeds two local accounts. Both share the password from
`MESSOR_DEMO_PASSWORD`:

| Email | Role |
| --- | --- |
| `admin@demo.messor.app` | `ORG_ADMIN` |
| `member@demo.messor.app` | `USER` |

If `MESSOR_DEMO_PASSWORD` is missing or blank, the demo profile will not start.
The password is never hard-coded, never committed, and never written to logs.

## 9. Golden-path manual walkthrough

1. Start the stack (section 6) and open `http://localhost:8088`.
2. Log in as `admin@demo.messor.app` with the `MESSOR_DEMO_PASSWORD` password.
3. Create a project; you automatically become its project lead and land on the board.
4. Open **Proje ayarları** and add `member@demo.messor.app` as a `MEMBER`.
5. Change the member's role to `VIEWER` and back to `MEMBER`.
6. Return to the board and create a **Hikaye**, a **Görev**, and a **Hata**.
7. Edit the story's title, then move the bug with the accessible movement menu
   (or drag it) into the next column.
8. Open the bug, comment on it, edit the comment, and delete it (tombstone).
9. Archive the story, then use the **Arşiv** filter to find the archived issue.
10. Log out and log in as `member@demo.messor.app`. Find the project, create and
    move an issue, comment, and open **Görevlerim** to see your assigned work.
11. As the viewer role, confirm every management control is hidden and that direct
    API mutations are rejected.
12. Log out and verify that protected routes no longer render any data.

## 10. Role and permission summary

| Operation | PROJECT_LEAD | MEMBER | VIEWER | Nonmember |
| --- | :-: | :-: | :-: | :-: |
| Read project, board, issues, activity, comments | yes | yes | yes | no (404) |
| Create/edit/archive/move issues | yes | yes | no (403) | no (404) |
| Comment create/edit/delete | yes (moderates) | own comments | no (403) | no (404) |
| Manage project metadata and members | yes | no | no | no |
| My Work (assigned issues only) | yes | yes | yes | n/a |

`ORG_ADMIN` can access and manage all projects. My Work is always scoped to the
authenticated principal; it cannot be queried for another user.

## 11. Test commands

```bash
# Backend unit + PostgreSQL Testcontainers integration + security
cd backend && ./mvnw verify

# Frontend unit/component tests, lint, production build
cd ../frontend && npm ci
npm test
npm run lint
npm run build

# Full mocked Playwright suite (Vite dev server, no backend required)
npm run test:e2e

# Compose-backed acceptance suite (requires the stack on 8088)
MESSOR_DEMO_PASSWORD=<value> npm run test:e2e:stack
# or against the CI test stack:
PLAYWRIGHT_STACK_URL=http://127.0.0.1:8089 MESSOR_DEMO_PASSWORD=<value> npm run test:e2e:stack

# Compose verification
cd ..
sh scripts/verify-dev-compose.sh
docker compose --env-file .env -f compose.dev.yaml config
docker compose --env-file .env -f compose.test.yaml config
docker compose --env-file .env -f compose.yaml config
```

The real-stack suite needs `MESSOR_DEMO_PASSWORD` in the environment (the same
value as in `.env`); it is never printed by the tests.

## 12. Local product-owner acceptance checklist

1. Admin login and logout.
2. Create a project (lead role is granted automatically).
3. Add the demo member and change their role.
4. Create a story, task, and bug.
5. Edit an issue and confirm the change persists.
6. Move a card by drag and drop and via the accessible movement menu.
7. Open the drawer, check activity, and manage comments (create/edit/delete).
8. Archive an issue and find it with the archive filter; confirm it is read-only.
9. Use project filters and URL/back/forward restoration.
10. Open My Work and confirm only your assigned issues appear.
11. Switch the member to `VIEWER` and confirm read-only behavior.
12. Check the mobile viewport (360px): no horizontal page overflow, usable forms.
13. Log out, confirm session isolation (no cached data for the next principal).
14. Restart the stack and confirm projects/issues persist.
15. No unexpected console or UI errors during the walkthrough.

## 13. Database reset

```bash
docker compose --env-file .env -f compose.dev.yaml down -v
```

`-v` deletes the `messor-postgres-data` volume. This is **destructive**: all
projects, issues, comments, sessions, and users except the re-seeded demo
accounts are permanently removed. Only run it when you explicitly want a clean
database; it is never run automatically.

## 14. Troubleshooting

- **Port 8088 (or 5432) already in use**: stop the other process or set a
  different `MESSOR_DEV_PORT` / `MESSOR_DB_PORT` in `.env`.
- **Docker unavailable or "Cannot connect to the Docker daemon"**: start Docker
  Desktop or the Docker Engine first; the stack cannot start without it.
- **Backend stays unhealthy**: inspect logs with
  `docker compose --env-file .env -f compose.dev.yaml logs backend`. The most
  common causes are a missing `MESSOR_DEMO_PASSWORD`/`MESSOR_DB_PASSWORD` in
  `.env` (the backend refuses to start) or an occupied database port.
- **PostgreSQL Testcontainers fail on native backend tests**: the tests need a
  working Docker daemon to start PostgreSQL 17 containers (H2 is never used).
- **Stale image / changes not reflected**: rebuild with
  `docker compose --env-file .env -f compose.dev.yaml up --build` (and, if
  necessary, remove the built image first).
- **Playwright browser missing**: run `npx playwright install chromium` in
  `frontend/`.
- **Production `Secure` cookie rejected over HTTP**: the production cookie is
  `__Host-MESSOR_SESSION` and `Secure`; browsers reject it on plain HTTP. Terminate
  TLS at the deployment edge (see section 15).
- **`.env` missing or placeholders not replaced**: the compose `:?` guards fail
  fast. Copy `.env.example` to `.env` and set `MESSOR_DB_PASSWORD` and
  `MESSOR_DEMO_PASSWORD` before starting.

## 15. Production-compose limitation

The production compose (`compose.yaml`) is retained and validated, but production
automation and TLS termination are out of MVP scope. The Nginx gateway listens on
plain HTTP; the `__Host-MESSOR_SESSION` cookie is `Secure` and is only stored over
HTTPS, so a real browser deployment must terminate TLS at the edge (a load
balancer or TLS proxy) in front of the Nginx container. See the previous README
sections on the `prod`/`prod,demo` profiles and Nginx rate limits for the
authentication endpoints.

## 16. Explicitly out of MVP scope

- Attachments, object storage, antivirus scanning, and file previews.
- User invitation, user administration, registration, password change/reset.
- Email delivery and notifications.
- Custom workflow editing, sprint planning, epics/subtasks, time tracking, reporting.
- Advanced search and dashboards.
- Billing.
- Production deployment automation, TLS/domain setup, hosted databases, monitoring.

## 17. CI

GitHub Actions (`.github/workflows/ci.yaml`) runs on pull requests and pushes:

- `verify`: backend `./mvnw verify`, frontend `npm ci`/`npm test`/`npm run lint`/
  `npm run build`, compose configuration validation for all three stacks, and the
  dev-compose contract check. Dummy demo credentials are injected through the
  environment and never logged.
- `acceptance`: builds the `compose.test.yaml` stack, waits for health, and runs
  the full mocked Playwright suite plus the compose-backed real-stack acceptance
  suite (golden path and security regressions). Failed trace/screenshot/report
  artifacts are uploaded; the stack is always torn down.

## 18. Repository structure

```text
backend/                          Spring Boot modular monolith
  src/main/java/io/github/apdmrl/messor/
    auth/ identity/ common/api/   session, CSRF, principals, problem details
    project/ issue/ comment/      feature modules
  src/main/resources/db/migration/  Flyway V1..V5
frontend/                         React + TypeScript SPA
  src/app/                        router, session, shared API client
  src/features/{auth,projects,issues,comments,my-work}/
  e2e/                            Playwright acceptance suites
infrastructure/nginx/             production Nginx configuration
scripts/verify-dev-compose.sh     dev-compose contract check
compose.yaml                      production stack
compose.dev.yaml                  one-command local demo
compose.test.yaml                 CI acceptance-test stack
.github/workflows/ci.yaml         CI
```
