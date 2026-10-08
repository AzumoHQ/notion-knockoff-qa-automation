import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: false });

const { PROFILES } = await import('./environment-profile.js');
const { bypassHeaders } = await import('../utils/target.js');
const { WorkspacePage } = await import('../pages/WorkspacePage.js');
const { trackWrites } = await import('../utils/network.js');
const { removePages } = await import('../utils/cleanup.js');
const { DataProvisioner } = await import('../data/data-provisioner.js');

// Safety net: sweeps any page left behind by an aborted run (everything carrying the test prefix).
export default async function globalTeardown() {
  const profile = PROFILES.default;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: profile.baseUrl,
      storageState: path.resolve(__dirname, '..', profile.storageStatePath),
      extraHTTPHeaders: bypassHeaders(),
    });
    const page = await context.newPage();
    const workspace = new WorkspacePage(page, trackWrites(page));
    await removePages(workspace, new RegExp(`^${DataProvisioner.prefix()}`));
    await context.close();
  } catch (err) {
    console.warn('[global-teardown] leftover sweep failed:', err.message);
  } finally {
    await browser.close();
  }
}
