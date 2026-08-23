import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for the Messor frontend.
 *
 * Runs against a local Vite dev server on 127.0.0.1:4173. All backend
 * interactions are mocked at the route level (see e2e/login-responsive.spec.ts),
 * so no backend/PostgreSQL is required.
 *
 * Five deterministic Chromium projects cover the responsive contract:
 * mobile 320/360/390, tablet 768, desktop 1440.
 */
export default defineConfig({
  testDir: './e2e',
  // The real-stack suites (golden path + security regressions) run against a
  // running compose stack via playwright.stack.config.ts; they are excluded
  // here so this mocked suite needs no backend or demo password.
  testIgnore: ['**/mvp-golden-path.spec.ts', '**/security-regression.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'off',
  },
  projects: [
    {
      name: 'mobile-320',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 800 } },
    },
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 } },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
