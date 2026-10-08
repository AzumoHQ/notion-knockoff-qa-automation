import { test, expect } from '../../fixtures/base.fixture.js';

test.describe('Delete flow: archive, restore, delete permanently @regression', () => {
  test('archiving removes the page from the sidebar and moves it to the trash, also after a reload', async ({ page, workspace, pageFactory }) => {
    const title = await pageFactory.create('archive');

    await workspace.editor.archive();

    await expect(workspace.sidebarLink(title)).toHaveCount(0);
    await workspace.openTrash();
    await expect(workspace.trash.item(title)).toBeVisible();

    await page.reload();
    await workspace.trash.waitForLoaded();
    await expect(workspace.trash.item(title)).toBeVisible();
    await expect(workspace.sidebarLink(title)).toHaveCount(0);
  });

  test('restoring an archived page brings it back with its content', async ({ page, workspace, pageFactory }) => {
    const title = await pageFactory.create('restore');
    await workspace.editor.addBlock('contenido que debe sobrevivir');
    await workspace.editor.archive();
    await workspace.openTrash();

    await workspace.trash.restore(title);
    await expect(workspace.trash.item(title)).toHaveCount(0);

    await page.reload();
    await workspace.newPageButton.waitFor();
    await expect(workspace.sidebarLink(title)).toBeVisible();
    await workspace.openPage(title);
    await expect(workspace.editor.blocks.first()).toHaveValue('contenido que debe sobrevivir');
  });

  test('deleting permanently removes the page everywhere and it stays gone after a reload', async ({ page, workspace, pageFactory }) => {
    const title = await pageFactory.create('delete-forever');
    const pageUrl = page.url();
    await workspace.editor.archive();
    await workspace.openTrash();

    await workspace.trash.deletePermanently(title);
    await expect(workspace.trash.item(title)).toHaveCount(0);

    await page.reload();
    await workspace.trash.waitForLoaded();
    await expect(workspace.trash.item(title)).toHaveCount(0);
    await expect(workspace.sidebarLink(title)).toHaveCount(0);

    // The old URL must not resurrect the page
    await page.goto(pageUrl);
    await expect(workspace.editor.title).toHaveCount(0);
  });
});
