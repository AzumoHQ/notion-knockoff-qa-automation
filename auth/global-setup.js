import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', `.env.${process.env.ENV ?? 'local'}`), override: false });
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: false });

const { PROFILES } = await import('./environment-profile.js');
const { bypassHeaders } = await import('../utils/target.js');

async function loginAndSave(page, url, username, password, storageStatePath) {
  await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
  // SPA: wait for hydration (login form visible) before interacting
  await page.getByPlaceholder('Usuario').fill(username);
  await page.getByPlaceholder('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL(/\/w\//, { timeout: 30_000 });
  await page.context().storageState({ path: storageStatePath });
}

// Add roles in environment-profile.js — no changes needed here
export default async function globalSetup() {
  const browser = await chromium.launch();

  for (const profile of Object.values(PROFILES)) {
    const username = process.env[`${profile.credentialsEnvPrefix}_USERNAME`];
    const password = process.env[`${profile.credentialsEnvPrefix}_PASSWORD`];
    if (!username || !password) {
      throw new Error(`Missing ${profile.credentialsEnvPrefix}_USERNAME / ${profile.credentialsEnvPrefix}_PASSWORD — set them in .env`);
    }
    const ctx = await browser.newContext({ extraHTTPHeaders: bypassHeaders() });
    await loginAndSave(await ctx.newPage(), profile.baseUrl, username, password, path.resolve(__dirname, '..', profile.storageStatePath));
    await ctx.close();
  }

  await browser.close();
}
