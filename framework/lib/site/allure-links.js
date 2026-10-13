import fs from 'node:fs';
import path from 'node:path';
import { idFromTitle } from '../ids.js';

/**
 * Deep links from case IDs into a generated Allure 2 report: { TC0001: '#suites/<parentUid>/<uid>' }.
 * Read from data/suites.json. If the structure is not what we expect, the map is empty and callers fall back
 * to the report's front page: a link problem must never fail a publish.
 */
export function allureCaseLinks(reportDir) {
  const file = path.join(reportDir, 'data', 'suites.json');
  const links = {};
  if (!fs.existsSync(file)) return links;
  const walk = (node) => {
    if (node.uid && node.parentUid && node.name) {
      const id = idFromTitle(node.name);
      if (id && !links[id]) links[id] = `#suites/${node.parentUid}/${node.uid}`;
    }
    for (const child of node.children ?? []) walk(child);
  };
  try {
    walk(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return {};
  }
  return links;
}
