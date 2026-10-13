import fs from 'node:fs';
import path from 'node:path';
import { ApiSession } from '../lib/api/session.js';
import { CreatedResources, DEFAULT_PREFIX } from '../lib/api/registry.js';
import { CALLS_DIR } from '../lib/api/coverage.js';

/**
 * API fixtures. Spread into `test.extend` together with `qaFixtures` and pass your config:
 *   export const test = base.extend({ ...qaFixtures, ...apiFixtures(apiConfig, PROFILES) })
 *  - `api`:  one authenticated session per worker (shared, read-mostly).
 *  - `seed`: per test; `await seed.create('page', {...})` registers what it creates and removes it when
 *            the test ends, passed or failed. Names are unique per call, so parallel tests never collide.
 * UI tests use `seed`; they never run API tests as a dependency.
 */
export function apiFixtures(config, profiles) {
  const prefix = config.prefix ?? DEFAULT_PREFIX;
  return {
    api: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use, workerInfo) => {
        const session = await ApiSession.create({ config, profiles });
        session.project = workerInfo.project.name;
        await use(session);
        // One file per worker: `qa api-coverage` merges them.
        fs.mkdirSync(CALLS_DIR, { recursive: true });
        fs.writeFileSync(path.join(CALLS_DIR, `worker-${workerInfo.workerIndex}-${process.pid}.json`), JSON.stringify(session.calls));
        await session.dispose();
      },
      { scope: 'worker' },
    ],
    seed: async ({ api }, use, testInfo) => {
      const created = new CreatedResources({ resources: config.resources ?? {}, api, prefix });
      await use(created);
      const failures = await created.cleanup();
      for (const f of failures) {
        testInfo.annotations.push({ type: 'cleanup-failed', description: `${f.kind} ${f.name}: ${f.error}` });
      }
    },
  };
}
