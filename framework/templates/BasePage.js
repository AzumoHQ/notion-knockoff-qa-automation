/**
 * BasePage: shared foundation for page objects.
 * Locators belong in the page object (role, label or test id first); specs hold the assertions.
 */
export class BasePage {
  constructor(page) {
    this.page = page;
  }

  async navigate(path = '') {
    await this.page.goto(path, { waitUntil: 'commit' });
  }

  async waitForPageReady() {
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Prefer test ids and roles: they survive visual refactors. */
  getByTestId(testId) {
    return this.page.getByTestId(testId);
  }

  async takeScreenshot(name) {
    await this.page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  }
}
