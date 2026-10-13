import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readConfig, writeConfig } from './config.js';
import { applyWorkflows, manifestOf } from './upgrade.js';

const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const RESERVED = /^(GITHUB_|RUNNER_|ACTIONS_|CI$|NODE_|PATH$|HOME$|ENV$)/;

/**
 * Registers a setting the application under test needs (an API key, a backend URL) so that CI receives it:
 * it goes into `.qa-framework.json`, `.env.example` and every generated workflow. The value stays in `.env`
 * and is uploaded to GitHub by `npm run qa -- secrets` (or by `env add` itself when `gh` is available).
 */
export async function addEnvVar({ root = process.cwd(), name, kind }) {
  if (!NAME.test(name)) throw new Error(`"${name}" is not a valid name (use UPPER_SNAKE_CASE)`);
  if (RESERVED.test(name)) throw new Error(`${name} is reserved by GitHub Actions or the framework`);
  if (!['secret', 'variable'].includes(kind)) throw new Error('Choose --secret (keys, tokens) or --variable (URLs and other non-sensitive settings)');
  const config = readConfig(root);
  config.extraEnv ??= { secrets: [], variables: [] };
  const other = kind === 'secret' ? 'variables' : 'secrets';
  const own = kind === 'secret' ? 'secrets' : 'variables';
  config.extraEnv[other] = config.extraEnv[other].filter((n) => n !== name);
  if (!config.extraEnv[own].includes(name)) config.extraEnv[own].push(name);

  const example = path.join(root, '.env.example');
  const text = fs.existsSync(example) ? fs.readFileSync(example, 'utf8') : '';
  if (!new RegExp(`^${name}=`, 'm').test(text)) fs.appendFileSync(example, `${text && !text.endsWith('\n') ? '\n' : ''}${text.includes('added with `npm run qa -- env add`') ? '' : '\n# Needed by the application under test (added with `npm run qa -- env add`)\n'}${name}=\n`);

  const scaffold = await import(pathToFileURL(path.join(root, 'framework/lib/scaffold.js')).href);
  const { updated, kept } = applyWorkflows({ root, config, rendered: scaffold.renderWorkflows(config) });
  config.files = { ...config.files, ...manifestOf(root, updated) };
  for (const rel of kept) delete config.files[rel];
  writeConfig(config, root);
  return { name, kind, updated, kept };
}
