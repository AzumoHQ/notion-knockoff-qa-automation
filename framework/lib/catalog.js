import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { CASE_ID, nextId } from './ids.js';
import { collectTests } from './collect.js';

export const DEFINITIONS_DIR = 'test-cases';
const TYPES = ['ui', 'api'];
const PRIORITIES = ['high', 'medium', 'low'];
const AUTOMATION = ['automated', 'manual', 'planned'];

/** Reads every `test-cases/*.yml`; file-level `area`/`feature` are defaults for its cases. */
export function readDefinitions(root = process.cwd()) {
  const dir = path.join(root, DEFINITIONS_DIR);
  const cases = [];
  const problems = [];
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!/\.ya?ml$/.test(file)) continue;
    let doc;
    try {
      doc = parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (error) {
      problems.push({ level: 'error', file, message: `invalid YAML: ${error.message.split('\n')[0]}` });
      continue;
    }
    for (const c of doc?.cases ?? []) {
      cases.push({
        area: doc.area,
        feature: doc.feature,
        type: 'ui',
        automation: 'automated',
        draft: false,
        tags: [],
        preconditions: [],
        steps: [],
        expected: [],
        ...c,
        definedIn: `${DEFINITIONS_DIR}/${file}`,
      });
    }
  }
  return { cases, problems };
}

const list = (value) => (Array.isArray(value) ? value : []);

function validateDefinition(c, add) {
  const where = c.id ?? '(no id)';
  if (!CASE_ID.test(c.id ?? '')) add('error', c.definedIn, `${where}: id must look like TC0001`);
  if (!c.title) add('error', c.definedIn, `${where}: title is required`);
  if (!c.area) add('error', c.definedIn, `${where}: area is required (case or file level)`);
  if (!c.feature) add('error', c.definedIn, `${where}: feature is required (case or file level)`);
  if (!TYPES.includes(c.type)) add('error', c.definedIn, `${where}: type must be one of ${TYPES.join(', ')}`);
  if (!PRIORITIES.includes(c.priority)) add('error', c.definedIn, `${where}: priority must be one of ${PRIORITIES.join(', ')}`);
  if (!AUTOMATION.includes(c.automation)) add('error', c.definedIn, `${where}: automation must be one of ${AUTOMATION.join(', ')}`);
  if (c.draft) {
    add('warn', c.definedIn, `${where}: draft, steps and expected results still need to be written`);
  } else {
    if (!list(c.steps).length) add('error', c.definedIn, `${where}: steps are required (write them, or mark the case draft: true)`);
    if (!list(c.expected).length) add('error', c.definedIn, `${where}: expected results are required (or draft: true)`);
  }
}

/**
 * Merges the written definitions with the tests Playwright collects and validates both directions.
 * Returns { catalog, issues }. `collected` is injectable for tests.
 */
export function buildCatalog({ root = process.cwd(), collected, now = new Date(), version = '' } = {}) {
  const { cases: definitions, problems } = readDefinitions(root);
  const issues = [...problems];
  const add = (level, file, message) => issues.push({ level, file, message });
  const tests = collected ?? collectTests({ root });

  const byId = new Map();
  for (const c of definitions) {
    validateDefinition(c, add);
    if (byId.has(c.id)) add('error', c.definedIn, `${c.id}: defined twice (also in ${byId.get(c.id).definedIn})`);
    else byId.set(c.id, c);
  }

  const testsById = new Map();
  for (const t of tests) {
    if (!t.id) {
      add('error', t.file, `test without a case ID in its title: "${t.title}" (start titles with TC0001)`);
      continue;
    }
    if (!testsById.has(t.id)) testsById.set(t.id, []);
    testsById.get(t.id).push(t);
  }

  for (const [id, found] of testsById) {
    const def = byId.get(id);
    const files = new Set(found.map((t) => t.file));
    if (files.size > 1) add('error', [...files].join(', '), `${id}: used by tests in several files (${[...files].join(', ')}); one ID belongs to one spec`);
    if (!def) {
      add('error', found[0].file, `${id}: test has no definition in ${DEFINITIONS_DIR}/ (run \`npm run qa catalog -- --stub\`)`);
      continue;
    }
    if (def.automation === 'manual') add('error', found[0].file, `${id}: marked manual but has an automated test`);
    if (def.spec && !files.has(def.spec)) add('error', def.definedIn, `${id}: spec is ${def.spec} but the test lives in ${[...files].join(', ')}`);
    const isApi = found.every((t) => t.project === 'api');
    if (def.type === 'api' && !isApi) add('error', def.definedIn, `${id}: type api but it runs in the ${found.map((t) => t.project).join(', ')} project`);
    if (def.type === 'ui' && found.some((t) => t.project === 'api')) add('error', def.definedIn, `${id}: type ui but it runs in the api project`);
  }
  for (const c of definitions) {
    if (c.spec && !fs.existsSync(path.join(root, c.spec))) add('error', c.definedIn, `${c.id}: spec file ${c.spec} does not exist`);
    if (c.automation === 'automated' && !testsById.has(c.id)) add('error', c.definedIn, `${c.id}: automated but no test carries this ID`);
  }

  const cases = [...byId.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => {
      const found = testsById.get(c.id) ?? [];
      return {
        id: c.id,
        title: c.title,
        area: c.area,
        feature: c.feature,
        type: c.type,
        priority: c.priority,
        automation: c.automation,
        draft: Boolean(c.draft),
        tags: list(c.tags),
        defect: c.defect ?? null,
        preconditions: list(c.preconditions),
        steps: list(c.steps),
        expected: list(c.expected),
        spec: found.length ? { file: found[0].file, line: found[0].line, tests: found.length, projects: [...new Set(found.map((t) => t.project))] } : null,
      };
    });

  const catalog = { generatedAt: now.toISOString(), frameworkVersion: version, stats: stats(cases), areas: groupAreas(cases), cases };
  return { catalog, issues };
}

function stats(cases) {
  const count = (key) => cases.reduce((acc, c) => ({ ...acc, [c[key]]: (acc[c[key]] ?? 0) + 1 }), {});
  return { total: cases.length, byType: count('type'), byPriority: count('priority'), byAutomation: count('automation') };
}

function groupAreas(cases) {
  const areas = new Map();
  for (const c of cases) {
    if (!areas.has(c.area)) areas.set(c.area, new Map());
    const features = areas.get(c.area);
    if (!features.has(c.feature)) features.set(c.feature, []);
    features.get(c.feature).push(c.id);
  }
  return [...areas].map(([name, features]) => ({ name, features: [...features].map(([feature, ids]) => ({ name: feature, cases: ids })) }));
}

/** Appends draft definitions for tests that have none. Titles come from the test; nothing else is guessed. */
export function stubMissing({ root = process.cwd(), collected } = {}) {
  const { cases } = readDefinitions(root);
  const known = new Set(cases.map((c) => c.id));
  const tests = collected ?? collectTests({ root });
  const missing = new Map();
  for (const t of tests) if (t.id && !known.has(t.id) && !missing.has(t.id)) missing.set(t.id, t);
  if (!missing.size) return [];
  const dir = path.join(root, DEFINITIONS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'unsorted.yml');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'area: Unsorted\nfeature: Unsorted\ncases:\n';
  const entries = [...missing.values()]
    .map((t) => `  - id: ${t.id}\n    title: ${JSON.stringify(t.title.replace(/^TC\d+\s*[-:]?\s*/, ''))}\n    priority: medium\n    draft: true\n    spec: ${t.file}\n`)
    .join('');
  fs.writeFileSync(file, existing + entries);
  return [...missing.keys()];
}

export { nextId };
