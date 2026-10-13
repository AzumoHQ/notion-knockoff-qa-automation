import { test, expect } from '../../fixtures/base.fixture.js';
import { genericLogin } from '../../framework/lib/login.js';

// Generic login checks written by `init` from the detected login form. Exploration refines them with the
// application's real selectors and post-login behavior (see docs/technical-context.md).
const login = { username: process.env.TEST_USER_USERNAME, password: process.env.TEST_USER_PASSWORD };
const passwordField = (page) => page.locator('input[type="password"]');

test.describe('Authentication', () => {
  test.describe('without a session', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('TC0001 - login screen asks for credentials', async ({ page }) => {
      await page.goto('/');
      await expect(passwordField(page)).toBeVisible();
    });

    test('TC0002 - invalid credentials are rejected and the user stays on login', async ({ page }) => {
      await expect(genericLogin(page, '/', login.username, `${login.password}-wrong`, { timeout: 5_000 })).rejects.toThrow();
      await expect(passwordField(page)).toBeVisible();
    });

    test('TC0003 - valid credentials leave the login screen', async ({ page, baseURL }) => {
      await genericLogin(page, baseURL, login.username, login.password);
      await expect(passwordField(page)).toHaveCount(0);
    });
  });

  test('TC0004 - the saved session opens the app without the login screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(passwordField(page)).toHaveCount(0);
  });
});
