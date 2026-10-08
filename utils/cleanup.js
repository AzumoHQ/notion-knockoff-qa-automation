import { expect } from '@playwright/test';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Removes pages whose title matches `matcher` (string = exact title, RegExp = pattern):
 * archive each one from the sidebar, then delete it permanently from the trash.
 * Tolerant by design — pages the test already deleted are simply not found.
 */
export async function removePages(workspace, matcher) {
  const { page } = workspace;
  const titleRe = typeof matcher === 'string' ? new RegExp(`^${escapeRe(matcher)}$`) : matcher;
  const deleteRe = new RegExp(`^Eliminar definitivamente .*${titleRe.source.replace(/^\^|\$$/g, '')}`);

  await workspace.open();

  for (let i = 0; i < 20; i++) {
    const link = page.getByRole('link', { name: titleRe }).first();
    if (!(await link.count())) break;
    await link.click();
    await page.waitForURL(/\/p\//);
    await workspace.editor.waitForLoaded();
    await workspace.editor.archive();
    await workspace.open(); // fresh sidebar: it may still list the page we just archived
  }

  await workspace.openTrash();
  for (let i = 0; i < 50; i++) {
    const matching = page.getByRole('button', { name: deleteRe });
    const before = await matching.count();
    if (!before) break;
    await matching.first().click();
    await workspace.trash.confirmDialog.getByRole('button', { name: 'Eliminar definitivamente' }).click();
    await workspace.trash.confirmDialog.waitFor({ state: 'hidden' });
    // wait for one entry to leave the list before looking for the next (the list re-renders; titles may repeat)
    await expect(matching).toHaveCount(before - 1);
  }
  await expect(page.getByRole('button', { name: deleteRe })).toHaveCount(0);
}
