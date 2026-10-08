import { test, expect } from '../../fixtures/base.fixture.js';

test.describe('Navigation and search @regression', () => {
  test('clicking sidebar entries switches between pages and shows each page\'s own content', async ({ page, workspace, pageFactory }) => {
    const first = await pageFactory.create('nav-a');
    await workspace.editor.addBlock('contenido de A');
    const second = await pageFactory.create('nav-b');
    await workspace.editor.addBlock('contenido de B');

    await workspace.openPage(first);
    await expect(workspace.editor.title).toHaveValue(first);
    await expect(workspace.editor.blocks.first()).toHaveValue('contenido de A');

    await workspace.openPage(second);
    await expect(workspace.editor.title).toHaveValue(second);
    await expect(workspace.editor.blocks.first()).toHaveValue('contenido de B');

    // Deep link: reloading a page URL lands on the same page
    await page.reload();
    await workspace.editor.waitForLoaded();
    await expect(workspace.editor.title).toHaveValue(second);
  });

  test('a sub-page is created under its parent and persists nested', async ({ page, workspace, pageFactory }) => {
    const parent = await pageFactory.create('parent');
    const parentUrl = page.url();
    await page.getByRole('button', { name: `Agregar subpágina en ${parent}` }).first().click();
    await page.waitForURL((url) => url.href !== parentUrl); // the parent URL already matches /p/
    await expect(workspace.editor.title).toHaveValue('');
    await workspace.editor.waitForLoaded();
    const child = `${parent}-child`;
    pageFactory.track(child);
    await workspace.editor.setTitle(child);

    await page.reload();
    await workspace.editor.waitForLoaded();
    await expect(workspace.editor.title).toHaveValue(child);

    // Child is only reachable by expanding its parent in the tree
    if (!(await workspace.sidebarLink(child).isVisible())) {
      await page.getByRole('button', { name: `Expandir ${parent}` }).first().click();
    }
    await expect(workspace.sidebarLink(child)).toBeVisible();
  });

  test('search finds a page by title and by block content', async ({ workspace, pageFactory }) => {
    const title = await pageFactory.create('search');
    const needle = `needle${title.slice(-6)}`;
    await workspace.editor.addBlock(`el secreto es ${needle}`);

    await workspace.search(title);
    await expect(workspace.searchResult(title)).toBeVisible();

    await workspace.searchDialog.getByPlaceholder('Buscar por título o contenido…').fill(needle);
    await expect(workspace.searchResult(title)).toBeVisible();

    await workspace.searchDialog.getByPlaceholder('Buscar por título o contenido…').fill(`${needle}-no-existe`);
    await expect(workspace.searchResult(title)).toHaveCount(0);
  });
});
