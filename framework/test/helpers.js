import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../lib/config.js';
import { scaffold } from '../lib/scaffold.js';

export function tempDir(prefix = 'qa-fw-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function sampleConfig(extra = {}) {
  const config = defaultConfig({
    app: { name: 'Demo App', slug: 'demo-app', loginType: 'password', vercelProtected: true },
    roles: [
      { name: 'default', login: 'password' },
      { name: 'viewer', login: 'password' },
    ],
  });
  Object.assign(config.options, { api: true, slack: true, jira: true }, extra);
  return config;
}

/** A scaffolded project with a lockfile that matches package.json, as `npm install` would leave it. */
export function scaffoldedProject(config = sampleConfig()) {
  const root = tempDir();
  scaffold({ root, config });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify({ packages: { 'node_modules/@playwright/test': { version: pkg.dependencies['@playwright/test'] } } }),
  );
  return { root, config };
}
