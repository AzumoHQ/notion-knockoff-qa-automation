import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { CONFIG_FILE, readConfig, requiredSecrets, requiredVariables } from './config.js';

const exists = (root, rel) => fs.existsSync(path.join(root, rel));

function secretsReferenced(text) {
  return [...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]).filter((n) => n !== 'GITHUB_TOKEN');
}

function workflowRunLines(doc) {
  const lines = [];
  for (const job of Object.values(doc.jobs ?? {})) {
    for (const step of job.steps ?? []) if (step.run) lines.push(...String(step.run).split('\n'));
  }
  return lines;
}

/** Static consistency checks between config, package.json, env example and workflows. Returns issues. */
export function runDoctor(root = process.cwd()) {
  const issues = [];
  const add = (level, message) => issues.push({ level, message });

  let config;
  try {
    config = readConfig(root);
  } catch (error) {
    return [{ level: 'error', message: error.message }];
  }

  const version = fs.readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
  if (config.frameworkVersion !== version) {
    add('warn', `${CONFIG_FILE} says framework ${config.frameworkVersion}, framework/ is ${version}: run \`npm run framework:upgrade\``);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const playwright = declared['@playwright/test'];
  if (!playwright) add('error', 'package.json does not depend on @playwright/test');
  else if (!/^\d+\.\d+\.\d+$/.test(playwright)) add('error', `@playwright/test must be pinned to an exact version, found "${playwright}"`);
  for (const dep of ['allure-playwright', 'allure-js-commons', 'allure-commandline', 'dotenv', 'yaml']) {
    if (!declared[dep]) add('error', `package.json is missing ${dep}`);
  }
  if (!exists(root, 'package-lock.json')) add('error', 'package-lock.json is missing: run `npm install` and commit it');
  else if (playwright) {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const locked = lock.packages?.['node_modules/@playwright/test']?.version;
    if (locked !== playwright) add('error', `package-lock.json has @playwright/test ${locked}, package.json pins ${playwright}`);
  }

  const profilesFile = path.join(root, 'auth/environment-profile.js');
  if (!fs.existsSync(profilesFile)) add('error', 'auth/environment-profile.js is missing');
  const example = exists(root, '.env.example') ? fs.readFileSync(path.join(root, '.env.example'), 'utf8') : '';
  const secrets = requiredSecrets(config);
  for (const name of secrets) {
    if (!new RegExp(`^${name}=`, 'm').test(example)) add('error', `.env.example does not list ${name}`);
  }

  const workflowDir = path.join(root, '.github/workflows');
  const allowed = new Set(secrets);
  const allowedVars = new Set([...requiredVariables(config), 'TCM_BASE_URL']);
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  for (const file of fs.existsSync(workflowDir) ? fs.readdirSync(workflowDir) : []) {
    if (!/\.ya?ml$/.test(file)) continue;
    const text = fs.readFileSync(path.join(workflowDir, file), 'utf8');
    let doc;
    try {
      doc = parse(text);
    } catch (error) {
      add('error', `${file}: invalid YAML (${error.message.split('\n')[0]})`);
      continue;
    }
    for (const name of secretsReferenced(text)) {
      if (!allowed.has(name)) add('error', `${file}: uses secrets.${name}, which init never sets (known: ${[...allowed].join(', ')})`);
    }
    for (const name of [...text.matchAll(/vars\.([A-Z0-9_]+)/g)].map((m) => m[1])) {
      if (!allowedVars.has(name)) add('error', `${file}: uses vars.${name}, which init never sets (known: ${[...allowedVars].join(', ')})`);
    }
    if (/playwright\/mcp/.test(text)) add('error', `${file}: starts a Playwright MCP server that no test uses`);
    for (const line of workflowRunLines(doc)) {
      const npmRun = line.match(/npm run ([\w:-]+)/);
      if (npmRun && !scripts.has(npmRun[1])) add('error', `${file}: \`npm run ${npmRun[1]}\` is not a script in package.json`);
      for (const m of line.matchAll(/(?:node|bash|sh)\s+(\.\/)?([\w./-]+\.(?:mjs|js|sh))/g)) {
        if (!exists(root, m[2])) add('error', `${file}: references ${m[2]}, which does not exist`);
      }
    }
  }

  const ignore = exists(root, '.gitignore') ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n') : [];
  for (const entry of ['.env', 'auth/*.storageState.json']) {
    if (!ignore.includes(entry)) add('error', `.gitignore does not ignore ${entry}`);
  }
  return issues;
}
