import { test, expect } from '../../fixtures/base.fixture.js';

// Runs in the dedicated "logout" project (after everything else): signing out can revoke the
// shared session, and this test uses its own fresh login so it never touches the saved storageState.
test.describe('Logout @regression', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('logging out returns to the login screen and the session is gone after a reload', async ({ page, loginPage, workspace }) => {
    await loginPage.goto();
    await loginPage.waitForHydration();
    await loginPage.login(process.env.TEST_USER_USERNAME, process.env.TEST_USER_PASSWORD);
    await expect(page).toHaveURL(/\/w\//);

    await workspace.logoutButton.click();

    await loginPage.waitForHydration();
    await expect(page).not.toHaveURL(/\/w\//);

    await page.reload();
    await loginPage.waitForHydration();
    await expect(loginPage.usernameInput).toBeVisible();

    await page.goto('/w/00000000-0000-0000-0000-000000000000');
    await loginPage.waitForHydration();
    await expect(page).not.toHaveURL(/\/w\//);
  });
});
