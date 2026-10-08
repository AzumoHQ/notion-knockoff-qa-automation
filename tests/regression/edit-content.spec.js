import { test, expect } from '../../fixtures/base.fixture.js';

test.describe('Page content: text, headings, lists @regression', () => {
  test('text, heading and list blocks keep their type, text and order after a reload', async ({ page, workspace, pageFactory }) => {
    await pageFactory.create('content');
    const { editor } = workspace;

    await editor.addBlock('Parrafo de prueba');
    await editor.addBlock('# Encabezado de prueba');
    await editor.addBlock('- primer item');
    await editor.addBlock('segundo item');

    // UI state before reload (the markdown shortcuts must have converted the block types)
    expect(await editor.blockTypes()).toEqual(['Texto', 'Título 1', 'Lista con viñetas', 'Texto']);

    await page.reload();
    await editor.waitForLoaded();

    // Persistence: what the UI showed must be what the backend stored
    await expect(editor.blocks).toHaveCount(4);
    expect(await editor.blockValues()).toEqual(['Parrafo de prueba', 'Encabezado de prueba', 'primer item', 'segundo item']);
    expect(await editor.blockTypes()).toEqual(['Texto', 'Título 1', 'Lista con viñetas', 'Texto']);
  });

  test('editing an existing block replaces its text and the new text persists', async ({ page, workspace, pageFactory }) => {
    await pageFactory.create('edit-block');
    const { editor } = workspace;
    await editor.addBlock('texto original');

    await editor.blocks.first().fill('texto editado');
    await workspace.writes.settled();

    await page.reload();
    await editor.waitForLoaded();

    await expect(editor.blocks).toHaveCount(1);
    await expect(editor.blocks.first()).toHaveValue('texto editado');
    expect(await editor.blockValues()).not.toContain('texto original');
  });

  test('pressing Enter in a block creates a new block below and both persist', async ({ page, workspace, pageFactory }) => {
    await pageFactory.create('enter-key');
    const { editor } = workspace;
    await editor.addBlock('linea uno');

    await editor.blocks.first().press('Enter');
    await expect(editor.blocks).toHaveCount(2);
    await page.keyboard.type('linea dos');
    await workspace.writes.settled();

    await page.reload();
    await editor.waitForLoaded();

    await expect(editor.blocks).toHaveCount(2);
    expect(await editor.blockValues()).toEqual(['linea uno', 'linea dos']);
  });
});
