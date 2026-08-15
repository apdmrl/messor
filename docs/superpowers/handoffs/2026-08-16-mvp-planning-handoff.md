# Messor MVP Planning Handoff

- Date: 2026-08-16
- Language with user: Turkish
- Repository: `git@github.com:apdmrl/messor.git`
- Main repository: `/home/apdmrl/workspace/repos/messor`
- Active planning worktree:
  `/home/apdmrl/workspace/repos/messor/.worktrees/mvp-planning`
- Active branch: `feature/mvp-plan`
- Base `main` commit: `fafa9d4` (`Merge pull request #1`)
- Latest design commit before this handoff: `7c73cb7`
- GitHub repository: <https://github.com/apdmrl/messor>

## Immediate instruction for the next chat

Continue from this file; do not restart discovery from zero. First read:

1. `AGENTS.md`
2. `docs/superpowers/specs/2026-08-14-authentication-design.md`
3. `docs/superpowers/specs/2026-08-16-portfolio-mvp-design.md`
4. This handoff file

The portfolio MVP design has been discussed and approved section by section,
but the written consolidated design document is still marked "Proposed for
approval". Ask the user for final approval of that document. Do not write the
detailed implementation plan until that explicit approval is received.

After approval:

1. Change the design document status to `Approved` and commit that change.
2. Use the `superpowers:writing-plans` skill.
3. Create
   `docs/superpowers/plans/2026-08-16-portfolio-mvp-implementation.md`.
4. Divide implementation into the eight delivery packages documented below.
5. Prepare the first copyable Roo Code / DeepSeek Flash prompt for the
   one-command local demo task.
6. Review every developer result independently before preparing the next task.

## Collaboration model

- The user is the product owner and performs local commands when requested.
- Codex is the architect and main reviewer.
- DeepSeek Flash in Roo Code is the only implementation developer for now.
- Do not introduce a second developer, multiple API providers, or parallel Roo
  workspaces unless the user explicitly reopens that decision.
- Do not store or request the user's SSH key passphrase. The user already uses
  `ssh-agent`; only normal Git operations should rely on it.
- All developer task reports must be treated as claims until Codex inspects the
  diff and runs risk-proportionate tests in WSL.
- Use strict red-green-refactor TDD for features and fixes.
- Prompts for Roo Code must be plain, copyable text and should not be excessively
  fragmented. The user wants faster progress and accepts larger coherent tasks.

## User priorities

- Finish a credible portfolio project quickly; it does not need to be a
  production-scale or "10/10" product.
- Complete and mature the project locally before live deployment.
- Provide a usable local demo that the user can see and test.
- Complete projects and issue-tracking functionality before building the final
  personal portfolio website.
- Preserve security quality and meaningful tests without expanding scope.
- Show whole-project progress at every meaningful checkpoint.

## Whole-project progress

Current progress:

`████░░░░░░░░░░░░░░░░ 22%`

This percentage represents the entire Messor portfolio MVP, not the current
task, branch, or authentication milestone. Do not increase it for planning or
documentation alone.

| Area | Weight |
| --- | ---: |
| Foundation and authentication (complete) | 22% |
| One-command local demo | 6% |
| Project application shell and CRUD | 14% |
| Membership and authorization | 12% |
| Issues, workflow, numbering, and activity | 18% |
| Kanban | 10% |
| Issue drawer and comments | 7% |
| My Work, filters, and responsive polish | 6% |
| Final E2E, CI, documentation, and hygiene | 5% |

Add a package's weight only after implementation, independent review, and all
required verification are complete.

## Completed authentication foundation

PR #1 was merged into `main` at `fafa9d4`. The delivered authentication work
includes:

- Spring Security server-side sessions backed by JDBC.
- Email/password authentication with Argon2id.
- CSRF token endpoint with session binding and token rotation.
- JSON login, current-user lookup, and CSRF-protected logout.
- RFC 9457 Problem Details errors.
- Demo-profile account initialization for administrator and member accounts.
- Safe authentication audit events.
- React login page and in-memory browser auth client.
- Responsive/accessibility Playwright coverage.
- Production session cookie and Nginx proxy/rate-limit configuration already in
  the repository. Preserve it, but do not spend more MVP time on deployment.

The detailed authentication specification remains authoritative for auth and
must not be weakened by subsequent work.

## Approved lean MVP scope

The architecture is a modular monolith. Backend feature boundaries are:

- `identity`: existing authentication and demo users.
- `project`: projects, memberships, default workflow, and authorization.
- `issue`: issue CRUD, numbering, ranking, movement, archive, and activity.
- `comment`: issue comments and their authorization.

The frontend mirrors these features under `src/features/`. Introduce routing
and TanStack Query when project screens begin. Use a focused
`ProjectAuthorizationService`; do not create a generic authorization framework.

Primary routes:

- `/login`
- `/projects`
- `/projects/:projectKey/board`
- `/projects/:projectKey/issues/:issueKey`
- `/my-work`

Project creation is transactional: the creator becomes `PROJECT_LEAD` and the
project receives ordered `TO_DO`, `IN_PROGRESS`, and `DONE` statuses.

Project roles:

- `PROJECT_LEAD`: project/member management and all issue actions.
- `MEMBER`: create, update, move, archive, and comment.
- `VIEWER`: read-only.
- Nonmember: no access.
- Organization `ORG_ADMIN`: access and manage all projects.

The membership UI selects an existing demo user by normalized email. There is
no invitation or user-administration flow.

## Approved API and security direction

The consolidated design document contains the full endpoint list. Key rules:

- Controllers return DTOs, never JPA entities.
- Every project-owned operation uses backend object-level authorization.
- Inaccessible project objects normally return `404`; a known project with an
  insufficient operation role may return `403`.
- State-changing endpoints retain session CSRF protection.
- The server derives reporter, actor, ownership, issue number, and rank.
- Updates and moves use `expectedVersion`; stale requests return `409`.
- Archive is soft; issue activity is append-only and atomic with issue changes.
- Lists use bounded pagination and a sort-field allowlist.
- Errors use RFC 9457 Problem Details and stable application codes.
- Frontend authorization is only UX; backend authorization is mandatory.
- Authentication/session/CSRF data is never stored in browser storage or logs.

## Explicitly removed or deferred

Do not add these during the MVP unless the user explicitly changes scope:

- Attachments, MinIO/S3, ClamAV, file previews.
- Invitations and user administration.
- Registration, password change, password reset.
- Email and notifications.
- Sprints, epics, subtasks, reporting, and time tracking.
- Microservices.
- Production deployment, hosted database, TLS/domain work, monitoring, or cloud
  integration.
- Pixel-perfect mobile drag and drop. Mobile must remain usable and avoid page
  overflow, but desktop/tablet are the primary demo targets.

Existing production files must remain valid and must not regress. They are not
the current development target.

## Eight remaining delivery packages

1. One-command local demo environment.
2. App shell, routing, project list, and project creation.
3. Project memberships and project-level RBAC.
4. Issue CRUD, workflow, numbering, archive, and activity.
5. Kanban drag and drop with optimistic locking and rollback.
6. Route-backed issue drawer, activity display, and comments.
7. My Work, filters, and responsive polish.
8. Golden-path E2E, security regressions, CI, documentation, and repository
   hygiene.

Target local command:

```bash
docker compose --env-file .env -f compose.dev.yaml up --build
```

It should start PostgreSQL, backend, and frontend; expose one documented local
URL; use idempotent demo seeding; and use development cookie settings compatible
with localhost. Do not replace or repurpose the production compose workflow.

## Verification baseline recorded on this worktree
