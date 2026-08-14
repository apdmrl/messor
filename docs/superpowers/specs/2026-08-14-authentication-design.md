# Authentication Design

- Status: Approved
- Scope: Portfolio MVP first release
- Date: 2026-08-14

## Summary

Server-side session authentication using Spring Security with JDBC-backed
HttpSession. Users log in with email and password. The first release includes
login, logout, current-user lookup and CSRF token issuance only. Registration,
password change and password reset are out of scope.

## Decisions

### Session and authentication

- Use Spring Security with JDBC-backed HttpSession (Spring Session JDBC).
- Credentials are email (normalized, unique) and password.
- No registration, password change or password reset in the first release.
- Session tracking is cookie-only. Do not use URL rewriting.

### Endpoints

- `GET /api/auth/csrf` — returns the current CSRF token.
- `POST /api/auth/login` — authenticates; accepts `application/x-www-form-urlencoded`.
- `POST /api/auth/logout` — ends the session.
- `GET /api/auth/me` — returns the authenticated user.

### CSRF

- Use `HttpSessionCsrfTokenRepository` with Spring Security's default XOR/BREACH
  token protection.
- Login and logout are CSRF protected.
- On successful login, discard the pre-login CSRF token and issue a new one.
- Reject CSRF tokens that belong to a different session.

### Error handling

- Failed login returns a generic message that does not reveal whether the email
  exists or the account is disabled.

### Cookies

- Production cookie name: `__Host-MESSOR_SESSION`.
- Cookie attributes: `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`.
- No `Domain` attribute.

### CORS and caching

- Restrict CORS to same origin. No wildcard CORS in production.
- Return `Cache-Control: no-store` on auth and CSRF responses.

### Rate limiting

- Apply IP rate limits at the Nginx layer for the CSRF and login endpoints.
- No persistent account lockout, so shared demo accounts are never locked out.

## API response contracts

### GET /api/auth/csrf

- `200 OK`
- Response:

```json
{
  "headerName": "X-CSRF-TOKEN",
  "parameterName": "_csrf",
  "token": "..."
}
```

### POST /api/auth/login

- Accepts `application/x-www-form-urlencoded`.
- Success: `200 OK` and the user summary.
- Failure: `401 Unauthorized`.
- Error body:

```json
{
  "type": "about:blank",
  "title": "Unauthorized",
  "status": 401,
  "detail": "E-posta veya parola hatalı.",
  "instance": "/api/auth/login",
  "code": "AUTHENTICATION_FAILED"
}
```

### GET /api/auth/me

- Authenticated: `200 OK` and the user summary.
- Unauthenticated: `401 Unauthorized`.
- Error body:

```json
{
  "type": "about:blank",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Oturum açmanız gerekiyor.",
  "instance": "/api/auth/me",
  "code": "UNAUTHENTICATED"
}
```

### POST /api/auth/logout

- Success: `204 No Content`.
- The session is invalidated.
- The session cookie is deleted.

### Problem Details error format

- All API error responses use `Content-Type: application/problem+json` and
  follow RFC 9457 / Spring Problem Details.
- `code` is an extension field on Problem Details.
- The frontend uses `detail` for user-facing messages and `code` for
  programmatic control.
- CSRF errors use the same Problem Details format.
- The CSRF error code is `INVALID_CSRF_TOKEN`.
- Missing and invalid token responses return `403 Forbidden`.
- Error responses also include `Cache-Control: no-store`.
- Internal exception messages and stack traces are never included in API
  responses.

## User model

- `id` — UUID primary key.
- `email` — normalized, unique.
- `passwordHash` — Argon2id.
- `firstName`, `lastName`.
- `role` — `ORG_ADMIN` or `USER`.
- `status` — `ACTIVE` or `DISABLED`.
- `createdAt`, `updatedAt`, `version` (optimistic locking).

The API user summary exposes only `id`, `email`, `firstName`, `lastName` and
`role`. `passwordHash`, `status`, `version` and other internal fields are never
returned in API responses.

## Demo accounts

| Email | Role |
| --- | --- |
| `admin@demo.messor.app` | `ORG_ADMIN` |
| `member@demo.messor.app` | `USER` |

- Demo password is read from the `MESSOR_DEMO_PASSWORD` environment variable.
- The demo initializer runs only under the demo profile and is idempotent.

## Logging

Never log: password, password hash, session ID, cookie, CSRF token,
`Authorization` header, or the raw email submitted on a failed login.

## Frontend

Approved design option A: branded split screen on desktop.

- Left panel: Messor brand, short description, and an ant-trail visual motif.
- Right panel: a plain, accessible login card.
- Form: email and password fields, submit button, generic error message,
  loading state, and a demo account note.
- The demo password is never embedded in frontend source code.

### Responsive and mobile

- Mobile-first CSS.
- 0–767 px: single-column login screen.
- Mobile: large left panel removed; brand and ant motif shown compactly above
  the login card.
- 768–1023 px: tablet layout.
- 1024 px and above: split-screen desktop view.
- No horizontal scrolling at 320 px width.
- Form fields and buttons do not overflow their container.
- Touch targets at least 44x44 px.
- Form remains usable when the on-screen keyboard is open.
- Visible focus styles and correct label associations.
- Support `prefers-reduced-motion`.
- Verified at viewports: 360x800, 390x844, 768x1024, 1440x900.

## TDD security scenarios

- Missing CSRF token.
- Invalid CSRF token.
- CSRF token from session A used with session B.
- Pre-login token reused after login.
- Logout without a token.
- Anonymous `GET /api/auth/me`.
- Wrong password.
- Disabled user.
- Successful login and logout.
- Sensitive data is not logged.

## Frontend test scenarios

- Login is not submitted until a CSRF token is obtained.
- CSRF token is refreshed after successful login.
- Generic error message is shown on failure.
- Loading and disabled states render correctly.
- Keyboard-only interaction works.
- No horizontal overflow in the mobile layout.
