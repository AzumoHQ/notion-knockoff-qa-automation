import { parseFailure, parseExpression, proposeReplacement } from '../lib/heal/locator.js';

const MAX_SNAPSHOT = 60_000;

/**
 * UI fixtures for selector healing in SUGGESTION mode. When a test fails because an action could not find its
 * element, this captures an ARIA snapshot of the open pages while they are still open, proposes a replacement,
 * checks it against the live page and attaches the result. The test still fails: nothing is retried, clicked or
 * changed here. `qa heal` later maps the proposal to source code.
 */
export const healFixtures = {
  _healSuggestions: [
    async ({ context }, use, testInfo) => {
      await use();
      if (testInfo.status === testInfo.expectedStatus || !['failed', 'timedOut'].includes(testInfo.status)) return;
      const message = testInfo.errors?.[0]?.message ?? testInfo.error?.message ?? '';
      const failure = parseFailure(message);
      if (failure.kind !== 'action' || !failure.expression) return;
      const parsed = parseExpression(failure.expression);
      const found = [];
      const snapshots = [];
      for (const page of context.pages()) {
        const snapshot = await page.ariaSnapshot({ timeout: 3_000 }).catch(() => null);
        if (!snapshot) continue;
        snapshots.push({ url: new URL(page.url(), 'http://x.invalid').pathname, snapshot: snapshot.slice(0, MAX_SNAPSHOT) });
        const proposal = proposeReplacement({ parsed, snapshot, action: failure.action });
        if (proposal.status === 'suggested') {
          const target = page.getByRole(proposal.candidate.role, { name: proposal.candidate.name, exact: true });
          const count = await target.count().catch(() => -1);
          const visible = count === 1 ? await target.isVisible().catch(() => false) : false;
          const enabled = count === 1 ? await target.isEnabled().catch(() => undefined) : undefined;
          found.push({ ...proposal, live: { count, visible, enabled } });
        } else {
          found.push(proposal);
        }
      }
      const suggested = found.filter((p) => p.status === 'suggested');
      const replacements = new Set(suggested.map((p) => p.replacement));
      let result;
      if (replacements.size === 1) result = suggested[0];
      else if (replacements.size > 1) result = { status: 'ambiguous', reason: 'open pages suggest different replacements' };
      else result = found.find((p) => p.status === 'ambiguous') ?? found[0] ?? { status: 'none', reason: 'no page could be inspected' };
      await testInfo.attach('heal-proposal', { body: JSON.stringify({ ...result, original: failure.expression, action: failure.action }), contentType: 'application/json' });
      // Page text may be sensitive: this one is dropped from anything published (see framework/lib/site/sanitize.js).
      await testInfo.attach('heal-evidence', { body: JSON.stringify(snapshots), contentType: 'application/json' });
    },
    { auto: true },
  ],
};
