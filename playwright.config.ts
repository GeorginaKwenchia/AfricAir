import { defineConfig, devices } from '@playwright/test'

// Set BASE_URL to test an already-running deployment (container, cluster, CloudFront…).
// Without it, Playwright starts the Vite dev server itself.
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]] : 'list',
  use: { baseURL, acceptDownloads: true, locale: 'en-GB', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.BASE_URL ? undefined : { command: 'pnpm dev', url: baseURL, reuseExistingServer: true },
})
