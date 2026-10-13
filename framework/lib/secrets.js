import { spawnSync } from 'node:child_process';
import { requiredSecrets, requiredVariables } from './config.js';

export function haveCommand(cmd) {
  return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
}

export function hasGithubRemote() {
  return spawnSync('git', ['remote', 'get-url', 'origin'], { stdio: 'ignore' }).status === 0;
}

/**
 * Uploads the secrets the workflows need, taking values from `env` (the local .env). Values go through
 * stdin only, so they never reach argv or logs. Returns { set, missing, failed } with names only.
 */
export function syncSecrets(config, env = process.env, { dryRun = false, only } = {}) {
  const result = { set: [], missing: [], failed: [], skipped: null };
  if (!haveCommand('gh') || !hasGithubRemote()) {
    result.skipped = 'gh CLI or git remote "origin" not available';
    return result;
  }
  for (const name of requiredSecrets(config).filter((n) => !only || only.includes(n))) {
    const value = env[name];
    if (!value) {
      result.missing.push(name);
      continue;
    }
    if (dryRun) {
      result.set.push(name);
      continue;
    }
    const r = spawnSync('gh', ['secret', 'set', name], { input: value, stdio: ['pipe', 'ignore', 'pipe'] });
    (r.status === 0 ? result.set : result.failed).push(name);
  }
  return result;
}

/** Same for repository variables (non-secret settings such as LLM_PROVIDER). */
export function syncVariables(config, env = process.env, { only } = {}) {
  const result = { set: [], missing: [], failed: [], skipped: null };
  if (!haveCommand('gh') || !hasGithubRemote()) {
    result.skipped = 'gh CLI or git remote "origin" not available';
    return result;
  }
  for (const name of requiredVariables(config).filter((n) => !only || only.includes(n))) {
    if (!env[name]) {
      result.missing.push(name);
      continue;
    }
    const r = spawnSync('gh', ['variable', 'set', name], { input: env[name], stdio: ['pipe', 'ignore', 'pipe'] });
    (r.status === 0 ? result.set : result.failed).push(name);
  }
  return result;
}
