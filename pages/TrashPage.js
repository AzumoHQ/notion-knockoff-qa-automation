import { BasePage } from './BasePage.js';

export class TrashPage extends BasePage {
  constructor(page, writes) {
    super(page);
    this.writes = writes;
    this.heading = page.getByRole('heading', { name: 'Papelera' });
    this.empty = page.getByText('La papelera está vacía');
    this.confirmDialog = page.getByRole('alertdialog');
  }

  /** Loaded = either the empty message or at least one entry is on screen. */
  async waitForLoaded() {
    await this.heading.waitFor({ state: 'visible' });
    await this.empty.or(this.page.getByRole('button', { name: /^Restaurar / }).first()).waitFor();
  }

  /** A trash entry is identified by its restore button (the title text also shows in the sidebar once restored). */
  item(title) {
    return this.restoreButton(title);
  }

  restoreButton(title) {
    return this.page.getByRole('button', { name: `Restaurar ${title}` });
  }

  deleteButton(title) {
    return this.page.getByRole('button', { name: `Eliminar definitivamente ${title}` });
  }

  async restore(title) {
    await this.restoreButton(title).click();
    await this.writes.settled(500);
  }

  async deletePermanently(title) {
    await this.deleteButton(title).click();
    await this.confirmDialog.getByRole('button', { name: 'Eliminar definitivamente' }).click();
    await this.confirmDialog.waitFor({ state: 'hidden' });
    await this.writes.settled(500);
  }
}
