// TEMPLATE — edit this file to update the scaffold for all future projects.
// Analyst Agent — Root-cause analysis module.
// Reads test failure context (error, trace, diff) and produces a structured
// diagnosis. In Phase 3, this diagnosis is written back to the ticket via
// the Work Management Connector.

import fs from 'fs';
import path from 'path';
import { readHealLog } from '../pages/heal-audit-log.js';

const DIAGNOSIS_PATH = process.env.DIAGNOSIS_PATH ?? 'analyst-diagnosis.jsonl';

/**
 * Builds a diagnosis object from a test failure.
 * @param {object} failure - { testTitle, error, traceFile, screenshotFile }
 * @returns {object} diagnosis
 */
export function buildDiagnosis(failure) {
  const healLog = readHealLog();
  const relatedHeals = healLog.filter(h =>
    h.original && failure.error?.includes(h.original)
  );

  const category = categorizeFailure(failure.error ?? '');

  return {
    testTitle: failure.testTitle,
    category,
    summary: buildSummary(category, failure.error, relatedHeals),
    relatedHeals: relatedHeals.length,
    hasTrace: !!failure.traceFile && fs.existsSync(failure.traceFile),
    hasScreenshot: !!failure.screenshotFile && fs.existsSync(failure.screenshotFile),
    reproSteps: buildReproSteps(category, failure),
    suggestedAction: suggestAction(category, relatedHeals),
    severity: assessSeverity(category, relatedHeals),
    timestamp: new Date().toISOString(),
    runId: process.env.GITHUB_RUN_ID ?? 'local',
  };
}

/**
 * Appends a diagnosis to the diagnosis log (JSONL).
 */
export function appendDiagnosis(diagnosis) {
  fs.appendFileSync(
    path.resolve(DIAGNOSIS_PATH),
    JSON.stringify(diagnosis) + '\n',
    'utf8'
  );
}

/**
 * Reads all diagnoses from the log.
 */
export function readDiagnosisLog() {
  const resolved = path.resolve(DIAGNOSIS_PATH);
  if (!fs.existsSync(resolved)) return [];
  return fs.readFileSync(resolved, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// ── CATEGORIZATION ──────────────────────────────────────────────────────

export function categorizeFailure(error) {
  if (/locator|selector|element not found|strict mode/i.test(error))
    return 'selector-broken';
  if (/timeout|exceeded|waiting for/i.test(error))
    return 'timing';
  if (/network|fetch|ERR_|ECONNREFUSED|502|503/i.test(error))
    return 'network';
  if (/assertion|expect|toBe|toEqual|toContain/i.test(error))
    return 'assertion';
  if (/auth|unauthorized|403|401|login/i.test(error))
    return 'auth';
  return 'unknown';
}

function buildSummary(category, error, relatedHeals) {
  const base = {
    'selector-broken': 'A UI element could not be located — selector may have changed.',
    'timing':          'Test timed out waiting for an element or network response.',
    'network':         'A network request failed or returned an unexpected status.',
    'assertion':       'A value in the UI did not match the expected value.',
    'auth':            'Authentication failed — session may have expired.',
    'unknown':         'Unexpected failure — review trace for details.',
  }[category] ?? 'Unknown failure.';

  return relatedHeals.length > 0
    ? `${base} Note: ${relatedHeals.length} heal event(s) recorded for related locators.`
    : base;
}

function buildReproSteps(category, failure) {
  const steps = [`1. Run: npx playwright test --grep "${failure.testTitle}" --headed`];
  if (category === 'selector-broken')
    steps.push('2. Inspect the element in DevTools — check if data-testid changed.');
  if (category === 'timing')
    steps.push('2. Check network tab for slow responses — consider increasing timeout.');
  if (category === 'auth')
    steps.push('2. Verify storageState is fresh — re-run global-setup.');
  if (failure.traceFile)
    steps.push(`3. Open trace: npx playwright show-trace ${failure.traceFile}`);
  return steps;
}

function suggestAction(category, relatedHeals) {
  if (relatedHeals.length >= 3) return 'escalate — locator healed 3+ times, structural fix needed';
  return {
    'selector-broken': 'update locator in Page Object or wait for Healer auto-PR',
    'timing':          'add explicit wait or increase timeout in playwright.config.js',
    'network':         'check environment health — may be transient',
    'assertion':       'review expected value — UI or business logic may have changed',
    'auth':            'regenerate storageState via npm run setup',
    'unknown':         'open trace file for detailed step-by-step replay',
  }[category] ?? 'review trace';
}

function assessSeverity(category, relatedHeals) {
  if (relatedHeals.length >= 3) return 'high';
  if (category === 'auth' || category === 'network') return 'high';
  if (category === 'assertion') return 'medium';
  return 'low';
}
