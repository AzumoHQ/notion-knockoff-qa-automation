import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = '.qa-framework.json';

/** Role name -> env prefix: `default` uses TEST_USER, anything else `<NAME>_USER`. */
export function rolePrefix(name) {
  return name === 'default' ? 'TEST_USER' : `${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_USER`;
}

export function defaultConfig(overrides = {}) {
  return {
    frameworkVersion: fs.readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim(),
    app: { name: '', slug: '', loginType: 'password', vercelProtected: false },
    roles: [{ name: 'default', login: 'password' }],
    options: { api: false, pages: true, visual: false, jira: false, slack: false, llm: null },
    schedule: { smokeCron: '0 10 * * *' },
    // push: smoke on every push to main/master. pullRequest: structure checks without secrets. productDeploy: run after the product repo deploys.
    triggers: { push: true, pullRequest: true, productDeploy: false },
    productRepo: '',
    // Settings the application needs that init does not know (API keys, URLs). Add with `npm run qa -- env add NAME --secret|--variable`.
    extraEnv: { secrets: [], variables: [] },
    retentionDays: 15,
    // 'auto': traces and full reports are uploaded only when the repository is private (artifacts of a public one are readable by any GitHub user).
    // Screenshots cannot be scanned for secrets or personal data: 'auto' publishes them only for private repositories (true/false force it).
    artifacts: { includeTraces: 'auto', screenshots: 'auto' },
    ...overrides,
  };
}

export function readConfig(root = process.cwd()) {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) throw new Error(`${CONFIG_FILE} not found: run \`npm run init\` first`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeConfig(config, root = process.cwd()) {
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n');
}

/** Secrets the generated workflows read, derived from the saved options (never their values). */
export function requiredSecrets(config) {
  const secrets = ['BASE_URL'];
  if (config.app.vercelProtected) secrets.push('VERCEL_AUTOMATION_BYPASS_SECRET');
  for (const role of config.roles) {
    if (role.login === 'manual') continue;
    const prefix = role.prefix ?? rolePrefix(role.name);
    secrets.push(`${prefix}_USERNAME`, `${prefix}_PASSWORD`);
  }
  if (config.options.slack) secrets.push('SLACK_WEBHOOK_URL');
  if (config.options.jira) secrets.push('JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY');
  if (config.options.llm) secrets.push('LLM_API_KEY');
  secrets.push(...(config.extraEnv?.secrets ?? []));
  return secrets;
}

/** Non-secret settings the workflows read from repository variables (`vars.NAME`). */
export function requiredVariables(config) {
  const names = [];
  if (config.options.slack) names.push('SLACK_NOTIFY');
  if (config.options.jira) names.push('JIRA_AUTO_CREATE', 'JIRA_ISSUE_TYPE');
  if (config.options.llm) {
    names.push('LLM_PROVIDER', 'LLM_MODEL');
    if (config.options.llm.provider === 'openai-compatible') names.push('LLM_BASE_URL');
  }
  names.push(...(config.extraEnv?.variables ?? []));
  return names;
}
