import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import { PROFILES, useEnvironment } from '../auth/environment-profile.js';
// add one import + fixture per new Page Object

export const test = base.extend({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  environmentProfile: async ({}, use) => {
    await use(PROFILES.default);
  },
});

export { expect, useEnvironment };
