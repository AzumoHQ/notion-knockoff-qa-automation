import { test as base, expect } from '@playwright/test';
import { qaFixtures } from '../framework/playwright/fixtures.js';
import { healFixtures } from '../framework/playwright/heal-fixtures.js';
import { PROFILES, useEnvironment } from '../auth/environment-profile.js';
// {{API_IMPORT}}
// Add one import + one fixture per page object.

// Use another role in a spec: test.use(useEnvironment('<profile name>'))
export const test = base.extend({
  ...qaFixtures,
  ...healFixtures,
  // {{API_FIXTURES}}
  // Playwright requires the destructuring pattern even when no fixture is used.
  // eslint-disable-next-line no-empty-pattern
  environmentProfile: async ({}, use) => use(PROFILES.default),
});

export { expect, useEnvironment };
