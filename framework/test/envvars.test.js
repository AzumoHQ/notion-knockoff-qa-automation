import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { addEnvVar } from '../lib/envvars.js';
import { runDoctor } from '../lib/doctor.js';
import { readConfig, requiredSecrets, requiredVariables } from '../lib/config.js';
import { scaffoldedProject } from './helpers.js';

function project() {
  const made = scaffoldedProject();
  fs.cpSync(path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), 'framework'), path.join(made.root, 'framework'), { recursive: true });
  return made.root;
}

test('a setting the app needs reaches config, .env.example and every workflow, and doctor agrees', async () => {
  const root = project();
  const secret = await addEnvVar({ root, name: 'SUPABASE_ANON_KEY', kind: 'secret' });
  await addEnvVar({ root, name: 'API_BASE_URL', kind: 'variable' });
  assert.ok(secret.updated.includes('.github/workflows/smoke.yml'));
  const config = readConfig(root);
  assert.ok(requiredSecrets(config).includes('SUPABASE_ANON_KEY'));
  assert.ok(requiredVariables(config).includes('API_BASE_URL'));
  for (const file of ['smoke.yml', 'regression.yml', 'api.yml']) {
    const text = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
    assert.match(text, /SUPABASE_ANON_KEY: \$\{\{ secrets\.SUPABASE_ANON_KEY \}\}/);
    assert.match(text, /API_BASE_URL: \$\{\{ vars\.API_BASE_URL \}\}/);
    assert.ok(parse(text).jobs.test);
  }
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(example, /^SUPABASE_ANON_KEY=$/m);
  assert.match(example, /^API_BASE_URL=$/m);
  assert.deepEqual(runDoctor(root).filter((i) => i.level === 'error'), []);
});

test('registering twice does not duplicate, and switching kind moves the setting', async () => {
  const root = project();
  await addEnvVar({ root, name: 'FEATURE_FLAG', kind: 'variable' });
  await addEnvVar({ root, name: 'FEATURE_FLAG', kind: 'variable' });
  assert.deepEqual(readConfig(root).extraEnv.variables, ['FEATURE_FLAG']);
  await addEnvVar({ root, name: 'FEATURE_FLAG', kind: 'secret' });
  assert.deepEqual(readConfig(root).extraEnv, { secrets: ['FEATURE_FLAG'], variables: [] });
  assert.equal((fs.readFileSync(path.join(root, '.env.example'), 'utf8').match(/^FEATURE_FLAG=/gm) ?? []).length, 1);
});

test('bad names, reserved names and a missing kind are refused', async () => {
  const root = project();
  await assert.rejects(addEnvVar({ root, name: 'lower', kind: 'secret' }), /not a valid name/);
  await assert.rejects(addEnvVar({ root, name: 'GITHUB_TOKEN', kind: 'secret' }), /reserved/);
  await assert.rejects(addEnvVar({ root, name: 'ENV', kind: 'variable' }), /reserved/);
  await assert.rejects(addEnvVar({ root, name: 'OK_NAME', kind: '' }), /--secret/);
});

test('a customized workflow is not overwritten when a setting is added', async () => {
  const root = project();
  fs.appendFileSync(path.join(root, '.github/workflows/smoke.yml'), '# ours\n');
  const result = await addEnvVar({ root, name: 'EXTRA_KEY', kind: 'secret' });
  assert.deepEqual(result.kept, ['.github/workflows/smoke.yml'].filter((f) => result.kept.includes(f)));
  assert.match(fs.readFileSync(path.join(root, '.github/workflows/smoke.yml'), 'utf8'), /# ours/);
  assert.match(fs.readFileSync(path.join(root, '.qa-out/upgrade/.github/workflows/smoke.yml'), 'utf8'), /EXTRA_KEY/);
});
