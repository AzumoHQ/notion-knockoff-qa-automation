import { test, expect } from '../../fixtures/base.fixture.js';

test.describe('Smoke @smoke', () => {
  test.describe('anonymous visitor', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('home hydrates and shows the login screen', async ({ page, loginPage }) => {
      await loginPage.goto();
      await loginPage.waitForHydration();

      await expect(page).toHaveTitle('Workspace');
      await expect(loginPage.usernameInput).toBeVisible();
      await expect(loginPage.passwordInput).toBeVisible();
      await expect(loginPage.googleButton).toBeVisible();
    });
  });

  test('authenticated session lands on the workspace', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/w\//);

    await expect(page.getByRole('button', { name: 'Nueva página' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
    await expect(page.getByPlaceholder('Usuario')).toHaveCount(0);
  });
});
