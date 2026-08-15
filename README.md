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

Installed:

- React
- TypeScript
- Vite
- Vitest
- React Testing Library
- Playwright

Planned (not yet installed):

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

## Architecture

Messor is a modular monolith.

```text
Browser
   |
   v
Nginx gateway (serves the React frontend and proxies /api/)
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
is the Nginx gateway.

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

## Development

### One-command local demo

The local demo starts PostgreSQL, the Spring Boot backend and the Nginx-served
frontend with a single command. The frontend gateway on `127.0.0.1:8088` is the
only HTTP/application entry point: the browser talks to a single origin that
serves the UI and proxies `/api/` to the backend. PostgreSQL is also bound to
the host on `127.0.0.1:${MESSOR_DB_PORT:-5432}:5432` for local development
convenience, but it is not an application entry point.

#### 1. Prepare the environment

```bash
cp .env.example .env
```

Then edit `.env` and replace the placeholder values with local values:

- `MESSOR_DB_PASSWORD` — the PostgreSQL password.
- `MESSOR_DEMO_PASSWORD` — the shared password for the demo accounts.
- `MESSOR_DEV_PORT` — the host port for the frontend gateway (default `8088`).

Never commit `.env`; it is git-ignored. The demo password is read by the
backend only from `.env` and is never embedded in the frontend source code or
build output.

#### 2. Start

```bash
docker compose --env-file .env -f compose.dev.yaml up --build
```

Open the application in your browser at:

```text
http://localhost:8088
```

#### 3. Demo accounts

The `demo` Spring profile seeds two local demo accounts. Both share the
password from `MESSOR_DEMO_PASSWORD`.

| Email | Role |
| --- | --- |
| `admin@demo.messor.app` | `ORG_ADMIN` |
| `member@demo.messor.app` | `USER` |

#### 4. Check service status and health

```bash
docker compose --env-file .env -f compose.dev.yaml ps
curl -fsS http://localhost:8088/actuator/health
```

The health endpoint is proxied to the backend through the frontend gateway, so
a single origin serves both the UI and the health check.

#### 5. Stop

```bash
docker compose --env-file .env -f compose.dev.yaml down
```

#### 6. Reset the database volume (optional)

To start from a clean database, remove the demo volume:

```bash
docker compose --env-file .env -f compose.dev.yaml down -v
```

The next `up --build` recreates the volume and re-runs the Flyway migrations
and the idempotent demo-account seeding.

#### 7. Verify the compose contract

```bash
sh scripts/verify-dev-compose.sh
```

This checks that `.env` exists, the compose configuration is valid, the service
list is exactly `postgres`, `backend` and `frontend`, the backend runs the
`demo` profile, the frontend publishes port `8088`, and the production
`compose.yaml` and Nginx files are unchanged.

In development the session cookie is not `Secure` (`Secure=false`), so the
application works over plain HTTP on `localhost`. The production cookie name
`__Host-MESSOR_SESSION` is never used in development.

## Production

### Prepare the environment

```bash
cp .env.example .env
# Replace every placeholder with a real value. Never commit .env.
```

The production compose reads secrets from `.env`. Required variables:

- `MESSOR_DB_NAME`, `MESSOR_DB_USER`, `MESSOR_DB_PASSWORD` — PostgreSQL
  credentials.
- `MESSOR_PUBLIC_PORT` — the public port exposed by the Nginx gateway
  (default `80`).
- `MESSOR_SPRING_PROFILES_ACTIVE` — `prod` for a real deployment, or
  `prod,demo` to seed the demo accounts.
- `MESSOR_DEMO_PASSWORD` — required only when the `demo` profile is active.

### Build and run

```bash
docker compose --env-file .env -f compose.yaml up -d --build
```

This builds the backend and frontend images, starts PostgreSQL, waits for it to
be healthy, starts the backend, and finally starts the Nginx gateway. The Nginx
gateway listens on plain HTTP at `http://localhost:${MESSOR_PUBLIC_PORT}`.

That HTTP port is intended for the internal/edge connection only. Real browser
authentication requires HTTPS: the `__Host-MESSOR_SESSION` cookie is `Secure`
and is rejected by browsers over plain HTTP. Terminate TLS at the deployment
edge (a load balancer or TLS proxy) in front of the Nginx container, as
described in the next section.

### `prod` vs `prod,demo`

- `MESSOR_SPRING_PROFILES_ACTIVE=prod` — a real deployment. No demo accounts
  are created.
- `MESSOR_SPRING_PROFILES_ACTIVE=prod,demo` — a demonstration deployment. The
  demo accounts are seeded with the password from `MESSOR_DEMO_PASSWORD`.

The demo password is read from the environment by the backend only. It is never
embedded in the frontend source code or build output.

### HTTPS / TLS edge requirement

The production session cookie is `__Host-MESSOR_SESSION`. The `__Host-` prefix
requires the cookie to be `Secure`, to have `Path=/` and to carry no `Domain`
attribute. Browsers reject the cookie unless the application is served over
HTTPS.

TLS is terminated at the deployment edge (a load balancer or TLS proxy in front
of the Nginx container). The Nginx container itself listens on plain HTTP and
forwards `X-Forwarded-Proto` to the backend. You must terminate TLS before
requests reach the browser, otherwise the session cookie will not be stored.

### Same-origin frontend and API

The frontend and the API share the same origin through Nginx. The browser never
makes cross-origin requests, so no CORS headers are configured and no wildcard
CORS is used.

### Nginx rate limits

Nginx applies per-IP rate limits to the authentication endpoints:

| Endpoint | Rate | Burst |
| --- | --- | --- |
| `POST /api/auth/login` | 5 requests/minute/IP | 5 |
| `GET /api/auth/csrf` | 30 requests/minute/IP | 30 |

The login endpoint is the primary brute-force target, so it gets a strict limit
with a small burst. The CSRF endpoint is fetched frequently by the SPA, so it
gets a higher limit with a larger burst.

When a limit is exceeded, Nginx returns `429 Too Many Requests` with a
problem-details body (`code: "RATE_LIMITED"`) and the
`application/problem+json` media type. If you see a `429`, slow down and retry
later.

Rate limiting keys on `$binary_remote_addr`, the direct connection peer. For
clients connecting directly to the Nginx container this is the real client IP.
Behind a TLS edge (load balancer or TLS proxy), the edge must reliably forward
the source IP to Nginx for per-client rate limiting to be meaningful. Nginx
deliberately discards any client-supplied `X-Forwarded-For` value and forwards
only the direct peer address to the backend, so a client cannot spoof its IP
toward the backend. If you need real client-IP rate limiting behind a TLS edge,
configure a deployment-specific trusted-proxy setup (for example, a trusted
`set_real_ip_from` list) so Nginx trusts the edge's forwarded address. Do not
unconditionally trust unknown proxy networks.

### Validating the Nginx configuration

```bash
docker run --rm \
  -v "$PWD/infrastructure/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/infrastructure/nginx/conf.d:/etc/nginx/conf.d:ro" \
  nginx:alpine nginx -t
```

### Validating the compose configuration

```bash
docker compose --env-file .env -f compose.yaml config
```
