import fs from 'node:fs';
import path from 'node:path';
import { roleEnvKeys, bypassHeaders } from './env.js';

/**
 * Generic username/password login: the first visible non-password input gets the user, the password input
 * gets the password, and the first non-Google button submits. Success = the password field goes away.
 * Apps whose login differs override `loginAndSave` in their own `auth/global-setup.js`.
 */
export async function genericLogin(page, url, username, password, { timeout = 30_000 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout });
  await page
    .locator('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):visible')
    .first()
    .fill(username);
  await passwordInput.fill(password);
  await page
    .locator('button[type="submit"], button:visible')
    .filter({ hasNotText: /google|github|microsoft|apple/i })
    .first()
    .click();
  await page.locator('input[type="password"]').waitFor({ state: 'detached', timeout });
}

/**
 * Logs every profile in once and saves its storage state. Profiles with `login: 'manual'` (e.g. Google only)
 * must already have a storage state file; they are never re-created here.
 */
export async function loginProfiles({ browser, profiles, root = process.cwd(), login = genericLogin, env = process.env, loginTimeout }) {
  for (const profile of Object.values(profiles)) {
    const file = path.resolve(root, profile.storageStatePath);
    if (profile.login === 'manual') {
      if (!fs.existsSync(file)) throw new Error(`Profile "${profile.name}" is manual and ${profile.storageStatePath} is missing`);
      continue;
    }
    const keys = roleEnvKeys(profile.credentialsEnvPrefix);
    const username = env[keys.username];
    const password = env[keys.password];
    if (!username || !password) {
      throw new Error(`Profile "${profile.name}": set ${keys.username} and ${keys.password} (in .env or CI secrets)`);
    }
    const context = await browser.newContext({ extraHTTPHeaders: bypassHeaders(env) });
    try {
      await login(await context.newPage(), profile.baseUrl ?? env.BASE_URL, username, password, { timeout: loginTimeout });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await context.storageState({ path: file });
    } catch (error) {
      throw new Error(`Login failed for profile "${profile.name}": ${String(error.message).split('\n')[0]}`);
    } finally {
      await context.close();
    }
  }
}

export const STORAGE_STATE_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Makes sure one profile has a usable storage state: logs in when the file is missing or older than `maxAgeMs`
 * (session tokens expire, so an old file from an earlier day makes `sweep` and `api-discover` fail with 401).
 */
export async function ensureProfileLogin({ browser, profile, root = process.cwd(), env = process.env, login, maxAgeMs = STORAGE_STATE_MAX_AGE_MS, now = Date.now() }) {
  const file = path.resolve(root, profile.storageStatePath);
  if (fs.existsSync(file) && now - fs.statSync(file).mtimeMs < maxAgeMs) return;
  await loginProfiles({ browser, profiles: { [profile.name]: profile }, root, env, login });
}
