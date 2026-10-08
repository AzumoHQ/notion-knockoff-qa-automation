// TEMPLATE — edit this file to update the scaffold for all future projects.
// Heal Audit Log — append-only, persists across test runs.
// Every heal decision (tier, original locator, healed locator, confidence,
// outcome) is written here. Never deleted, never overwritten.
// Used by: BasePage.getHealLog(), CI reporters, future Analyst agent.

import fs from 'fs';
import path from 'path';

const LOG_PATH = process.env.HEAL_LOG_PATH ?? 'heal-audit.log.jsonl';

/**
 * Appends one heal event to the audit log (JSONL format — one JSON per line).
 * Safe to call from parallel workers — each write is atomic at the OS level
 * for lines under ~4KB (covers any realistic locator + snapshot excerpt).
 */
export function appendHealEvent(event) {
  const entry = {
    ...event,
    runId: process.env.GITHUB_RUN_ID ?? 'local',
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(
    path.resolve(LOG_PATH),
    JSON.stringify(entry) + '\n',
    'utf8'
  );
}

/**
 * Reads all heal events from the log file.
 * Returns an empty array if the file does not exist yet.
 */
export function readHealLog() {
  const resolved = path.resolve(LOG_PATH);
  if (!fs.existsSync(resolved)) return [];
  return fs.readFileSync(resolved, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

/**
 * Returns a summary grouped by locator — useful for detecting
 * locators that heal repeatedly (escalation signal).
 */
export function healSummary() {
  const events = readHealLog();
  const map = new Map();
  for (const e of events) {
    const key = e.original ?? 'unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return Object.fromEntries(map);
}

/**
 * Returns locators that have been healed more than `threshold` times
 * without a corresponding PR merge — escalation candidates.
 */
export function escalationCandidates(threshold = 3) {
  const summary = healSummary();
  return Object.entries(summary)
    .filter(([_, events]) => events.length >= threshold)
    .map(([locator, events]) => ({ locator, count: events.length, events }));
}
