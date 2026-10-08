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

  /**
   * Archives the open page. After a successful archive the app either navigates away from the page
   * URL or stays on it showing the "Esta página está archivada" panel — both count as success.
   * The confirm dialog can re-mount while that happens (the click may even report a failure although
   * the archive went through), so each retry first checks whether the page is already archived.
   */
  async archive() {
    const pageUrl = this.page.url();
    const archivedPanel = this.page.getByText('Esta página está archivada');
    const isArchived = async () => this.page.url() !== pageUrl || (await archivedPanel.isVisible());

    await expect(async () => {
      if (await isArchived()) return;
      if (!(await this.confirmDialog.isVisible())) await this.archiveButton.click({ timeout: 3_000 });
      await this.confirmDialog.getByRole('button', { name: 'Archivar', exact: true }).click({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
    await expect.poll(isArchived, { message: 'page was not archived', timeout: 20_000 }).toBe(true);
    await this.writes.settled(500);
  }
}
