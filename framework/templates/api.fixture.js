import { test as base, expect } from '@playwright/test';
import { qaFixtures } from '../framework/playwright/fixtures.js';
import { apiFixtures } from '../framework/playwright/api-fixtures.js';
import { PROFILES } from '../auth/environment-profile.js';
import apiConfig from '../api/api.config.js';

// Fixtures for tests/api: no browser is started. UI specs use fixtures/base.fixture.js instead.
export const test = base.extend({
  ...qaFixtures,
  ...apiFixtures(apiConfig, PROFILES),
});

export { expect };
