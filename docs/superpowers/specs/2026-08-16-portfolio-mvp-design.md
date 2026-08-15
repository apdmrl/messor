# Messor Portfolio MVP Design

- Status: Approved
- Scope: Local-first portfolio MVP after authentication
- Date: 2026-08-16

## Summary

Messor is a compact collaborative issue tracker built as a portfolio project.
The remaining MVP demonstrates a complete, secure workflow rather than broad
product scope: users create projects, assign project roles, manage issues on a
Kanban board, collaborate through comments, and find their assigned work.

The application remains a Spring Boot and React modular monolith backed by
PostgreSQL. Development targets a reliable local demo first. Production
deployment, cloud services, and additional account-management features are
deferred until the portfolio application is complete and reviewed locally.

The approved authentication design remains authoritative. This document adds
the application features that follow authentication and does not weaken its
session, CSRF, cookie, logging, or error-handling contracts.

## Product goal

A reviewer should be able to clone the repository, start the local demo with a
single documented command, and complete this flow:

1. Log in as the demo administrator.
2. Create a project and automatically receive the project-lead role.
3. Add the existing demo member to the project.
4. Create an issue and see its generated project key and number.
5. Log in as the member, update and move the issue, and add a comment.
6. Find the issue in My Work and filter project issues.
7. Verify that a read-only member cannot mutate project data.
8. Log out and lose access to protected data.

## Scope

### Included

- One-command local demo environment for PostgreSQL, backend, and frontend.
- Project list, project creation, and a project application shell.
- Project membership and project-level authorization.
- Default workflow statuses and issue creation, reading, updating, archiving,
  numbering, ranking, and activity history.
- Kanban board with drag and drop and optimistic conflict handling.
- Deep-linked issue drawer with activity and comments.
- My Work, useful issue filters, and responsive layout.
- Unit, PostgreSQL integration, API/security, frontend, and browser acceptance
  tests appropriate to each feature.
- Final CI, repository hygiene, and local-demo documentation.

### Explicitly deferred

- Attachments, object storage, antivirus scanning, and file previews.
- User invitation, user administration, registration, password change, and
  password reset.
- Email delivery and notification systems.
- Custom workflow editing, sprint planning, time tracking, and reporting.
- Production deployment, domain/TLS setup, hosted databases, monitoring, and
  cloud-provider integration.
- Pixel-perfect mobile drag and drop. Mobile must remain usable and free of
  horizontal overflow, but the portfolio demo is desktop/tablet first.

Existing production configuration is retained and must not regress, but no
further production-compose or deployment work is part of this MVP phase.

## Architecture

### Backend modules

The backend stays in one deployable Spring Boot application, organized by
feature boundary:

- `identity`: existing authentication, principals, and demo users.
- `project`: projects, memberships, default workflow statuses, and project
  authorization.
- `issue`: issues, numbering, rank, movement, archive state, and activity.
- `comment`: issue comments and comment authorization.

Controllers expose DTOs only. JPA entities are not serialized. Business rules
belong in application/domain services rather than controllers or repositories.
Every project, issue, and comment operation passes through a focused
`ProjectAuthorizationService`; a large general-purpose authorization framework
is not introduced.

### Frontend modules

The React application mirrors backend feature boundaries under
`src/features/`. Routing and TanStack Query are introduced with the project
screens. TanStack Query owns server state, cache invalidation, mutation loading
states, and optimistic Kanban updates with rollback. Authentication remains in
the existing session client and is never persisted to browser storage.

### Primary routes

- `/login`
- `/projects`
- `/projects/:projectKey/board`
- `/projects/:projectKey/issues/:issueKey`
- `/my-work`

The authenticated shell contains Projects and My Work navigation, current-user
information, and logout. The project board is the primary workspace. Issue
details use a route-backed drawer so refresh and direct links preserve context.

## Data model

### Existing identity

`UserAccount` remains the source of authenticated users. The organization role
continues to be `ORG_ADMIN` or `USER`; project permissions are separate.

### Project

- UUID identifier.
- Unique, normalized, immutable project key suitable for issue keys and URLs.
- Name and optional description.
- Creator and audit timestamps.
- Optimistic-lock version.

Creating a project also creates its creator membership as `PROJECT_LEAD` and
creates exactly three ordered statuses: `TO_DO`, `IN_PROGRESS`, and `DONE`.
The operation is transactional.

### ProjectMember

A unique project/user pair with one role:

- `PROJECT_LEAD`: manage project metadata and membership; all issue actions.
- `MEMBER`: create, update, move, archive, and comment on issues.
- `VIEWER`: read project, board, issue, activity, and comments only.

An `ORG_ADMIN` may access and manage all projects. A nonmember has no project
access. The MVP membership UI selects an existing user by normalized email; it
does not create or invite users.

### WorkflowStatus

A project-owned status with a stable code, display name, and integer position.
The default workflow is fixed for this MVP; custom status administration is
deferred.

### Issue

- UUID identifier and immutable human key such as `MES-12`.
- Project-scoped monotonically increasing number allocated transactionally.
- Title, optional description, workflow status, reporter, optional assignee.
- Rank within a workflow status.
- Active or archived state.
- Created/updated timestamps and optimistic-lock version.

### IssueActivity

Append-only records for meaningful issue changes such as creation, assignment,
status movement, title/description update, and archive. Each record identifies
the actor, event type, timestamp, and a safe structured change summary.
Sensitive authentication data is never stored in activity.

### IssueComment

A project-authorized comment with author, body, timestamps, and optimistic-lock
version. Authors may edit or delete their own comments; project leads and
organization administrators may moderate them. Deletion may be represented as
a retained tombstone so activity ordering remains understandable.

## API surface

### Projects and membership

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{projectKey}`
- `PATCH /api/projects/{projectKey}`
- `POST /api/projects/{projectKey}/members`
- `PATCH /api/projects/{projectKey}/members/{userId}`
- `DELETE /api/projects/{projectKey}/members/{userId}`

### Issues and activity

- `GET /api/projects/{projectKey}/issues`
- `POST /api/projects/{projectKey}/issues`
- `GET /api/issues/{issueKey}`
- `PATCH /api/issues/{issueKey}`
- `POST /api/issues/{issueKey}/archive`
- `PATCH /api/issues/{issueKey}/move`
- `GET /api/issues/{issueKey}/activity`
- `GET /api/my-work`

### Comments

- `GET /api/issues/{issueKey}/comments`
- `POST /api/issues/{issueKey}/comments`
- `PATCH /api/comments/{commentId}`
- `DELETE /api/comments/{commentId}`

Create and mutation requests use explicit request DTOs and validation. Update,
move, and editable comment requests include `expectedVersion`. A stale version
returns `409 Conflict`; the frontend restores optimistic state and refetches.
Issue list and My Work queries use bounded pagination, approved filter fields,
and a sort-field allowlist.

## Security and error behavior

- Existing server-side session authentication and CSRF protection apply to all
  new state-changing endpoints.
- Client-supplied reporter, actor, project ownership, issue number, and rank are
  never trusted; the server derives or validates them.
- Authorization is checked from persistent membership on every operation.
- Inaccessible project-owned objects normally return `404` to reduce identifier
  disclosure. A known project with an insufficient operation role may return
  `403`.
- Responses never expose password hashes, account status, entity versions not
  required by the contract, internal exceptions, or stack traces.
- Application errors use RFC 9457 Problem Details and the existing `code`
  extension.

Required application codes include:

- `VALIDATION_FAILED`
- `PROJECT_NOT_FOUND`
- `ISSUE_NOT_FOUND`
- `FORBIDDEN`
- `VERSION_CONFLICT`
- `MEMBER_ALREADY_EXISTS`
- `INVALID_WORKFLOW_STATUS`

All new list inputs have length/range limits. Text is rendered as text by the
frontend; raw HTML is not accepted or injected. Audit logs may include stable
internal UUIDs and event names but not email, comment bodies, credentials,
session identifiers, cookies, or CSRF tokens.

## Local demo

The target developer experience is:

```bash
docker compose --env-file .env -f compose.dev.yaml up --build
```

This starts PostgreSQL, the Spring Boot backend, and the Vite frontend, exposes
one documented browser URL, waits on useful health checks, and runs demo data
initialization only through the `demo` profile. The existing administrator and
member accounts are seeded idempotently. Feature tasks may add deterministic
sample project data only if it is idempotent and demo-profile-only.

Local HTTP uses development cookie settings compatible with localhost. The
production `Secure` `__Host-MESSOR_SESSION` contract remains unchanged in the
production profile. Demo passwords come from environment configuration and are
never embedded in frontend source or committed as real secrets.

## User experience and accessibility

- Desktop uses a persistent application shell and spacious Kanban board.
- Tablet remains fully functional with compact navigation and board scrolling.
- Mobile provides readable lists, accessible forms/drawers, and no horizontal
  page overflow; alternative controls may supplement drag and drop.
- Interactive targets are at least 44 by 44 CSS pixels where practical.
- Forms have labels, useful validation, visible focus, loading/disabled states,
  and accessible error announcements.
