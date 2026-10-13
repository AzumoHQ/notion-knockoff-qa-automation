import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const Q = `['"\`]`;
const text = (s) => `${Q}${esc(s).replace(/'/g, "\\\\?'")}${Q}`;

/** A regex that finds the failing locator in source code, tolerant to quotes and spacing but exact on content. */
export function sourcePattern(parsed) {
  const chain = esc(parsed.chain ?? '');
  if (parsed.method === 'getByRole') {
    const opts = parsed.text === undefined ? '' : `\\s*,\\s*\\{\\s*name:\\s*${text(parsed.text)}${parsed.exactGiven ? `\\s*,\\s*exact:\\s*${parsed.exact}` : ''}\\s*\\}`;
    return new RegExp(`getByRole\\(\\s*${text(parsed.role)}${opts}\\s*\\)${chain}`, 'g');
  }
  const exact = parsed.exactGiven ? `\\s*,\\s*\\{\\s*exact:\\s*${parsed.exact}\\s*\\}` : '';
  return new RegExp(`${parsed.method}\\(\\s*${text(parsed.text)}${exact}\\s*\\)${chain}`, 'g');
}

function* sourceFiles(root, dirs) {
  for (const dir of dirs) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/\.(js|mjs|ts)$/.test(entry.name)) yield full;
      }
    }
  }
}

/**
 * Finds the one place in the project where the failing locator is written.
 * Returns { status: 'found', file, line, match, original } or { status: 'not-found' | 'ambiguous' | 'assertion-target', ... }.
 * A locator written inside an expect(...) is the target of an assertion and is never patched.
 */
export function findInSource({ root, parsed, dirs = ['pages', 'tests', 'fixtures', 'utils'] }) {
  const hits = [];
  for (const file of sourceFiles(root, dirs)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const m of content.matchAll(sourcePattern(parsed))) {
      const lineStart = content.lastIndexOf('\n', m.index) + 1;
      const before = content.slice(lineStart, m.index);
      hits.push({ file: path.relative(root, file), index: m.index, match: m[0], line: content.slice(0, m.index).split('\n').length, inExpect: /expect\(\s*[\w.$]*$/.test(before) || /expect\([^;]*$/.test(before) });
    }
  }
  if (!hits.length) return { status: 'not-found', reason: 'the locator is not written literally in the project (built dynamically or from a variable)' };
  if (hits.length > 1) return { status: 'ambiguous', reason: `the locator appears ${hits.length} times (${hits.map((h) => `${h.file}:${h.line}`).join(', ')})`, locations: hits.map((h) => `${h.file}:${h.line}`) };
  const [hit] = hits;
  if (hit.inExpect) return { status: 'assertion-target', reason: 'the locator is written inside an expect(): assertions are never changed', file: hit.file, line: hit.line };
  return { status: 'found', file: hit.file, line: hit.line, index: hit.index, match: hit.match };
}

/**
 * Where else the candidate's name is already used as a locator. A name the project already targets on purpose
 * belongs to another element with its own purpose, so pointing a second, different locator at it is suspicious.
 */
export function findNameElsewhere({ root, name, except, dirs = ['pages', 'tests', 'fixtures', 'utils'] }) {
  const pattern = new RegExp(`(?:name:\\s*|getBy\\w+\\(\\s*)${text(name)}`, 'g');
  const places = [];
  for (const file of sourceFiles(root, dirs)) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    for (const m of content.matchAll(pattern)) {
      const line = content.slice(0, m.index).split('\n').length;
      if (rel === except.file && line === except.line) continue;
      places.push(`${rel}:${line}`);
    }
  }
  return places;
}

/** The file content with the matched locator replaced. Touches nothing else on the line or in the file. */
export function applyReplacement(content, hit, replacement) {
  if (content.slice(hit.index, hit.index + hit.match.length) !== hit.match) throw new Error('the file changed since the locator was found');
  return content.slice(0, hit.index) + replacement + content.slice(hit.index + hit.match.length);
}

/** Unified diff of a one-line change, accepted by `git apply` (checked in tests, including first and last lines). */
export function unifiedDiff(file, before, after) {
  const lines = (text) => {
    const parts = text.split('\n');
    if (parts.at(-1) === '') parts.pop();
    return parts;
  };
  const a = lines(before);
  const b = lines(after);
  const i = a.findIndex((line, n) => line !== b[n]);
  if (i < 0) return '';
  const from = Math.max(0, i - 3);
  const to = Math.min(a.length, i + 4);
  const body = [];
  const noEol = '\\ No newline at end of file';
  const lastLineHasNoEol = !before.endsWith('\n');
  for (let n = from; n < to; n++) {
    const atEnd = lastLineHasNoEol && n === a.length - 1;
    if (n === i) body.push(`-${a[n]}`, ...(atEnd ? [noEol] : []), `+${b[n]}`, ...(atEnd ? [noEol] : []));
    else body.push(` ${a[n]}`, ...(atEnd ? [noEol] : []));
  }
  const count = to - from;
  return [`--- a/${file}`, `+++ b/${file}`, `@@ -${from + 1},${count} +${from + 1},${count} @@`, ...body, ''].join('\n');
}
