# Messor

> Small tasks. Shared progress.

Messor is a portfolio-oriented project and issue tracking application inspired by
modern Kanban tools. It focuses on a small, polished feature set with secure
authentication and project-scoped authorization.

## Status

Messor is under active development. The repository currently contains the
backend and frontend foundations.

## Planned first release

- Secure login and logout
- Server-side sessions and CSRF protection
- Demo users
- Project management
- Project memberships and roles
- Story, task and bug management
- Kanban board with drag and drop
- Comments
- Issue activity history
- My Work
- Basic filtering
- Desktop and tablet layouts
- Docker-based deployment
- Automated tests and CI

Attachments, invitations, password reset, notifications, sprints and epics are
outside the first release.

## Technology stack

### Backend

- Java 25
- Spring Boot 4.1
- Spring Security
- Spring Data JPA
- Spring Session JDBC
- Flyway
- PostgreSQL
- Maven

### Frontend

- React
- TypeScript
- Vite
- TanStack Query
- React Router
- React Hook Form
- Zod
- dnd-kit

### Testing and infrastructure

- JUnit
- MockMvc
- Testcontainers
- Vitest
- React Testing Library
- Playwright
- Docker Compose
- Nginx
- GitHub Actions

## Architecture

Messor is a modular monolith.

```text
Browser
   |
   v
React + TypeScript
   |
   v
Spring Boot API
   |
   +-- PostgreSQL

## Demo profile

The `demo` Spring profile seeds two local demo accounts for development and
demonstration purposes only. It is not intended for production use.

| Email | Role |
| --- | --- |
| `admin@demo.messor.app` | `ORG_ADMIN` |
| `member@demo.messor.app` | `USER` |

Both accounts share a common password supplied through the
`MESSOR_DEMO_PASSWORD` environment variable. If the variable is missing or
blank, the demo profile will not start. Never hard-code the password in the
frontend source code, and never commit a real or test password.

### Running the demo profile

```bash
cp .env.example .env
# Replace the placeholder values inside .env
docker compose --env-file .env -f compose.dev.yaml up -d
```

```bash
cd backend
set -a
. ../.env
set +a
SPRING_PROFILES_ACTIVE=demo ./mvnw spring-boot:run
```