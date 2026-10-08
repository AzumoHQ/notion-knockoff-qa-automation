import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

const TITLE_LABEL = 'Título de la página';

export class PageEditor extends BasePage {
  constructor(page, writes) {
    super(page);
    this.writes = writes;
    this.title = page.getByLabel(TITLE_LABEL);
    this.addBlockButton = page.getByRole('button', { name: 'Agregar bloque' });
    this.archiveButton = page.getByRole('button', { name: 'Archivar', exact: true });
    // every textarea except the title is a content block; its aria-label is the block type
    this.blocks = page.locator(`textarea:not([aria-label="${TITLE_LABEL}"])`);
    this.confirmDialog = page.getByRole('alertdialog');
  }

  async waitForLoaded() {
    await this.title.waitFor({ state: 'visible' });
  }

  async setTitle(text) {
    await this.title.fill(text);
    await this.writes.settled();
  }

  /** Appends a block and types `text` (markdown shortcuts like "# " or "- " change the block type). */
  async addBlock(text) {
    const before = await this.blocks.count();
    await this.addBlockButton.click();
    await this.blocks.nth(before).waitFor({ state: 'visible' });
    await this.blocks.nth(before).fill(text);
    await this.writes.settled();
  }

  async blockValues() {
    return this.blocks.evaluateAll((els) => els.map((e) => e.value));
  }

  async blockTypes() {
    return this.blocks.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  }

  /** The confirm dialog can re-mount while sidebar data refreshes, so retry the whole open→confirm sequence. */
  async archive() {
    await expect(async () => {
      if (!/\/p\//.test(this.page.url())) return; // already archived and redirected
      if (!(await this.confirmDialog.isVisible())) await this.archiveButton.click({ timeout: 3_000 });
      await this.confirmDialog.getByRole('button', { name: 'Archivar', exact: true }).click({ timeout: 3_000 });
      await this.confirmDialog.waitFor({ state: 'hidden', timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
    await this.writes.settled(500);
  }
}
