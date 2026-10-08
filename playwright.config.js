import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.ENV ?? 'local'}`, override: false });
dotenv.config({ path: '.env', override: false });

const { BASE_URL, bypassHeaders } = await import('./utils/target.js');

export default defineConfig({
  testDir: './tests',
  globalSetup: './auth/global-setup.js',
  globalTeardown: './auth/global-teardown.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  expect: { timeout: 15_000 },
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ['allure-playwright', { outputFolder: 'allure-results' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: bypassHeaders(),
    storageState: './auth/default.storageState.json',
    screenshot: process.env.CI ? 'only-on-failure' : 'on',
    video: process.env.CI ? 'retain-on-failure' : 'on',
    trace: process.env.CI ? 'retain-on-failure' : 'on',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /logout\.spec\.js/ },
    // Logging out may revoke the shared session server-side, so it runs last, after every other test.
    {
      name: 'logout',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /logout\.spec\.js/,
      dependencies: ['chromium'],
    },
  ],
  outputDir: 'test-results',
  timeout: 60_000,
});
