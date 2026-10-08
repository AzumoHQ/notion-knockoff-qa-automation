import { BasePage } from './BasePage.js';
import { PageEditor } from './PageEditor.js';
import { TrashPage } from './TrashPage.js';

export class WorkspacePage extends BasePage {
  constructor(page, writes) {
    super(page);
    this.writes = writes;
    // the sidebar is rendered more than once (desktop + mobile), so always take the first match
    this.newPageButton = page.getByRole('button', { name: 'Nueva página' }).first();
    this.searchButton = page.getByRole('button', { name: /^Buscar/ }).first();
    this.trashLink = page.getByRole('link', { name: 'Papelera' }).first();
    this.logoutButton = page.getByRole('button', { name: 'Cerrar sesión' });
    this.searchDialog = page.getByRole('dialog');
    this.editor = new PageEditor(page, writes);
    this.trash = new TrashPage(page, writes);
  }

  sidebarLink(title) {
    return this.page.getByRole('link', { name: title, exact: true }).first();
  }

  /** Opens the workspace and waits until the sidebar page list has actually been fetched. */
  async open() {
    const pagesLoaded = this.page.waitForResponse(
      (r) => r.request().method() === 'GET' && /\/rest\/v1\/pages\?/.test(r.url()) && r.ok(),
    );
    await this.page.goto('/');
    await this.page.waitForURL(/\/w\//);
    await pagesLoaded;
    await this.newPageButton.waitFor({ state: 'visible' });
  }

  /** Creates an untitled page and returns once the editor is on screen. */
  async createPage() {
    await this.newPageButton.click();
    await this.page.waitForURL(/\/p\//);
    await this.editor.waitForLoaded();
    await this.writes.settled(500);
  }

  async openPage(title) {
    await this.sidebarLink(title).click();
    await this.page.waitForURL(/\/p\//);
    await this.editor.waitForLoaded();
  }

  async openTrash() {
    await this.trashLink.click();
    await this.trash.waitForLoaded();
  }

  async search(text) {
    await this.searchButton.click();
    await this.searchDialog.getByPlaceholder('Buscar por título o contenido…').fill(text);
  }

  searchResult(title) {
    return this.searchDialog.getByText(title, { exact: true });
  }
}
