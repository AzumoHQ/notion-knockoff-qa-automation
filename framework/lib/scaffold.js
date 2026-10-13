import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE, rolePrefix, requiredSecrets, requiredVariables, writeConfig } from './config.js';
import { manifestOf } from './upgrade.js';

const frameworkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PINNED = {
  '@playwright/test': '1.64.0',
  'allure-playwright': '3.13.0',
  'allure-js-commons': '3.13.0',
  'allure-commandline': '2.46.1',
  dotenv: '18.0.7',
  yaml: '2.9.1',
};

const GITIGNORE = [
  '.env',
  '.env.*',
  '!.env.example',
  'auth/*.storageState.json',
  'test-results/',
  'playwright-report/',
  'allure-results/',
  'allure-report/',
  '.qa-out/',
  'qa-publish/',
  'qa-incoming/',
  '.DS_Store',
  'node_modules/',
];

function copy(from, to, root) {
  const dest = path.join(root, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(frameworkDir, 'templates', from), dest);
  return to;
}

function write(rel, content, root) {
  const dest = path.join(root, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  return rel;
}

export function renderProfiles(config) {
  const entries = config.roles
    .map((role) => {
      const prefix = role.prefix ?? rolePrefix(role.name);
      const login = role.login === 'manual' ? "\n    login: 'manual'," : '';
      return `  ${JSON.stringify(role.name).replaceAll('"', "'")}: {
    name: '${role.name}',
    baseUrl: process.env.BASE_URL,
    credentialsEnvPrefix: '${prefix}',
    storageStatePath: 'auth/${role.name}.storageState.json',${login}
  },`;
    })
    .join('\n');
  return `// One entry per role. global-setup logs in once per profile and saves its storage state.
// credentialsEnvPrefix 'X_USER' reads X_USER_USERNAME and X_USER_PASSWORD.
export const PROFILES = {
${entries}
};

/** Use another role in a spec: test.use(useEnvironment('<name>')) */
export function useEnvironment(profileName) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(\`Unknown environment profile: "\${profileName}". Add it to PROFILES in auth/environment-profile.js\`);
  return { baseURL: profile.baseUrl, storageState: profile.storageStatePath };
}
`;
}

export function renderEnvExample(config) {
  const lines = ['# Local configuration. Copy to `.env` (git-ignored) and fill in. Never commit real values.', '', 'BASE_URL=', 'ENV=local'];
  if (config.app.vercelProtected) lines.push('', '# Vercel Deployment Protection bypass', 'VERCEL_AUTOMATION_BYPASS_SECRET=');
  for (const role of config.roles) {
    if (role.login === 'manual') continue;
    const prefix = role.prefix ?? rolePrefix(role.name);
    lines.push('', `# Role: ${role.name}`, `${prefix}_USERNAME=`, `${prefix}_PASSWORD=`);
  }
  if (config.options.slack) lines.push('', '# Slack (optional). SLACK_NOTIFY: failures | always', 'SLACK_WEBHOOK_URL=', 'SLACK_NOTIFY=failures');
  if (config.options.jira) {
    lines.push('', '# Jira (optional). JIRA_AUTO_CREATE=true lets CI create issues for product failures; false only reports them', 'JIRA_BASE_URL=', 'JIRA_EMAIL=', 'JIRA_API_TOKEN=', 'JIRA_PROJECT_KEY=', 'JIRA_ISSUE_TYPE=Bug', 'JIRA_AUTO_CREATE=false');
  }
  if (config.options.llm) {
    lines.push('', '# LLM (optional; the framework works without it). Page element names are sent to this provider.', 'LLM_PROVIDER=', 'LLM_MODEL=', 'LLM_API_KEY=');
    if (config.options.llm.provider === 'openai-compatible') lines.push('LLM_BASE_URL=');
  }
  const extra = [...(config.extraEnv?.secrets ?? []), ...(config.extraEnv?.variables ?? [])];
  if (extra.length) lines.push('', '# Needed by the application under test (added with `npm run qa -- env add`)', ...extra.map((n) => `${n}=`));
  return lines.join('\n') + '\n';
}

/** `env:` lines for a workflow step: every secret and repository variable the enabled options need. */
export function secretEnvBlock(config, indent = '          ') {
  return [...requiredSecrets(config).map((name) => `${indent}${name}: \${{ secrets.${name} }}`), ...requiredVariables(config).map((name) => `${indent}${name}: \${{ vars.${name} }}`)].join('\n');
}

export function renderPlaywrightConfig(config) {
  const template = fs.readFileSync(path.join(frameworkDir, 'templates', 'playwright.config.js'), 'utf8');
  const visual = config.options.visual
    ? `// Visual checks are tagged @visual and run only with VISUAL=1 (see .github/workflows/visual.yml).
// Baselines live next to the tests, one per platform (-linux, -darwin): only the Linux ones come from CI.
const visualExpect = { toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled' } };
const visualOptions = {
  grepInvert: process.env.VISUAL ? undefined : /@visual/,
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}-{platform}{ext}',
};`
    : 'const visualExpect = {};\nconst visualOptions = {};';
  return template.replace(/\/\/ \{\{VISUAL_BEGIN\}\}[\s\S]*?\/\/ \{\{VISUAL_END\}\}/, visual);
}

export function renderFixtures(config) {
  const template = fs.readFileSync(path.join(frameworkDir, 'templates', 'fixtures.base.fixture.js'), 'utf8');
  const api = config.options.api;
  return template
    .replace('// {{API_IMPORT}}\n', api ? "import { apiFixtures } from '../framework/playwright/api-fixtures.js';\nimport apiConfig from '../api/api.config.js';\n" : '')
    .replace('  // {{API_FIXTURES}}\n', api ? '  ...apiFixtures(apiConfig, PROFILES),\n' : '');
}

function renderWorkflow(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Unknown workflow placeholder {{${key}}}`);
    return values[key];
  });
}

export function renderWorkflows(config) {
  const template = fs.readFileSync(path.join(frameworkDir, 'workflows', 'suite.yml'), 'utf8');
  const secrets = secretEnvBlock(config);
  const [minute, hour] = config.schedule.smokeCron.split(' ');
  const triggers = config.triggers ?? { push: true, pullRequest: true, productDeploy: false };
  const dispatch = (what) => `  workflow_dispatch:
    inputs:
      test_grep:
        description: 'Blank = all ${what} tests | One: TC0001 | Several: TC0001|TC0002 | Partial title'
        required: false
        default: ''${triggers.productDeploy ? `
      changed_paths:
        description: 'Changed product files (comma separated), to select tests by risk. Blank = everything'
        required: false
        default: ''` : ''}`;
  const productEvent = triggers.productDeploy ? '\n  repository_dispatch:\n    types: [product-deployed]' : '';
  const select = triggers.productDeploy ? `      - name: Select tests by risk
        id: select
        run: npm run qa -- select --suite DIR
        env:
          QA_CHANGED_PATHS: \${{ github.event.client_payload.changed_paths && join(github.event.client_payload.changed_paths, ',') || github.event.inputs.changed_paths }}
` : '';
  const grepExpr = triggers.productDeploy ? '${{ github.event.inputs.test_grep || steps.select.outputs.grep }}' : '${{ github.event.inputs.test_grep }}';
  const withSecrets = (title, command) => `      - name: ${title}\n        continue-on-error: true\n        run: ${command}\n        env:\n          ENV: ci\n${secrets}\n`;
  const diagnose = `      - name: Diagnose failures
        if: always() && hashFiles('playwright-report/results.json') != ''
        run: npm run qa -- diagnose
`;
  const heal = `      - name: Suggest selector fixes (suggestions only)
        if: steps.run.outcome == 'failure'
        continue-on-error: true
        run: npm run qa -- heal --verify
        env:
          ENV: ci
${secrets}
`;
  const notify = config.options.slack || config.options.jira ? `      - name: Notify
        if: always() && hashFiles('qa-publish/meta.json') != ''
        continue-on-error: true
        run: npm run qa -- notify
        env:
          ENV: ci
${secrets}
` : '';
  const sweep = config.options.api ? withSecrets('Remove QA data left by interrupted runs', 'npm run qa -- sweep --older-than 2h') : '';
  const traces = config.artifacts?.includeTraces ?? 'auto';
  const rawIf = traces === true ? 'true' : traces === false ? 'false' : 'github.event.repository.private == true';
  const shots = config.artifacts?.screenshots ?? 'auto';
  const screenshots = shots === true ? "'true'" : shots === false ? "'false'" : '${{ github.event.repository.private }}';
  const base = { SCREENSHOTS: screenshots, RETENTION: String(config.retentionDays), SECRET_ENV: secrets, SWEEP: sweep, NOTIFY: notify, RAW_IF: rawIf, GREP_EXPR: grepExpr };
  const suite = (file, values) => [file, renderWorkflow(template, { ...base, ...values })];
  const files = Object.fromEntries([
    suite('.github/workflows/smoke.yml', { NAME: 'Smoke Tests', SUITE: 'smoke', PROJECT: 'chromium', DIR: 'tests/smoke-tests', TIMEOUT: '30', CONCURRENCY: 'smoke-${{ github.ref }}', AFTER_RUN: diagnose + heal, SELECT: select.replace('DIR', 'tests/smoke-tests'), TRIGGERS: `${triggers.push ? '  push:\n    branches: [main, master]\n    paths-ignore: [\'docs/**\', \'**.md\']\n' : ''}  schedule:\n    - cron: '${minute} ${hour} * * *'  # UTC\n${dispatch('smoke')}${productEvent}` }),
    suite('.github/workflows/regression.yml', { NAME: 'Regression Tests', SUITE: 'regression', PROJECT: 'chromium', DIR: 'tests/regression', TIMEOUT: '60', CONCURRENCY: 'regression-${{ github.ref }}', AFTER_RUN: diagnose + heal, SELECT: select.replace('DIR', 'tests/regression'), TRIGGERS: `${dispatch('regression')}${productEvent}` }),
  ]);
  const names = ['Smoke Tests', 'Regression Tests'];
  if (config.options.api) {
    Object.assign(files, Object.fromEntries([suite('.github/workflows/api.yml', { NAME: 'API Tests', SUITE: 'api', PROJECT: 'api', DIR: 'tests/api', TIMEOUT: '30', CONCURRENCY: 'api-${{ github.ref }}', AFTER_RUN: diagnose, SELECT: '', TRIGGERS: dispatch('API') })]));
    names.push('API Tests');
  }
  if (triggers.pullRequest) files['.github/workflows/checks.yml'] = fs.readFileSync(path.join(frameworkDir, 'workflows', 'checks.yml'), 'utf8');
  if (config.options.visual) files['.github/workflows/visual.yml'] = renderWorkflow(fs.readFileSync(path.join(frameworkDir, 'workflows', 'visual.yml'), 'utf8'), { SECRET_ENV: secrets, RAW_IF: rawIf, RETENTION: String(config.retentionDays) });
  if (config.options.pages !== false) {
    const pages = fs.readFileSync(path.join(frameworkDir, 'workflows', 'pages.yml'), 'utf8');
    files['.github/workflows/pages.yml'] = renderWorkflow(pages, { WORKFLOW_NAMES: names.map((n) => `'${n}'`).join(', '), RETENTION: String(config.retentionDays) });
  }
  return files;
}

function renderDeployDoc(config) {
  const doc = fs.readFileSync(path.join(frameworkDir, 'templates', 'product-deploy-trigger.md'), 'utf8');
  return doc.replace('{{PRODUCT_REPO}}', config.productRepo ? ` (\`${config.productRepo}\`)` : '');
}

/** Brings pinned dependencies and framework scripts of package.json up to date; returns what changed. */
export function syncPackageJson(config, root, { identity = false } = {}) {
  const file = path.join(root, 'package.json');
  const pkg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const before = { ...pkg.dependencies, ...pkg.devDependencies };
  if (identity) {
    pkg.name = config.app.slug || pkg.name;
    pkg.description = `Playwright E2E automation for ${config.app.name || 'the application under test'}.`;
  }
  pkg.type = 'module';
  pkg.engines = { node: '>=20' };
  pkg.scripts = {
    ...pkg.scripts,
    setup: 'npm install && npx playwright install --with-deps',
    test: 'npx playwright test --project=chromium',
    'test:smoke': 'npx playwright test --project=chromium tests/smoke-tests',
    'test:regression': 'npx playwright test --project=chromium tests/regression',
    'test:api': 'npx playwright test --project=api',
    'test:framework': 'node --test framework/test/*.test.js',
    'report:allure': 'allure generate allure-results --clean -o allure-report',
    'report:open': 'allure open allure-report',
    qa: 'node framework/bin/qa.mjs',
    ...(config.options.api && { 'api:discover': 'node framework/bin/qa.mjs api-discover', 'api:coverage': 'node framework/bin/qa.mjs api-coverage', sweep: 'node framework/bin/qa.mjs sweep' }),
    doctor: 'node framework/bin/qa.mjs doctor',
    catalog: 'node framework/bin/qa.mjs catalog --check',
  };
  pkg.dependencies = { ...pkg.dependencies, '@playwright/test': PINNED['@playwright/test'] };
  pkg.devDependencies = {
    ...pkg.devDependencies,
    ...Object.fromEntries(Object.entries(PINNED).filter(([name]) => name !== '@playwright/test')),
  };
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  const after = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.keys(after).filter((name) => before[name] !== after[name]).map((name) => `${name}: ${before[name] ?? '(new)'} -> ${after[name]}`);
}

function mergeGitignore(root) {
  const file = path.join(root, '.gitignore');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const have = new Set(current.split('\n'));
  const missing = GITIGNORE.filter((line) => !have.has(line));
  if (missing.length) fs.appendFileSync(file, `${current.endsWith('\n') || !current ? '' : '\n'}# Added by the framework\n${missing.join('\n')}\n`);
}

/** Writes everything that does not depend on exploring the application. Idempotent. */
export function scaffold({ root = process.cwd(), config }) {
  const written = [];
  for (const dir of ['pages', 'fixtures', 'auth', 'utils', 'data', 'docs', 'tests/smoke-tests', 'tests/regression']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  if (config.options.api) fs.mkdirSync(path.join(root, 'tests/api'), { recursive: true });
  written.push(copy('BasePage.js', 'pages/BasePage.js', root));
  written.push(copy('helpers.js', 'utils/helpers.js', root));
  written.push(copy('global-setup.js', 'auth/global-setup.js', root));
  written.push(write('playwright.config.js', renderPlaywrightConfig(config), root));
  if (config.options.visual) written.push(copy('visual.js', 'utils/visual.js', root));
  const hasPasswordLogin = config.roles.some((role) => role.login !== 'manual');
  const authSpec = path.join(root, 'tests/smoke-tests/auth.spec.js');
  if (hasPasswordLogin && !fs.existsSync(authSpec)) {
    written.push(copy('auth.spec.js', 'tests/smoke-tests/auth.spec.js', root));
    written.push(copy('authentication.cases.yml', 'test-cases/authentication.yml', root));
  }
  const fixtures = path.join(root, 'fixtures/base.fixture.js');
  if (!fs.existsSync(fixtures)) written.push(write('fixtures/base.fixture.js', renderFixtures(config), root));
  if (config.options.api) {
    if (!fs.existsSync(path.join(root, 'api/api.config.js'))) written.push(copy('api.config.js', 'api/api.config.js', root));
    if (!fs.existsSync(path.join(root, 'fixtures/api.fixture.js'))) written.push(copy('api.fixture.js', 'fixtures/api.fixture.js', root));
    if (!fs.existsSync(path.join(root, 'api/discover.flows.js'))) written.push(copy('discover.flows.js', 'api/discover.flows.js', root));
  }
  written.push(write('auth/environment-profile.js', renderProfiles(config), root));
  written.push(write('.env.example', renderEnvExample(config), root));
  for (const [rel, content] of Object.entries(renderWorkflows(config))) written.push(write(rel, content, root));
  const templateCi = path.join(root, '.github/workflows/template-ci.yml');
  if (fs.existsSync(templateCi)) fs.rmSync(templateCi);
  if (config.triggers?.productDeploy) {
    if (!fs.existsSync(path.join(root, 'risk.map.json'))) written.push(write('risk.map.json', JSON.stringify({ rules: [], alwaysRun: [], ignore: ['docs/**', '**/*.md'] }, null, 2) + '\n', root));
    written.push(write('docs/product-deploy-trigger.md', renderDeployDoc(config), root));
  }
  syncPackageJson(config, root, { identity: true });
  mergeGitignore(root);
  config.files = manifestOf(root, Object.keys(renderWorkflows(config)));
  writeConfig(config, root);
  written.push('package.json', '.gitignore', CONFIG_FILE);
  return written;
}
