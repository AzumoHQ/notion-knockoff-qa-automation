// TEMPLATE — edit this file to update the scaffold for all future projects.
// Analyst Agent — Flaky test detection and quarantine module.
// Tracks test results across runs and identifies non-deterministic tests.
// Quarantined tests still run but their failures don't block CI.

import fs from 'fs';
import path from 'path';

const FLAKY_LOG_PATH = process.env.FLAKY_LOG_PATH ?? 'flaky-registry.jsonl';
const QUARANTINE_PATH = process.env.QUARANTINE_PATH ?? 'quarantine.json';
const FLAKY_WINDOW = parseInt(process.env.FLAKY_WINDOW ?? '5');
const FLAKY_THRESHOLD = parseInt(process.env.FLAKY_THRESHOLD ?? '2');
const QUARANTINE_BUDGET = parseFloat(process.env.QUARANTINE_BUDGET ?? '0.10');

export function recordResult(testTitle, passed, runId) {
  const entry = {
    testTitle,
    passed,
    runId: runId ?? process.env.GITHUB_RUN_ID ?? 'local',
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(
    path.resolve(FLAKY_LOG_PATH),
    JSON.stringify(entry) + '\n',
    'utf8'
  );
}

export function readFlakyLog() {
  const resolved = path.resolve(FLAKY_LOG_PATH);
  if (!fs.existsSync(resolved)) return [];
  return fs.readFileSync(resolved, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

export function detectFlaky() {
  const log = readFlakyLog();
  const byTest = new Map();
  for (const entry of log) {
    if (!byTest.has(entry.testTitle)) byTest.set(entry.testTitle, []);
    byTest.get(entry.testTitle).push(entry);
  }
  const flaky = [];
  for (const [testTitle, results] of byTest) {
    const window = results.slice(-FLAKY_WINDOW);
    const passes = window.filter(r => r.passed).length;
    const failures = window.filter(r => !r.passed).length;
    if (passes >= FLAKY_THRESHOLD && failures >= FLAKY_THRESHOLD) {
      flaky.push({
        testTitle,
        passes,
        failures,
        window: FLAKY_WINDOW,
        lastSeen: window.at(-1)?.timestamp,
      });
    }
  }
  return flaky;
}

export function readQuarantine() {
  const resolved = path.resolve(QUARANTINE_PATH);
  if (!fs.existsSync(resolved)) return [];
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

export function quarantine(testTitle, totalTests, reason) {
  const current = readQuarantine();
  const maxAllowed = Math.floor(totalTests * QUARANTINE_BUDGET);
  if (current.length >= maxAllowed) {
    console.warn(
      `[flaky-detector] Quarantine budget exhausted ` +
      `(${current.length}/${maxAllowed} tests). ` +
      `Manual review required before adding: "${testTitle}"`
    );
    return false;
  }
  if (current.find(t => t.testTitle === testTitle)) return false;
  current.push({
    testTitle,
    reason,
    quarantinedAt: new Date().toISOString(),
    expiresAt: getExpiryDate(),
  });
  fs.writeFileSync(
    path.resolve(QUARANTINE_PATH),
    JSON.stringify(current, null, 2),
    'utf8'
  );
  return true;
}

export function release(testTitle) {
  const current = readQuarantine();
  const updated = current.filter(t => t.testTitle !== testTitle);
  fs.writeFileSync(
    path.resolve(QUARANTINE_PATH),
    JSON.stringify(updated, null, 2),
    'utf8'
  );
}

export function expiredQuarantines() {
  const current = readQuarantine();
  const now = new Date();
  return current.filter(t => t.expiresAt && new Date(t.expiresAt) < now);
}

export function isQuarantined(testTitle) {
  return readQuarantine().some(t => t.testTitle === testTitle);
}

function getExpiryDate() {
  const days = parseInt(process.env.QUARANTINE_EXPIRY_DAYS ?? '14');
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}
