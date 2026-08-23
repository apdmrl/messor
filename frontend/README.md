# Messor frontend

This directory contains the Messor React + TypeScript single-page application
(React 19, Vite, TanStack Query, React Router, dnd-kit).

See the repository [README](../README.md) for:

- the product and completed MVP features,
- the technology stack and architecture,
- how to start the full local demo with Docker Compose,
- demo accounts and setup,
- how to run the frontend tests, lint, build, and browser suites.

Quick local commands:

```bash
npm ci
npm test          # unit/component tests
npm run lint      # oxlint
npm run build     # type-check + production build
npm run test:e2e  # mocked Playwright suite (no backend required)
```

The real-stack acceptance suites (`frontend/e2e/mvp-golden-path.spec.ts` and
`frontend/e2e/security-regression.spec.ts`) run against the compose-backed stack
via `npm run test:e2e:stack` (see `playwright.stack.config.ts` and the README).
