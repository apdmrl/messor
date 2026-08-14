# Messor Engineering Rules

## Product scope

Messor is a portfolio-oriented project and issue tracking application.

The first release includes:

- Server-side session authentication
- Projects and project memberships
- Project-scoped authorization
- Story, task and bug management
- Kanban board
- Comments
- Activity history
- My Work and basic filtering

Do not add invitations, password reset, attachments, malware scanning,
notifications, sprints, epics, subtasks or microservices unless explicitly requested.

## Architecture

- Use a modular monolith.
- Organize backend code by feature/domain.
- Keep the React frontend organized by feature.
- Do not introduce microservices.
- Do not create abstractions without a concrete use case.
- Do not perform unrelated refactoring during a feature task.
- Keep changes small and reviewable.

## Security

- Authentication uses server-side sessions.
- Never store authentication tokens in localStorage or sessionStorage.
- Keep CSRF protection enabled.
- Never use wildcard CORS in production.
- Backend authorization is mandatory for every protected operation.
- Frontend permission checks are UX only.
- Enforce object-level authorization for project resources.
- Never expose JPA entities directly from controllers.
- Never expose passwords, hashes, session IDs, cookies, CSRF tokens or secrets.
- Validate every request DTO.
- Fail closed when authorization cannot be determined.
- Never log credentials or security tokens.

## Database

- PostgreSQL is the application database.
- All schema changes use Flyway.
- Never use `ddl-auto=create` or `ddl-auto=update`.
- Preserve foreign keys, unique constraints and check constraints.
- Business operations define explicit transaction boundaries.
- Concurrency-sensitive operations require explicit handling.
- Issue changes and activity records must be persisted atomically.

## Backend

- Java 25.
- Spring Boot 4.1.
- Prefer records for request and response DTOs.
- Avoid Lombok unless it provides clear value.
- Do not catch `Exception` broadly.
- Do not silently swallow errors.
- Do not add dependencies without explaining their purpose.
- Return a consistent problem-details error format.

## Frontend

- React and TypeScript.
- Use TanStack Query for server state.
- Use local React state for local UI state.
- Do not add global state libraries without a concrete need.
- Every screen must handle loading, error and empty states.
- Do not use unsafe HTML rendering.
- Keep permission-aware UI consistent with backend authorization.

## Testing

- Every authorization rule requires a negative test.
- New endpoints require success, validation and authorization tests.
- PostgreSQL-specific behavior uses Testcontainers.
- Do not replace PostgreSQL integration tests with H2.
- Add frontend tests for critical user flows.
- Fix root causes; never weaken tests merely to make them pass.

## Workflow

For every task:

1. Read this file and relevant documentation.
2. Inspect the existing implementation.
3. State the intended approach and affected files.
4. Implement only the requested scope.
5. Add or update tests.
6. Run relevant checks.
7. Review authorization and security implications.
8. Summarize changes and unresolved risks.

Stop when the requested task and its tests are complete.