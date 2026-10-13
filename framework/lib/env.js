import dotenv from 'dotenv';
import path from 'node:path';

/** Loads `.env.<ENV>` then `.env` without overriding variables that are already set (CI secrets win). */
export function loadEnv(root = process.cwd()) {
  const env = process.env.ENV ?? 'local';
  dotenv.config({ path: path.join(root, `.env.${env}`), override: false, quiet: true });
  dotenv.config({ path: path.join(root, '.env'), override: false, quiet: true });
}

/** Env var names for a role: prefix `VIEWER_USER` -> VIEWER_USER_USERNAME / VIEWER_USER_PASSWORD. */
export function roleEnvKeys(prefix) {
  return { username: `${prefix}_USERNAME`, password: `${prefix}_PASSWORD` };
}

/** Header that lets automation through Vercel Deployment Protection; empty when no bypass secret is set. */
export function bypassHeaders(env = process.env) {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret
    ? { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' }
    : {};
}

/**
 * Where the TCM page lives, used to link Allure results to their case. Explicit TCM_BASE_URL wins; on GitHub
 * Actions it is derived from the repository (project pages: https://<owner>.github.io/<repo>/tcm/).
 */
export function tcmBaseUrl(env = process.env) {
  if (env.TCM_BASE_URL) return env.TCM_BASE_URL.replace(/\/?$/, '/');
  if (!env.GITHUB_REPOSITORY) return '';
  const [owner, repo] = env.GITHUB_REPOSITORY.split('/');
  return `https://${owner.toLowerCase()}.github.io/${repo}/tcm/`;
}

/** Options for the allure-playwright reporter. Case links are added per test by the `_caseLink` fixture. */
export function allureOptions() {
  return { resultsDir: 'allure-results' };
}
