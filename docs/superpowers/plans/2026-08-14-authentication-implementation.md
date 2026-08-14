# Messor Authentication Implementation Plan

> **Execution rule:** Give the software engineer only one task at a time. For
> every behavior, observe the new test fail for the expected reason before
> adding production code. Do not batch later tasks into the current task.

**Goal:** Add secure, JDBC-session authentication and a responsive React login
screen for the Messor portfolio MVP.

**Architecture:** Keep the backend a feature-oriented modular monolith. The
`identity` feature owns users and authentication. Controllers return records,
never JPA entities. The frontend keeps authentication under
`src/features/auth` and stores no security token in browser storage.

**Stack:** Java 25, Spring Boot 4.1, PostgreSQL 17, Flyway, Spring Security,
Spring Session JDBC, React 19, TypeScript, Vite, Vitest, Testing Library and
Playwright.

## Global execution rules

- Work from `/home/apdmrl/workspace/repos/messor` in WSL.
- Read `AGENTS.md` and the approved authentication design before every task.
- Start each task with `git status --short`; preserve unrelated user changes.
- Follow RED -> GREEN -> REFACTOR. No production code before a relevant failing
  test has been run and its failure has been inspected.
- Use PostgreSQL Testcontainers for persistence behavior. Never substitute H2.
- Run the narrow test first, then the relevant module suite.
- Do not weaken or delete a test to make the build pass.
- Do not add registration, password reset, password change, JWT, OAuth, a
  global frontend state library or unrelated refactoring.
- Do not log or print passwords, hashes, session IDs, cookies, CSRF tokens,
  authorization headers or a failed login's raw email.
- Keep commits small. Suggested commit commands are checkpoints, not
  authorization to commit without reviewing `git diff` first.

## Task 0: Establish a clean baseline

**Inspect:**

- `AGENTS.md`
- `backend/pom.xml`
- `backend/src/test/java/com/abdullah/messor/MessorApplicationTests.java`
- `frontend/package.json`
- `compose.dev.yaml`
- `compose.test.yaml`

### Step 1: Verify the current repository state

Run:

```bash
git status --short
docker compose --env-file .env -f compose.dev.yaml ps
```

Expected: PostgreSQL is healthy. Record all untracked scaffold files; do not
discard them.

### Step 2: Run the existing builds

Run:

```bash
cd backend
set -a && source ../.env && set +a
./mvnw test
cd ../frontend
npm run lint
npm run build
```

Expected: either all pass or the exact pre-existing failure is documented
before feature work starts.

### Step 3: Create the scaffold checkpoint

Review:

```bash
cd ..
git diff --check
git status --short
```

If the repository still has no commit, create one reviewed baseline commit:

```bash
git add .
git commit -m "chore: initialize messor workspace"
```

Do not commit `.env`, build output, dependencies or `.superpowers/`.

## Task 1: Add PostgreSQL integration-test infrastructure

**Modify:** `backend/pom.xml`

**Create:**

- `backend/src/test/java/com/abdullah/messor/support/PostgresIntegrationTest.java`
- `backend/src/test/resources/application-test.yaml`

### Step 1: Add a failing container-backed context test

Create an abstract test base that starts PostgreSQL and supplies the datasource
to Spring. Prefer Spring Boot's `@ServiceConnection` support. Add one temporary
test assertion proving the JDBC URL is PostgreSQL and Flyway ran.

Run:

```bash
cd backend
./mvnw -Dtest=PostgresIntegrationTest test
```

Expected RED: Testcontainers/Spring Boot container support is missing.

### Step 2: Add only the required test dependencies

Use Spring Boot 4.1 dependency management. Add compatible test-scoped
dependencies for Spring Boot Testcontainers and PostgreSQL Testcontainers.
Confirm the artifact names against the active BOM instead of copying Spring
Boot 3 examples blindly.

Run:

```bash
./mvnw dependency:tree
./mvnw -Dtest=PostgresIntegrationTest test
```

Expected GREEN: a real PostgreSQL container starts and Flyway applies V1.

### Step 3: Refactor and verify

Remove any temporary assertion that does not provide lasting value. Keep a
reusable base for later integration tests.

Run:

```bash
./mvnw test
```

Suggested commit: `test: add postgres integration test support`

## Task 2: Create the user schema with Flyway

**Create:**

- `backend/src/test/java/com/abdullah/messor/identity/UserMigrationIT.java`
- `backend/src/main/resources/db/migration/V2__create_user_accounts.sql`

### Step 1: RED — describe the schema

Write an integration test using JDBC metadata and direct SQL that expects:

- table `user_account`;
- UUID primary key;
- normalized, unique `email`;
- `password_hash`, `first_name`, `last_name`;
- role limited to `ORG_ADMIN` or `USER`;
- status limited to `ACTIVE` or `DISABLED`;
- `created_at`, `updated_at` and `version`;
- duplicate normalized email rejection;
- invalid role/status rejection.

Run:

```bash
cd backend
./mvnw -Dtest=UserMigrationIT test
```

Expected RED: `user_account` does not exist.

### Step 2: GREEN — add the minimum migration

Use PostgreSQL UUID, `TIMESTAMPTZ`, explicit `NOT NULL`, unique and check
constraints. Store email already normalized and enforce
`email = lower(btrim(email))`. Use `BIGINT NOT NULL DEFAULT 0` for the version.

Run the narrow test, then:

```bash
./mvnw test
```

Suggested commit: `feat: add user account schema`

## Task 3: Implement identity persistence

**Create:**

- `backend/src/main/java/com/abdullah/messor/identity/UserAccount.java`
- `backend/src/main/java/com/abdullah/messor/identity/UserRole.java`
- `backend/src/main/java/com/abdullah/messor/identity/UserStatus.java`
- `backend/src/main/java/com/abdullah/messor/identity/UserAccountRepository.java`
- `backend/src/main/java/com/abdullah/messor/identity/EmailNormalizer.java`
- `backend/src/test/java/com/abdullah/messor/identity/UserAccountRepositoryIT.java`
- `backend/src/test/java/com/abdullah/messor/identity/EmailNormalizerTest.java`

### Step 1: RED — email normalization

Test trim plus lowercase using `Locale.ROOT`, including mixed-case demo email.
Reject null or blank input at the appropriate boundary.

Run:

```bash
cd backend
./mvnw -Dtest=EmailNormalizerTest test
```

Expected RED: normalizer does not exist.

### Step 2: GREEN — minimum normalizer

Implement only the behavior asserted above. Re-run the narrow test.

### Step 3: RED — repository mapping

Write PostgreSQL integration tests for save, normalized-email lookup, ACTIVE
and DISABLED status mapping, enum mapping and optimistic version updates.

Run:

```bash
./mvnw -Dtest=UserAccountRepositoryIT test
```

Expected RED: entity/repository do not exist.

### Step 4: GREEN — entity and repository

Map `UserAccount` explicitly to `user_account`. Use UUID IDs and `@Version`.
Do not use Lombok and do not add JSON annotations to the entity.

Run:

```bash
./mvnw -Dtest=EmailNormalizerTest,UserAccountRepositoryIT test
./mvnw test
```

Suggested commit: `feat: add user identity persistence`

## Task 4: Add Argon2 authentication lookup

**Modify:** `backend/pom.xml` only if the runtime proves an Argon2 provider is
required.

**Create:**

- `backend/src/main/java/com/abdullah/messor/identity/MessorUserPrincipal.java`
- `backend/src/main/java/com/abdullah/messor/identity/DatabaseUserDetailsService.java`
- `backend/src/main/java/com/abdullah/messor/identity/PasswordConfiguration.java`
- `backend/src/test/java/com/abdullah/messor/identity/DatabaseUserDetailsServiceTest.java`
- `backend/src/test/java/com/abdullah/messor/identity/PasswordConfigurationTest.java`

### Step 1: RED — password hashing

Test that the configured encoder produces an Argon2 hash, matches the original
password and rejects a wrong password. Never print either value.

Run:

```bash
cd backend
./mvnw -Dtest=PasswordConfigurationTest test
```

Expected RED: no encoder bean/configuration.

### Step 2: GREEN — configure Argon2id

Use Spring Security's maintained Argon2 defaults. If Bouncy Castle is required,
add the smallest Boot-compatible runtime dependency and explain it in the POM
change review.

### Step 3: RED — user lookup

Mock the repository and test normalized lookup, ACTIVE principal creation,
DISABLED rejection and unknown-user rejection. External authentication errors
must not distinguish these cases.

### Step 4: GREEN — database-backed UserDetailsService

Return a dedicated principal containing the internal user ID and safe profile
fields. Do not return the JPA entity as the principal.

Run:

```bash
./mvnw -Dtest=PasswordConfigurationTest,DatabaseUserDetailsServiceTest test
./mvnw test
```

Suggested commit: `feat: add database authentication lookup`

## Task 5: Implement security errors and the CSRF endpoint

**Create:**

- `backend/src/main/java/com/abdullah/messor/auth/SecurityConfiguration.java`
- `backend/src/main/java/com/abdullah/messor/auth/AuthController.java`
- `backend/src/main/java/com/abdullah/messor/auth/CsrfTokenResponse.java`
- `backend/src/main/java/com/abdullah/messor/auth/SecurityProblemWriter.java`
- `backend/src/main/java/com/abdullah/messor/auth/ApiAuthenticationEntryPoint.java`
- `backend/src/main/java/com/abdullah/messor/auth/ApiAccessDeniedHandler.java`
- `backend/src/test/java/com/abdullah/messor/auth/CsrfEndpointIT.java`

**Modify:** `backend/src/main/resources/application.yaml`

### Step 1: RED — CSRF token contract

With MockMvc and the PostgreSQL test base, test `GET /api/auth/csrf` returns
`headerName`, `parameterName`, a nonblank masked token, and
`Cache-Control: no-store`. Assert actuator health remains public while other
API requests require authentication.

### Step 2: GREEN — minimum endpoint and filter chain

Use `HttpSessionCsrfTokenRepository` and Spring Security's default XOR request
handler. Permit only the CSRF endpoint, login processing URL and health probes.
Use cookie-only session tracking. Do not enable wildcard CORS.

### Step 3: RED — CSRF failures

Test missing token, invalid token and a token from session A submitted with
session B. Expect `403`, `application/problem+json`, extension code
`INVALID_CSRF_TOKEN`, `no-store`, no exception detail and no stack trace.

### Step 4: GREEN — Problem Details access-denied handler

Write errors through `SecurityProblemWriter`. Distinguish CSRF denial from a
generic forbidden response without exposing internals.

Run:

```bash
cd backend
./mvnw -Dtest=CsrfEndpointIT test
./mvnw test
```

Suggested commit: `feat: expose protected csrf token endpoint`

## Task 6: Implement form login

**Create:**

- `backend/src/main/java/com/abdullah/messor/auth/UserSummary.java`
- `backend/src/main/java/com/abdullah/messor/auth/JsonAuthenticationSuccessHandler.java`
- `backend/src/main/java/com/abdullah/messor/auth/ProblemAuthenticationFailureHandler.java`
- `backend/src/test/java/com/abdullah/messor/auth/LoginIT.java`

**Modify:** `SecurityConfiguration.java`

### Step 1: RED — successful login

Seed an ACTIVE test user with an Argon2 hash. Fetch a CSRF token, submit
form-urlencoded `email` and `password`, then assert `200`, `no-store`, an
authenticated JDBC-backed session and exactly these response fields:
`id`, `email`, `firstName`, `lastName`, `role`.

Explicitly assert the response omits `passwordHash`, `status` and `version`.

### Step 2: GREEN — success handler

Configure `loginProcessingUrl("/api/auth/login")`, email as the username
parameter, and a JSON success handler returning only `UserSummary`.

### Step 3: RED — indistinguishable failures

Test unknown email, wrong password and DISABLED user. All must return the same
`401 application/problem+json`, `AUTHENTICATION_FAILED`, Turkish generic
detail and `no-store`.

### Step 4: GREEN — failure handler

Add the minimum Problem Details failure handler. Do not include submitted email
or exception messages.

### Step 5: RED — session and token rotation

Assert session fixation protection rotates the session identifier, the
pre-login CSRF token cannot be reused, and a newly fetched post-login token
works.

### Step 6: GREEN — rely on and verify Spring Security rotation

Use Spring Security's session authentication strategy. Add custom token
mutation only if the failing test proves the framework configuration does not
meet the approved contract.

Run:

```bash
cd backend
./mvnw -Dtest=LoginIT test
./mvnw test
```

Suggested commit: `feat: add csrf-protected session login`

## Task 7: Implement current-user lookup

**Modify:** `AuthController.java`

**Create:** `backend/src/test/java/com/abdullah/messor/auth/CurrentUserIT.java`

### Step 1: RED

Test authenticated `GET /api/auth/me` returns `200`, `no-store` and the safe
user summary. Test anonymous access returns `401 application/problem+json`,
code `UNAUTHENTICATED`, the approved Turkish detail and no internal fields.

### Step 2: GREEN

Map the authenticated `MessorUserPrincipal` to `UserSummary`. Configure the
authentication entry point for anonymous API access.

Run:

```bash
cd backend
./mvnw -Dtest=CurrentUserIT test
./mvnw test
```

Suggested commit: `feat: expose current authenticated user`

## Task 8: Implement logout

**Create:**

- `backend/src/main/java/com/abdullah/messor/auth/NoContentLogoutSuccessHandler.java`
- `backend/src/test/java/com/abdullah/messor/auth/LogoutIT.java`

**Modify:** `SecurityConfiguration.java`

### Step 1: RED

Test valid-CSRF logout returns `204`, invalidates the server session, deletes
the configured cookie, and makes the next `/api/auth/me` return `401`. Test
missing/invalid CSRF returns the standard `403` Problem Details response.

### Step 2: GREEN

Configure `/api/auth/logout`, session invalidation, authentication clearing,
cookie deletion and a no-content success handler.

Run:

```bash
cd backend
./mvnw -Dtest=LogoutIT test
./mvnw test
```

Suggested commit: `feat: add csrf-protected logout`

## Task 9: Seed demo accounts safely

**Create:**

- `backend/src/main/java/com/abdullah/messor/identity/DemoAccountInitializer.java`
- `backend/src/test/java/com/abdullah/messor/identity/DemoAccountInitializerIT.java`
- `backend/src/main/resources/application-demo.yaml`

**Modify:**

- `.env.example`
- `README.md`

### Step 1: RED

Test that the initializer exists only under the `demo` profile, fails fast when
`MESSOR_DEMO_PASSWORD` is missing, creates exactly admin/member with the
approved roles, stores Argon2 hashes, and is idempotent across two executions.
Test it is absent under normal and production profiles.

### Step 2: GREEN

Implement the smallest profile-scoped initializer using normalized email and a
transaction. Read the password only from the environment-backed property.
Never provide a default password.

### Step 3: Document

Add the variable name, demo profile command and two demo emails to README and
`.env.example`; do not include a real password.

Run:

```bash
cd backend
./mvnw -Dtest=DemoAccountInitializerIT test
./mvnw test
```

Suggested commit: `feat: seed profile-scoped demo accounts`

## Task 10: Add safe authentication audit events

**Create:**

- `backend/src/main/java/com/abdullah/messor/auth/AuthenticationAuditLogger.java`
- `backend/src/test/java/com/abdullah/messor/auth/AuthenticationAuditLoggerTest.java`

### Step 1: RED

Capture logs for success, failure and logout. Assert stable event names are
present while password, hash, session/cookie/CSRF values, Authorization header
and failed raw email are absent. A successful event may use internal user UUID;
a failed event must not log submitted identity.

### Step 2: GREEN

Listen to the narrow Spring Security events needed for these three outcomes.
Log event name and safe internal identifiers only.

Run:

```bash
cd backend
./mvnw -Dtest=AuthenticationAuditLoggerTest test
./mvnw test
```

Suggested commit: `feat: add safe authentication audit events`

## Task 11: Establish frontend unit-test infrastructure

**Modify:**

- `frontend/package.json`
- `frontend/vite.config.ts`

**Create:**

- `frontend/src/test/setup.ts`
- `frontend/src/test/smoke.test.tsx`

### Step 1: RED

Add a smoke test using Vitest, jsdom and Testing Library, then run it before the
dependencies/configuration exist.

```bash
cd frontend
npm test -- --run
```

Expected RED: test script/runner is missing.

### Step 2: GREEN

Install only Vitest, jsdom, Testing Library DOM/React, jest-dom and user-event.
Add deterministic `test` and `test:watch` scripts. Configure Vite's development
proxy for `/api` to the backend so browser requests remain same-origin in dev.

Run:

```bash
npm test -- --run
npm run lint
npm run build
```

Suggested commit: `test: add frontend unit test support`

## Task 12: Implement the frontend authentication client

**Create:**

- `frontend/src/features/auth/types.ts`
- `frontend/src/features/auth/authApi.ts`
- `frontend/src/features/auth/authApi.test.ts`

### Step 1: RED

Mock `fetch` and test:

- CSRF is fetched before login;
- every request uses `credentials: "include"`;
- login uses `URLSearchParams` and form-urlencoded content type;
- the dynamic CSRF `headerName` is used;
- the pre-login token is discarded after success and a fresh token is fetched;
- `/me` maps `401` to anonymous state;
- RFC 9457 `detail` and `code` are parsed;
- no localStorage/sessionStorage write occurs.

Run:

```bash
cd frontend
npm test -- --run src/features/auth/authApi.test.ts
```

Expected RED: auth client does not exist.

### Step 2: GREEN

Implement a small fetch-based client. Keep the CSRF token in module memory
only. Clear it on authentication transitions and unexpected auth failures.

Run the narrow test, then all unit tests, lint and build.

Suggested commit: `feat: add browser session auth client`

## Task 13: Build the responsive login screen

**Create:**

- `frontend/src/features/auth/LoginPage.tsx`
- `frontend/src/features/auth/LoginPage.css`
- `frontend/src/features/auth/LoginPage.test.tsx`

### Step 1: RED — behavior and accessibility

Test correct label associations, email/password input types, keyboard submit,
loading and disabled states, generic Problem Details display, demo account
emails, absence of a demo password, and successful-login callback.

### Step 2: GREEN — semantic form

Implement the minimum controlled form and call the auth client. Use a live
region for errors and retain visible focus styling.

### Step 3: RED — responsive contract markers

Unit tests should assert stable layout regions and accessible branding, not
pixel dimensions. Leave actual overflow and viewport behavior for Playwright.

### Step 4: GREEN — approved option A styles

Use mobile-first CSS:

- 0-767px: one column, compact brand above card;
- 768-1023px: tablet layout;
- 1024px+: split screen with branded left panel;
- CSS/SVG ant trail, no generated bitmap dependency;
- minimum 44px touch targets;
- no fixed viewport height that breaks mobile keyboards; use `min-height: 100dvh`;
- `prefers-reduced-motion` disables nonessential animation;
- `box-sizing: border-box`, fluid widths and safe padding prevent 320px overflow.

Run:

```bash
cd frontend
npm test -- --run src/features/auth/LoginPage.test.tsx
npm test -- --run
npm run lint
npm run build
```

Suggested commit: `feat: add responsive messor login screen`

## Task 14: Integrate authentication with the app shell

**Modify:**

- `frontend/src/App.tsx`
- `frontend/src/App.css`
- `frontend/src/index.css`

**Create:** `frontend/src/App.test.tsx`

**Delete only after replacement is verified:** unused Vite starter image imports
and assets.

### Step 1: RED

Test initial `/me` loading, anonymous login display, authenticated placeholder
shell, recoverable network error and return to login after logout.

### Step 2: GREEN

Use local React state for this small MVP auth bootstrap. Do not add TanStack
Query until server-state complexity justifies it in a later feature.

### Step 3: Refactor starter code

Remove only now-unused Vite demo styles/assets. Preserve global accessibility
and responsive defaults.

Run:

```bash
cd frontend
npm test -- --run
npm run lint
npm run build
```

Suggested commit: `feat: connect login to app session state`

## Task 15: Verify responsive behavior in a real browser

**Modify:** `frontend/package.json`, `.gitignore` only if existing artifact
rules are insufficient.

**Create:**

- `frontend/playwright.config.ts`
- `frontend/e2e/login-responsive.spec.ts`

### Step 1: RED

Install Playwright test tooling and write deterministic route-mocked tests for:

- 360x800;
- 390x844;
- 768x1024;
- 1440x900;
- 320px width with `document.documentElement.scrollWidth <= innerWidth`;
- visible/usable inputs and submit button;
- logical Tab order and visible focus;
- reduced-motion emulation;
- successful mocked login flow.

Run before completing responsive fixes:

```bash
cd frontend
npm run test:e2e
```

Expected RED: Playwright setup and/or responsive assertions are not complete.

### Step 2: GREEN

Make the smallest CSS/markup corrections. Do not commit screenshots or browser
binaries; keep screenshots/traces as failure artifacts only.

Run unit tests, Playwright, lint and build.

Suggested commit: `test: verify responsive login experience`

## Task 16: Add production session and Nginx security

**Create:**

- `backend/src/main/resources/application-prod.yaml`
- `infrastructure/nginx/nginx.conf`
- `infrastructure/nginx/conf.d/messor.conf`
- a focused Nginx verification script only if it avoids duplicated commands

**Modify:**

- `compose.yaml`
- `.env.example`
- `README.md`

### Step 1: RED — configuration assertions

Before implementation, add either a small configuration test or explicit
failing validation demonstrating production cookie settings are absent. Define
the expected Nginx locations and rate-limit zones before adding them.

### Step 2: GREEN — production cookie profile

Configure `__Host-MESSOR_SESSION`, Secure, HttpOnly, SameSite=Lax, Path=/ and no
Domain in production. Keep a non-`__Host-` development cookie with Secure=false
so localhost HTTP remains usable.

### Step 3: GREEN — same-origin reverse proxy and limits

Serve the frontend and proxy `/api/` to the backend. Add a strict per-IP limit
for `/api/auth/login` and a higher limit for `/api/auth/csrf`. Return/document
429 behavior. Forward only required proxy headers and document that TLS ends at
the edge. Do not enable wildcard CORS.

Validate:

```bash
docker compose --env-file .env -f compose.yaml config
docker run --rm -v "$PWD/infrastructure/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:alpine nginx -t
```

Adjust the mount command to include referenced `conf.d` files. The final
validation must test the same directory structure used by Compose.

Suggested commit: `feat: harden production auth proxy`

## Task 17: Full verification and documentation review

### Step 1: Backend

```bash
cd backend
./mvnw test
./mvnw verify
```

Expected: unit and PostgreSQL Testcontainers tests pass with no skipped security
tests.

### Step 2: Frontend

```bash
cd ../frontend
npm test -- --run
npm run test:e2e
npm run lint
npm run build
```

Expected: all four viewport groups pass; build has no TypeScript errors.

### Step 3: Containers and configuration

```bash
cd ..
docker compose --env-file .env -f compose.dev.yaml config
docker compose --env-file .env -f compose.yaml config
```

Run the final Nginx `nginx -t` command from Task 16.

### Step 4: Security review

Check:

- CSRF is enabled for login and logout;
- tokens are session-bound and rotate after authentication;
- no browser storage contains a token;
- anonymous `/me` is 401;
- login failures are indistinguishable;
- disabled users cannot authenticate;
- cookies differ safely between development and production;
- auth/error responses are no-store;
- API responses contain no entity/internal fields;
- logs and docs contain no secrets;
- rate limits cover login and CSRF routes.

### Step 5: Mobile accessibility review

Check:

- 320px has no horizontal overflow;
- 360x800 and 390x844 show the complete form;
- 768x1024 uses the intended tablet layout;
- 1440x900 uses the branded split layout;
- touch targets are at least 44x44px;
- keyboard focus is visible and order is logical;
- error text is announced;
- the layout survives the on-screen keyboard;
- reduced-motion preference is honored.

### Step 6: Repository hygiene

```bash
git diff --check
git status --short
git diff --stat
```

Review README commands from a fresh-clone perspective. Do not claim completion
until every required command has been run in the current state and its output
has been inspected.

Suggested commit: `docs: document authentication setup and verification`

## Expected file tree

```text
backend/src/main/java/com/abdullah/messor/
  auth/
    ApiAccessDeniedHandler.java
    ApiAuthenticationEntryPoint.java
    AuthController.java
    CsrfTokenResponse.java
    JsonAuthenticationSuccessHandler.java
    NoContentLogoutSuccessHandler.java
    ProblemAuthenticationFailureHandler.java
    SecurityConfiguration.java
    SecurityProblemWriter.java
    UserSummary.java
  identity/
    DatabaseUserDetailsService.java
    DemoAccountInitializer.java
    EmailNormalizer.java
    MessorUserPrincipal.java
    PasswordConfiguration.java
    UserAccount.java
    UserAccountRepository.java
    UserRole.java
    UserStatus.java
frontend/src/features/auth/
  LoginPage.css
  LoginPage.test.tsx
  LoginPage.tsx
  authApi.test.ts
  authApi.ts
  types.ts
frontend/e2e/
  login-responsive.spec.ts
```

## Known risks and out-of-scope work

- Testcontainers requires a working Docker daemon.
- Production `Secure` cookies require HTTPS at the deployment edge.
- Shared demo data reset is a later operational feature.
- Registration, invitations, password change/reset, OAuth, MFA and a real
  `VIEWER` role are intentionally out of scope.
- Project authorization starts only after authentication is complete; frontend
  visibility will never replace backend authorization.
