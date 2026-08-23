import { defineConfig, devices } from '@playwright/test'

/**
 * Real-stack Playwright configuration for the compose-backed acceptance
 * suites (golden path + security regressions).
 *
 * This config does NOT start a web server and does NOT mock any backend route.
 * It targets the running local stack (default `http://127.0.0.1:8088`, the dev
 * compose frontend gateway) and exercises the real PostgreSQL backend with real
 * server-side sessions and CSRF. CI overrides the base URL with the test-stack
 * port (compose.test.yaml).
 *
 * The four target viewports from the responsive contract are covered:
 * 360x800, 390x844, 768x1024, 1440x900.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /(mvp-golden-path|security-regression)\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // No retries: a failing acceptance run must expose its root cause, never be
  // masked by automatic reruns.
  retries: 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_STACK_URL ?? 'http://127.0.0.1:8088',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'stack-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 } },
    },
    {
      name: 'stack-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'stack-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'stack-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
