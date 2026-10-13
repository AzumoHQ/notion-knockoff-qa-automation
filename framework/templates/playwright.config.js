import { defineConfig, devices } from '@playwright/test';
import { loadEnv, bypassHeaders, allureOptions } from './framework/lib/env.js';
import { PROFILES } from './auth/environment-profile.js';

loadEnv();

// {{VISUAL_BEGIN}}
const visualExpect = {};
const visualOptions = {};
// {{VISUAL_END}}

const ci = Boolean(process.env.CI);

// UI suite: tests/** except tests/api. API suite: tests/api (no browser). Run with --project=chromium | --project=api.
export default defineConfig({
  testDir: './tests',
  globalSetup: './auth/global-setup.js',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 1,
  workers: ci ? 2 : undefined,
  expect: { timeout: 15_000, ...visualExpect },
  ...visualOptions,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ['allure-playwright', allureOptions()],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL,
    extraHTTPHeaders: bypassHeaders(),
    storageState: PROFILES.default.storageStatePath,
    screenshot: ci ? 'only-on-failure' : 'on',
    video: ci ? 'retain-on-failure' : 'on',
    trace: ci ? 'retain-on-failure' : 'on',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/api/**',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'api',
      testMatch: '**/api/**/*.spec.js',
    },
  ],
  outputDir: 'test-results',
  timeout: 60_000,
});
