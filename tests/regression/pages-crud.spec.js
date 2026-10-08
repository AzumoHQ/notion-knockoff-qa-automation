import { test, expect } from '../../fixtures/base.fixture.js';
import { DataProvisioner } from '../../data/data-provisioner.js';

test.describe('Pages: create, rename, persistence @regression', () => {
  test('a new page is created, listed in the sidebar and survives a reload', async ({ page, workspace, pageFactory }) => {
    const title = await pageFactory.create('create');

    await expect(page).toHaveURL(/\/w\/[^/]+\/p\/[^/]+$/);
    await expect(workspace.sidebarLink(title)).toBeVisible();
    const urlBeforeReload = page.url();

    await page.reload();
    await workspace.editor.waitForLoaded();

    await expect(page).toHaveURL(urlBeforeReload);
    await expect(workspace.editor.title).toHaveValue(title);
    await expect(workspace.sidebarLink(title)).toBeVisible();
  });

  test('renaming a page updates the sidebar and is still there after a reload', async ({ page, workspace, pageFactory }) => {
    const original = await pageFactory.create('before-rename');
    const renamed = original.replace('before-rename', 'after-rename');
    pageFactory.track(renamed);

    await workspace.editor.setTitle(renamed);

    await expect(workspace.sidebarLink(renamed)).toBeVisible();
    await expect(workspace.sidebarLink(original)).toHaveCount(0);

    await page.reload();
    await workspace.editor.waitForLoaded();

    await expect(workspace.editor.title).toHaveValue(renamed);
    await expect(workspace.sidebarLink(renamed)).toBeVisible();
    await expect(workspace.sidebarLink(original)).toHaveCount(0);
  });

  test('a page created without title is listed as "Sin título"', async ({ workspace, pageFactory }) => {
    // Business rule: an empty title must still be navigable. Rename right away so cleanup finds it.
    await workspace.open();
    await workspace.createPage();

    await expect(workspace.editor.title).toHaveValue('');
    await expect(workspace.editor.title).toHaveAttribute('placeholder', 'Sin título');
    await expect(workspace.sidebarLink('Sin título')).toBeVisible();

    const title = DataProvisioner.pageTitle('untitled');
    pageFactory.track(title);
    await workspace.editor.setTitle(title);
    await expect(workspace.sidebarLink(title)).toBeVisible();
  });
});
