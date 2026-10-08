import { expect } from '@playwright/test';

// The app persists through Supabase REST. A "write" is any non-GET call to /rest/v1/
// (permission lookups are POST rpc calls but read-only, so they are excluded).
const isWrite = (req) =>
  req.method() !== 'GET' && /\/rest\/v1\//.test(req.url()) && !/get_page_permissions/.test(req.url());

/**
 * Tracks in-flight writes so tests can wait for "really saved" before reloading.
 * settled() resolves once no write is pending and none has started for `quietMs`
 * (covers the editor's debounce between typing and the PATCH).
 */
export function trackWrites(page) {
  let inflight = 0;
  let lastActivity = 0;
  page.on('request', (r) => {
    if (isWrite(r)) {
      inflight++;
      lastActivity = Date.now();
    }
  });
  const done = (r) => {
    if (isWrite(r)) {
      inflight--;
      lastActivity = Date.now();
    }
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);

  return {
    async settled(quietMs = 1500) {
      const start = Date.now();
      await expect
        .poll(() => inflight === 0 && Date.now() - Math.max(lastActivity, start) >= quietMs, {
          message: 'pending writes to the backend never settled',
          timeout: 20_000,
        })
        .toBe(true);
    },
  };
}
