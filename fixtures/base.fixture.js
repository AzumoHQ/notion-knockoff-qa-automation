import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import { WorkspacePage } from '../pages/WorkspacePage.js';
import { PROFILES, useEnvironment } from '../auth/environment-profile.js';
import { DataProvisioner } from '../data/data-provisioner.js';
import { trackWrites } from '../utils/network.js';
import { removePages } from '../utils/cleanup.js';
// add one import + fixture per new Page Object

export const test = base.extend({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  environmentProfile: async ({}, use) => {
    await use(PROFILES.default);
  },

  writes: async ({ page }, use) => {
    await use(trackWrites(page));
  },

  workspace: async ({ page, writes }, use) => {
    await use(new WorkspacePage(page, writes));
  },

  /**
   * Creates uniquely-titled pages through the UI and guarantees they are deleted afterwards
   * (archive + delete permanently), even when the test fails. Runs against production.
   *   const title = await pageFactory.create('rename');
   */
  pageFactory: async ({ browser, workspace, baseURL }, use, testInfo) => {
    const created = [];
    await use({
      /** Opens the workspace, creates a page and gives it a unique title. Leaves the editor open. */
      async create(label = 'page') {
        const title = DataProvisioner.pageTitle(label);
        created.push(title);
        await workspace.open();
        await workspace.createPage();
        await workspace.editor.setTitle(title);
        return title;
      },
      /** Registers a title created some other way (e.g. renamed inside a test) for cleanup. */
      track(title) {
        created.push(title);
      },
    });

    // Cleanup in a fresh page so a failed/closed test page cannot block it.
    if (!created.length) return;
    const context = await browser.newContext({
      baseURL,
      storageState: testInfo.project.use.storageState,
      extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
    });
    try {
      const page = await context.newPage();
      const cleaner = new WorkspacePage(page, trackWrites(page));
      for (const title of created) await removePages(cleaner, title);
    } finally {
      await context.close();
    }
  },
});

export { expect, useEnvironment };
