import { chromium } from '@playwright/test';
import { endpointTemplate } from './normalize.js';
import { documentedEndpoints, OPENAPI_CANDIDATES } from './openapi.js';

const LOGOUT = /log-?out|sign-?out|salir|cerrar sesi/i;
const SENSITIVE_HEADERS = ['authorization', 'apikey', 'cookie', 'x-api-key'];

/** Collects fetch/xhr calls as method + path template + status. Nothing else is kept. */
export class TrafficRecorder {
  constructor() {
    this.map = new Map();
    this.origins = new Set();
    this.probeHeaders = new Map(); // in memory only, used to read an API's own OpenAPI document; never written out
  }

  record({ method, url, status, headers = {} }) {
    const { origin, path, query } = endpointTemplate(url);
    if (!origin) return;
    this.origins.add(origin);
    const key = `${method} ${origin} ${path}`;
    const entry = this.map.get(key) ?? { method, origin, path, query: [], statuses: [], count: 0, authenticated: false };
    entry.count++;
    entry.query = [...new Set([...entry.query, ...query])].sort();
    entry.statuses = [...new Set([...entry.statuses, status])].sort();
    const names = Object.keys(headers).map((h) => h.toLowerCase());
    entry.authenticated ||= SENSITIVE_HEADERS.some((h) => names.includes(h));
    this.map.set(key, entry);
    const keep = Object.fromEntries(Object.entries(headers).filter(([h]) => SENSITIVE_HEADERS.slice(0, 2).includes(h.toLowerCase())));
    if (Object.keys(keep).length) this.probeHeaders.set(origin, keep);
  }

  toObserved(documented = [], now = new Date()) {
    return { generatedAt: now.toISOString(), origins: [...this.origins].sort(), endpoints: [...this.map.values()], documented };
  }
}

async function probeOpenApi(recorder, baseURL, fetchImpl = fetch) {
  const documented = [];
  const origins = new Set([new URL(baseURL).origin, ...recorder.origins]);
  for (const origin of origins) {
    for (const candidate of OPENAPI_CANDIDATES) {
      try {
        const res = await fetchImpl(origin + candidate, { headers: recorder.probeHeaders.get(origin) ?? {} });
        if (!res.ok || !/json/.test(res.headers.get('content-type') ?? '')) continue;
        const prefix = candidate.endsWith('/') ? candidate.replace(/\/$/, '') : '';
        const found = documentedEndpoints(await res.json(), { prefix });
        if (found.length) {
          documented.push(...found);
          break;
        }
      } catch {
        // unreachable candidate: try the next one
      }
    }
  }
  return documented;
}

/**
 * Walks the UI as the QA account (links only, no clicks, no form submits, no logout links), then runs the
 * optional flows, and records the API traffic it saw. Also reads an OpenAPI document when one is exposed.
 */
export async function discover({ baseURL, storageState, headers = {}, maxPages = 15, flows = [], probe = true, fetchImpl }) {
  const recorder = new TrafficRecorder();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL, storageState, extraHTTPHeaders: headers });
    const page = await context.newPage();
    page.on('response', async (response) => {
      const request = response.request();
      if (!['fetch', 'xhr'].includes(request.resourceType())) return;
      recorder.record({ method: request.method(), url: request.url(), status: response.status(), headers: await request.allHeaders().catch(() => ({})) });
    });
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    const origin = new URL(baseURL).origin;
    const links = await page.$$eval('a[href]', (anchors) => anchors.map((a) => ({ href: a.href, text: a.textContent ?? '' })));
    const targets = [...new Set(links.filter((l) => l.href.startsWith(origin) && !LOGOUT.test(l.href + l.text)).map((l) => l.href.split('#')[0]))].slice(0, maxPages);
    for (const target of targets) {
      await page.goto(target, { waitUntil: 'networkidle' }).catch(() => {});
    }
    for (const flow of flows) await flow(page, { baseURL });
    await context.close();
  } finally {
    await browser.close();
  }
  const documented = probe ? await probeOpenApi(recorder, baseURL, fetchImpl) : [];
  return recorder.toObserved(documented);
}
