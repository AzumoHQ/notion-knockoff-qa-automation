import { test, expect } from '../../fixtures/base.fixture.js';

test.describe('Auth @regression', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('valid credentials land on the workspace and the session survives a reload', async ({ page, loginPage, workspace }) => {
    await loginPage.goto();
    await loginPage.waitForHydration();
    await loginPage.login(process.env.TEST_USER_USERNAME, process.env.TEST_USER_PASSWORD);

    await expect(page).toHaveURL(/\/w\/[^/]+/);
    await expect(workspace.newPageButton).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/w\/[^/]+/);
    await expect(workspace.newPageButton).toBeVisible();
    await expect(loginPage.usernameInput).toHaveCount(0);
  });

  test('wrong credentials show an error and keep the visitor out', async ({ page, loginPage, workspace }) => {
    await loginPage.goto();
    await loginPage.waitForHydration();
    await loginPage.login('usuario-inexistente', 'password-incorrecta');

    await expect(page.getByText('Usuario o contraseña incorrectos.')).toBeVisible();
    await expect(page).not.toHaveURL(/\/w\//);
    await expect(workspace.newPageButton).toHaveCount(0);
  });

  test('a protected workspace URL redirects an anonymous visitor to the login screen', async ({ page, loginPage }) => {
    await page.goto('/w/00000000-0000-0000-0000-000000000000');

    await loginPage.waitForHydration();
    await expect(page).not.toHaveURL(/\/w\//);
    await expect(loginPage.usernameInput).toBeVisible();
  });
});
