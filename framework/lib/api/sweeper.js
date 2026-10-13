import { DEFAULT_PREFIX, createdAtFromName } from './registry.js';

export function parseDuration(text) {
  const m = /^(\d+)\s*(m|h|d)$/.exec(String(text).trim());
  if (!m) throw new Error(`Invalid duration "${text}" (use 30m, 2h or 1d)`);
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}

/**
 * Deletes leftovers of earlier runs. A resource is only touched when ALL hold:
 *  - it is visible to the QA account the API session logs in as (the list call is scoped by that account),
 *  - its name starts with the QA prefix,
 *  - it is older than `olderThanMs` (created time from the resource, else decoded from the name),
 *  - the number of candidates does not exceed `max` (a runaway filter aborts instead of mass-deleting).
 */
export async function sweep({ resources, api, prefix = DEFAULT_PREFIX, olderThanMs = 2 * 3_600_000, max = 200, dryRun = false, now = Date.now() }) {
  const report = { checked: 0, deleted: [], skippedRecent: 0, skippedForeign: 0, failed: [], dryRun };
  const candidates = [];
  for (const [kind, definition] of Object.entries(resources)) {
    if (!definition.list) continue;
    for (const item of await definition.list(api, { prefix })) {
      report.checked++;
      if (!item.name?.startsWith(prefix)) {
        report.skippedForeign++;
        continue;
      }
      const created = item.createdAt ? Date.parse(item.createdAt) : createdAtFromName(item.name, prefix);
      if (!created || now - created < olderThanMs) {
        report.skippedRecent++;
        continue;
      }
      candidates.push({ kind, id: item.id, name: item.name });
    }
  }
  if (candidates.length > max) throw new Error(`Refusing to delete ${candidates.length} resources (limit ${max}). Check the prefix and filters, then raise --max if this is right.`);
  for (const item of candidates) {
    if (dryRun) {
      report.deleted.push(item);
      continue;
    }
    try {
      await resources[item.kind].remove(api, item);
      report.deleted.push(item);
    } catch (error) {
      report.failed.push({ ...item, error: String(error.message).slice(0, 200) });
    }
  }
  return report;
}
