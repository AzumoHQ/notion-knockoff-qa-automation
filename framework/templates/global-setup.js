import { chromium } from '@playwright/test';
import { loadEnv } from '../framework/lib/env.js';
import { loginProfiles } from '../framework/lib/login.js';
import { PROFILES } from './environment-profile.js';

loadEnv();

// One login per profile in environment-profile.js. For a login that differs from the generic
// username/password form, pass your own `login(page, url, username, password)` to loginProfiles.
export default async function globalSetup() {
  const browser = await chromium.launch();
  try {
    await loginProfiles({ browser, profiles: PROFILES });
  } finally {
    await browser.close();
  }
}
